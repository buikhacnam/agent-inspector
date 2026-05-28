import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InspectorFlags } from './inspector.flags';
import { InspectorService } from './inspector.service';
import { InspectorController } from './inspector.controller';

@Module({
  imports: [PrismaModule],
  providers: [InspectorFlags, InspectorService],
  controllers: [InspectorController],
  exports: [InspectorFlags, InspectorService],
})
export class InspectorModule {}
