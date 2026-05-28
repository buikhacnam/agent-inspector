import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  Action,
  ButtonOption,
  SessionState,
  SseEvent,
} from '@agent-x/shared';
import { SessionService } from '../session/session.service';
import { LlmService } from '../llm/llm.service';
import { WorkflowService } from '../workflow/workflow.service';
import {
  DirectorService,
  type EvalContext,
} from '../director/director.service';
import { RagService, type RagHit } from '../rag/rag.service';
import { ToolsService } from '../tools/tools.service';
import { EventsService } from '../events/events.service';
import { PostSessionService } from '../post-session/post-session.service';
import { InspectorFlags } from '../inspector/inspector.flags';
import { InspectorService } from '../inspector/inspector.service';

export type StreamWrite = (event: SseEvent) => void;

export interface ActionCtx {
  sessionId: string;
  blockId: string;
  write?: StreamWrite;
  directorId?: string;
  lastUserMessage?: string;
  /** Recursion guard for switch chains. */
  depth?: number;
  /** Suppress the trailing `done` event — used when caller intends to chain more actions. */
  suppressDone?: boolean;
}

const MAX_SWITCH_DEPTH = 5;

@Injectable()
export class ActionService {
  private readonly logger = new Logger(ActionService.name);

  constructor(
    private readonly sessions: SessionService,
    private readonly llm: LlmService,
    private readonly workflow: WorkflowService,
    private readonly directors: DirectorService,
    private readonly rag: RagService,
    private readonly tools: ToolsService,
    private readonly events: EventsService,
    private readonly postSession: PostSessionService,
    private readonly inspectorFlags: InspectorFlags,
    private readonly inspector: InspectorService,
  ) {}

  async run(action: Action, ctx: ActionCtx): Promise<void> {
    const depth = ctx.depth ?? 0;
    if (depth > MAX_SWITCH_DEPTH) {
      throw new Error(`max switch depth exceeded (${MAX_SWITCH_DEPTH})`);
    }

    this.events.emit(
      'action_executed',
      {
        actionType: action.type,
        blockId: ctx.blockId,
        directorId: ctx.directorId ?? null,
      },
      ctx.sessionId,
    );

    switch (action.type) {
      case 'system_message':
        return this.runSystemMessage(action.text, ctx);
      case 'ai_message':
        return this.runAiMessage(action.prompt, ctx);
      case 'switch':
        return this.runSwitch(action.toBlockId, ctx);
      case 'end_chat':
        return this.runEndChat(action.text, ctx);
      case 'form':
        return this.runForm(action.formId, ctx);
      case 'buttons':
        return this.runButtons(action.options, ctx);
      case 'http':
        this.logger.warn(`action type 'http' not yet implemented`);
        ctx.write?.({ type: 'action', action });
        if (!ctx.suppressDone) ctx.write?.({ type: 'done', messageId: '' });
        return;
    }
  }

  /** Run a sequence of actions, only emitting `done` after the last one. */
  async runMany(actions: Action[], ctx: ActionCtx): Promise<void> {
    for (let i = 0; i < actions.length; i++) {
      const isLast = i === actions.length - 1;
      await this.run(actions[i], { ...ctx, suppressDone: !isLast });
    }
  }

  private async runSystemMessage(text: string, ctx: ActionCtx) {
    if (ctx.write) ctx.write({ type: 'delta', text });
    const saved = await this.sessions.appendMessage(
      ctx.sessionId,
      'assistant',
      text,
      {
        actionType: 'system_message',
        blockId: ctx.blockId,
        directorId: ctx.directorId ?? null,
      },
    );
    this.events.emit(
      'message_sent',
      { messageId: saved.id, kind: 'system_message' },
      ctx.sessionId,
    );
    if (ctx.write && !ctx.suppressDone)
      ctx.write({ type: 'done', messageId: saved.id });
  }

  private async runAiMessage(prompt: string | undefined, ctx: ActionCtx) {
    const block = this.workflow.getBlock(ctx.blockId);
    const history = await this.sessions.history(ctx.sessionId);

    const session = await this.sessions.get(ctx.sessionId);
    const state = (session.state ?? {}) as SessionState;

    const hits = await this.retrieveKnowledge(ctx, block.knowledgeNamespaces, state);
    const knowledgeBlock = hits.length ? RagService.formatForPrompt(hits) : '';

    // Surface extracted keyFacts so the model doesn't re-ask for info we already have.
    // Note the one-turn lag: facts are merged after the turn (Guardian.extract runs async),
    // so these reflect state as of the *previous* turn — see docs/guardian-extraction.md.
    const factsBlock = ActionService.formatFacts(state.keyFacts);

    const systemPrompt =
      [block.persona, prompt, factsBlock, knowledgeBlock]
        .filter(Boolean)
        .join('\n\n') || undefined;

    const workflowTools = this.workflow.current().tools;
    const toolNames = this.tools.merge(block.tools, workflowTools);
    const toolSet = this.tools.resolve(toolNames);

    let full = '';
    const toolCalls: { name: string; args: unknown; result?: unknown }[] = [];
    const toolTraceOn = this.inspectorFlags.on('tool');
    const toolTimings = new Map<string, number>();
    let resolveMessageId: (id: string | null) => void = () => {};
    const messageIdPromise = new Promise<string | null>((resolve) => {
      resolveMessageId = resolve;
    });
    const stream = await this.llm.streamChat(history, {
      systemPrompt,
      tools: toolSet,
      trace: {
        sessionId: ctx.sessionId,
        callSite: `action.ai_message:${ctx.blockId}`,
        messageIdPromise,
      },
    });

    // ai-sdk's TextStreamPart narrows tool-call/tool-result to `never` when the TOOLS
    // generic is inferred from a runtime ToolSet (Record<string,Tool>). Cast through a
    // shared shape that covers the events we actually consume.
    type StreamPart =
      | { type: 'text-delta'; textDelta: string }
      | { type: 'tool-call'; toolName: string; args: unknown }
      | { type: 'tool-result'; toolName: string; result: unknown }
      | { type: 'error'; error: unknown }
      | { type: string; [k: string]: unknown };

    for await (const raw of stream.fullStream) {
      const part = raw as unknown as StreamPart;
      if (part.type === 'text-delta') {
        const td = (part as { textDelta: string }).textDelta;
        full += td;
        if (ctx.write) ctx.write({ type: 'delta', text: td });
      } else if (part.type === 'tool-call') {
        const tc = part as { toolName: string; args: unknown };
        toolCalls.push({ name: tc.toolName, args: tc.args });
        if (toolTraceOn) toolTimings.set(tc.toolName, Date.now());
        if (ctx.write)
          ctx.write({ type: 'tool_call', name: tc.toolName, args: tc.args });
        this.logger.log(`tool-call: ${tc.toolName}`);
      } else if (part.type === 'tool-result') {
        const tr = part as { toolName: string; result: unknown };
        const entry = toolCalls.find(
          (c) => c.name === tr.toolName && c.result === undefined,
        );
        if (entry) entry.result = tr.result;
        if (toolTraceOn) {
          const startMs = toolTimings.get(tr.toolName) ?? Date.now();
          toolTimings.delete(tr.toolName);
          this.inspector.record({
            sessionId: ctx.sessionId,
            phase: 'tool',
            startedAt: new Date(startMs),
            durationMs: Date.now() - startMs,
            payload: {
              name: tr.toolName,
              args: (entry?.args ?? null) as Prisma.InputJsonValue,
              result: tr.result as Prisma.InputJsonValue,
            },
          });
        }
        if (ctx.write)
          ctx.write({
            type: 'tool_result',
            name: tr.toolName,
            result: tr.result,
          });
      } else if (part.type === 'error') {
        this.logger.error(
          `stream error: ${String((part as { error: unknown }).error)}`,
        );
      }
    }

    const meta: Prisma.InputJsonValue = {
      actionType: 'ai_message',
      blockId: ctx.blockId,
      directorId: ctx.directorId ?? null,
      ragHitIds: hits.map((h) => h.id),
      ...(toolCalls.length
        ? { toolCalls: toolCalls as unknown as Prisma.InputJsonValue }
        : {}),
    };
    const saved = await this.sessions.appendMessage(
      ctx.sessionId,
      'assistant',
      full,
      meta,
    );
    resolveMessageId(saved.id);
    this.events.emit(
      'message_sent',
      {
        messageId: saved.id,
        kind: 'ai_message',
        toolCallsCount: toolCalls.length,
        ragHitsCount: hits.length,
      },
      ctx.sessionId,
    );
    if (ctx.write && !ctx.suppressDone)
      ctx.write({ type: 'done', messageId: saved.id });
  }

  /**
   * Retrieve top-k chunks from configured namespaces. Skipped when the block has no namespaces
   * or when fact-extraction has classified the conversation as `other` (chit-chat) — see plan §12.
   */
  private async retrieveKnowledge(
    ctx: ActionCtx,
    namespaces: string[] | undefined,
    state: SessionState,
  ): Promise<RagHit[]> {
    const ragTraceOn = this.inspectorFlags.on('rag');
    const timingOn = this.inspectorFlags.on('timing');
    const anyTrace = ragTraceOn || timingOn;
    const recordSkip = (skipReason: string, query: string | null) => {
      if (!anyTrace) return;
      this.inspector.record({
        sessionId: ctx.sessionId,
        phase: 'rag',
        startedAt: new Date(),
        durationMs: 0,
        payload: {
          query,
          namespaces: namespaces ?? [],
          skipReason,
          hitCount: 0,
          hits: [],
        },
      });
    };

    if (!namespaces || namespaces.length === 0) {
      recordSkip('no-namespaces', ctx.lastUserMessage?.trim() ?? null);
      return [];
    }
    const query = ctx.lastUserMessage?.trim();
    if (!query) {
      recordSkip('empty-query', null);
      return [];
    }
    if (state.intent === 'other') {
      recordSkip('intent-other', query);
      return [];
    }

    const startedAt = new Date();
    const startMs = Date.now();
    const hits = await this.rag.search(query, namespaces);
    if (hits.length) {
      this.logger.log(
        `rag: ${hits.length} hit(s) for "${query.slice(0, 40)}" ns=${namespaces.join(',')} ` +
          `scores=${hits.map((h) => h.score.toFixed(3)).join(',')}`,
      );
    }
    if (anyTrace) {
      this.inspector.record({
        sessionId: ctx.sessionId,
        phase: 'rag',
        startedAt,
        durationMs: Date.now() - startMs,
        payload: {
          query,
          namespaces,
          hitCount: hits.length,
          hits: ragTraceOn
            ? hits.map((h) => ({
                id: h.id,
                score: h.score,
                sourceId: h.sourceId,
                sourceTitle: h.sourceTitle,
                sourceUri: h.sourceUri,
                preview: h.text.slice(0, 300),
              }))
            : [],
        },
      });
    }
    return hits;
  }

  /** Render extracted keyFacts as a system-prompt block, or '' when there are none. */
  private static formatFacts(keyFacts: Record<string, string> | undefined): string {
    const entries = Object.entries(keyFacts ?? {}).filter(([, v]) => v?.trim());
    if (!entries.length) return '';
    const facts = entries.map(([k, v]) => `${k}=${v}`).join(', ');
    return [
      '<known_facts>',
      `Facts already known about the user — use them and do not ask again: ${facts}`,
      '</known_facts>',
    ].join('\n');
  }

  private async runSwitch(toBlockId: string, ctx: ActionCtx) {
    const newBlock = this.workflow.getBlock(toBlockId);
    await this.sessions.setActiveBlock(ctx.sessionId, toBlockId);
    if (ctx.write)
      ctx.write({ type: 'action', action: { type: 'switch', toBlockId } });

    const session = await this.sessions.get(ctx.sessionId);
    const history = await this.sessions.history(ctx.sessionId);
    const evalCtx: EvalContext = {
      state: (session.state ?? {}) as SessionState,
      messageCount: history.length,
      lastUserMessage: ctx.lastUserMessage,
    };
    const matched = this.directors.findMatch(newBlock.directors, evalCtx);
    const nextCtx: ActionCtx = {
      ...ctx,
      blockId: toBlockId,
      depth: (ctx.depth ?? 0) + 1,
      directorId: matched?.id,
    };

    if (matched) {
      await this.run(matched.then, nextCtx);
    } else if (newBlock.firstAction) {
      await this.run(newBlock.firstAction, nextCtx);
    } else if (ctx.write && !ctx.suppressDone) {
      ctx.write({ type: 'done', messageId: '' });
    }
  }

  private async runEndChat(text: string | undefined, ctx: ActionCtx) {
    let messageId = '';
    if (text) {
      if (ctx.write) ctx.write({ type: 'delta', text });
      const saved = await this.sessions.appendMessage(
        ctx.sessionId,
        'assistant',
        text,
        {
          actionType: 'end_chat',
          blockId: ctx.blockId,
          directorId: ctx.directorId ?? null,
        },
      );
      messageId = saved.id;
      this.events.emit(
        'message_sent',
        { messageId: saved.id, kind: 'end_chat' },
        ctx.sessionId,
      );
    }
    await this.sessions.end(ctx.sessionId);
    // Fire-and-forget the post-session enqueue: errors get logged on the service but never
    // fail the user-facing turn.
    this.postSession
      .enqueue(ctx.sessionId, 'end_chat')
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`post-session enqueue failed: ${message}`);
      });
    if (ctx.write) {
      ctx.write({ type: 'action', action: { type: 'end_chat', text } });
      if (!ctx.suppressDone) ctx.write({ type: 'done', messageId });
    }
  }

  private async runForm(formId: string, ctx: ActionCtx) {
    const form = this.workflow.getForm(formId);
    await this.mergeState(ctx.sessionId, {
      formState: { formId, collected: {} },
      pendingButtons: undefined,
    });
    if (ctx.write) {
      ctx.write({
        type: 'action',
        action: { type: 'form', formId, form, collected: {} },
      });
    }
    // Persist a synthetic assistant message so history reflects what was shown.
    const saved = await this.sessions.appendMessage(
      ctx.sessionId,
      'assistant',
      `[form ${form.id}] requested fields: ${form.fields.map((f) => f.name).join(', ')}`,
      {
        actionType: 'form',
        formId,
        blockId: ctx.blockId,
        directorId: ctx.directorId ?? null,
      },
    );
    this.events.emit(
      'message_sent',
      { messageId: saved.id, kind: 'form', formId },
      ctx.sessionId,
    );
    if (ctx.write && !ctx.suppressDone)
      ctx.write({ type: 'done', messageId: '' });
  }

  private async runButtons(options: ButtonOption[], ctx: ActionCtx) {
    await this.mergeState(ctx.sessionId, {
      pendingButtons: { options },
      formState: undefined,
    });
    if (ctx.write) {
      ctx.write({ type: 'action', action: { type: 'buttons', options } });
    }
    const saved = await this.sessions.appendMessage(
      ctx.sessionId,
      'assistant',
      `[buttons] ${options.map((o) => o.label).join(' | ')}`,
      {
        actionType: 'buttons',
        blockId: ctx.blockId,
        directorId: ctx.directorId ?? null,
      },
    );
    this.events.emit(
      'message_sent',
      { messageId: saved.id, kind: 'buttons' },
      ctx.sessionId,
    );
    if (ctx.write && !ctx.suppressDone)
      ctx.write({ type: 'done', messageId: '' });
  }

  /** Shallow-merge into session.state, treating `undefined` as a clear-the-key signal. */
  private async mergeState(sessionId: string, patch: Partial<SessionState>) {
    const session = await this.sessions.get(sessionId);
    const current = (session.state ?? {}) as SessionState;
    const next: SessionState = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (next as Record<string, unknown>)[k];
      else (next as Record<string, unknown>)[k] = v;
    }
    await this.sessions.updateState(
      sessionId,
      next as unknown as Prisma.InputJsonValue,
    );
  }
}
