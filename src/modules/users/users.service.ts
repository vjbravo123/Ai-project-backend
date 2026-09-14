import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  findByEmail(email: string) {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  findById(id: string) {
    return this.userModel.findById(id).exec();
  }

  create(data: {
    email: string;
    passwordHash: string;
    name?: string;
    otpHash: string;
    otpExpiresAt: Date;
  }) {
    return this.userModel.create({
      email: data.email.toLowerCase(),
      passwordHash: data.passwordHash,
      name: data.name,
      isVerified: false,
      otpHash: data.otpHash,
      otpExpiresAt: data.otpExpiresAt,
      otpAttempts: 0,
      otpLastSentAt: new Date(),
    });
  }

  /** Overwrites a still-unverified pending signup with fresh credentials + a new OTP. */
  async updatePendingRegistration(
    userId: string,
    data: {
      passwordHash: string;
      name?: string;
      otpHash: string;
      otpExpiresAt: Date;
    },
  ) {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        {
          passwordHash: data.passwordHash,
          name: data.name,
          otpHash: data.otpHash,
          otpExpiresAt: data.otpExpiresAt,
          otpAttempts: 0,
          otpLastSentAt: new Date(),
        },
        { new: true },
      )
      .exec();
  }

  async setOtp(userId: string, otpHash: string, otpExpiresAt: Date) {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { otpHash, otpExpiresAt, otpAttempts: 0, otpLastSentAt: new Date() },
        { new: true },
      )
      .exec();
  }

  async incrementOtpAttempts(userId: string) {
    return this.userModel
      .findByIdAndUpdate(userId, { $inc: { otpAttempts: 1 } }, { new: true })
      .exec();
  }

  async markVerified(userId: string) {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        {
          isVerified: true,
          $unset: { otpHash: '', otpExpiresAt: '', otpLastSentAt: '' },
          otpAttempts: 0,
        },
        { new: true },
      )
      .exec();
  }
}
