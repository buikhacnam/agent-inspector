import { Module } from '@nestjs/common';
import { ExperienceService } from './experience.service';
import { SessionController } from '../session/session.controller';
import { SessionModule } from '../session/session.module';
import { ActionModule } from '../action/action.module';
import { DirectorModule } from '../director/director.module';
import { GuardianModule } from '../guardian/guardian.module';
import { EventsModule } from '../events/events.module';
import { PostSessionModule } from '../post-session/post-session.module';
import { InspectorModule } from '../inspector/inspector.module';

@Module({
  imports: [
    SessionModule,
    ActionModule,
    DirectorModule,
    GuardianModule,
    EventsModule,
    PostSessionModule,
    InspectorModule,
  ],
  controllers: [SessionController],
  providers: [ExperienceService],
  exports: [ExperienceService],
})
export class ExperienceModule {}
