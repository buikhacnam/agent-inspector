import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RagModule } from '../rag/rag.module';
import { FirecrawlService } from './firecrawl.service';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { IngestProcessor } from './ingest.processor';
import { INGEST_QUEUE } from './knowledge.tokens';

@Module({
  imports: [PrismaModule, RagModule, BullModule.registerQueue({ name: INGEST_QUEUE })],
  providers: [KnowledgeService, FirecrawlService, IngestProcessor],
  controllers: [KnowledgeController],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
