import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../rag/embedding.service';
import { chunkText } from '../rag/chunker';
import { INGEST_QUEUE, type IngestJobData } from './knowledge.tokens';

export interface ChunkInsert {
  text: string;
  position: number;
  embedding: number[];
  meta?: Record<string, unknown>;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingService,
    @InjectQueue(INGEST_QUEUE) private readonly queue: Queue<IngestJobData>,
  ) {}

  /** Create a paste source and embed inline (no queue). */
  async paste(text: string, opts: { title?: string; namespace?: string } = {}) {
    const namespace = opts.namespace?.trim() || 'default';
    const source = await this.prisma.knowledgeSource.create({
      data: {
        type: 'paste',
        uri: 'paste',
        title: opts.title,
        namespace,
        status: 'embedding',
      },
    });
    try {
      const inserted = await this.ingestText(source.id, text, { url: 'paste', title: opts.title });
      await this.prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'ready' },
      });
      return { source, chunks: inserted };
    } catch (err) {
      const message = (err as Error).message;
      await this.prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'failed', error: message },
      });
      throw err;
    }
  }

  /** Enqueue an ingest job for a URL (scrape or crawl). */
  async enqueueUrl(uri: string, opts: { crawl?: boolean; namespace?: string; title?: string } = {}) {
    const namespace = opts.namespace?.trim() || 'default';
    const source = await this.prisma.knowledgeSource.create({
      data: {
        type: opts.crawl ? 'crawl' : 'url',
        uri,
        title: opts.title,
        namespace,
        status: 'pending',
      },
    });
    await this.queue.add('ingest', { sourceId: source.id, crawl: !!opts.crawl });
    return source;
  }

  list() {
    return this.prisma.knowledgeSource.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });
  }

  async delete(sourceId: string) {
    // Chunks cascade-delete via the FK relation.
    await this.prisma.knowledgeSource.delete({ where: { id: sourceId } });
  }

  async setStatus(sourceId: string, status: string, error?: string) {
    await this.prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status, error: error ?? null },
    });
  }

  /** Chunk, embed, and insert. Returns inserted chunk count. */
  async ingestText(
    sourceId: string,
    text: string,
    meta: { url: string; title?: string },
  ): Promise<number> {
    const chunks = chunkText(text);
    if (chunks.length === 0) return 0;
    const embeddings = await this.embeddings.embedBatch(chunks.map((c) => c.text));
    if (embeddings.length !== chunks.length) {
      throw new Error(
        `embedding count mismatch: ${embeddings.length} embeddings for ${chunks.length} chunks`,
      );
    }
    await this.insertChunks(
      sourceId,
      chunks.map((c, i) => ({
        text: c.text,
        position: c.position,
        embedding: embeddings[i],
        meta: { url: meta.url, title: meta.title, position: c.position },
      })),
    );
    return chunks.length;
  }

  /** Insert chunks via parameterised raw SQL (Prisma can't write pgvector directly). */
  private async insertChunks(sourceId: string, chunks: ChunkInsert[]): Promise<void> {
    if (!chunks.length) return;
    // One row at a time keeps the SQL simple and avoids variadic placeholder gymnastics.
    // The volumes we expect (tens-to-low-thousands per source) make this fine.
    for (const c of chunks) {
      const id = cuid();
      const vec = `[${c.embedding.join(',')}]`;
      const meta = c.meta ? (JSON.stringify(c.meta) as string) : null;
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "KnowledgeChunk" (id, "sourceId", text, embedding, meta)
         VALUES ($1, $2, $3, $4::vector, $5::jsonb)`,
        id,
        sourceId,
        c.text,
        vec,
        meta,
      );
    }
  }
}

// Tiny cuid-ish id generator to avoid coupling to @paralleldrive/cuid here.
// Prisma generates ids in JS land for the model, but we're going via raw SQL,
// so we mint our own that's compatible with the TEXT primary key.
function cuid(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 12);
  return `c${ts}${rand}`;
}

