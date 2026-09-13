import { Module } from '@nestjs/common';
import { NewsAgentController } from './news-agent.controller';
import { NewsAgentService } from './news-agent.service';
import { NewsApiService } from './newsapi.service';
import { GeminiModule } from '../../common/gemini/gemini.module';

@Module({
  imports: [GeminiModule],
  controllers: [NewsAgentController],
  providers: [NewsAgentService, NewsApiService],
})
export class NewsAgentModule {}
