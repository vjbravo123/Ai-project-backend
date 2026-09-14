import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { MailService } from '../../common/mail/mail.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';

@Injectable()
export class AuthService {
  private readonly otpTtlMinutes: number;
  private readonly otpResendCooldownSeconds: number;
  private readonly otpMaxAttempts: number;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {
    this.otpTtlMinutes = Number(this.config.get('OTP_TTL_MINUTES') ?? 10);
    this.otpResendCooldownSeconds = Number(
      this.config.get('OTP_RESEND_COOLDOWN_SECONDS') ?? 60,
    );
    this.otpMaxAttempts = Number(this.config.get('OTP_MAX_ATTEMPTS') ?? 5);
  }

  /**
   * Step 1 of registration: create (or refresh) an unverified account and
   * email a one-time code via Resend. No tokens are issued yet — the
   * account only becomes usable after verifyOtp() succeeds.
   */
  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing?.isVerified) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const otp = this.generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpiresAt = this.nextOtpExpiry();

    if (existing) {
      this.assertCanResend(existing.otpLastSentAt);
      await this.usersService.updatePendingRegistration(
        existing._id.toString(),
        {
          passwordHash,
          name: dto.name,
          otpHash,
          otpExpiresAt,
        },
      );
    } else {
      await this.usersService.create({
        email: dto.email,
        passwordHash,
        name: dto.name,
        otpHash,
        otpExpiresAt,
      });
    }

    await this.mailService.sendOtpEmail(dto.email, otp, 'verify');

    return {
      message: 'Verification code sent to your email.',
      email: dto.email.toLowerCase(),
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || user.isVerified || !user.otpHash || !user.otpExpiresAt) {
      throw new BadRequestException('Invalid or already verified account');
    }

    if (user.otpAttempts >= this.otpMaxAttempts) {
      throw new BadRequestException(
        'Too many incorrect attempts. Please request a new code.',
      );
    }

    if (user.otpExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Code expired. Please request a new one.');
    }

    const valid = await bcrypt.compare(dto.otp, user.otpHash);
    if (!valid) {
      await this.usersService.incrementOtpAttempts(user._id.toString());
      throw new UnauthorizedException('Incorrect verification code');
    }

    const verified = await this.usersService.markVerified(user._id.toString());
    if (!verified) {
      throw new BadRequestException('Could not verify account');
    }

    return this.buildTokenResponse(verified._id.toString(), verified.email);
  }

  async resendOtp(dto: ResendOtpDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || user.isVerified) {
      throw new BadRequestException('Invalid or already verified account');
    }

    this.assertCanResend(user.otpLastSentAt);

    const otp = this.generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    await this.usersService.setOtp(
      user._id.toString(),
      otpHash,
      this.nextOtpExpiry(),
    );
    await this.mailService.sendOtpEmail(user.email, otp, 'resend');

    return { message: 'A new verification code has been sent.' };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials');

    if (!user.isVerified) {
      throw new UnauthorizedException(
        'Please verify your email before logging in',
      );
    }

    return this.buildTokenResponse(user._id.toString(), user.email);
  }

  private buildTokenResponse(userId: string, email: string) {
    const accessToken = this.jwtService.sign({ sub: userId, email });
    return {
      accessToken,
      user: { id: userId, email },
    };
  }

  private generateOtp(): string {
    // 6-digit numeric code, zero-padded (e.g. "004821")
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private nextOtpExpiry(): Date {
    return new Date(Date.now() + this.otpTtlMinutes * 60_000);
  }

  private assertCanResend(lastSentAt?: Date) {
    if (
      lastSentAt &&
      Date.now() - lastSentAt.getTime() < this.otpResendCooldownSeconds * 1000
    ) {
      const waitSeconds = Math.ceil(
        (this.otpResendCooldownSeconds * 1000 -
          (Date.now() - lastSentAt.getTime())) /
          1000,
      );
      throw new BadRequestException(
        `Please wait ${waitSeconds}s before requesting another code`,
      );
    }
  }
}
