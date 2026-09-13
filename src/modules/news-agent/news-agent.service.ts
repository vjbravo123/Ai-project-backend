import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { GeminiService } from '../../common/gemini/gemini.service';
import { NewsApiService, RawArticle } from './newsapi.service';

const NewsletterDraftSchema = z.object({
  subject: z.string().describe('Short, engaging newsletter subject line'),
  intro: z.string().describe('2-3 sentence introduction'),
  items: z
    .array(
      z.object({
        title: z.string().describe('Original article title'),
        url: z.string().describe('Original article URL'),
        summary: z
          .string()
          .describe('2-3 sentence summary written in your own words'),
      }),
    )
    .min(1)
    .max(7)
    .describe('The 5-7 most relevant, newsworthy articles'),
  outro: z.string().describe('1-2 sentence sign-off'),
});

type NewsletterDraft = z.infer<typeof NewsletterDraftSchema>;

const OUTPUT_DIR = path.join(process.cwd(), 'generated-newsletters');

@Injectable()
export class NewsAgentService {
  private readonly logger = new Logger(NewsAgentService.name);

  constructor(
    private readonly newsApi: NewsApiService,
    private readonly gemini: GeminiService,
  ) {}

  /**
   * Runs the full agent loop for a plain-English goal:
   *   1. Research  -> NewsApiService.searchArticles
   *   2. Reason    -> Gemini picks + summarizes the 5-7 most relevant articles
   *   3. Act       -> Gemini drafts subject/intro/outro, we render Markdown + HTML
   *   4. "Send"    -> simulated by writing the newsletter to disk and returning it
   */
  async runNewsletterAgent(goal: string, topic: string) {
    this.logger.log(`Agent goal: ${goal}`);

    // 1. Research
    const articles = await this.newsApi.searchArticles(topic, 25);
    if (articles.length === 0) {
      throw new InternalServerErrorException(
        `No articles found for topic "${topic}"`,
      );
    }
    this.logger.log(`Researched ${articles.length} candidate articles`);

    // 2. Reason: let the model pick the best 5-7 and summarize each
    const draft = await this.summarizeAndDraft(goal, topic, articles);

    // 3. Act: render final Markdown + HTML newsletter
    const markdown = this.renderMarkdown(draft, topic);
    const html = this.renderHtml(draft, topic);

    // 4. Simulate sending: save to disk instead of hitting a real email API
    const savedPath = await this.simulateSend(draft.subject, markdown);

    return {
      subject: draft.subject,
      articleCount: draft.items.length,
      markdown,
      html,
      savedTo: savedPath,
    };
  }

  private async summarizeAndDraft(
    goal: string,
    topic: string,
    articles: RawArticle[],
  ): Promise<NewsletterDraft> {
    const articleList = articles
      .slice(0, 25)
      .map(
        (a, i) =>
          `${i + 1}. "${a.title}" — ${a.source} (${a.publishedAt})\n   ${a.description ?? 'No description available.'}\n   URL: ${a.url}`,
      )
      .join('\n\n');

    const prompt = `
You are an autonomous newsletter-writing agent. Your goal: "${goal}"

Below is a list of recent articles about "${topic}". Select the 5 to 7 most
relevant and newsworthy articles, then write a short (2-3 sentence) summary
for each in your own words. Then write a short newsletter subject line, a
2-3 sentence intro, and a 1-2 sentence outro/sign-off.

Articles:
${articleList}
`.trim();

    // Schema-enforced generation: Gemini is constrained to return exactly
    // this shape, so there's no JSON parsing (and no risk of truncated or
    // fence-wrapped output breaking the pipeline) — see GeminiService.
    return this.gemini.generateStructured({
      prompt,
      schema: NewsletterDraftSchema,
    });
  }

  private renderMarkdown(draft: NewsletterDraft, topic: string): string {
    const items = draft.items
      .map((item) => `### ${item.title}\n\n${item.summary}\n\n[Read more](${item.url})`)
      .join('\n\n');

    return `# ${draft.subject}\n\n${draft.intro}\n\n${items}\n\n---\n\n${draft.outro}`;
  }

  private renderHtml(draft: NewsletterDraft, topic: string): string {
    const items = draft.items
      .map(
        (item) => `
      <div style="margin-bottom:24px;">
        <h3 style="margin:0 0 8px;">${this.escapeHtml(item.title)}</h3>
        <p style="margin:0 0 8px;">${this.escapeHtml(item.summary)}</p>
        <a href="${item.url}" style="color:#4f46e5;">Read more →</a>
      </div>`,
      )
      .join('\n');

    return `<!DOCTYPE html>
<html>
  <body style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px;">
    <h1>${this.escapeHtml(draft.subject)}</h1>
    <p>${this.escapeHtml(draft.intro)}</p>
    ${items}
    <hr />
    <p>${this.escapeHtml(draft.outro)}</p>
  </body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Stands in for actually sending email (e.g. via SendGrid/SES). Saves
   * the newsletter to disk and logs the "email" so you can see exactly
   * what would have gone out.
   */
  private async simulateSend(subject: string, markdown: string): Promise<string> {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const filename = `${Date.now()}-${subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50)}.md`;
    const filePath = path.join(OUTPUT_DIR, filename);

    await fs.writeFile(filePath, markdown, 'utf-8');

    this.logger.log('--- SIMULATED EMAIL SEND ---');
    this.logger.log(`Subject: ${subject}`);
    this.logger.log(`Saved to: ${filePath}`);
    this.logger.log('----------------------------');

    return filePath;
  }
}
