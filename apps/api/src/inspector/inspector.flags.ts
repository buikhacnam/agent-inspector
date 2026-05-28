import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type DebugFlags = {
  inspector: boolean;
  director: boolean;
  rag: boolean;
  llm: boolean;
  prompt: boolean;
  timing: boolean;
  pipeline: boolean;
  tool: boolean;
};

function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === '1';
}

@Injectable()
export class InspectorFlags implements OnModuleInit {
  private readonly logger = new Logger(InspectorFlags.name);
  private flags: DebugFlags = {
    inspector: false,
    director: false,
    rag: false,
    llm: false,
    prompt: false,
    timing: false,
    pipeline: false,
    tool: false,
  };

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const master = bool(this.config.get('DEBUG_INSPECTOR'));
    const isProd = this.config.get('NODE_ENV') === 'production';
    const prodOverride = bool(this.config.get('ALLOW_INSPECTOR_IN_PROD'));
    if (master && isProd && !prodOverride) {
      throw new Error(
        'DEBUG_INSPECTOR=true in production. Set ALLOW_INSPECTOR_IN_PROD=true to override.',
      );
    }
    this.flags = {
      inspector: master,
      director: master && bool(this.config.get('DEBUG_DIRECTOR_TRACE')),
      rag: master && bool(this.config.get('DEBUG_RAG_TRACE')),
      llm: master && bool(this.config.get('DEBUG_LLM_TRACE')),
      prompt: master && bool(this.config.get('DEBUG_PROMPT_CAPTURE')),
      timing: master && bool(this.config.get('DEBUG_PHASE_TIMING')),
      pipeline: master && bool(this.config.get('DEBUG_PIPELINE_TRACE')),
      tool: master && bool(this.config.get('DEBUG_TOOL_TRACE')),
    };
    if (master) {
      this.logger.log(`inspector enabled: ${JSON.stringify(this.flags)}`);
    }
  }

  get(): DebugFlags {
    return this.flags;
  }

  enabled(): boolean {
    return this.flags.inspector;
  }

  on(key: keyof Omit<DebugFlags, 'inspector'>): boolean {
    return this.flags.inspector && this.flags[key];
  }
}
