import { config } from './config.js';
import { getBoss, QUEUES, stopBoss, type ProcessAssetJob, type RenderExportJob, type RunGenerationJob } from './queue.js';
import { backupDatabase, cleanup, processAsset, renderExport, runGeneration } from './jobs.js';
import { pool } from './db/client.js';

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), msg, ...extra }));

async function main() {
  const boss = await getBoss();
  const concurrency = { localConcurrency: config.WORKER_CONCURRENCY };

  await boss.work<ProcessAssetJob>(QUEUES.processAsset, { localConcurrency: 2 }, async ([job]) => {
    if (job) await processAsset(job.data.assetId, log);
  });
  await boss.work<RunGenerationJob>(QUEUES.runGeneration, concurrency, async ([job]) => {
    if (job) await runGeneration(job.data.generationId, log);
  });
  await boss.work<RenderExportJob>(QUEUES.renderExport, concurrency, async ([job]) => {
    if (job) await renderExport(job.data.exportId, log);
  });
  await boss.work(QUEUES.backup, async () => backupDatabase(log));
  await boss.work(QUEUES.cleanup, async () => cleanup(log));

  if (config.BACKUP_CRON) await boss.schedule(QUEUES.backup, config.BACKUP_CRON);
  else await boss.unschedule(QUEUES.backup).catch(() => undefined);
  await boss.schedule(QUEUES.cleanup, '17 * * * *');

  log('worker started', { concurrency: config.WORKER_CONCURRENCY, backups: config.BACKUP_CRON || 'off' });

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
