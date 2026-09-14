import { IsEmail, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsEmail()
  email: string;

  @Matches(/^\d{6}$/, { message: 'otp must be a 6-digit code' })
  otp: string;
}
