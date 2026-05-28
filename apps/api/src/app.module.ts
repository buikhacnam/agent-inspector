import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { LlmModule } from './llm/llm.module';
import { WorkflowModule } from './workflow/workflow.module';
import { DirectorModule } from './director/director.module';
import { ActionModule } from './action/action.module';
import { SessionModule } from './session/session.module';
import { GuardianModule } from './guardian/guardian.module';
import { ExperienceModule } from './experience/experience.module';
import { RagModule } from './rag/rag.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { EventsModule } from './events/events.module';
import { PostSessionModule } from './post-session/post-session.module';
import { InspectorModule } from './inspector/inspector.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379');
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
            username: url.username || undefined,
          },
        };
      },
    }),
    PrismaModule,
    LlmModule,
    WorkflowModule,
    SessionModule,
    DirectorModule,
    ActionModule,
    GuardianModule,
    ExperienceModule,
    RagModule,
    KnowledgeModule,
    EventsModule,
    PostSessionModule,
    InspectorModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
