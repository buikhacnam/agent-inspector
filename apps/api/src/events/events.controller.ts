import { Controller, Get, Query } from '@nestjs/common';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(
    @Query('sessionId') sessionId?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? Number(limit) : undefined;
    return this.events.list({
      sessionId,
      type,
      limit: Number.isFinite(n) ? n : undefined,
    });
  }
}
