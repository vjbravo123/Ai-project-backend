import { Module } from '@nestjs/common';
import { VisionController } from './vision.controller';
import { VisionService } from './vision.service';
import { GeminiModule } from '../../common/gemini/gemini.module';

@Module({
  imports: [GeminiModule],
  controllers: [VisionController],
  providers: [VisionService],
})
export class VisionModule {}
