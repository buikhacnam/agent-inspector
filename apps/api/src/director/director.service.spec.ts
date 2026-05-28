import { DirectorService, type EvalContext } from './director.service';
import type { Director } from '@agent-x/shared';

describe('DirectorService', () => {
  const svc = new DirectorService();
  const baseCtx = (over: Partial<EvalContext> = {}): EvalContext => ({
    state: {},
    messageCount: 0,
    ...over,
  });

  describe('evaluate', () => {
    it('key_fact_present / absent', () => {
      const ctx = baseCtx({ state: { keyFacts: { email: 'a@b.c' } } });
      expect(
        svc.evaluate({ type: 'key_fact_present', fact: 'email' }, ctx),
      ).toBe(true);
      expect(
        svc.evaluate({ type: 'key_fact_present', fact: 'name' }, ctx),
      ).toBe(false);
      expect(svc.evaluate({ type: 'key_fact_absent', fact: 'name' }, ctx)).toBe(
        true,
      );
      expect(
        svc.evaluate({ type: 'key_fact_absent', fact: 'email' }, ctx),
      ).toBe(false);
    });

    it('message_count_gte', () => {
      expect(
        svc.evaluate(
          { type: 'message_count_gte', value: 3 },
          baseCtx({ messageCount: 3 }),
        ),
      ).toBe(true);
      expect(
        svc.evaluate(
          { type: 'message_count_gte', value: 5 },
          baseCtx({ messageCount: 3 }),
        ),
      ).toBe(false);
    });

    it('intent_detected', () => {
      expect(
        svc.evaluate(
          { type: 'intent_detected', value: 'buying' },
          baseCtx({ state: { intent: 'buying' } }),
        ),
      ).toBe(true);
      expect(
        svc.evaluate(
          { type: 'intent_detected', value: 'buying' },
          baseCtx({ state: { intent: 'support' } }),
        ),
      ).toBe(false);
    });

    it('form_field_collected', () => {
      const ctx = baseCtx({
        state: { formState: { formId: 'f', collected: { name: 'Ada' } } },
      });
      expect(
        svc.evaluate({ type: 'form_field_collected', field: 'name' }, ctx),
      ).toBe(true);
      expect(
        svc.evaluate({ type: 'form_field_collected', field: 'email' }, ctx),
      ).toBe(false);
    });

    it('last_user_message_matches', () => {
      const ctx = baseCtx({ lastUserMessage: 'How much is the Pro plan?' });
      expect(
        svc.evaluate(
          { type: 'last_user_message_matches', pattern: '(?i)pro plan' },
          ctx,
        ),
      ).toBe(true);
      expect(
        svc.evaluate(
          { type: 'last_user_message_matches', pattern: '^bye$' },
          ctx,
        ),
      ).toBe(false);
      // bad regex returns false (logged)
      expect(
        svc.evaluate({ type: 'last_user_message_matches', pattern: '[' }, ctx),
      ).toBe(false);
    });

    it('safe defaults when state fields are absent', () => {
      const ctx = baseCtx();
      expect(
        svc.evaluate({ type: 'key_fact_present', fact: 'email' }, ctx),
      ).toBe(false);
      expect(
        svc.evaluate({ type: 'key_fact_absent', fact: 'email' }, ctx),
      ).toBe(true);
      expect(
        svc.evaluate({ type: 'intent_detected', value: 'buying' }, ctx),
      ).toBe(false);
      expect(
        svc.evaluate({ type: 'form_field_collected', field: 'name' }, ctx),
      ).toBe(false);
      expect(
        svc.evaluate({ type: 'last_user_message_matches', pattern: '.+' }, ctx),
      ).toBe(false);
    });

    it('handles unicode + multi-flag regex', () => {
      const ctx = baseCtx({ lastUserMessage: 'Café CAFÉ\ncafé' });
      expect(
        svc.evaluate(
          { type: 'last_user_message_matches', pattern: '(?im)^café$' },
          ctx,
        ),
      ).toBe(true);
      // \\p{Letter} requires the `u` flag; bare pattern without it should still error-recover cleanly
      expect(
        svc.evaluate(
          { type: 'last_user_message_matches', pattern: '(?u)\\p{Letter}+' },
          ctx,
        ),
      ).toBe(true);
    });

    it('deeply nested combinators short-circuit correctly', () => {
      const ctx = baseCtx({
        state: { intent: 'buying', keyFacts: { email: 'a@b.c' } },
        messageCount: 4,
      });
      const cond = {
        type: 'all_of' as const,
        conditions: [
          {
            type: 'any_of' as const,
            conditions: [
              { type: 'intent_detected' as const, value: 'support' },
              { type: 'intent_detected' as const, value: 'buying' },
            ],
          },
          {
            type: 'not' as const,
            condition: { type: 'key_fact_absent' as const, fact: 'email' },
          },
          { type: 'message_count_gte' as const, value: 3 },
        ],
      };
      expect(svc.evaluate(cond, ctx)).toBe(true);
      // flip one nested arm
      const flipped = {
        ...cond,
        conditions: [
          cond.conditions[0],
          cond.conditions[1],
          { type: 'message_count_gte' as const, value: 99 },
        ],
      };
      expect(svc.evaluate(flipped, ctx)).toBe(false);
    });

    it('combinators', () => {
      const ctx = baseCtx({ messageCount: 5, state: { intent: 'buying' } });
      expect(
        svc.evaluate(
          {
            type: 'all_of',
            conditions: [
              { type: 'intent_detected', value: 'buying' },
              { type: 'message_count_gte', value: 3 },
            ],
          },
          ctx,
        ),
      ).toBe(true);
      expect(
        svc.evaluate(
          {
            type: 'any_of',
            conditions: [
              { type: 'intent_detected', value: 'support' },
              { type: 'message_count_gte', value: 99 },
            ],
          },
          ctx,
        ),
      ).toBe(false);
      expect(
        svc.evaluate(
          { type: 'not', condition: { type: 'message_count_gte', value: 99 } },
          ctx,
        ),
      ).toBe(true);
    });
  });

  describe('findMatch', () => {
    const directors: Director[] = [
      {
        id: 'end',
        when: { type: 'last_user_message_matches', pattern: '(?i)\\bbye\\b' },
        then: { type: 'end_chat', text: 'k' },
      },
      {
        id: 'msg-count',
        when: { type: 'message_count_gte', value: 2 },
        then: { type: 'system_message', text: 'hi' },
      },
    ];

    it('returns first matching director', () => {
      expect(
        svc.findMatch(
          directors,
          baseCtx({ messageCount: 5, lastUserMessage: 'bye' }),
        )?.id,
      ).toBe('end');
      expect(
        svc.findMatch(
          directors,
          baseCtx({ messageCount: 5, lastUserMessage: 'hello' }),
        )?.id,
      ).toBe('msg-count');
    });

    it('returns null when no match', () => {
      expect(
        svc.findMatch(
          directors,
          baseCtx({ messageCount: 0, lastUserMessage: 'hello' }),
        ),
      ).toBeNull();
    });

    it('handles empty / undefined directors', () => {
      expect(svc.findMatch(undefined, baseCtx())).toBeNull();
      expect(svc.findMatch([], baseCtx())).toBeNull();
    });
  });
});
