import { Module } from '@nestjs/common';
import { InspectorModule } from '../inspector/inspector.module';
import { LlmService } from './llm.service';

@Module({
  imports: [InspectorModule],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
