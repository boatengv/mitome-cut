import { config } from './config.js';
import { buildApp } from './app.js';
import { runMigrations } from './migrate.js';
import { getBoss, stopBoss } from './queue.js';
import { pool } from './db/client.js';

async function main() {
  await runMigrations();
  await getBoss(); // creates queues so sends never race the worker's startup
  const app = await buildApp();
  await app.listen({ host: config.HOST, port: config.PORT });

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
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
