import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';

interface PasteBody {
  text?: string;
  title?: string;
  namespace?: string;
}

interface UrlBody {
  url?: string;
  crawl?: boolean;
  title?: string;
  namespace?: string;
}

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Post('paste')
  async paste(@Body() body: PasteBody) {
    if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
      throw new BadRequestException('text is required');
    }
    const { source, chunks } = await this.knowledge.paste(body.text, {
      title: body.title,
      namespace: body.namespace,
    });
    return { source, chunks };
  }

  @Post('url')
  async url(@Body() body: UrlBody) {
    if (!body.url || typeof body.url !== 'string') {
      throw new BadRequestException('url is required');
    }
    const source = await this.knowledge.enqueueUrl(body.url, {
      crawl: !!body.crawl,
      title: body.title,
      namespace: body.namespace,
    });
    return source;
  }

  @Get('sources')
  list() {
    return this.knowledge.list();
  }

  @Delete('sources/:id')
  async delete(@Param('id') id: string) {
    await this.knowledge.delete(id);
    return { ok: true };
  }
}
