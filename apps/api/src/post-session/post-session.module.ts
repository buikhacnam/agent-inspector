import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { LlmModule } from '../llm/llm.module';
import { EventsModule } from '../events/events.module';
import { PostSessionService } from './post-session.service';
import { PostSessionProcessor } from './post-session.processor';
import { POST_SESSION_QUEUE } from './post-session.tokens';

@Module({
  imports: [
    PrismaModule,
    LlmModule,
    EventsModule,
    BullModule.registerQueue({ name: POST_SESSION_QUEUE }),
  ],
  providers: [PostSessionService, PostSessionProcessor],
  exports: [PostSessionService],
})
export class PostSessionModule {}
