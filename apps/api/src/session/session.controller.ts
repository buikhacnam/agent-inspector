import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { SseEvent } from '@agent-x/shared';
import { SessionService } from './session.service';
import { ExperienceService } from '../experience/experience.service';
import { PostSessionService } from '../post-session/post-session.service';

interface MessageBody {
  text?: string;
  formValues?: Record<string, string>;
  buttonId?: string;
}

@Controller('sessions')
export class SessionController {
  constructor(
    private readonly sessions: SessionService,
    private readonly experience: ExperienceService,
    private readonly postSession: PostSessionService,
  ) {}

  @Post()
  async create() {
    const session = await this.sessions.create();
    await this.experience.runFirstAction(session.id);
    return this.sessions.get(session.id);
  }

  @Get()
  list() {
    return this.sessions.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.sessions.get(id);
  }

  @Get(':id/memories')
  memories(@Param('id') id: string) {
    return this.sessions.memories(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.sessions.delete(id);
  }

  @Post(':id/end')
  async end(@Param('id') id: string) {
    const updated = await this.sessions.end(id);
    await this.postSession.enqueue(id, 'manual');
    return updated;
  }

  @Post(':id/messages')
  async sendMessage(@Param('id') id: string, @Body() body: MessageBody, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const write = (event: SseEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      if (typeof body.text === 'string') {
        await this.experience.handleText(id, body.text, write);
      } else if (body.formValues && typeof body.formValues === 'object') {
        await this.experience.handleForm(id, body.formValues, write);
      } else if (typeof body.buttonId === 'string') {
        await this.experience.handleButton(id, body.buttonId, write);
      } else {
        throw new BadRequestException('expected one of: text, formValues, buttonId');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      write({ type: 'error', message });
    } finally {
      res.end();
    }
  }
}
