import { config } from './config.js';
import { getBoss, QUEUES, stopBoss, type AiJobPayload, type RenderExportPayload } from './queue.js';
import { backupDatabase, cleanup, renderExport, runAiJob } from './jobs.js';
import { pool } from './db/client.js';

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), msg, ...extra }));

async function main() {
  const boss = await getBoss();

  // AI jobs mostly wait on fal.ai, so several run at once; renders are CPU-bound.
  await boss.work<AiJobPayload>(QUEUES.aiJob, { localConcurrency: config.AI_CONCURRENCY }, async ([job]) => {
    if (job) await runAiJob(job.data.jobId, log);
  });
  await boss.work<RenderExportPayload>(QUEUES.renderExport, { localConcurrency: config.WORKER_CONCURRENCY }, async ([job]) => {
    if (job) await renderExport(job.data.exportId, log);
  });
  await boss.work(QUEUES.backup, async () => backupDatabase(log));
  await boss.work(QUEUES.cleanup, async () => cleanup(log));

  if (config.BACKUP_CRON) await boss.schedule(QUEUES.backup, config.BACKUP_CRON);
  else await boss.unschedule(QUEUES.backup).catch(() => undefined);
  await boss.schedule(QUEUES.cleanup, '17 * * * *');

  log('worker started', { renders: config.WORKER_CONCURRENCY, ai: config.AI_CONCURRENCY, backups: config.BACKUP_CRON || 'off' });

  const shutdown = async (signal: string) => {
    log(`${signal} received, finishing current jobs`);
    await stopBoss();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
