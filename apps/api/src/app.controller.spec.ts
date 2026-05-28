import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WorkflowService } from './workflow/workflow.service';

describe('AppController', () => {
  let appController: AppController;
  const workflowStub = { current: () => ({ version: 1, blocks: [], forms: [] }) };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: WorkflowService, useValue: workflowStub }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });

    it('exposes workflow JSON', () => {
      expect(appController.getWorkflow()).toEqual({ version: 1, blocks: [], forms: [] });
    });
  });
});
