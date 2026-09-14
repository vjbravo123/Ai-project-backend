import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { z } from 'zod';
import { GeminiService } from '../../common/gemini/gemini.service';
import { computeNextSchedule } from './scheduling/sm2';
import {
  RevisionTopic,
  RevisionTopicDocument,
} from './schemas/revision-topic.schema';

const StudyAnalysisSchema = z.object({
  transcript: z
    .string()
    .describe(
      'Clean, readable transcript of what the user said or wrote about what they studied. If audio was provided, transcribe it faithfully (light cleanup of filler words is fine). If only text was provided, echo it back, lightly tidied.',
    ),
  topic: z
    .string()
    .describe(
      '2-6 word normalized subject/topic name for what was studied, e.g. "Photosynthesis" or "React useEffect Hook". Reuse consistent naming for the same subject.',
    ),
  summary: z
    .string()
    .describe(
      '2-3 sentence summary of what the user studied or learned, in their own words.',
    ),
  keyPoints: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe('The key facts, definitions, or concepts the user mentioned.'),
  understandingScore: z
    .number()
    .int()
    .min(0)
    .max(5)
    .describe(
      'How well the user seems to understand/recall this topic right now, judged from the clarity, correctness, depth and confidence of their explanation. ' +
        '0 = could not recall or explain anything correctly. ' +
        '2 = recalled some fragments but with significant gaps or errors. ' +
        '3 = mostly correct explanation but with hesitation or minor gaps. ' +
        '4 = clear and correct explanation with only small hesitations. ' +
        '5 = explained fully, correctly and confidently with no notable gaps.',
    ),
});

const STUDY_ANALYSIS_INSTRUCTION = `
You are helping a student log a study/revision session for a spaced-repetition
app. Analyze what they said or wrote about what they just studied and return
the structured fields describing it. Judge understandingScore strictly based
on the substance of their explanation, not their tone alone.
`.trim();

@Injectable()
export class RevisionService {
  constructor(
    @InjectModel(RevisionTopic.name)
    private readonly topicModel: Model<RevisionTopicDocument>,
    private readonly gemini: GeminiService,
  ) {}

  /** Log a study session captured as spoken audio (frontend recording). */
  async logFromAudio(
    userId: string,
    audio: { base64: string; mimeType: string },
  ) {
    const analysis = await this.gemini.analyzeStudyInput({
      instructionText: `${STUDY_ANALYSIS_INSTRUCTION}\n\nThe student's study session was recorded as audio. Transcribe it and analyze it.`,
      schema: StudyAnalysisSchema,
      audio,
    });

    return this.applyAnalysis(userId, analysis);
  }

  /** Log a study session from typed text (or text already transcribed client-side). */
  async logFromText(userId: string, text: string) {
    const analysis = await this.gemini.analyzeStudyInput({
      instructionText: `${STUDY_ANALYSIS_INSTRUCTION}\n\nThe student typed the following about what they studied:\n"""\n${text}\n"""`,
      schema: StudyAnalysisSchema,
    });

    return this.applyAnalysis(userId, analysis);
  }

  /** Manually record a revision review (e.g. a quiz result) without re-analyzing speech. */
  async reviewTopic(userId: string, topicId: string, quality: number) {
    const topic = await this.findOwnedTopic(userId, topicId);
    this.rescheduleAndSave(topic, quality);
    await topic.save();
    return topic;
  }

  async listTopics(userId: string) {
    return this.topicModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ nextRevisionAt: 1 })
      .exec();
  }

  async getDueTopics(userId: string) {
    return this.topicModel
      .find({
        userId: new Types.ObjectId(userId),
        nextRevisionAt: { $lte: new Date() },
      })
      .sort({ nextRevisionAt: 1 })
      .exec();
  }

  async deleteTopic(userId: string, topicId: string) {
    const topic = await this.findOwnedTopic(userId, topicId);
    await topic.deleteOne();
    return { deleted: true };
  }

  private async applyAnalysis(
    userId: string,
    analysis: z.infer<typeof StudyAnalysisSchema>,
  ) {
    const normalizedTitle = this.normalize(analysis.topic);
    const userObjectId = new Types.ObjectId(userId);

    let topic = await this.topicModel.findOne({
      userId: userObjectId,
      normalizedTitle,
    });

    if (!topic) {
      topic = new this.topicModel({
        userId: userObjectId,
        title: analysis.topic,
        normalizedTitle,
        repetitions: 0,
        easeFactor: 2.5,
        intervalDays: 0,
        nextRevisionAt: new Date(),
        reminderSent: false,
        history: [],
      });
    }

    topic.history.push({
      transcript: analysis.transcript,
      summary: analysis.summary,
      keyPoints: analysis.keyPoints,
      understandingScore: analysis.understandingScore,
      studiedAt: new Date(),
    });
    topic.latestSummary = analysis.summary;

    this.rescheduleAndSave(topic, analysis.understandingScore);
    await topic.save();
    return topic;
  }

  /** Runs the SM-2 rule engine and mutates the topic's scheduling fields. */
  private rescheduleAndSave(topic: RevisionTopicDocument, quality: number) {
    const now = new Date();
    const result = computeNextSchedule(
      {
        repetitions: topic.repetitions,
        easeFactor: topic.easeFactor,
        intervalDays: topic.intervalDays,
      },
      quality,
      now,
    );

    topic.repetitions = result.repetitions;
    topic.easeFactor = result.easeFactor;
    topic.intervalDays = result.intervalDays;
    topic.lastRevisedAt = now;
    topic.nextRevisionAt = result.nextRevisionAt;
    topic.reminderSent = false;
    topic.reminderSentAt = undefined;
  }

  private async findOwnedTopic(userId: string, topicId: string) {
    const topic = await this.topicModel.findById(topicId).exec();
    if (!topic) throw new NotFoundException('Revision topic not found');
    if (topic.userId.toString() !== userId) {
      throw new ForbiddenException(
        'This revision topic does not belong to you',
      );
    }
    return topic;
  }

  private normalize(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ');
  }
}
