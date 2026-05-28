import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenRouter, type OpenRouterProvider } from '@openrouter/ai-sdk-provider';
import { generateObject, streamText, type CoreMessage, type Tool } from 'ai';
import type { Message as DbMessage } from '@prisma/client';
import { z } from 'zod';
import { InspectorService } from '../inspector/inspector.service';

export interface LlmTraceContext {
  sessionId: string;
  /** Resolved after persist; if absent the trace is still recorded with null messageId. */
  messageIdPromise?: Promise<string | null>;
  callSite: string;
}

const SessionSummarySchema = z.object({
  summary: z.string().describe('A 2-4 sentence neutral summary of the conversation.'),
  memories: z
    .array(z.string())
    .max(10)
    .describe(
      'Discrete durable facts about the user (name, email, company, preferences, intent, commitments). One short statement per item. Empty array if nothing notable.',
    ),
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

const MAX_TOOL_STEPS = 5;

export interface StreamChatOptions {
  systemPrompt?: string;
  tools?: Record<string, Tool>;
  trace?: LlmTraceContext;
}

@Injectable()
export class LlmService {
  private openrouter?: OpenRouterProvider;
  private readonly chatModelId: string;

  constructor(
    private readonly config: ConfigService,
    private readonly inspector: InspectorService,
  ) {
    this.chatModelId = this.config.get<string>('CHAT_MODEL') ?? 'openai/gpt-4o-mini';
  }

  private getProvider(): OpenRouterProvider {
    if (this.openrouter) return this.openrouter;
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not set');
    }
    this.openrouter = createOpenRouter({ apiKey });
    return this.openrouter;
  }

  streamChat(history: DbMessage[], options: StreamChatOptions = {}) {
    const { systemPrompt, tools, trace } = options;
    const messages: CoreMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    for (const m of history) {
      if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') {
        messages.push({ role: m.role, content: m.content });
      }
    }
    const hasTools = !!tools && Object.keys(tools).length > 0;
    const startedAt = new Date();
    const startMs = Date.now();
    // Pass `tools` directly (not via conditional spread) so the streamText generic infers
    // TOOLS correctly — otherwise tool-call / tool-result narrow to never on fullStream.
    const result = streamText({
      model: this.getProvider().chat(this.chatModelId),
      messages,
      tools: hasTools ? tools : undefined,
      maxSteps: hasTools ? MAX_TOOL_STEPS : 1,
    });
    if (trace) {
      const messageIdRace: Promise<string | null> = trace.messageIdPromise
        ? Promise.race([
            trace.messageIdPromise,
            new Promise<string | null>((r) => setTimeout(() => r(null), 60_000)),
          ])
        : Promise.resolve(null);
      void Promise.all([result.usage, result.finishReason, messageIdRace])
        .then(([usage, finishReason, messageId]) => {
          this.inspector.recordLlm({
            sessionId: trace.sessionId,
            messageId,
            callSite: trace.callSite,
            model: this.chatModelId,
            startedAt,
            durationMs: Date.now() - startMs,
            usage: {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
            },
            finishReason,
            systemPrompt: systemPrompt ?? null,
          });
        })
        .catch((err: unknown) => {
          this.inspector.recordLlm({
            sessionId: trace.sessionId,
            messageId: null,
            callSite: trace.callSite,
            model: this.chatModelId,
            startedAt,
            durationMs: Date.now() - startMs,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
    return result;
  }

  async summariseSession(
    history: DbMessage[],
    trace?: LlmTraceContext,
  ): Promise<SessionSummary> {
    const transcript = history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const prompt = [
      'Summarise the following chat between a user and a sales assistant.',
      'Extract durable memories about the user that would be useful in a future conversation.',
      '',
      'Transcript:',
      transcript,
    ].join('\n');

    const startedAt = new Date();
    const startMs = Date.now();
    try {
      const result = await generateObject({
        model: this.getProvider().chat(this.chatModelId),
        schema: SessionSummarySchema,
        prompt,
        temperature: 0,
      });
      if (trace) {
        this.inspector.recordLlm({
          sessionId: trace.sessionId,
          callSite: trace.callSite,
          model: this.chatModelId,
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
      return result.object;
    } catch (err) {
      if (trace) {
        this.inspector.recordLlm({
          sessionId: trace.sessionId,
          callSite: trace.callSite,
          model: this.chatModelId,
          startedAt,
          durationMs: Date.now() - startMs,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  }
}
