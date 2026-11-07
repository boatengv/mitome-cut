import { runMigrations } from './migrate.js';
import { pool } from './db/client.js';

runMigrations()
  .then(async () => {
    console.log('Migrations applied');
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
