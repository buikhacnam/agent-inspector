import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { POST_SESSION_QUEUE, type PostSessionJobData } from './post-session.tokens';

@Injectable()
export class PostSessionService {
  private readonly logger = new Logger(PostSessionService.name);

  constructor(
    @InjectQueue(POST_SESSION_QUEUE) private readonly queue: Queue<PostSessionJobData>,
  ) {}

  async enqueue(sessionId: string, reason: PostSessionJobData['reason'] = 'end_chat') {
    await this.queue.add(
      'process',
      { sessionId, reason },
      // de-dupe by sessionId so back-to-back end_chats don't re-summarise
      // de-dupe by sessionId so back-to-back end_chats don't re-summarise.
      // BullMQ disallows `:` in custom job ids — use `-`.
      { jobId: `post-session-${sessionId}` },
    );
    this.logger.log(`enqueued post-session: session=${sessionId} reason=${reason}`);
  }
}
