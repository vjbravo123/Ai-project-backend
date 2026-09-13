import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RawArticle {
  title: string;
  description: string | null;
  url: string;
  source: string;
  publishedAt: string;
}

/**
 * Thin wrapper around https://newsapi.org — this is the "research tool"
 * the agent calls. Swap this out for a different search/scrape provider
 * if you don't have a NewsAPI key; the rest of the agent doesn't care
 * where the articles came from as long as they match RawArticle.
 */
@Injectable()
export class NewsApiService {
  private readonly logger = new Logger(NewsApiService.name);

  constructor(private readonly config: ConfigService) {}

  async searchArticles(topic: string, pageSize = 20): Promise<RawArticle[]> {
    const apiKey = this.config.get<string>('NEWSAPI_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('NEWSAPI_KEY is not configured');
    }

    const url = new URL('https://newsapi.org/v2/everything');
    url.searchParams.set('q', topic);
    url.searchParams.set('language', 'en');
    url.searchParams.set('sortBy', 'publishedAt');
    url.searchParams.set('pageSize', String(pageSize));

    const res = await fetch(url.toString(), {
      headers: { 'X-Api-Key': apiKey },
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`NewsAPI request failed: ${res.status} ${body}`);
      throw new ServiceUnavailableException('Failed to fetch news articles');
    }

    const data = (await res.json()) as {
      articles: Array<{
        title: string;
        description: string | null;
        url: string;
        publishedAt: string;
        source: { name: string };
      }>;
    };

    return data.articles.map((a) => ({
      title: a.title,
      description: a.description,
      url: a.url,
      source: a.source?.name ?? 'Unknown',
      publishedAt: a.publishedAt,
    }));
  }
}
