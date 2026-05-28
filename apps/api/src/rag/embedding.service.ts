import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { embed, embedMany } from 'ai';

export const EMBEDDING_DIMS = 1536;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private provider?: OpenAIProvider;
  private readonly modelId: string;

  constructor(private readonly config: ConfigService) {
    this.modelId = this.config.get<string>('EMBEDDING_MODEL') ?? 'text-embedding-3-small';
  }

  private getProvider(): OpenAIProvider {
    if (this.provider) return this.provider;
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    this.provider = createOpenAI({ apiKey });
    return this.provider;
  }

  async embedOne(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: this.getProvider().embedding(this.modelId),
      value: text,
    });
    return embedding;
  }

  /** Embeds in batches of 96 to stay well under OpenAI's per-request limit. */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const provider = this.getProvider();
    const model = provider.embedding(this.modelId);
    const batchSize = 96;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const slice = texts.slice(i, i + batchSize);
      const { embeddings } = await embedMany({ model, values: slice });
      out.push(...embeddings);
    }
    return out;
  }
}
