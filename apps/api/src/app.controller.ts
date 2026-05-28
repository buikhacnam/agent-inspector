import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { WorkflowService } from './workflow/workflow.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly workflow: WorkflowService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('workflow')
  getWorkflow() {
    return this.workflow.current();
  }
}
