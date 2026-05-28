import { Module } from '@nestjs/common';
import { InspectorModule } from '../inspector/inspector.module';
import { GuardianService } from './guardian.service';

@Module({
  imports: [InspectorModule],
  providers: [GuardianService],
  exports: [GuardianService],
})
export class GuardianModule {}
