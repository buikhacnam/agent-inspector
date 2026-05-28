import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InspectorFlags } from './inspector.flags';
import { estimateCostUsd } from './pricing';

export type TracePhase =
  | 'extract'
  | 'moderate'
  | 'director'
  | 'rag'
  | 'llm'
  | 'tool'
  | 'persist';

export type TraceInput = {
  sessionId: string;
  messageId?: string | null;
  phase: TracePhase;
  startedAt: Date;
  durationMs: number;
  payload: Prisma.InputJsonValue;
};

@Injectable()
export class InspectorService {
  private readonly logger = new Logger(InspectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: InspectorFlags,
  ) {}

  /**
   * Fire-and-forget. No-op when inspector is off.
   * Callers pass already-gated payloads — this only writes when master flag is on.
   */
  record(input: TraceInput): void {
    if (!this.flags.enabled()) return;
    this.prisma.turnTrace
      .create({
        data: {
          sessionId: input.sessionId,
          messageId: input.messageId ?? null,
          phase: input.phase,
          startedAt: input.startedAt,
          durationMs: input.durationMs,
          payload: input.payload,
        },
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`record(${input.phase}) failed: ${message}`);
      });
  }

  listForSession(sessionId: string, limit = 200) {
    return this.prisma.turnTrace.findMany({
      where: { sessionId },
      orderBy: { startedAt: 'asc' },
      take: Math.min(limit, 1000),
    });
  }

  listForMessage(messageId: string) {
    return this.prisma.turnTrace.findMany({
      where: { messageId },
      orderBy: { startedAt: 'asc' },
    });
  }

  /**
   * Record an LLM call. No-op unless both inspector + llm flags are on.
   * `usage` may be partial — fields default to 0. `systemPrompt` only persisted when prompt flag is on.
   */
  recordLlm(input: {
    sessionId: string;
    messageId?: string | null;
    callSite: string;
    model: string;
    startedAt: Date;
    durationMs: number;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    finishReason?: string | null;
    systemPrompt?: string | null;
    error?: string | null;
  }): void {
    if (!this.flags.on('llm')) return;
    const pTok = input.usage?.promptTokens ?? 0;
    const cTok = input.usage?.completionTokens ?? 0;
    const costUsd = estimateCostUsd(input.model, pTok, cTok);
    const payload: Prisma.InputJsonValue = {
      callSite: input.callSite,
      model: input.model,
      promptTokens: pTok,
      completionTokens: cTok,
      totalTokens: input.usage?.totalTokens ?? pTok + cTok,
      costUsd,
      finishReason: input.finishReason ?? null,
      ...(this.flags.on('prompt') && input.systemPrompt
        ? { systemPrompt: input.systemPrompt }
        : {}),
      ...(input.error ? { error: input.error } : {}),
    };
    this.record({
      sessionId: input.sessionId,
      messageId: input.messageId ?? null,
      phase: 'llm',
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      payload,
    });
  }
}
