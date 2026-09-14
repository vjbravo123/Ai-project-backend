import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Model } from 'mongoose';
import { MailService } from '../../common/mail/mail.service';
import { UsersService } from '../users/users.service';
import {
  RevisionTopic,
  RevisionTopicDocument,
} from './schemas/revision-topic.schema';

const CRON_JOB_NAME = 'revision-reminder-sweep';
const DEFAULT_CRON_EXPRESSION = '*/10 * * * *'; // every 10 minutes

/**
 * Periodically sweeps for revision topics whose SM-2 schedule says they're
 * due, and emails the owning user a reminder via Resend. This is the "send
 * reminder after that time" half of the feature — the SM-2 engine in
 * RevisionService decides *when*, this decides *that it actually goes out*.
 */
@Injectable()
export class ReminderScheduler {
  private readonly logger = new Logger(ReminderScheduler.name);

  constructor(
    @InjectModel(RevisionTopic.name)
    private readonly topicModel: Model<RevisionTopicDocument>,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    const cronExpression =
      this.config.get<string>('REVISION_REMINDER_CRON') ??
      DEFAULT_CRON_EXPRESSION;

    const job = new CronJob(cronExpression, () => this.sweepDueReminders());
    this.schedulerRegistry.addCronJob(CRON_JOB_NAME, job);
    job.start();
    this.logger.log(`Revision reminder sweep scheduled: "${cronExpression}"`);
  }

  async sweepDueReminders() {
    const dueTopics = await this.topicModel
      .find({ nextRevisionAt: { $lte: new Date() }, reminderSent: false })
      .exec();

    if (dueTopics.length === 0) return;

    this.logger.log(`Found ${dueTopics.length} due revision reminder(s)`);

    for (const topic of dueTopics) {
      try {
        const user = await this.usersService.findById(topic.userId.toString());
        if (!user) continue;

        await this.mailService.sendRevisionReminderEmail({
          to: user.email,
          topic: topic.title,
          summary: topic.latestSummary,
          dueSince: topic.nextRevisionAt,
        });

        topic.reminderSent = true;
        topic.reminderSentAt = new Date();
        await topic.save();
      } catch (err) {
        // One failed reminder (e.g. a bad email) should never block the rest.
        this.logger.error(
          `Failed to send revision reminder for topic ${topic._id.toString()}`,
          err as Error,
        );
      }
    }
  }
}
