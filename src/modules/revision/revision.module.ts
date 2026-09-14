import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  RevisionTopic,
  RevisionTopicSchema,
} from './schemas/revision-topic.schema';
import { RevisionService } from './revision.service';
import { RevisionController } from './revision.controller';
import { ReminderScheduler } from './reminder.scheduler';
import { GeminiModule } from '../../common/gemini/gemini.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RevisionTopic.name, schema: RevisionTopicSchema },
    ]),
    GeminiModule,
    UsersModule,
  ],
  controllers: [RevisionController],
  providers: [RevisionService, ReminderScheduler],
})
export class RevisionModule {}
