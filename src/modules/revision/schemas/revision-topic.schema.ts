import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RevisionTopicDocument = RevisionTopic & Document;

@Schema({ _id: false })
export class RevisionHistoryEntry {
  @Prop({ required: true })
  transcript: string;

  @Prop({ required: true })
  summary: string;

  @Prop({ type: [String], default: [] })
  keyPoints: string[];

  @Prop({ required: true, min: 0, max: 5 })
  understandingScore: number;

  @Prop({ default: () => new Date() })
  studiedAt: Date;
}

export const RevisionHistoryEntrySchema =
  SchemaFactory.createForClass(RevisionHistoryEntry);

@Schema({ timestamps: true })
export class RevisionTopic {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  // Human-readable topic name, e.g. "Photosynthesis"
  @Prop({ required: true, trim: true })
  title: string;

  // Lowercased/trimmed key used to match new study sessions to this topic
  @Prop({ required: true, trim: true, index: true })
  normalizedTitle: string;

  @Prop()
  latestSummary?: string;

  // --- SM-2 spaced-repetition scheduling state ---
  @Prop({ default: 0 })
  repetitions: number;

  @Prop({ default: 2.5 })
  easeFactor: number;

  @Prop({ default: 0 })
  intervalDays: number;

  @Prop()
  lastRevisedAt?: Date;

  @Prop({ required: true, index: true })
  nextRevisionAt: Date;

  // Set true once a reminder has gone out for the current nextRevisionAt;
  // reset to false every time the schedule is recomputed.
  @Prop({ default: false })
  reminderSent: boolean;

  @Prop()
  reminderSentAt?: Date;

  @Prop({ type: [RevisionHistoryEntrySchema], default: [] })
  history: RevisionHistoryEntry[];
}

export const RevisionTopicSchema = SchemaFactory.createForClass(RevisionTopic);

// One document per (user, topic) pair
RevisionTopicSchema.index({ userId: 1, normalizedTitle: 1 }, { unique: true });
