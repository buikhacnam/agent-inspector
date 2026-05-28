import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';

export interface RagHit {
  id: string;
  sourceId: string;
  text: string;
  score: number;
  meta: Record<string, unknown> | null;
  sourceTitle: string | null;
  sourceUri: string;
}

interface RawRow {
  id: string;
  sourceId: string;
  text: string;
  meta: Record<string, unknown> | null;
  score: number;
  sourceTitle: string | null;
  sourceUri: string;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly defaultTopK: number;
  private readonly minScore: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingService,
    private readonly config: ConfigService,
  ) {
    this.defaultTopK = Number(this.config.get<string>('RAG_TOP_K') ?? '5');
    this.minScore = Number(this.config.get<string>('RAG_MIN_SCORE') ?? '0.2');
  }

  async search(query: string, namespaces?: string[], k = this.defaultTopK): Promise<RagHit[]> {
    const q = query.trim();
    if (!q) return [];
    let embedding: number[];
    try {
      embedding = await this.embeddings.embedOne(q);
    } catch (err) {
      this.logger.warn(`embed-for-search failed: ${(err as Error).message}`);
      return [];
    }
    const vec = toVectorLiteral(embedding);

    // Cosine distance via pgvector's <=> operator; similarity = 1 - distance.
    // Filter by namespace through the source join, and only consider ready sources.
    const ns = namespaces && namespaces.length ? namespaces : null;

    const rows = ns
      ? await this.prisma.$queryRawUnsafe<RawRow[]>(
          `
            SELECT c.id              AS "id",
                   c."sourceId"      AS "sourceId",
                   c.text            AS "text",
                   c.meta            AS "meta",
                   1 - (c.embedding <=> $1::vector) AS "score",
                   s.title           AS "sourceTitle",
                   s.uri             AS "sourceUri"
              FROM "KnowledgeChunk" c
              JOIN "KnowledgeSource" s ON s.id = c."sourceId"
             WHERE c.embedding IS NOT NULL
               AND s.status = 'ready'
               AND s.namespace = ANY($2::text[])
             ORDER BY c.embedding <=> $1::vector
             LIMIT $3
          `,
          vec,
          ns,
          k,
        )
      : await this.prisma.$queryRawUnsafe<RawRow[]>(
          `
            SELECT c.id              AS "id",
                   c."sourceId"      AS "sourceId",
                   c.text            AS "text",
                   c.meta            AS "meta",
                   1 - (c.embedding <=> $1::vector) AS "score",
                   s.title           AS "sourceTitle",
                   s.uri             AS "sourceUri"
              FROM "KnowledgeChunk" c
              JOIN "KnowledgeSource" s ON s.id = c."sourceId"
             WHERE c.embedding IS NOT NULL
               AND s.status = 'ready'
             ORDER BY c.embedding <=> $1::vector
             LIMIT $2
          `,
          vec,
          k,
        );

    return rows
      .filter((r) => r.score >= this.minScore)
      .map((r) => ({
        id: r.id,
        sourceId: r.sourceId,
        text: r.text,
        score: Number(r.score),
        meta: r.meta,
        sourceTitle: r.sourceTitle,
        sourceUri: r.sourceUri,
      }));
  }

  /** Format hits for injection into a system prompt. */
  static formatForPrompt(hits: RagHit[]): string {
    if (!hits.length) return '';
    const blocks = hits.map((h, i) => {
      const label = h.sourceTitle || h.sourceUri || h.sourceId;
      return `[${i + 1}] ${label}\n${h.text}`;
    });
    return [
      '<knowledge>',
      'Use the following retrieved knowledge to answer the user. Cite the bracketed source number when relevant. If the answer is not in the knowledge, say you do not know.',
      ...blocks,
      '</knowledge>',
    ].join('\n\n');
  }
}

function toVectorLiteral(v: number[]): string {
  // pgvector accepts '[1, 2, 3]' string format.
  return `[${v.join(',')}]`;
}
