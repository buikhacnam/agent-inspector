import { ExperienceService } from './experience.service';
import type { SseEvent } from '@agent-x/shared';

describe('ExperienceService.handleText guardian path', () => {
  function build({
    flagged,
    extraction,
  }: {
    flagged: boolean;
    extraction?: { keyFacts: Record<string, string>; intent: string; sentiment: string };
  }) {
    const appended: { role: string; content: string }[] = [];

    const sessions = {
      get: jest.fn().mockResolvedValue({ id: 's1', activeBlockId: 'welcome', endedAt: null, state: {} }),
      appendMessage: jest.fn(async (_id: string, role: string, content: string) => {
        appended.push({ role, content });
        return { id: `m-${appended.length}` };
      }),
      history: jest.fn().mockResolvedValue([]),
      updateState: jest.fn().mockResolvedValue({}),
    } as any;

    const workflow = {
      getBlock: jest.fn().mockReturnValue({ id: 'welcome', persona: 'p', directors: [] }),
    } as any;
    const directors = { findMatch: jest.fn().mockReturnValue(null) } as any;
    const actions = { run: jest.fn().mockResolvedValue(undefined) } as any;
    const guardian = {
      safetyMessage: 'BLOCKED',
      moderate: jest.fn().mockResolvedValue({ flagged, reason: flagged ? 'violence' : undefined }),
      extract: jest.fn().mockResolvedValue(extraction ?? null),
    } as any;

    const events = { emit: jest.fn() } as any;
    const inspectorFlags = { on: jest.fn().mockReturnValue(false), enabled: jest.fn().mockReturnValue(false) } as any;
    const inspector = { record: jest.fn(), recordLlm: jest.fn() } as any;
    const svc = new ExperienceService(
      sessions,
      workflow,
      directors,
      actions,
      guardian,
      events,
      inspectorFlags,
      inspector,
    );
    return { svc, sessions, actions, guardian, events, appended };
  }

  it('short-circuits with safety message when moderation flags', async () => {
    const { svc, sessions, actions, guardian, appended } = build({ flagged: true });
    const events: SseEvent[] = [];

    await svc.handleText('s1', 'bad', (e) => events.push(e));

    expect(guardian.moderate).toHaveBeenCalledWith('bad');
    expect(actions.run).not.toHaveBeenCalled();
    // safety delta + done
    expect(events[0]).toEqual({ type: 'delta', text: 'BLOCKED' });
    expect(events.at(-1)?.type).toBe('done');
    // user + safety assistant message persisted
    expect(appended).toEqual([
      { role: 'user', content: 'bad' },
      { role: 'assistant', content: 'BLOCKED' },
    ]);
    expect(guardian.extract).not.toHaveBeenCalled();
    expect(sessions.updateState).not.toHaveBeenCalled();
  });

  it('runs action and merges extraction into state on clean input', async () => {
    const { svc, sessions, actions, guardian } = build({
      flagged: false,
      extraction: { keyFacts: { email: 'a@b.c' }, intent: 'buying', sentiment: 'pos' },
    });
    await svc.handleText('s1', 'hi', () => {});

    expect(actions.run).toHaveBeenCalledTimes(1);
    expect(guardian.extract).toHaveBeenCalledWith('hi', {}, { sessionId: 's1' });
    expect(sessions.updateState).toHaveBeenCalled();
    const written = sessions.updateState.mock.calls[0][1];
    expect(written.intent).toBe('buying');
    expect(written.sentiment).toBe('pos');
    expect(written.keyFacts).toEqual({ email: 'a@b.c' });
  });
});
