export const INGEST_QUEUE = 'ingest';

export interface IngestJobData {
  sourceId: string;
  crawl: boolean;
}
