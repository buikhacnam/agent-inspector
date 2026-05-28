import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { FirecrawlService } from './firecrawl.service';
import { KnowledgeService } from './knowledge.service';
import { INGEST_QUEUE, type IngestJobData } from './knowledge.tokens';

@Processor(INGEST_QUEUE)
export class IngestProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firecrawl: FirecrawlService,
    private readonly knowledge: KnowledgeService,
  ) {
    super();
  }

  async process(job: Job<IngestJobData>): Promise<{ chunks: number; pages: number }> {
    const { sourceId, crawl } = job.data;
    const source = await this.prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new Error(`source ${sourceId} not found`);

    this.logger.log(`ingest start: source=${sourceId} crawl=${crawl} uri=${source.uri}`);

    try {
      await this.knowledge.setStatus(sourceId, 'crawling');
      let totalChunks = 0;
      let titleSet = !!source.title;
      let pagesCount = 0;

      const ingestPage = async (page: { url: string; title?: string; markdown: string }) => {
        // Promote the first arriving title onto the source so the panel has a label early.
        if (!titleSet && page.title) {
          await this.prisma.knowledgeSource.update({
            where: { id: sourceId },
            data: { title: page.title },
          });
          titleSet = true;
        }
        const n = await this.knowledge.ingestText(sourceId, page.markdown, {
          url: page.url,
          title: page.title,
        });
        totalChunks += n;
        pagesCount += 1;
        this.logger.log(`ingest page ${pagesCount} (chunks=${n}, total=${totalChunks}): ${page.url}`);
      };

      if (crawl) {
        // Stream pages as Firecrawl yields them so the sources panel sees chunks tick up
        // live instead of staring at 0 for minutes while a big site spiders.
        await this.firecrawl.crawl(source.uri, { onPage: ingestPage });
      } else {
        const pages = await this.firecrawl.scrape(source.uri);
        if (pages.length === 0) throw new Error('no pages returned from firecrawl');
        for (const page of pages) await ingestPage(page);
      }

      if (pagesCount === 0) throw new Error('no pages returned from firecrawl');

      await this.knowledge.setStatus(sourceId, 'ready');
      this.logger.log(`ingest done: source=${sourceId} pages=${pagesCount} chunks=${totalChunks}`);
      return { chunks: totalChunks, pages: pagesCount };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`ingest failed: source=${sourceId} ${message}`);
      await this.knowledge.setStatus(sourceId, 'failed', message);
      throw err;
    }
  }
}
