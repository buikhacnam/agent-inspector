import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type WebhookEventType =
  | 'message_received'
  | 'message_sent'
  | 'director_fired'
  | 'action_executed'
  | 'form_submitted'
  | 'guardian_blocked'
  | 'session_ended';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget event log. Never awaited by the critical path; failures are logged.
   * Returns void so callers can't accidentally make their flow dependent on this.
   */
  emit(type: WebhookEventType, payload: Prisma.InputJsonValue, sessionId?: string | null): void {
    this.prisma.webhookEvent
      .create({
        data: {
          type,
          payload,
          sessionId: sessionId ?? null,
        },
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`emit(${type}) failed: ${message}`);
      });
  }

  list(filter: { sessionId?: string; type?: string; limit?: number }) {
    const where: Prisma.WebhookEventWhereInput = {};
    if (filter.sessionId) where.sessionId = filter.sessionId;
    if (filter.type) where.type = filter.type;
    return this.prisma.webhookEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.limit ?? 100, 500),
    });
  }
}
