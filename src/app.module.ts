import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ChatModule } from './modules/chat/chat.module';
import { VisionModule } from './modules/vision/vision.module';
import { NewsAgentModule } from './modules/news-agent/news-agent.module';
import { RevisionModule } from './modules/revision/revision.module';
import { GeminiModule } from './common/gemini/gemini.module';
import { MailModule } from './common/mail/mail.module';

@Module({
  imports: [
    // Loads .env once, available everywhere via ConfigService
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Basic rate limiting so the AI endpoints can't be hammered
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 30, // 30 requests / minute / client by default
      },
    ]),

    // Backs the revision-reminder cron sweep (see modules/revision)
    ScheduleModule.forRoot(),

    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGO_URI'),
      }),
    }),

    GeminiModule, // shared LangChain + Gemini wrapper, exported for reuse
    MailModule, // shared Resend wrapper (OTP emails + revision reminders)
    AuthModule,
    UsersModule,
    ChatModule,
    VisionModule,
    NewsAgentModule,
    RevisionModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard, // applies the rate limit from ThrottlerModule.forRoot globally
    },
  ],
})
export class AppModule {}
