import type { SseEvent } from '@agent-x/shared';

export interface MessageDto {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  meta?: Record<string, unknown> | null;
}

export interface SessionDto {
  id: string;
  activeBlockId: string;
  workflowVersion: number;
  endedAt: string | null;
  state: Record<string, unknown>;
  messages: MessageDto[];
}

export interface MemoryDto {
  id: string;
  sessionId: string;
  content: string;
  createdAt: string;
}

export interface SessionSummaryDto {
  id: string;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  messageCount: number;
  preview: string | null;
}

export interface KnowledgeSourceDto {
  id: string;
  type: string;
  uri: string;
  title: string | null;
  namespace: string;
  status: string;
  error: string | null;
  createdAt: string;
  _count?: { chunks: number };
}

export interface WebhookEventDto {
  id: string;
  sessionId: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface DebugFlags {
  inspector: boolean;
  director: boolean;
  rag: boolean;
  llm: boolean;
  prompt: boolean;
  timing: boolean;
  pipeline: boolean;
  tool: boolean;
}

export interface TurnTraceDto {
  id: string;
  sessionId: string;
  messageId: string | null;
  phase: string;
  startedAt: string;
  durationMs: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export async function listTraces(
  sessionId: string,
  opts: { messageId?: string; limit?: number } = {},
): Promise<TurnTraceDto[]> {
  const qs = new URLSearchParams();
  if (opts.messageId) qs.set('messageId', opts.messageId);
  if (opts.limit) qs.set('limit', String(opts.limit));
  const url = `/api/sessions/${sessionId}/traces${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('failed to load traces');
  return res.json();
}

export async function getDebugFlags(): Promise<DebugFlags> {
  try {
    const res = await fetch('/api/debug/flags');
    if (!res.ok) throw new Error('flags fetch failed');
    return res.json();
  } catch {
    return { inspector: false, director: false, rag: false, llm: false, prompt: false, timing: false, pipeline: false, tool: false };
  }
}

export async function createSession(): Promise<SessionDto> {
  const res = await fetch('/api/sessions', { method: 'POST' });
  if (!res.ok) throw new Error('failed to create session');
  return res.json();
}

export async function listSessions(): Promise<SessionSummaryDto[]> {
  const res = await fetch('/api/sessions');
  if (!res.ok) throw new Error('failed to load sessions');
  return res.json();
}

export async function getSession(id: string): Promise<SessionDto> {
  const res = await fetch(`/api/sessions/${id}`);
  if (!res.ok) throw new Error('failed to load session');
  return res.json();
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('failed to delete session');
}

export async function listMemories(sessionId: string): Promise<MemoryDto[]> {
  const res = await fetch(`/api/sessions/${sessionId}/memories`);
  if (!res.ok) throw new Error('failed to load memories');
  return res.json();
}

export async function listSources(): Promise<KnowledgeSourceDto[]> {
  const res = await fetch('/api/knowledge/sources');
  if (!res.ok) throw new Error('failed to load sources');
  return res.json();
}

export async function deleteSource(id: string): Promise<void> {
  const res = await fetch(`/api/knowledge/sources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('delete failed');
}

export async function pasteKnowledge(text: string, title?: string, namespace?: string) {
  const res = await fetch('/api/knowledge/paste', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, title, namespace }),
  });
  if (!res.ok) throw new Error('paste failed');
  return res.json();
}

export async function addUrlKnowledge(
  url: string,
  opts: { crawl?: boolean; namespace?: string } = {},
) {
  const res = await fetch('/api/knowledge/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, ...opts }),
  });
  if (!res.ok) throw new Error('url enqueue failed');
  return res.json();
}

export async function listEvents(sessionId: string, limit = 50): Promise<WebhookEventDto[]> {
  const res = await fetch(`/api/events?sessionId=${sessionId}&limit=${limit}`);
  if (!res.ok) throw new Error('failed to load events');
  return res.json();
}

export function streamText(sessionId: string, text: string) {
  return openStream(sessionId, { text });
}

export function streamForm(sessionId: string, values: Record<string, string>) {
  return openStream(sessionId, { formValues: values });
}

export function streamButton(sessionId: string, buttonId: string) {
  return openStream(sessionId, { buttonId });
}

async function* openStream(sessionId: string, body: unknown): AsyncGenerator<SseEvent> {
  const res = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error('stream failed');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        yield JSON.parse(payload) as SseEvent;
      } catch {
        // ignore malformed
      }
    }
  }
}
