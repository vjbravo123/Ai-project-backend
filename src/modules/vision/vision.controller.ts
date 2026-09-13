import {
  BadRequestException,
  Body,
  Controller,
  Optional,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';
import { VisionService } from './vision.service';
import { DescribeImageDto } from './dto/describe-image.dto';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic'];
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

@UseGuards(JwtAuthGuard)
@Controller('vision')
export class VisionController {
  constructor(private readonly visionService: VisionService) {}

  @Post('describe')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async describe(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Optional() @Body() dto: DescribeImageDto,
  ) {
    if (!file) {
      throw new BadRequestException('No image file uploaded (field name: "image")');
    }
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported image type "${file.mimetype}". Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    return this.visionService.describeImage({
      buffer: file.buffer,
      mimeType: file.mimetype,
      instruction: dto?.instruction,
    });
  }
}
