import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/**
 * Single place that knows how to send transactional email via Resend.
 * Uses the domain/API key configured in RESEND_API_KEY / RESEND_FROM_EMAIL.
 * Every feature that needs to email a user (OTP verification, revision
 * reminders, etc.) should go through this service instead of touching
 * the Resend SDK directly.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend;
  private readonly fromEmail: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not set in the environment');
    }

    this.resend = new Resend(apiKey);
    this.fromEmail =
      this.config.get<string>('RESEND_FROM_EMAIL') ?? 'onboarding@resend.dev';
  }

  async sendOtpEmail(
    to: string,
    otp: string,
    purpose: 'verify' | 'resend' = 'verify',
  ) {
    const subject =
      purpose === 'resend'
        ? 'Your new verification code'
        : 'Verify your email address';

    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;">Confirm it's you</h2>
        <p style="margin:0 0 16px;color:#333;">Use the code below to verify your email. It expires in a few minutes.</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f4f4f5;padding:16px 24px;border-radius:8px;text-align:center;margin:0 0 16px;">
          ${otp}
        </div>
        <p style="margin:0;color:#888;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
      </div>`;

    await this.send({ to, subject, html });
  }

  async sendRevisionReminderEmail(params: {
    to: string;
    topic: string;
    summary?: string;
    dueSince: Date;
  }) {
    const { to, topic, summary, dueSince } = params;

    const html = `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;">Time to revise: ${this.escapeHtml(topic)}</h2>
        ${summary ? `<p style="margin:0 0 16px;color:#333;">${this.escapeHtml(summary)}</p>` : ''}
        <p style="margin:0 0 16px;color:#555;">Based on how well you recalled this last time, this topic was due for revision on ${dueSince.toLocaleString()}.</p>
        <p style="margin:0;color:#888;font-size:13px;">Open the app and speak through what you remember to keep your streak going.</p>
      </div>`;

    await this.send({ to, subject: `Revise now: ${topic}`, html });
  }

  private async send(params: { to: string; subject: string; html: string }) {
    try {
      const result = await this.resend.emails.send({
        from: this.fromEmail,
        to: params.to,
        subject: params.subject,
        html: params.html,
      });

      if (result.error) {
        this.logger.error(`Resend rejected the email: ${result.error.message}`);
        throw new ServiceUnavailableException('Failed to send email');
      }

      return result;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error('Resend email send failed', err as Error);
      throw new ServiceUnavailableException('Failed to send email');
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
