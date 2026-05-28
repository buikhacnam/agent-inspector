import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ButtonOption, Form, SseEvent } from '@agent-x/shared';
import {
  addUrlKnowledge,
  createSession,
  deleteSession,
  deleteSource,
  getDebugFlags,
  getSession,
  listEvents,
  listMemories,
  listSessions,
  listSources,
  listTraces,
  pasteKnowledge,
  streamButton,
  streamForm,
  streamText,
  type DebugFlags,
  type KnowledgeSourceDto,
  type MemoryDto,
  type SessionDto,
  type SessionSummaryDto,
  type TurnTraceDto,
  type WebhookEventDto,
} from './lib/api';

type Msg =
  | { kind: 'text'; role: 'user' | 'assistant'; content: string; meta?: Record<string, unknown> }
  | { kind: 'form'; form: Form; collected: Record<string, string>; submitted?: boolean }
  | { kind: 'buttons'; options: ButtonOption[]; clickedId?: string }
  | { kind: 'tool'; name: string; args: unknown; result?: unknown }
  | { kind: 'error'; message: string };

export function App() {
  const navigate = useNavigate();
  const { sessionId: routeSessionId } = useParams<{ sessionId: string }>();
  const sessionId = routeSessionId ?? null;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [ended, setEnded] = useState(false);

  // Debug + sources panel state
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [eventsOpen, setEventsOpen] = useState(true);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [sessionDto, setSessionDto] = useState<SessionDto | null>(null);
  const [sessions, setSessions] = useState<SessionSummaryDto[]>([]);
  const [sources, setSources] = useState<KnowledgeSourceDto[]>([]);
  const [events, setEvents] = useState<WebhookEventDto[]>([]);
  const [memories, setMemories] = useState<MemoryDto[]>([]);
  const [traces, setTraces] = useState<TurnTraceDto[]>([]);
  const [debugFlags, setDebugFlags] = useState<DebugFlags>({
    inspector: false,
    director: false,
    rag: false,
    llm: false,
    prompt: false,
    timing: false,
  });
  const [lastTurnMeta, setLastTurnMeta] = useState<{
    ragHitIds?: string[];
    toolCalls?: { name: string; args: unknown; result?: unknown }[];
    directorId?: string | null;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshDebug = useCallback(
    async (sid: string) => {
      try {
        const [s, ev, mem, tr] = await Promise.all([
          getSession(sid),
          listEvents(sid, 50),
          listMemories(sid),
          listTraces(sid, { limit: 200 }).catch(() => [] as TurnTraceDto[]),
        ]);
        setSessionDto(s);
        setEvents(ev);
        setMemories(mem);
        setTraces(tr);
        // Latest assistant message meta drives the "last turn" debug box.
        const lastAssistant = [...s.messages].reverse().find((m) => m.role === 'assistant');
        if (lastAssistant?.meta) {
          const meta = lastAssistant.meta as Record<string, unknown>;
          setLastTurnMeta({
            ragHitIds: Array.isArray(meta.ragHitIds) ? (meta.ragHitIds as string[]) : undefined,
            toolCalls: Array.isArray(meta.toolCalls)
              ? (meta.toolCalls as { name: string; args: unknown; result?: unknown }[])
              : undefined,
            directorId: (meta.directorId as string | null | undefined) ?? null,
          });
        }
      } catch (err) {
        console.warn('refreshDebug failed', err);
      }
    },
    [],
  );

  const refreshSources = useCallback(async () => {
    try {
      setSources(await listSources());
    } catch (err) {
      console.warn('refreshSources failed', err);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await listSessions());
    } catch (err) {
      console.warn('refreshSessions failed', err);
    }
  }, []);

  // Load a session DTO into the chat view.
  const enterSession = useCallback(
    (s: SessionDto) => {
      setSessionDto(s);
      setMessages(
        s.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ kind: 'text', role: m.role as 'user' | 'assistant', content: m.content })),
      );
      setEnded(!!s.endedAt);
      void refreshDebug(s.id);
    },
    [refreshDebug],
  );

  const openSession = useCallback(
    (id: string) => {
      if (sending) return;
      navigate(`/${id}`);
    },
    [navigate, sending],
  );

  const startSession = useCallback(async () => {
    if (sending) return;
    try {
      const s = await createSession();
      enterSession(s); // populate immediately so the loader effect skips a refetch
      void refreshSessions();
      navigate(`/${s.id}`);
    } catch (err) {
      console.error(err);
    }
  }, [enterSession, navigate, refreshSessions, sending]);

  const goHome = useCallback(() => {
    if (sending) return;
    navigate('/');
  }, [navigate, sending]);

  const removeSession = useCallback(
    async (id: string) => {
      if (sending) return;
      if (!window.confirm('Delete this session and all its data?')) return;
      try {
        await deleteSession(id);
        if (id === sessionId) navigate('/');
        void refreshSessions();
      } catch (err) {
        console.error(err);
      }
    },
    [navigate, refreshSessions, sending, sessionId],
  );

  const removeSource = useCallback(async (id: string) => {
    try {
      await deleteSource(id);
      setSources((current) => current.filter((source) => source.id !== id));
      await refreshSources();
    } catch (err) {
      console.error(err);
      throw err;
    }
  }, [refreshSources]);

  useEffect(() => {
    void refreshSessions();
    void refreshSources();
    void getDebugFlags().then(setDebugFlags);
  }, [refreshSessions, refreshSources]);

  // URL drives the active session: load it (or clear the view at "/").
  useEffect(() => {
    if (!sessionId) {
      setSessionDto(null);
      setMessages([]);
      setEvents([]);
      setMemories([]);
      setTraces([]);
      setEnded(false);
      return;
    }
    if (sessionDto?.id === sessionId) return; // already loaded (e.g. just created)
    let cancelled = false;
    getSession(sessionId)
      .then((s) => {
        if (!cancelled) enterSession(s);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) navigate('/', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, sessionDto?.id, enterSession, navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  async function consumeStream(gen: AsyncGenerator<SseEvent>, userBubble?: Msg) {
    setSending(true);
    setMessages((m) => {
      const next = userBubble ? [...m, userBubble] : [...m];
      next.push({ kind: 'text', role: 'assistant', content: '' });
      return next;
    });
    try {
      for await (const ev of gen) {
        if (ev.type === 'delta') {
          setMessages((m) => {
            const next = [...m];
            const tail = next[next.length - 1];
            if (tail.kind === 'text' && tail.role === 'assistant') {
              next[next.length - 1] = { ...tail, content: tail.content + ev.text };
            }
            return next;
          });
        } else if (ev.type === 'action') {
          const a = ev.action;
          if (a.type === 'form') {
            setMessages((m) => {
              const next = [...m];
              const tail = next[next.length - 1];
              const formMsg: Msg = { kind: 'form', form: a.form!, collected: a.collected ?? {} };
              if (tail.kind === 'text' && tail.role === 'assistant' && !tail.content) next[next.length - 1] = formMsg;
              else next.push(formMsg);
              return next;
            });
          } else if (a.type === 'buttons') {
            setMessages((m) => {
              const next = [...m];
              const tail = next[next.length - 1];
              const btnMsg: Msg = { kind: 'buttons', options: a.options };
              if (tail.kind === 'text' && tail.role === 'assistant' && !tail.content) next[next.length - 1] = btnMsg;
              else next.push(btnMsg);
              return next;
            });
          } else if (a.type === 'end_chat') {
            setEnded(true);
          }
        } else if (ev.type === 'tool_call') {
          setMessages((m) => {
            const next = [...m];
            const tail = next[next.length - 1];
            const toolMsg: Msg = { kind: 'tool', name: ev.name, args: ev.args };
            if (tail && tail.kind === 'text' && tail.role === 'assistant' && !tail.content) {
              next[next.length - 1] = toolMsg;
              next.push({ kind: 'text', role: 'assistant', content: '' });
            } else {
              next.splice(next.length - 1, 0, toolMsg);
            }
            return next;
          });
        } else if (ev.type === 'tool_result') {
          setMessages((m) => {
            const next = [...m];
            for (let i = next.length - 1; i >= 0; i--) {
              const t = next[i];
              if (t.kind === 'tool' && t.name === ev.name && t.result === undefined) {
                next[i] = { ...t, result: ev.result };
                break;
              }
            }
            return next;
          });
        } else if (ev.type === 'error') {
          setMessages((m) => {
            const next = [...m];
            const tail = next[next.length - 1];
            const errBubble: Msg = { kind: 'error', message: ev.message };
            if (tail.kind === 'text' && tail.role === 'assistant' && !tail.content) next[next.length - 1] = errBubble;
            else next.push(errBubble);
            return next;
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'stream failed';
      setMessages((m) => {
        const next = [...m];
        const tail = next[next.length - 1];
        const errBubble: Msg = { kind: 'error', message };
        if (tail.kind === 'text' && tail.role === 'assistant' && !tail.content) next[next.length - 1] = errBubble;
        else next.push(errBubble);
        return next;
      });
    } finally {
      // drop empty assistant placeholder if nothing arrived
      setMessages((m) => {
        const tail = m[m.length - 1];
        if (tail && tail.kind === 'text' && tail.role === 'assistant' && !tail.content) return m.slice(0, -1);
        return m;
      });
      setSending(false);
      if (sessionId) void refreshDebug(sessionId);
    }
  }

  async function sendText() {
    if (!sessionId || !input.trim() || sending || ended) return;
    const text = input.trim();
    setInput('');
    await consumeStream(streamText(sessionId, text), { kind: 'text', role: 'user', content: text });
  }

  async function submitForm(idx: number, values: Record<string, string>) {
    if (!sessionId || sending || ended) return;
    setMessages((m) => {
      const next = [...m];
      const target = next[idx];
      if (target.kind === 'form') next[idx] = { ...target, collected: values, submitted: true };
      return next;
    });
    await consumeStream(streamForm(sessionId, values));
  }

  async function clickButton(idx: number, btn: ButtonOption) {
    if (!sessionId || sending || ended) return;
    setMessages((m) => {
      const next = [...m];
      const target = next[idx];
      if (target.kind === 'buttons') next[idx] = { ...target, clickedId: btn.id };
      return next;
    });
    await consumeStream(streamButton(sessionId, btn.id));
  }

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <strong style={{ cursor: 'pointer' }} onClick={goHome} title="Back to sessions">
            Agent-X
          </strong>
          <button type="button" style={styles.toggleBtn} onClick={() => setSessionsOpen((v) => !v)}>
            {sessionsOpen ? '◀ Sessions' : 'Sessions ▶'}
          </button>
          <button type="button" style={styles.toggleBtn} onClick={() => setInspectorOpen((v) => !v)}>
            {inspectorOpen ? '◀ Inspector' : 'Inspector ▶'}
          </button>
          <button type="button" style={styles.toggleBtn} onClick={() => setKnowledgeOpen(true)}>
            + Add knowledge
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={styles.session}>
            {sessionId ? `session: ${sessionId.slice(0, 8)}${ended ? ' (ended)' : ''}` : 'no session'}
          </span>
          <button type="button" style={styles.toggleBtn} onClick={() => setEventsOpen((v) => !v)}>
            {eventsOpen ? 'Events ▶' : '◀ Events'}
          </button>
        </div>
      </header>

      <div style={styles.body}>
        {sessionsOpen && (
          <SessionsPanel
            sessions={sessions}
            activeId={sessionId}
            onNew={startSession}
            onOpen={openSession}
            onDelete={removeSession}
            onRefresh={refreshSessions}
            disabled={sending}
          />
        )}
        {inspectorOpen && (
          <InspectorPanel
            session={sessionDto}
            memories={memories}
            sources={sources}
            onDeleteSource={removeSource}
            lastTurnMeta={lastTurnMeta}
            debugFlags={debugFlags}
            traces={traces}
          />
        )}

        <div style={styles.chatCol}>
          {!sessionId ? (
            <HomeView
              sessions={sessions}
              onNew={startSession}
              onOpen={openSession}
              onDelete={removeSession}
              onRefresh={refreshSessions}
            />
          ) : (
          <>
          <div ref={scrollRef} style={styles.messages}>
            {messages.length === 0 && <div style={styles.empty}>Type a message to start.</div>}
            {messages.map((m, i) => {
              if (m.kind === 'text') {
                return (
                  <div key={i} style={{ ...styles.bubble, ...(m.role === 'user' ? styles.user : styles.assistant) }}>
                    {m.content || (m.role === 'assistant' && sending ? '…' : '')}
                  </div>
                );
              }
              if (m.kind === 'form') {
                return <FormBubble key={i} idx={i} msg={m} onSubmit={submitForm} disabled={sending || ended || m.submitted} />;
              }
              if (m.kind === 'buttons') {
                return <ButtonsBubble key={i} idx={i} msg={m} onClick={clickButton} disabled={sending || ended || !!m.clickedId} />;
              }
              if (m.kind === 'tool') {
                return <ToolBubble key={i} msg={m} />;
              }
              if (m.kind === 'error') {
                return (
                  <div key={i} style={styles.errorBubble}>
                    <span style={styles.errorTag}>error</span> {m.message}
                  </div>
                );
              }
              return null;
            })}
          </div>

          <form
            style={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              sendText();
            }}
          >
            <input
              style={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ended ? 'Session ended' : 'Message...'}
              disabled={!sessionId || sending || ended}
            />
            <button type="submit" style={styles.btn} disabled={!sessionId || sending || ended || !input.trim()}>
              Send
            </button>
          </form>
          </>
          )}
        </div>

        {eventsOpen && <EventsPanel events={events} />}
      </div>

      {knowledgeOpen && (
        <Modal title="Add knowledge" onClose={() => setKnowledgeOpen(false)}>
          <SourcesPanel sources={sources} onRefresh={refreshSources} onDeleteSource={removeSource} />
        </Modal>
      )}
    </div>
  );
}

function FormBubble({
  idx,
  msg,
  onSubmit,
  disabled,
}: {
  idx: number;
  msg: Extract<Msg, { kind: 'form' }>;
  onSubmit: (idx: number, values: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(msg.collected);
  return (
    <div style={{ ...styles.bubble, ...styles.assistant, ...styles.formBubble }}>
      <div style={styles.formTitle}>{msg.form.id}</div>
      {msg.form.fields.map((f) => (
        <label key={f.name} style={styles.formField}>
          <span style={styles.formLabel}>
            {f.label}
            {f.required ? ' *' : ''}
          </span>
          <input
            style={styles.formInput}
            type={f.validate === 'email' ? 'email' : 'text'}
            value={values[f.name] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            disabled={disabled}
            required={f.required}
          />
        </label>
      ))}
      <button
        style={{ ...styles.btn, marginTop: 8, alignSelf: 'flex-start' }}
        onClick={() => onSubmit(idx, values)}
        disabled={disabled}
        type="button"
      >
        {msg.submitted ? 'Submitted' : 'Submit'}
      </button>
    </div>
  );
}

function ButtonsBubble({
  idx,
  msg,
  onClick,
  disabled,
}: {
  idx: number;
  msg: Extract<Msg, { kind: 'buttons' }>;
  onClick: (idx: number, btn: ButtonOption) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ ...styles.bubble, ...styles.assistant, ...styles.buttonsBubble }}>
      {msg.options.map((o) => (
        <button
          key={o.id}
          style={{
            ...styles.choiceBtn,
            ...(msg.clickedId === o.id ? styles.choiceBtnActive : {}),
          }}
          onClick={() => onClick(idx, o)}
          disabled={disabled}
          type="button"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ToolBubble({ msg }: { msg: Extract<Msg, { kind: 'tool' }> }) {
  return (
    <div style={styles.toolBubble}>
      <div style={styles.toolHeader}>tool · {msg.name}</div>
      <div style={styles.toolBlock}>
        <span style={styles.toolLabel}>args</span>
        <pre style={styles.toolPre}>{JSON.stringify(msg.args, null, 2)}</pre>
      </div>
      {msg.result !== undefined && (
        <div style={styles.toolBlock}>
          <span style={styles.toolLabel}>result</span>
          <pre style={styles.toolPre}>{JSON.stringify(msg.result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function sessionLabel(s: SessionSummaryDto): string {
  return s.preview?.trim() || `(empty) ${s.id.slice(0, 8)}`;
}

function HomeView({
  sessions,
  onNew,
  onOpen,
  onDelete,
  onRefresh,
}: {
  sessions: SessionSummaryDto[];
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div style={styles.home}>
      <div style={styles.homeCard}>
        <h2 style={styles.homeTitle}>Agent-X</h2>
        <button type="button" style={{ ...styles.btn, alignSelf: 'stretch' }} onClick={onNew}>
          + New session
        </button>
        <div style={styles.panelHeader}>
          Recent sessions ({sessions.length})
          <button type="button" style={styles.linkBtn} onClick={() => void onRefresh()}>
            refresh
          </button>
        </div>
        <div style={styles.homeList}>
          {sessions.length === 0 && <div style={styles.empty}>none yet</div>}
          {sessions.map((s) => (
            <div key={s.id} style={styles.homeRow} onClick={() => onOpen(s.id)}>
              <div style={styles.homeRowMain}>
                <div style={styles.homeRowTitle}>{sessionLabel(s)}</div>
                <div style={styles.homeRowMeta}>
                  {new Date(s.createdAt).toLocaleString()} · {s.messageCount} msgs
                  {s.endedAt ? ' · ended' : ''}
                </div>
              </div>
              <button
                type="button"
                style={styles.deleteBtn}
                title="Delete session"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionsPanel({
  sessions,
  activeId,
  onNew,
  onOpen,
  onDelete,
  onRefresh,
  disabled,
}: {
  sessions: SessionSummaryDto[];
  activeId: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => Promise<void>;
  disabled?: boolean;
}) {
  return (
    <aside style={styles.sidePanel}>
      <div style={styles.panelHeader}>
        Sessions ({sessions.length})
        <button type="button" style={styles.linkBtn} onClick={() => void onRefresh()}>
          refresh
        </button>
      </div>
      <button type="button" style={styles.btn} onClick={onNew} disabled={disabled}>
        + New session
      </button>
      <div style={styles.sourceList}>
        {sessions.length === 0 && <div style={styles.empty}>none yet</div>}
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => !disabled && onOpen(s.id)}
            style={{
              ...styles.sessionRow,
              ...(s.id === activeId ? styles.sessionRowActive : {}),
              ...(disabled ? { cursor: 'default' } : {}),
            }}
          >
            <div style={styles.sessionRowMain}>
              <div style={styles.sourceTitle} title={sessionLabel(s)}>
                {sessionLabel(s)}
              </div>
              <div style={styles.sourceMeta}>
                {new Date(s.createdAt).toLocaleString()} · {s.messageCount} msgs
                {s.endedAt ? ' · ended' : ''}
              </div>
            </div>
            <button
              type="button"
              style={styles.deleteBtn}
              title="Delete session"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

function SourcesPanel({
  sources,
  onRefresh,
  onDeleteSource,
}: {
  sources: KnowledgeSourceDto[];
  onRefresh: () => Promise<void>;
  onDeleteSource: (id: string) => Promise<void>;
}) {
  const [pasteText, setPasteText] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [url, setUrl] = useState('');
  const [crawl, setCrawl] = useState(false);
  const [namespace, setNamespace] = useState('default');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPaste(e: React.FormEvent) {
    e.preventDefault();
    if (!pasteText.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await pasteKnowledge(pasteText, pasteTitle || undefined, namespace);
      setPasteText('');
      setPasteTitle('');
      await onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'paste failed');
    } finally {
      setBusy(false);
    }
  }

  async function onUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await addUrlKnowledge(url, { crawl, namespace });
      setUrl('');
      await onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'url failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.panelStack}>
      <div style={styles.panelHeader}>
        Knowledge
        <button type="button" style={styles.linkBtn} onClick={() => void onRefresh()}>
          refresh
        </button>
      </div>

      <form style={styles.panelForm} onSubmit={onPaste}>
        <label style={styles.formLabel}>Namespace</label>
        <input
          style={styles.formInput}
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          placeholder="default"
        />
        <label style={styles.formLabel}>Paste text</label>
        <input
          style={styles.formInput}
          value={pasteTitle}
          onChange={(e) => setPasteTitle(e.target.value)}
          placeholder="title (optional)"
        />
        <textarea
          style={{ ...styles.formInput, height: 80, fontFamily: 'inherit' }}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="paste content..."
        />
        <button type="submit" style={styles.btn} disabled={busy || !pasteText.trim()}>
          Add paste
        </button>
      </form>

      <form style={styles.panelForm} onSubmit={onUrl}>
        <label style={styles.formLabel}>Add URL</label>
        <input
          style={styles.formInput}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
        />
        <label style={{ ...styles.formLabel, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={crawl} onChange={(e) => setCrawl(e.target.checked)} />
          crawl whole site
        </label>
        <button type="submit" style={styles.btn} disabled={busy || !url.trim()}>
          Enqueue URL
        </button>
      </form>

      {err && <div style={styles.panelErr}>{err}</div>}

      <KnowledgeSourcesList
        sources={sources}
        heading={`Sources (${sources.length})`}
        onDelete={onDeleteSource}
      />
    </div>
  );
}

function KnowledgeSourcesList({
  sources,
  heading,
  onDelete,
}: {
  sources: KnowledgeSourceDto[];
  heading: string;
  onDelete?: (id: string) => Promise<void> | void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  async function handleDelete(s: KnowledgeSourceDto) {
    if (!onDelete) return;
    const label = s.title ?? s.uri;
    if (!window.confirm(`Delete "${label}"? This removes all its chunks.`)) return;
    setPendingId(s.id);
    try {
      await onDelete(s.id);
    } finally {
      setPendingId(null);
    }
  }
  return (
    <>
      <div style={styles.panelHeader}>{heading}</div>
      <div style={styles.sourceList}>
        {sources.length === 0 && <div style={styles.empty}>none yet</div>}
        {sources.map((s) => (
          <div key={s.id} style={styles.sourceRow}>
            <div style={styles.sourceRowHead}>
              <div style={styles.sourceTitle} title={s.title ?? s.uri}>
                {s.title ?? s.uri}
              </div>
              {onDelete && (
                <button
                  type="button"
                  style={styles.sourceDeleteBtn}
                  onClick={() => void handleDelete(s)}
                  disabled={pendingId === s.id}
                  title="Delete source"
                >
                  {pendingId === s.id ? '…' : '×'}
                </button>
              )}
            </div>
            <div style={styles.sourceMeta}>
              <span style={statusStyle(s.status)}>{s.status}</span> · {s.namespace} · {s._count?.chunks ?? 0} chunks
            </div>
            {s.error && <div style={styles.sourceErr}>{s.error}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

function InspectorPanel({
  session,
  memories,
  sources,
  onDeleteSource,
  lastTurnMeta,
  debugFlags,
  traces,
}: {
  session: SessionDto | null;
  memories: MemoryDto[];
  sources: KnowledgeSourceDto[];
  onDeleteSource: (id: string) => Promise<void>;
  lastTurnMeta: {
    ragHitIds?: string[];
    toolCalls?: { name: string; args: unknown; result?: unknown }[];
    directorId?: string | null;
  } | null;
  debugFlags: DebugFlags;
  traces: TurnTraceDto[];
}) {
  const state = (session?.state ?? {}) as Record<string, unknown>;
  const summaryRow = memories.find((m) => m.content.startsWith('[summary] '));
  const factRows = memories.filter((m) => !m.content.startsWith('[summary] '));
  const intent = typeof state.intent === 'string' ? state.intent : null;
  const sentiment = typeof state.sentiment === 'string' ? state.sentiment : null;
  const keyFacts =
    state.keyFacts && typeof state.keyFacts === 'object'
      ? (state.keyFacts as Record<string, unknown>)
      : null;
  return (
    <aside style={{ ...styles.sidePanel, ...styles.inspectorAside }}>
      <div style={styles.panelHeader}>Session info</div>
      <div style={styles.lastTurn}>
        <div>
          <span style={styles.kvKey}>active block:</span>{' '}
          <span style={styles.kvVal}>{session?.activeBlockId ?? '—'}</span>
        </div>
        <div>
          <span style={styles.kvKey}>workflow version:</span>{' '}
          <span style={styles.kvVal}>{session?.workflowVersion ?? '—'}</span>
        </div>
      </div>

      {debugFlags.inspector && (
        <>
          <div style={styles.panelHeader}>
            Pre-extraction
            <span style={styles.debugTag}>debug</span>
          </div>
          <div style={styles.lastTurn}>
            <div>
              <span style={styles.kvKey}>intent:</span>{' '}
              <span style={styles.kvVal}>{intent ?? '—'}</span>
            </div>
            <div>
              <span style={styles.kvKey}>sentiment:</span>{' '}
              <span style={styles.kvVal}>{sentiment ?? '—'}</span>
            </div>
            <div style={{ marginTop: 4 }}>
              <span style={styles.kvKey}>keyFacts:</span>
              {keyFacts && Object.keys(keyFacts).length > 0 ? (
                <div style={styles.factGrid}>
                  {Object.entries(keyFacts).map(([k, v]) => (
                    <div key={k} style={styles.factRow}>
                      <span style={styles.factKey}>{k}</span>
                      <span style={styles.factVal}>
                        {typeof v === 'string' ? v : JSON.stringify(v)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <span style={styles.kvVal}> —</span>
              )}
            </div>
          </div>
        </>
      )}

      {debugFlags.timing && <PhaseTimelineCard traces={traces} />}
      {debugFlags.llm && <LlmCallsCard traces={traces} promptVisible={debugFlags.prompt} />}
      {debugFlags.rag && <RagHitsCard traces={traces} />}
      {debugFlags.director && <DirectorTraceCard traces={traces} />}

      <div style={styles.panelHeader}>Session state</div>
      <pre style={styles.statePre}>{JSON.stringify(state, null, 2)}</pre>

      <div style={styles.panelHeader}>Last turn</div>
      <div style={styles.lastTurn}>
        <div>
          <span style={styles.kvKey}>director:</span>{' '}
          <span style={styles.kvVal}>{lastTurnMeta?.directorId ?? '—'}</span>
        </div>
        <div>
          <span style={styles.kvKey}>rag hits:</span>{' '}
          <span style={styles.kvVal}>{lastTurnMeta?.ragHitIds?.length ?? 0}</span>
        </div>
        <div>
          <span style={styles.kvKey}>tool calls:</span>{' '}
          <span style={styles.kvVal}>
            {lastTurnMeta?.toolCalls?.length
              ? lastTurnMeta.toolCalls.map((c) => c.name).join(', ')
              : '—'}
          </span>
        </div>
      </div>

      <div style={styles.panelHeader}>Memories ({memories.length})</div>
      <div style={styles.memoryList}>
        {memories.length === 0 && <div style={styles.empty}>none yet (written post-session)</div>}
        {summaryRow && (
          <div style={{ ...styles.memoryRow, ...styles.memorySummary }}>
            <span style={styles.memoryTag}>summary</span>
            <div style={styles.memoryContent}>{summaryRow.content.slice('[summary] '.length)}</div>
            <div style={styles.memoryTime}>{new Date(summaryRow.createdAt).toLocaleString()}</div>
          </div>
        )}
        {factRows.map((m) => (
          <div key={m.id} style={styles.memoryRow}>
            <span style={styles.memoryTag}>fact</span>
            <div style={styles.memoryContent}>{m.content}</div>
            <div style={styles.memoryTime}>{new Date(m.createdAt).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <KnowledgeSourcesList
        sources={sources}
        heading={`Knowledge sources (${sources.length})`}
        onDelete={onDeleteSource}
      />
    </aside>
  );
}

const PHASE_COLORS: Record<string, string> = {
  moderate: '#d83b3b',
  extract: '#0f6e72',
  director: '#5b2bb3',
  rag: '#17a2a8',
  llm: '#0a84ff',
  tool: '#e09a1a',
  persist: '#888',
};

function pickLastTurnTraces(traces: TurnTraceDto[]): TurnTraceDto[] {
  if (!traces.length) return [];
  const sorted = [...traces].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );
  const TURN_GAP_MS = 5000;
  const cluster: TurnTraceDto[] = [sorted[sorted.length - 1]];
  for (let i = sorted.length - 2; i >= 0; i--) {
    const curEnd =
      new Date(sorted[i].startedAt).getTime() + sorted[i].durationMs;
    const nextStart = new Date(sorted[i + 1].startedAt).getTime();
    if (nextStart - curEnd > TURN_GAP_MS) break;
    cluster.unshift(sorted[i]);
  }
  return cluster;
}

function PhaseTimelineCard({ traces }: { traces: TurnTraceDto[] }) {
  const turn = pickLastTurnTraces(traces);
  if (!turn.length) {
    return (
      <>
        <div style={styles.panelHeader}>
          <span>Phase timeline</span>
          <span style={styles.debugTag}>debug</span>
        </div>
        <div style={styles.empty}>no phase data yet</div>
      </>
    );
  }
  const t0 = Math.min(...turn.map((t) => new Date(t.startedAt).getTime()));
  const t1 = Math.max(
    ...turn.map((t) => new Date(t.startedAt).getTime() + t.durationMs),
  );
  const span = Math.max(t1 - t0, 1);

  // Greedy lane packing so concurrent phases (e.g. extract LLM overlapping persist) stack.
  type Lane = { trace: TurnTraceDto; start: number; end: number; lane: number }[];
  const placed: Lane = [];
  const laneEnds: number[] = [];
  for (const t of turn) {
    const start = new Date(t.startedAt).getTime();
    const end = start + t.durationMs;
    let laneIdx = laneEnds.findIndex((e) => e <= start);
    if (laneIdx === -1) {
      laneIdx = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[laneIdx] = end;
    }
    placed.push({ trace: t, start, end, lane: laneIdx });
  }
  const laneCount = laneEnds.length;

  return (
    <>
      <div style={styles.panelHeader}>
        <span>Phase timeline · {t1 - t0}ms</span>
        <span style={styles.debugTag}>debug</span>
      </div>
      <div style={styles.timelineBox}>
        <div style={{ ...styles.timelineInner, height: 6 + laneCount * 26 }}>
          {[0.25, 0.5, 0.75].map((frac) => (
            <div key={frac} style={{ ...styles.timelineTick, left: `${frac * 100}%` }} />
          ))}
          {placed.map((p) => {
            const left = ((p.start - t0) / span) * 100;
            const width = Math.max(((p.end - p.start) / span) * 100, 0.4);
            const color = PHASE_COLORS[p.trace.phase] ?? '#888';
            const label = labelForPhase(p.trace);
            const narrow = width < 12;
            return (
              <div
                key={p.trace.id}
                title={`${label} · ${p.trace.durationMs}ms`}
                style={{
                  ...styles.timelineBar,
                  left: `${left}%`,
                  width: `${width}%`,
                  top: 4 + p.lane * 26,
                  background: color,
                }}
              >
                {!narrow && (
                  <span style={styles.timelineBarLabel}>
                    {label}
                    <span style={styles.timelineBarMs}> {p.trace.durationMs}ms</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div style={styles.timelineAxis}>
          <span>0</span>
          <span>{Math.round(span / 2)}ms</span>
          <span>{span}ms</span>
        </div>
      </div>
      <div style={styles.timelineLegend}>
        {Array.from(new Set(turn.map((t) => t.phase))).map((p) => (
          <span key={p} style={styles.timelineLegendItem}>
            <span style={{ ...styles.timelineLegendDot, background: PHASE_COLORS[p] ?? '#888' }} />
            {p}
          </span>
        ))}
      </div>
    </>
  );
}

function labelForPhase(t: TurnTraceDto): string {
  if (t.phase === 'llm') {
    const cs = (t.payload as { callSite?: string }).callSite;
    if (cs) {
      // shorten action.ai_message:welcome → ai:welcome
      const short = cs.replace('action.ai_message:', 'ai:').replace('guardian.extract', 'extract-llm').replace('post-session.summarise', 'summarise');
      return short;
    }
  }
  return t.phase;
}

type RagHitPayload = {
  id: string;
  score: number;
  sourceId: string;
  sourceTitle: string | null;
  sourceUri: string;
  preview: string;
};

type RagTracePayload = {
  query?: string | null;
  namespaces?: string[];
  hitCount?: number;
  hits?: RagHitPayload[];
  skipReason?: string;
};

function RagHitsCard({ traces }: { traces: TurnTraceDto[] }) {
  const last = [...traces].reverse().find((t) => t.phase === 'rag');
  const p = (last?.payload ?? {}) as RagTracePayload;
  const hits = p.hits ?? [];
  return (
    <>
      <div style={styles.panelHeader}>
        <span>
          RAG hits ({p.hitCount ?? 0})
          {last ? <> · {last.durationMs}ms</> : null}
        </span>
        <span style={styles.debugTag}>debug</span>
      </div>
      <div style={styles.ragMeta}>
        <div>
          <span style={styles.kvKey}>query:</span>{' '}
          <span style={styles.kvVal}>{p.query ?? '—'}</span>
        </div>
        <div>
          <span style={styles.kvKey}>namespaces:</span>{' '}
          <span style={styles.kvVal}>{(p.namespaces ?? []).join(', ') || '—'}</span>
        </div>
        {p.skipReason && (
          <div>
            <span style={styles.kvKey}>skipped:</span>{' '}
            <span style={{ ...styles.kvVal, color: '#8a5a00' }}>{p.skipReason}</span>
          </div>
        )}
      </div>
      <div style={styles.ragList}>
        {!last && <div style={styles.empty}>no retrieval this turn</div>}
        {last && !p.skipReason && hits.length === 0 && (
          <div style={styles.empty}>no matches above threshold</div>
        )}
        {hits.map((h) => (
          <RagHitRow key={h.id} hit={h} />
        ))}
      </div>
    </>
  );
}

function RagHitRow({ hit }: { hit: RagHitPayload }) {
  const [open, setOpen] = useState(false);
  const label = hit.sourceTitle || hit.sourceUri || hit.sourceId;
  return (
    <div style={styles.ragRow} onClick={() => setOpen((v) => !v)}>
      <div style={styles.ragRowHeader}>
        <span style={styles.ragScore}>{hit.score.toFixed(3)}</span>
        <span style={styles.ragSource}>{label}</span>
      </div>
      <div style={open ? styles.ragPreviewFull : styles.ragPreview}>{hit.preview}</div>
    </div>
  );
}

type DirectorCandidate = {
  id: string;
  matched: boolean;
  skipped: boolean;
  condition: { type: string; [k: string]: unknown };
};

type DirectorTracePayload = {
  blockId?: string;
  winnerId?: string | null;
  candidates?: DirectorCandidate[];
};

function summariseCondition(c: DirectorCandidate['condition'], depth = 0): string {
  if (!c) return '?';
  if (depth > 3) return '…';
  const children = (c.conditions as DirectorCandidate['condition'][] | undefined) ?? [];
  switch (c.type) {
    case 'intent_detected':
      return `intent = ${String(c.value)}`;
    case 'key_fact_present':
      return `has(${String(c.fact)})`;
    case 'key_fact_absent':
      return `!has(${String(c.fact)})`;
    case 'message_count_gte':
      return `msgs >= ${String(c.value)}`;
    case 'form_field_collected':
      return `form.${String(c.field)}`;
    case 'last_user_message_matches':
      return `match /${String(c.pattern)}/`;
    case 'all_of':
      return children.length
        ? children.map((x) => summariseCondition(x, depth + 1)).join(' AND ')
        : 'all_of()';
    case 'any_of':
      return children.length
        ? children.map((x) => summariseCondition(x, depth + 1)).join(' OR ')
        : 'any_of()';
    case 'not': {
      const inner = c.condition as DirectorCandidate['condition'] | undefined;
      return `NOT ${inner ? summariseCondition(inner, depth + 1) : '…'}`;
    }
    default:
      return c.type;
  }
}

function DirectorTraceCard({ traces }: { traces: TurnTraceDto[] }) {
  const last = [...traces].reverse().find((t) => t.phase === 'director');
  const payload = (last?.payload ?? {}) as DirectorTracePayload;
  const candidates = payload.candidates ?? [];
  return (
    <>
      <div style={styles.panelHeader}>
        <span>
          Director trace
          {payload.blockId ? <> · {payload.blockId}</> : null}
          {last ? <> · {new Date(last.startedAt).toLocaleTimeString()}</> : null}
        </span>
        <span style={styles.debugTag}>debug</span>
      </div>
      <div style={styles.directorList}>
        {!last && <div style={styles.empty}>no director ran this turn</div>}
        {last && candidates.length === 0 && (
          <div style={styles.empty}>block has no directors</div>
        )}
        {candidates.map((c) => {
          const isWinner = c.id === payload.winnerId;
          return (
            <div
              key={c.id}
              style={{
                ...styles.directorRow,
                ...(isWinner ? styles.directorRowWinner : {}),
                ...(c.skipped ? styles.directorRowSkipped : {}),
              }}
            >
              <div style={styles.directorRowHeader}>
                <span style={styles.directorId}>{c.id}</span>
                <span
                  style={
                    isWinner
                      ? styles.directorBadgeWin
                      : c.skipped
                      ? styles.directorBadgeSkip
                      : c.matched
                      ? styles.directorBadgeMatch
                      : styles.directorBadgeMiss
                  }
                >
                  {isWinner ? 'WIN' : c.skipped ? 'skipped' : c.matched ? '✓' : '✗'}
                </span>
              </div>
              <div style={styles.directorCondition}>{summariseCondition(c.condition)}</div>
              {last && (
                <div style={styles.directorTime}>
                  {new Date(last.startedAt).toLocaleTimeString()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

type LlmTracePayload = {
  callSite?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number | null;
  finishReason?: string | null;
  systemPrompt?: string;
  error?: string;
};

function LlmCallsCard({
  traces,
  promptVisible,
}: {
  traces: TurnTraceDto[];
  promptVisible: boolean;
}) {
  const llmTraces = traces
    .filter((t) => t.phase === 'llm')
    .slice(-10)
    .reverse();
  const totalCost = llmTraces.reduce((acc, t) => {
    const c = (t.payload as LlmTracePayload).costUsd;
    return acc + (typeof c === 'number' ? c : 0);
  }, 0);
  return (
    <>
      <div style={styles.panelHeader}>
        <span>
          LLM calls ({llmTraces.length})
          {totalCost > 0 && <> · ${totalCost.toFixed(5)}</>}
        </span>
        <span style={styles.debugTag}>debug</span>
      </div>
      <div style={styles.llmList}>
        {llmTraces.length === 0 && <div style={styles.empty}>no calls yet</div>}
        {llmTraces.map((t) => (
          <LlmCallRow key={t.id} trace={t} promptVisible={promptVisible} />
        ))}
      </div>
    </>
  );
}

function LlmCallRow({
  trace,
  promptVisible,
}: {
  trace: TurnTraceDto;
  promptVisible: boolean;
}) {
  const [open, setOpen] = useState(false);
  const p = trace.payload as LlmTracePayload;
  const cost = typeof p.costUsd === 'number' ? `$${p.costUsd.toFixed(5)}` : '—';
  return (
    <div style={styles.llmRow} onClick={() => setOpen((v) => !v)}>
      <div style={styles.llmRowHeader}>
        <span style={styles.llmCallSite}>{p.callSite ?? trace.phase}</span>
        <span style={styles.llmTime}>
          {new Date(trace.startedAt).toLocaleTimeString()} · {trace.durationMs}ms
        </span>
      </div>
      <div style={styles.llmMeta}>
        <span style={styles.llmModel}>{p.model ?? '—'}</span>
        <span>
          {p.promptTokens ?? 0}p / {p.completionTokens ?? 0}c
        </span>
        <span>{cost}</span>
        <span style={{ color: p.error ? '#b00020' : '#666' }}>
          {p.error ? 'error' : (p.finishReason ?? '')}
        </span>
      </div>
      {open && (
        <div style={styles.llmDetail}>
          {p.error && <div style={styles.panelErr}>{p.error}</div>}
          {promptVisible && p.systemPrompt && (
            <>
              <div style={styles.llmDetailRow}>
                <span style={styles.llmDetailLabel}>
                  system prompt · {p.systemPrompt.length.toLocaleString()} chars
                </span>
                <button
                  type="button"
                  style={styles.copyBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    void navigator.clipboard.writeText(p.systemPrompt ?? '');
                  }}
                >
                  copy
                </button>
              </div>
              <pre style={styles.llmPre}>{p.systemPrompt}</pre>
            </>
          )}
          {promptVisible && !p.systemPrompt && (
            <div style={styles.llmHint}>(no system prompt for this call)</div>
          )}
          {!promptVisible && (
            <div style={styles.llmHint}>
              enable DEBUG_PROMPT_CAPTURE to see assembled prompts
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventsPanel({ events }: { events: WebhookEventDto[] }) {
  return (
    <aside style={styles.sidePanel}>
      <div style={styles.panelHeader}>Events ({events.length})</div>
      <div style={styles.eventList}>
        {events.length === 0 && <div style={styles.empty}>none</div>}
        {events.map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
      </div>
    </aside>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={styles.modalBackdrop} onClick={onClose}>
      <div style={styles.modalDialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span>{title}</span>
          <button type="button" style={styles.deleteBtn} onClick={onClose} title="Close">
            ×
          </button>
        </div>
        <div style={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

const EVENT_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  message_received: { bg: '#e3f0ff', fg: '#0a4d8c', border: '#0a84ff' },
  message_sent:     { bg: '#e2f6e7', fg: '#1d6b34', border: '#2ea44f' },
  director_fired:   { bg: '#f1e8ff', fg: '#5b2bb3', border: '#8a4cff' },
  action_executed:  { bg: '#fff1d6', fg: '#8a5a00', border: '#e09a1a' },
  form_submitted:   { bg: '#d8f3f4', fg: '#0f6e72', border: '#17a2a8' },
  guardian_blocked: { bg: '#fde2e2', fg: '#9a1a1a', border: '#d83b3b' },
  session_ended:    { bg: '#ececec', fg: '#444',    border: '#888' },
};
const FALLBACK_EVENT_COLOR = { bg: '#f3f3f3', fg: '#555', border: '#bbb' };

function eventColor(type: string) {
  return EVENT_COLORS[type] ?? FALLBACK_EVENT_COLOR;
}

function EventRow({ event }: { event: WebhookEventDto }) {
  const [open, setOpen] = useState(false);
  const compact = JSON.stringify(event.payload);
  const c = eventColor(event.type);
  return (
    <div
      style={{ ...styles.eventRow, borderLeft: `3px solid ${c.border}` }}
      onClick={() => setOpen((v) => !v)}
      title={open ? 'click to collapse' : 'click to expand'}
    >
      <div style={styles.eventRowHeader}>
        <span style={{ ...styles.eventType, background: c.bg, color: c.fg }}>{event.type}</span>
        <span style={styles.eventTime}>{new Date(event.createdAt).toLocaleTimeString()}</span>
      </div>
      {open ? (
        <pre style={styles.eventPre}>{JSON.stringify(event.payload, null, 2)}</pre>
      ) : (
        <span style={styles.eventPayload}>{compact.slice(0, 80)}{compact.length > 80 ? '…' : ''}</span>
      )}
    </div>
  );
}

function statusStyle(status: string): React.CSSProperties {
  if (status === 'ready') return { color: '#0a7d2c', fontWeight: 600 };
  if (status === 'failed') return { color: '#b00020', fontWeight: 600 };
  return { color: '#9a6c00', fontWeight: 600 };
}

const styles: Record<string, React.CSSProperties> = {
  shell: { width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui' },
  header: { padding: '10px 14px', borderBottom: '1px solid #e5e5e5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  toggleBtn: { padding: '4px 8px', fontSize: 12, border: '1px solid #ccc', background: 'white', borderRadius: 6, cursor: 'pointer' },
  session: { fontSize: 12, color: '#888', fontFamily: 'monospace' },
  body: { flex: 1, display: 'flex', minHeight: 0 },
  chatCol: { flex: '0 0 460px', display: 'flex', flexDirection: 'column', borderLeft: '1px solid #e5e5e5', borderRight: '1px solid #e5e5e5', minWidth: 0 },
  messages: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 },
  empty: { color: '#aaa', textAlign: 'center', marginTop: 20, fontSize: 12 },
  bubble: { padding: '8px 12px', borderRadius: 12, maxWidth: '80%', whiteSpace: 'pre-wrap', lineHeight: 1.4 },
  user: { background: '#0a84ff', color: 'white', alignSelf: 'flex-end' },
  assistant: { background: '#eee', color: '#111', alignSelf: 'flex-start' },
  form: { display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #e5e5e5' },
  input: { flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 },
  btn: { padding: '8px 16px', border: 'none', background: '#0a84ff', color: 'white', borderRadius: 8, fontWeight: 600, cursor: 'pointer' },
  formBubble: { display: 'flex', flexDirection: 'column', gap: 6, width: '70%', maxWidth: '70%' },
  formTitle: { fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
  formField: { display: 'flex', flexDirection: 'column', gap: 2 },
  formLabel: { fontSize: 12, color: '#444' },
  formInput: { padding: '6px 8px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14 },
  buttonsBubble: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  choiceBtn: { padding: '6px 12px', border: '1px solid #0a84ff', background: 'white', color: '#0a84ff', borderRadius: 16, cursor: 'pointer', fontSize: 13 },
  choiceBtnActive: { background: '#0a84ff', color: 'white' },
  toolBubble: { alignSelf: 'flex-start', maxWidth: '80%', border: '1px dashed #c9b58c', background: '#fffaf0', borderRadius: 10, padding: '6px 10px', fontSize: 12, color: '#5b4a1f', display: 'flex', flexDirection: 'column', gap: 4 },
  toolHeader: { fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', fontSize: 11, color: '#8a6d1f' },
  toolBlock: { display: 'flex', flexDirection: 'column', gap: 2 },
  toolLabel: { fontSize: 10, color: '#8a6d1f', textTransform: 'uppercase' },
  toolPre: { margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  errorBubble: { alignSelf: 'flex-start', background: '#fde8e8', color: '#7a1a1a', border: '1px solid #f5b5b5', padding: '8px 10px', borderRadius: 10, fontSize: 13, maxWidth: '80%' },
  errorTag: { fontWeight: 700, marginRight: 6, textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.3 },
  sidePanel: { width: 340, flexShrink: 0, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: '#fafafa', fontSize: 12 },
  inspectorAside: { flex: 1, width: 'auto', minWidth: 380 },
  panelHeader: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666', fontWeight: 600, marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  linkBtn: { background: 'none', border: 'none', color: '#0a84ff', cursor: 'pointer', fontSize: 11, padding: 0 },
  panelForm: { display: 'flex', flexDirection: 'column', gap: 4, padding: 8, background: 'white', border: '1px solid #e5e5e5', borderRadius: 6 },
  panelErr: { color: '#b00020', fontSize: 11, padding: 6, background: '#fde8e8', borderRadius: 4 },
  home: { flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: 24 },
  homeCard: { width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 },
  homeTitle: { margin: 0, fontSize: 22 },
  homeList: { display: 'flex', flexDirection: 'column', gap: 6 },
  homeRow: { textAlign: 'left', padding: '10px 12px', background: 'white', border: '1px solid #e5e5e5', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 },
  homeRowMain: { flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  homeRowTitle: { fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  homeRowMeta: { fontSize: 11, color: '#888' },
  sessionRow: { textAlign: 'left', padding: 6, background: 'white', border: '1px solid #e5e5e5', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 },
  sessionRowMain: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  sessionRowActive: { borderColor: '#0a84ff', background: '#eef6ff' },
  deleteBtn: { flexShrink: 0, width: 24, height: 24, lineHeight: '1', fontSize: 16, border: '1px solid #e5b5b5', background: 'white', color: '#b00020', borderRadius: 6, cursor: 'pointer', padding: 0 },
  panelStack: { display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 },
  modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalDialog: { background: 'white', borderRadius: 10, width: 'min(560px, 92vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' },
  modalHeader: { padding: '12px 16px', borderBottom: '1px solid #e5e5e5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600 },
  modalBody: { padding: 12, overflowY: 'auto' },
  sourceList: { display: 'flex', flexDirection: 'column', gap: 4 },
  sourceRow: { padding: 6, background: 'white', border: '1px solid #e5e5e5', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 2 },
  sourceRowHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  sourceTitle: { fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sourceDeleteBtn: { flexShrink: 0, width: 20, height: 20, lineHeight: '1', fontSize: 14, border: '1px solid #e5b5b5', background: 'white', color: '#b00020', borderRadius: 999, cursor: 'pointer', padding: 0 },
  sourceMeta: { fontSize: 10, color: '#666' },
  sourceErr: { fontSize: 10, color: '#b00020' },
  statePre: { margin: 0, padding: 6, background: 'white', border: '1px solid #e5e5e5', borderRadius: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 200, minHeight: 200, overflowY: 'auto' },
  lastTurn: { display: 'flex', flexDirection: 'column', gap: 2, padding: 6, background: 'white', border: '1px solid #e5e5e5', borderRadius: 4 },
  kvKey: { color: '#666', fontSize: 11 },
  kvVal: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 },
  debugTag: { fontSize: 9, padding: '1px 6px', background: '#fff3cd', color: '#8a6d1f', border: '1px solid #e0c870', borderRadius: 8, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 },
  llmList: { display: 'flex', flexDirection: 'column', gap: 4 },
  llmRow: { padding: 6, background: 'white', border: '1px solid #e5e5e5', borderRadius: 4, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3, borderLeft: '3px solid #0a84ff' },
  llmRowHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 },
  llmCallSite: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: '#0a4d8c', fontWeight: 600, overflowWrap: 'anywhere' },
  llmTime: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, color: '#666' },
  llmMeta: { display: 'flex', flexWrap: 'wrap', gap: 8, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, color: '#444' },
  llmModel: { color: '#5b2bb3' },
  llmDetail: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 },
  llmDetailLabel: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666', fontWeight: 600 },
  llmDetailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  copyBtn: { padding: '2px 8px', fontSize: 10, border: '1px solid #ccc', background: 'white', borderRadius: 4, cursor: 'pointer' },
  llmPre: { margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#f5f5f5', padding: 6, borderRadius: 3, maxHeight: 240, overflowY: 'auto' },
  llmHint: { fontSize: 10, color: '#999', fontStyle: 'italic' },
  directorList: { display: 'flex', flexDirection: 'column', gap: 4 },
  directorRow: { padding: 6, background: 'white', border: '1px solid #e5e5e5', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 3, borderLeft: '3px solid #ccc' },
  directorRowWinner: { borderLeftColor: '#2ea44f', background: '#f1faf3' },
  directorRowSkipped: { opacity: 0.55 },
  directorRowHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 },
  directorId: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: '#222', fontWeight: 600 },
  directorCondition: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, color: '#666' },
  directorTime: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 9, color: '#999' },
  directorBadgeWin: { fontSize: 9, padding: '1px 6px', background: '#2ea44f', color: 'white', borderRadius: 8, fontWeight: 600, letterSpacing: 0.4 },
  directorBadgeMatch: { fontSize: 10, padding: '0 4px', color: '#2ea44f', fontWeight: 700 },
  directorBadgeMiss: { fontSize: 10, padding: '0 4px', color: '#b00020', fontWeight: 700 },
  directorBadgeSkip: { fontSize: 9, padding: '1px 6px', background: '#eee', color: '#666', borderRadius: 8, fontWeight: 600, letterSpacing: 0.4 },
  ragMeta: { display: 'flex', flexDirection: 'column', gap: 2, padding: 6, background: 'white', border: '1px solid #e5e5e5', borderRadius: 4 },
  ragList: { display: 'flex', flexDirection: 'column', gap: 4 },
  ragRow: { padding: 6, background: 'white', border: '1px solid #e5e5e5', borderRadius: 4, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3, borderLeft: '3px solid #17a2a8' },
  ragRowHeader: { display: 'flex', gap: 6, alignItems: 'baseline' },
  ragScore: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, color: '#0f6e72', fontWeight: 700, minWidth: 40 },
  ragSource: { fontSize: 11, color: '#222', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  ragPreview: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, color: '#444', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
  ragPreviewFull: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, color: '#222', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#f5f5f5', padding: 6, borderRadius: 3, maxHeight: 240, overflowY: 'auto' },
  timelineBox: { background: 'white', border: '1px solid #e5e5e5', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 4 },
  timelineInner: { position: 'relative' },
  timelineTick: { position: 'absolute', top: 0, bottom: 0, width: 1, background: '#eee' },
  timelineBar: { position: 'absolute', height: 18, borderRadius: 4, display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: 2, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' },
  timelineBarLabel: { color: 'white', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 },
  timelineBarMs: { opacity: 0.8, fontWeight: 400, marginLeft: 4 },
  timelineAxis: { display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#999', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', paddingTop: 2, borderTop: '1px solid #f0f0f0' },
  timelineLegend: { display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 10, color: '#666', padding: '4px 2px' },
  timelineLegendItem: { display: 'flex', alignItems: 'center', gap: 4 },
  timelineLegendDot: { width: 8, height: 8, borderRadius: 2, display: 'inline-block' },
  factGrid: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 },
  factRow: { display: 'flex', gap: 6, fontSize: 11 },
  factKey: { color: '#5b2bb3', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', minWidth: 80 },
  factVal: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#222', overflowWrap: 'anywhere' },
  memoryList: { display: 'flex', flexDirection: 'column', gap: 4 },
  memoryRow: { padding: 6, background: 'white', border: '1px solid #e5e5e5', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 3, borderLeft: '3px solid #9a6c00' },
  memorySummary: { borderLeftColor: '#5b2bb3', background: '#faf7ff' },
  memoryTag: { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666', fontWeight: 600 },
  memoryContent: { fontSize: 11, color: '#222', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  memoryTime: { fontSize: 9, color: '#999', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  eventList: { display: 'flex', flexDirection: 'column', gap: 2 },
  eventRow: { padding: 6, background: 'white', border: '1px solid #e5e5e5', borderRadius: 4, fontSize: 10, display: 'flex', flexDirection: 'column', gap: 3, cursor: 'pointer' },
  eventRowHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 },
  eventType: { fontWeight: 600, padding: '1px 6px', borderRadius: 10, fontSize: 10, letterSpacing: 0.2 },
  eventTime: { color: '#999', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 9 },
  eventPayload: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  eventPre: { margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, color: '#222', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#f5f5f5', padding: 6, borderRadius: 3, maxHeight: 240, overflowY: 'auto' },
};
