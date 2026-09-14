import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService);

  // ---- CORS ----
  const origins = (config.get<string>('CORS_ORIGIN') ?? '*')
    .split(',')
    .map((o) => o.trim());

  app.enableCors({
    origin: origins.includes('*') ? true : origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ---- Global validation ----
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true,
      transform: true, // auto-transform payloads to DTO classes
    }),
  );

  app.setGlobalPrefix('api/v1');

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Server running on http://localhost:${port}/api/v1`,
    'Bootstrap',
  );
}

void bootstrap();
