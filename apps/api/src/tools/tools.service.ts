import { Injectable, Logger } from '@nestjs/common';
import type { Tool } from 'ai';
import { searchProductsTool } from './search-products.tool';
import { bookDemoTool } from './book-demo.tool';

export type ToolSet = Record<string, Tool>;

@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);
  private readonly registry: ToolSet = {
    search_products: searchProductsTool,
    book_demo: bookDemoTool,
  };

  /** Resolve a list of tool names (from block.tools ∪ workflow.tools) into the SDK ToolSet shape. */
  resolve(names: ReadonlyArray<string> | undefined): ToolSet | undefined {
    if (!names || names.length === 0) return undefined;
    const out: ToolSet = {};
    const unknown: string[] = [];
    for (const name of names) {
      const t = this.registry[name];
      if (t) out[name] = t;
      else unknown.push(name);
    }
    if (unknown.length) {
      this.logger.warn(`unknown tool name(s) ignored: ${unknown.join(', ')}`);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  /** Block + workflow tool names, de-duplicated. */
  merge(blockTools?: string[], workflowTools?: string[]): string[] {
    return Array.from(new Set([...(blockTools ?? []), ...(workflowTools ?? [])]));
  }
}
