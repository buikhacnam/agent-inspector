export const POST_SESSION_QUEUE = 'post-session';

export interface PostSessionJobData {
  sessionId: string;
  /** Why the job was enqueued: explicit end_chat action or admin/manual trigger. */
  reason: 'end_chat' | 'manual';
}
