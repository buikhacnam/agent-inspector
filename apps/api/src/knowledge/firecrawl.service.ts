import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FirecrawlPage {
  url: string;
  title?: string;
  markdown: string;
}

interface ScrapeResp {
  success: boolean;
  data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string } };
  error?: string;
}

interface CrawlStartResp {
  success: boolean;
  id?: string;
  error?: string;
}

interface CrawlStatusResp {
  success: boolean;
  status: 'scraping' | 'completed' | 'failed' | 'cancelled' | string;
  total?: number;
  completed?: number;
  data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string } }[];
  next?: string;
  error?: string;
}

const DEFAULT_API = 'https://api.firecrawl.dev';
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_MS = 5 * 60_000;
const DEFAULT_CRAWL_LIMIT = 25;

export interface CrawlOptions {
  /** Hard cap on pages Firecrawl is allowed to scrape. Default 25. */
  limit?: number;
  /** Called as each new page completes, so callers can stream ingestion. */
  onPage?: (page: FirecrawlPage) => Promise<void> | void;
}

@Injectable()
export class FirecrawlService {
  private readonly logger = new Logger(FirecrawlService.name);
  private readonly apiUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiUrl = (this.config.get<string>('FIRECRAWL_API_URL') ?? DEFAULT_API).replace(/\/+$/, '');
  }

  private get apiKey(): string {
    const key = this.config.get<string>('FIRECRAWL_API_KEY');
    if (!key) throw new Error('FIRECRAWL_API_KEY is not set');
    return key;
  }

  async scrape(url: string): Promise<FirecrawlPage[]> {
    const res = await fetch(`${this.apiUrl}/v1/scrape`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ url, formats: ['markdown'] }),
    });
    const json = (await res.json()) as ScrapeResp;
    if (!res.ok || !json.success || !json.data?.markdown) {
      throw new Error(`firecrawl scrape failed: ${json.error ?? res.statusText}`);
    }
    return [
      {
        url: json.data.metadata?.sourceURL ?? url,
        title: json.data.metadata?.title,
        markdown: json.data.markdown,
      },
    ];
  }

  async crawl(url: string, opts: CrawlOptions = {}): Promise<FirecrawlPage[]> {
    const limit = opts.limit ?? DEFAULT_CRAWL_LIMIT;
    const startRes = await fetch(`${this.apiUrl}/v1/crawl`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ url, limit, scrapeOptions: { formats: ['markdown'] } }),
    });
    const start = (await startRes.json()) as CrawlStartResp;
    if (!startRes.ok || !start.success || !start.id) {
      throw new Error(`firecrawl crawl start failed: ${start.error ?? startRes.statusText}`);
    }

    const id = start.id;
    const deadline = Date.now() + MAX_POLL_MS;
    const pages: FirecrawlPage[] = [];
    // Firecrawl returns the cumulative completed-pages array on every poll. Dedup by URL
    // so onPage fires exactly once per page even though we revisit the response.
    const seen = new Set<string>();

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const statusRes = await fetch(`${this.apiUrl}/v1/crawl/${id}`, {
        headers: this.headers(),
      });
      const status = (await statusRes.json()) as CrawlStatusResp;
      if (!statusRes.ok || !status.success) {
        throw new Error(`firecrawl crawl status failed: ${status.error ?? statusRes.statusText}`);
      }

      for (const d of status.data ?? []) {
        if (!d.markdown) continue;
        const pageUrl = d.metadata?.sourceURL ?? url;
        if (seen.has(pageUrl)) continue;
        seen.add(pageUrl);
        const page: FirecrawlPage = { url: pageUrl, title: d.metadata?.title, markdown: d.markdown };
        pages.push(page);
        if (opts.onPage) {
          try {
            await opts.onPage(page);
          } catch (err) {
            this.logger.warn(`onPage callback failed for ${pageUrl}: ${(err as Error).message}`);
          }
        }
      }

      this.logger.log(
        `crawl ${id}: status=${status.status} completed=${status.completed ?? '?'}/${status.total ?? '?'} dedup=${seen.size}`,
      );

      if (status.status === 'completed') return pages;
      if (status.status === 'failed' || status.status === 'cancelled') {
        throw new Error(`firecrawl crawl ${status.status}`);
      }
    }
    throw new Error(`firecrawl crawl timed out after ${MAX_POLL_MS}ms`);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
