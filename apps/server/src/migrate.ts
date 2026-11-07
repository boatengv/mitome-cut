import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './db/client.js';

/**
 * Applies pending SQL migrations from apps/server/drizzle. Runs automatically
 * when the API starts; `npm run db:migrate` runs it on its own (migrate-cli.ts).
 */
export async function runMigrations() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/ in development, dist/ in production: both sit next to drizzle/
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(here, '../drizzle');
  await migrate(db, { migrationsFolder });
}
