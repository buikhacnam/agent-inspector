import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Form, SessionState } from '@agent-x/shared';
import { SessionService } from '../session/session.service';
import { WorkflowService } from '../workflow/workflow.service';
import {
  DirectorService,
  type EvalContext,
} from '../director/director.service';
import { ActionService, type StreamWrite } from '../action/action.service';
import {
  GuardianService,
  type ExtractionResult,
} from '../guardian/guardian.service';
import { EventsService } from '../events/events.service';
import { InspectorFlags } from '../inspector/inspector.flags';
import { InspectorService } from '../inspector/inspector.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s\-()]{7,}$/;

@Injectable()
export class ExperienceService {
  private readonly logger = new Logger(ExperienceService.name);

  constructor(
    private readonly sessions: SessionService,
    private readonly workflow: WorkflowService,
    private readonly directors: DirectorService,
    private readonly actions: ActionService,
    private readonly guardian: GuardianService,
    private readonly events: EventsService,
    private readonly inspectorFlags: InspectorFlags,
    private readonly inspector: InspectorService,
  ) {}

  async runFirstAction(sessionId: string): Promise<void> {
    const session = await this.sessions.get(sessionId);
    const block = this.workflow.getBlock(session.activeBlockId);
    if (!block.firstAction) return;
    await this.actions.run(block.firstAction, { sessionId, blockId: block.id });
  }

  async handleText(
    sessionId: string,
    text: string,
    write: StreamWrite,
  ): Promise<void> {
    const session = await this.sessions.get(sessionId);
    if (session.endedAt) throw new Error('session has ended');

    await this.sessions.appendMessage(sessionId, 'user', text);
    this.events.emit(
      'message_received',
      { text, inputType: 'text' },
      sessionId,
    );

    // Moderation runs synchronously — we need to short-circuit before any LLM cost.
    const modStart = Date.now();
    const mod = await this.guardian.moderate(text);
    if (this.inspectorFlags.on('timing') || this.inspectorFlags.on('pipeline')) {
      this.inspector.record({
        sessionId,
        phase: 'moderate',
        startedAt: new Date(modStart),
        durationMs: Date.now() - modStart,
        payload: { flagged: mod.flagged, reason: mod.reason ?? null },
      });
    }
    if (mod.flagged) {
      this.logger.log(
        `guardian blocked message (${mod.reason ?? 'unspecified'})`,
      );
      this.events.emit(
        'guardian_blocked',
        { reason: mod.reason ?? null, text },
        sessionId,
      );
      const safety = this.guardian.safetyMessage;
      write({ type: 'delta', text: safety });
      const saved = await this.sessions.appendMessage(
        sessionId,
        'assistant',
        safety,
        {
          actionType: 'guardian_blocked',
          reason: mod.reason ?? null,
          blockId: session.activeBlockId,
        },
      );
      this.events.emit(
        'message_sent',
        { messageId: saved.id, kind: 'safety' },
        sessionId,
      );
      write({ type: 'done', messageId: saved.id });
      return;
    }

    const block = this.workflow.getBlock(session.activeBlockId);
    const history = await this.sessions.history(sessionId);
    const priorState = (session.state ?? {}) as SessionState;

    // Extraction runs synchronously and is persisted BEFORE director matching, so directors
    // (e.g. intent_detected) evaluate against the current turn's intent/facts, not last turn's.
    // It writes only keyFacts/intent/sentiment; the action writes formState/pendingButtons after,
    // so there is no clobber.
    const extractStart = Date.now();
    const extraction = await this.guardian.extract(text, priorState, { sessionId });
    if (this.inspectorFlags.on('timing') || this.inspectorFlags.on('pipeline')) {
      this.inspector.record({
        sessionId,
        phase: 'extract',
        startedAt: new Date(extractStart),
        durationMs: Date.now() - extractStart,
        payload: {
          intent: extraction?.intent ?? null,
          sentiment: extraction?.sentiment ?? null,
          factCount: extraction ? Object.keys(extraction.keyFacts ?? {}).length : 0,
        },
      });
    }
    if (extraction) await this.applyExtraction(sessionId, extraction);
    const state: SessionState = extraction
      ? {
          ...priorState,
          keyFacts: { ...(priorState.keyFacts ?? {}), ...extraction.keyFacts },
          intent: extraction.intent,
          sentiment: extraction.sentiment,
        }
      : priorState;

    const ctx: EvalContext = {
      state,
      messageCount: history.length,
      lastUserMessage: text,
    };

    const directorStart = Date.now();
    let matched: ReturnType<DirectorService['findMatch']> = null;
    const directorTraceOn = this.inspectorFlags.on('director');
    if (directorTraceOn) {
      const traced = this.directors.findMatchTraced(block.directors, ctx);
      matched = traced.winner;
      this.inspector.record({
        sessionId,
        phase: 'director',
        startedAt: new Date(directorStart),
        durationMs: Date.now() - directorStart,
        payload: {
          blockId: block.id,
          winnerId: traced.winner?.id ?? null,
          candidates: traced.candidates as unknown as Prisma.InputJsonValue,
        },
      });
    } else {
      matched = this.directors.findMatch(block.directors, ctx);
      if (this.inspectorFlags.on('timing')) {
        this.inspector.record({
          sessionId,
          phase: 'director',
          startedAt: new Date(directorStart),
          durationMs: Date.now() - directorStart,
          payload: {
            blockId: block.id,
            winnerId: matched?.id ?? null,
          },
        });
      }
    }
    if (matched) {
      this.logger.log(
        `director matched: ${matched.id} -> ${matched.then.type}`,
      );
      this.events.emit(
        'director_fired',
        {
          directorId: matched.id,
          blockId: block.id,
          actionType: matched.then.type,
        },
        sessionId,
      );
      await this.recordMatch(sessionId, state, matched.id);
      await this.actions.run(matched.then, {
        sessionId,
        blockId: block.id,
        write,
        directorId: matched.id,
        lastUserMessage: text,
      });
    } else {
      await this.actions.run(
        { type: 'ai_message' },
        { sessionId, blockId: block.id, write, lastUserMessage: text },
      );
    }
  }

  private async applyExtraction(
    sessionId: string,
    extraction: ExtractionResult,
  ) {
    const session = await this.sessions.get(sessionId);
    const fresh = (session.state ?? {}) as SessionState;
    const next: SessionState = {
      ...fresh,
      keyFacts: { ...(fresh.keyFacts ?? {}), ...extraction.keyFacts },
      intent: extraction.intent,
      sentiment: extraction.sentiment,
    };
    await this.sessions.updateState(
      sessionId,
      next as unknown as Prisma.InputJsonValue,
    );
  }

  async handleForm(
    sessionId: string,
    values: Record<string, string>,
    write: StreamWrite,
  ): Promise<void> {
    const session = await this.sessions.get(sessionId);
    if (session.endedAt) throw new Error('session has ended');
    const state = (session.state ?? {}) as SessionState;
    if (!state.formState) throw new Error('no form is currently active');

    const form = this.workflow.getForm(state.formState.formId);
    const collected = { ...state.formState.collected, ...values };

    const issues = this.validate(form, collected);
    if (issues.length) {
      write({
        type: 'error',
        message: `form validation failed: ${issues.join('; ')}`,
      });
      write({
        type: 'action',
        action: { type: 'form', formId: form.id, form, collected },
      });
      write({ type: 'done', messageId: '' });
      return;
    }

    // Persist as a user-side message so LLM history reflects the submission.
    const summary = `[form:${form.id}] ${Object.entries(collected)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`;
    await this.sessions.appendMessage(sessionId, 'user', summary, {
      inputType: 'form',
      formId: form.id,
      values: collected,
    });
    this.events.emit(
      'message_received',
      { inputType: 'form', formId: form.id },
      sessionId,
    );
    this.events.emit(
      'form_submitted',
      { formId: form.id, values: collected },
      sessionId,
    );

    // Promote collected fields into keyFacts and clear formState.
    const block = this.workflow.getBlock(session.activeBlockId);
    await this.mergeState(sessionId, state, {
      formState: undefined,
      keyFacts: { ...(state.keyFacts ?? {}), ...collected },
    });

    await this.actions.runMany(form.submitActions, {
      sessionId,
      blockId: block.id,
      write,
      lastUserMessage: summary,
    });
  }

  async handleButton(
    sessionId: string,
    buttonId: string,
    write: StreamWrite,
  ): Promise<void> {
    const session = await this.sessions.get(sessionId);
    if (session.endedAt) throw new Error('session has ended');
    const state = (session.state ?? {}) as SessionState;
    const option = state.pendingButtons?.options.find((o) => o.id === buttonId);
    if (!option) throw new Error(`button ${buttonId} not pending`);

    await this.sessions.appendMessage(
      sessionId,
      'user',
      `[button] ${option.label}`,
      {
        inputType: 'button',
        buttonId,
      },
    );
    this.events.emit(
      'message_received',
      { inputType: 'button', buttonId, label: option.label },
      sessionId,
    );
    await this.mergeState(sessionId, state, { pendingButtons: undefined });

    const block = this.workflow.getBlock(session.activeBlockId);
    await this.actions.run(option.action, {
      sessionId,
      blockId: block.id,
      write,
      lastUserMessage: option.label,
    });
  }

  private validate(form: Form, collected: Record<string, string>): string[] {
    const issues: string[] = [];
    for (const f of form.fields) {
      const v = collected[f.name]?.trim();
      if (f.required && !v) {
        issues.push(`${f.label} is required`);
        continue;
      }
      if (!v) continue;
      if (f.validate === 'email' && !EMAIL_RE.test(v))
        issues.push(`${f.label} is not a valid email`);
      if (f.validate === 'phone' && !PHONE_RE.test(v))
        issues.push(`${f.label} is not a valid phone`);
    }
    return issues;
  }

  private async recordMatch(
    sessionId: string,
    state: SessionState,
    directorId: string,
  ) {
    const next: SessionState = {
      ...state,
      directorsMatched: [...(state.directorsMatched ?? []), directorId],
    };
    await this.sessions.updateState(
      sessionId,
      next as unknown as Prisma.InputJsonValue,
    );
  }

  private async mergeState(
    sessionId: string,
    current: SessionState,
    patch: Partial<SessionState>,
  ) {
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
