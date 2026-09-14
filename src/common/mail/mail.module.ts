import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

// Global so any feature module (auth, revision reminders, ...) can inject
// MailService without re-importing this module everywhere.
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
