import type { Action } from './workflow';

export type SseEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'action'; action: Action }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };
