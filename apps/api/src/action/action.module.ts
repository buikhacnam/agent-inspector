import { Module } from '@nestjs/common';
import { ActionService } from './action.service';
import { LlmModule } from '../llm/llm.module';
import { SessionModule } from '../session/session.module';
import { DirectorModule } from '../director/director.module';
import { RagModule } from '../rag/rag.module';
import { ToolsModule } from '../tools/tools.module';
import { EventsModule } from '../events/events.module';
import { PostSessionModule } from '../post-session/post-session.module';
import { InspectorModule } from '../inspector/inspector.module';

@Module({
  imports: [
    LlmModule,
    SessionModule,
    DirectorModule,
    RagModule,
    ToolsModule,
    EventsModule,
    PostSessionModule,
    InspectorModule,
  ],
  providers: [ActionService],
  exports: [ActionService],
})
export class ActionModule {}
