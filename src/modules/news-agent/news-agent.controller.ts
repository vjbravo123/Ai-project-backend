import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NewsAgentService } from './news-agent.service';
import { GenerateNewsletterDto } from './dto/generate-newsletter.dto';

@UseGuards(JwtAuthGuard)
@Controller('news-agent')
export class NewsAgentController {
  constructor(private readonly newsAgentService: NewsAgentService) {}

  @Post('run')
  run(@Body() dto: GenerateNewsletterDto) {
    const goal =
      dto.goal ??
      'Create a weekly newsletter on the latest AI agent news and send it to our subscribers.';
    const topic = dto.topic ?? 'AI agents';

    return this.newsAgentService.runNewsletterAgent(goal, topic);
  }
}
