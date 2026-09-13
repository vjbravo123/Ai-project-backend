import { Injectable } from '@nestjs/common';
import { GeminiService } from '../../common/gemini/gemini.service';

@Injectable()
export class VisionService {
  constructor(private readonly gemini: GeminiService) {}

  async describeImage(params: {
    buffer: Buffer;
    mimeType: string;
    instruction?: string;
  }) {
    const base64Image = params.buffer.toString('base64');

    const description = await this.gemini.describeImage({
      base64Image,
      mimeType: params.mimeType,
      instruction: params.instruction,
    });

    return { description };
  }
}
