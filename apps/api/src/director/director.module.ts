import { Module } from '@nestjs/common';
import { DirectorService } from './director.service';

@Module({
  providers: [DirectorService],
  exports: [DirectorService],
})
export class DirectorModule {}
