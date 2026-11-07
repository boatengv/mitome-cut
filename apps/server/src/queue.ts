import { PgBoss } from 'pg-boss';
import { config } from './config.js';

/**
 * Background jobs live in Postgres (pg-boss), so there is no Redis to run.
 * Queue names and payloads are defined here and shared by the API (which
 * sends) and the worker (which processes).
 */
export const QUEUES = {
  processAsset: 'asset.process',
  runGeneration: 'generation.run',
  renderExport: 'export.render',
  backup: 'maintenance.backup',
  cleanup: 'maintenance.cleanup',
} as const;

export interface ProcessAssetJob {
  assetId: string;
}
export interface RunGenerationJob {
  generationId: string;
}
export interface RenderExportJob {
  exportId: string;
}

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  const b = new PgBoss({ connectionString: config.DATABASE_URL, max: 4 });
  b.on('error', (err: unknown) => console.error('[queue]', err));
  await b.start();
  await b.createQueue(QUEUES.processAsset, { retryLimit: 2, retryDelay: 10, expireInSeconds: 15 * 60 });
  // Generations are never retried automatically: with a paid model a retry is a second charge.
  await b.createQueue(QUEUES.runGeneration, { retryLimit: 0, expireInSeconds: 30 * 60 });
  // Renders are not retried automatically: a failed export is surfaced to the user.
  await b.createQueue(QUEUES.renderExport, { retryLimit: 0, expireInSeconds: 60 * 60 });
  await b.createQueue(QUEUES.backup, { retryLimit: 2, retryDelay: 300, expireInSeconds: 30 * 60 });
  await b.createQueue(QUEUES.cleanup, { retryLimit: 0, expireInSeconds: 10 * 60 });
  boss = b;
  return b;
}

export async function enqueue<T extends object>(queue: string, data: T) {
  const b = await getBoss();
  return b.send(queue, data);
}

export async function stopBoss() {
  if (boss) await boss.stop({ graceful: true, timeout: 20_000 });
  boss = null;
}
