import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  _id: Types.ObjectId;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ trim: true })
  name?: string;

  // --- Email verification (OTP via Resend) ---
  @Prop({ default: false })
  isVerified: boolean;

  @Prop()
  otpHash?: string;

  @Prop()
  otpExpiresAt?: Date;

  @Prop({ default: 0 })
  otpAttempts: number;

  @Prop()
  otpLastSentAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
