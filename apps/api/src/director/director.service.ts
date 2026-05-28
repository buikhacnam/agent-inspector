import { Injectable, Logger } from '@nestjs/common';
import type { Condition, Director, SessionState } from '@agent-x/shared';

export interface EvalContext {
  state: SessionState;
  messageCount: number;
  lastUserMessage?: string;
}

@Injectable()
export class DirectorService {
  private readonly logger = new Logger(DirectorService.name);

  findMatch(directors: Director[] | undefined, ctx: EvalContext): Director | null {
    if (!directors?.length) return null;
    for (const d of directors) {
      if (this.evaluate(d.when, ctx)) return d;
    }
    return null;
  }

  /**
   * Evaluates every director up to and including the first match. Directors after the
   * winner are reported as `skipped: true` (the production matcher short-circuits).
   * Designed for the inspector — keep the cost low (no extra LLM/IO).
   */
  findMatchTraced(
    directors: Director[] | undefined,
    ctx: EvalContext,
  ): {
    winner: Director | null;
    candidates: Array<{
      id: string;
      matched: boolean;
      skipped: boolean;
      condition: Condition;
    }>;
  } {
    if (!directors?.length) return { winner: null, candidates: [] };
    let winner: Director | null = null;
    const candidates: Array<{
      id: string;
      matched: boolean;
      skipped: boolean;
      condition: Condition;
    }> = [];
    for (const d of directors) {
      if (winner) {
        candidates.push({ id: d.id, matched: false, skipped: true, condition: d.when });
        continue;
      }
      const matched = this.evaluate(d.when, ctx);
      candidates.push({ id: d.id, matched, skipped: false, condition: d.when });
      if (matched) winner = d;
    }
    return { winner, candidates };
  }

  evaluate(c: Condition, ctx: EvalContext): boolean {
    switch (c.type) {
      case 'key_fact_present':
        return Boolean(ctx.state.keyFacts?.[c.fact]);
      case 'key_fact_absent':
        return !ctx.state.keyFacts?.[c.fact];
      case 'message_count_gte':
        return ctx.messageCount >= c.value;
      case 'intent_detected':
        return ctx.state.intent === c.value;
      case 'form_field_collected':
        return Boolean(ctx.state.formState?.collected?.[c.field]);
      case 'last_user_message_matches': {
        if (!ctx.lastUserMessage) return false;
        try {
          let pattern = c.pattern;
          let flags = '';
          // Support `(?i)` / `(?im)` / etc. inline-flag prefix by converting to JS RegExp flags.
          const m = pattern.match(/^\(\?([imsu]+)\)/);
          if (m) {
            flags = m[1];
            pattern = pattern.slice(m[0].length);
          }
          return new RegExp(pattern, flags).test(ctx.lastUserMessage);
        } catch (err) {
          this.logger.warn(`bad regex in condition: ${c.pattern} (${(err as Error).message})`);
          return false;
        }
      }
      case 'all_of':
        return c.conditions.every((x) => this.evaluate(x, ctx));
      case 'any_of':
        return c.conditions.some((x) => this.evaluate(x, ctx));
      case 'not':
        return !this.evaluate(c.condition, ctx);
    }
  }
}
