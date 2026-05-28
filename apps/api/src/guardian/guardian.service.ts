import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { generateText } from 'ai';
import { createOpenRouter, type OpenRouterProvider } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import type { SessionState } from '@agent-x/shared';
import { InspectorService } from '../inspector/inspector.service';

export interface ModerationResult {
  flagged: boolean;
  reason?: string;
}

const ExtractSchema = z.object({
  keyFacts: z.record(z.string(), z.string()).default({}),
  intent: z.enum(['buying', 'support', 'info', 'menu', 'ending', 'other']),
  sentiment: z.enum(['pos', 'neu', 'neg']),
});

export type ExtractionResult = z.infer<typeof ExtractSchema>;

@Injectable()
export class GuardianService {
  private readonly logger = new Logger(GuardianService.name);
  private openai?: OpenAI;
  private openrouter?: OpenRouterProvider;
  private readonly extractModel: string;

  constructor(
    private readonly config: ConfigService,
    private readonly inspector: InspectorService,
  ) {
    this.extractModel = this.config.get<string>('EXTRACT_MODEL') ?? 'openai/gpt-4o-mini';
  }

  get safetyMessage(): string {
    return (
      this.config.get<string>('SAFETY_MESSAGE') ??
      "I can't help with that. Let's keep things on-topic."
    );
  }

  async moderate(text: string): Promise<ModerationResult> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not set — moderation skipped');
      return { flagged: false };
    }
    const client = (this.openai ??= new OpenAI({ apiKey }));
    try {
      const res = await client.moderations.create({
        model: 'omni-moderation-latest',
        input: text,
      });
      const r = res.results[0];
      if (!r || !r.flagged) return { flagged: false };
      const reason = Object.entries(r.categories)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ');
      return { flagged: true, reason };
    } catch (err) {
      this.logger.warn(`moderation failed: ${(err as Error).message}`);
      return { flagged: false };
    }
  }

  async extract(
    latestUserText: string,
    currentState: SessionState,
    trace?: { sessionId: string },
  ): Promise<ExtractionResult | null> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) return null;
    const provider = (this.openrouter ??= createOpenRouter({ apiKey }));

    const prior = JSON.stringify({
      keyFacts: currentState.keyFacts ?? {},
      intent: currentState.intent ?? null,
    });
    const prompt = [
      'You extract structured information from a chat user\'s latest message.',
      `Prior state: ${prior}`,
      `Latest user message: ${JSON.stringify(latestUserText)}`,
      '',
      'Return ONLY a JSON object with this exact shape (no markdown, no extra prose):',
      '{ "keyFacts": { /* string→string, only fields you are confident about (e.g. name, email, phone, company, budget). Prefer empty over guessing. */ },',
      '  "intent": "buying|support|info|menu|ending|other",',
      '  "sentiment": "pos|neu|neg" }',
      '',
      'Intent guide:',
      '- buying: wants to purchase, sign up, get a demo/quote, or shows clear purchase interest.',
      '- support: has a problem, complaint, or needs help with something they already use.',
      '- info: asking questions about products, pricing, or features (still exploring).',
      '- menu: explicitly wants to see options/navigation or asks what they can do (e.g. "show menu", "what can you do", "options"). Do NOT use menu just because the word "help" appears in a real question.',
      '- ending: wants to end the conversation or is saying goodbye (e.g. "bye", "that\'s all", "gotta run", "we\'re done").',
      '- other: small talk or anything that fits none of the above.',
    ].join('\n');

    const startedAt = new Date();
    const startMs = Date.now();
    try {
      const result = await generateText({
        model: provider.chat(this.extractModel),
        prompt,
        temperature: 0,
      });
      if (trace) {
        this.inspector.recordLlm({
          sessionId: trace.sessionId,
          callSite: 'guardian.extract',
          model: this.extractModel,
          startedAt,
          durationMs: Date.now() - startMs,
          usage: {
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
          },
          finishReason: result.finishReason,
          systemPrompt: prompt,
        });
      }
      const cleaned = result.text
        .trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/, '')
        .trim();
      return ExtractSchema.parse(JSON.parse(cleaned));
    } catch (err) {
      if (trace) {
        this.inspector.recordLlm({
          sessionId: trace.sessionId,
          callSite: 'guardian.extract',
          model: this.extractModel,
          startedAt,
          durationMs: Date.now() - startMs,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.logger.warn(`extraction failed: ${(err as Error).message}`);
      return null;
    }
  }
}
