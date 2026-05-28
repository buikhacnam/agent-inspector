import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Block, Form, Workflow } from '@agent-x/shared';

@Injectable()
export class WorkflowService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowService.name);
  private workflow!: Workflow;

  onModuleInit() {
    const path = this.resolveSeedPath();
    const raw = readFileSync(path, 'utf-8');
    this.workflow = JSON.parse(raw) as Workflow;
    this.logger.log(
      `loaded workflow v${this.workflow.version} from ${path} ` +
        `(${this.workflow.blocks.length} block${this.workflow.blocks.length === 1 ? '' : 's'}, ` +
        `${this.workflow.forms.length} form${this.workflow.forms.length === 1 ? '' : 's'})`,
    );
  }

  current(): Workflow {
    return this.workflow;
  }

  getBlock(id: string): Block {
    const block = this.workflow.blocks.find((b) => b.id === id);
    if (!block) throw new Error(`block ${id} not found in workflow`);
    return block;
  }

  startBlock(): Block {
    return this.getBlock(this.workflow.startBlockId);
  }

  getForm(id: string): Form {
    const form = this.workflow.forms.find((f) => f.id === id);
    if (!form) throw new Error(`form ${id} not found in workflow`);
    return form;
  }

  private resolveSeedPath(): string {
    const envPath = process.env.WORKFLOW_PATH;
    if (envPath) return resolve(envPath);
    const cwd = process.cwd();
    const candidates = [
      resolve(cwd, 'seeds/workflow.json'),
      resolve(cwd, '../../seeds/workflow.json'),
      resolve(cwd, '../../../seeds/workflow.json'),
    ];
    for (const candidate of candidates) {
      try {
        readFileSync(candidate);
        return candidate;
      } catch {
        /* try next */
      }
    }
    throw new Error(`workflow.json not found; tried: ${candidates.join(', ')}`);
  }
}
