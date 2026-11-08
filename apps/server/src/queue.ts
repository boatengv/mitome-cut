import { PgBoss } from 'pg-boss';
import { config } from './config.js';

/**
 * Background jobs live in Postgres (pg-boss), so there is no Redis to run.
 * The API sends; the worker processes.
 */
export const QUEUES = {
  aiJob: 'ai.job',
  renderExport: 'export.render',
  backup: 'maintenance.backup',
  cleanup: 'maintenance.cleanup',
} as const;

export interface AiJobPayload {
  jobId: string;
}
export interface RenderExportPayload {
  exportId: string;
}

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  const b = new PgBoss({ connectionString: config.DATABASE_URL, max: 4 });
  b.on('error', (err: unknown) => console.error('[queue]', err));
  await b.start();
  // AI jobs are never retried automatically: with a paid model a retry is a second charge.
  await b.createQueue(QUEUES.aiJob, { retryLimit: 0, expireInSeconds: (config.AI_JOB_TIMEOUT_MIN + 5) * 60 });
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
