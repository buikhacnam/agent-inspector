import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  create() {
    return this.prisma.session.create({
      data: {
        activeBlockId: 'welcome',
        workflowVersion: 1,
        state: {},
      },
    });
  }

  async list(limit = 50) {
    const sessions = await this.prisma.session.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        endedAt: true,
        _count: { select: { messages: true } },
        messages: {
          where: { role: 'user' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { content: true },
        },
      },
    });
    return sessions.map(({ messages, _count, ...s }) => ({
      ...s,
      messageCount: _count.messages,
      preview: messages[0]?.content ?? null,
    }));
  }

  async get(id: string) {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!session) throw new NotFoundException(`session ${id} not found`);
    return session;
  }

  memories(id: string) {
    return this.prisma.memory.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  history(id: string) {
    return this.prisma.message.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  appendMessage(sessionId: string, role: 'user' | 'assistant' | 'system' | 'tool', content: string, meta?: Prisma.InputJsonValue) {
    return this.prisma.message.create({
      data: { sessionId, role, content, ...(meta !== undefined ? { meta } : {}) },
    });
  }

  setActiveBlock(id: string, blockId: string) {
    return this.prisma.session.update({
      where: { id },
      data: { activeBlockId: blockId },
    });
  }

  updateState(id: string, state: Prisma.InputJsonValue) {
    return this.prisma.session.update({
      where: { id },
      data: { state },
    });
  }

  end(id: string) {
    return this.prisma.session.update({
      where: { id },
      data: { endedAt: new Date() },
    });
  }

  async delete(id: string) {
    const session = await this.prisma.session.findUnique({ where: { id }, select: { id: true } });
    if (!session) throw new NotFoundException(`session ${id} not found`);
    // Messages + memories cascade via FK; WebhookEvent has no relation so delete explicitly.
    await this.prisma.$transaction([
      this.prisma.webhookEvent.deleteMany({ where: { sessionId: id } }),
      this.prisma.session.delete({ where: { id } }),
    ]);
  }
}
