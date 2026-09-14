import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthUser,
} from '../auth/decorators/current-user.decorator';
import { RevisionService } from './revision.service';
import { LogTextDto } from './dto/log-text.dto';
import { ReviewDto } from './dto/review.dto';

const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/ogg',
  'audio/aac',
];
const MAX_AUDIO_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

@UseGuards(JwtAuthGuard)
@Controller('revision')
export class RevisionController {
  constructor(private readonly revisionService: RevisionService) {}

  // Speak what you studied: frontend records audio and posts it here as
  // multipart/form-data under the "audio" field. Gemini transcribes it and
  // extracts the topic/summary/understanding in one call.
  @Post('log')
  @UseInterceptors(
    FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_SIZE_BYTES } }),
  )
  async logFromAudio(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(
        'No audio file uploaded (field name: "audio")',
      );
    }
    if (!ALLOWED_AUDIO_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported audio type "${file.mimetype}". Allowed: ${ALLOWED_AUDIO_MIME_TYPES.join(', ')}`,
      );
    }

    return this.revisionService.logFromAudio(user.userId, {
      base64: file.buffer.toString('base64'),
      mimeType: file.mimetype,
    });
  }

  // Fallback for when the frontend already has text (e.g. its own
  // speech-to-text, or the user just typed it).
  @Post('log-text')
  logFromText(@CurrentUser() user: AuthUser, @Body() dto: LogTextDto) {
    return this.revisionService.logFromText(user.userId, dto.text);
  }

  @Get()
  listTopics(@CurrentUser() user: AuthUser) {
    return this.revisionService.listTopics(user.userId);
  }

  @Get('due')
  getDueTopics(@CurrentUser() user: AuthUser) {
    return this.revisionService.getDueTopics(user.userId);
  }

  // Log a manual review (e.g. "I just quizzed myself") without new audio/text.
  @Post(':id/review')
  reviewTopic(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.revisionService.reviewTopic(user.userId, id, dto.quality);
  }

  @Delete(':id')
  deleteTopic(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.revisionService.deleteTopic(user.userId, id);
  }
}
