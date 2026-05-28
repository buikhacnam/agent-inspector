import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { EventsService } from '../events/events.service';
import { POST_SESSION_QUEUE, type PostSessionJobData } from './post-session.tokens';

@Processor(POST_SESSION_QUEUE)
export class PostSessionProcessor extends WorkerHost {
  private readonly logger = new Logger(PostSessionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly events: EventsService,
  ) {
    super();
  }

  async process(job: Job<PostSessionJobData>): Promise<{ memories: number }> {
    const { sessionId, reason } = job.data;
    this.logger.log(`post-session start: session=${sessionId} reason=${reason}`);

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session) {
      this.logger.warn(`post-session skipped: session ${sessionId} not found`);
      return { memories: 0 };
    }

    // Idempotency: a memory marked `summary` means we've already processed.
    const existing = await this.prisma.memory.findFirst({
      where: { sessionId, content: { startsWith: '[summary] ' } },
    });
    if (existing) {
      this.logger.log(`post-session skipped: session=${sessionId} already summarised`);
      return { memories: 0 };
    }

    const summary = await this.llm.summariseSession(session.messages, {
      sessionId,
      callSite: 'post-session.summarise',
    });

    // Persist as Memory rows. The summary is stored as a `[summary] …` row so it's
    // queryable alongside the extracted facts without needing a schema change.
    const rows: Prisma.MemoryCreateManyInput[] = [
      { sessionId, content: `[summary] ${summary.summary}` },
      ...summary.memories.map((content) => ({ sessionId, content })),
    ];
    await this.prisma.memory.createMany({ data: rows });

    // Mirror the summary onto session.state for cheap reads in future turns.
    const state = (session.state ?? {}) as Record<string, unknown>;
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { state: { ...state, summary: summary.summary } as Prisma.InputJsonValue },
    });

    this.events.emit(
      'session_ended',
      { reason, memoriesCount: summary.memories.length, summary: summary.summary },
      sessionId,
    );

    this.logger.log(
      `post-session done: session=${sessionId} memories=${summary.memories.length}`,
    );
    return { memories: summary.memories.length };
  }
}
