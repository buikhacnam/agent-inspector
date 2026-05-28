import { Controller, Get, Param, Query } from '@nestjs/common';
import { InspectorFlags } from './inspector.flags';
import { InspectorService } from './inspector.service';

@Controller()
export class InspectorController {
  constructor(
    private readonly flags: InspectorFlags,
    private readonly inspector: InspectorService,
  ) {}

  @Get('debug/flags')
  getFlags() {
    return this.flags.get();
  }

  @Get('sessions/:id/traces')
  listForSession(
    @Param('id') sessionId: string,
    @Query('messageId') messageId?: string,
    @Query('limit') limit?: string,
  ) {
    if (messageId) return this.inspector.listForMessage(messageId);
    const n = limit ? Number(limit) : undefined;
    return this.inspector.listForSession(sessionId, Number.isFinite(n) ? n : undefined);
  }
}
