import { z } from 'zod';
import path from 'node:path';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Used to sign local storage URLs. Use a long random string in production. */
  SESSION_SECRET: z.string().min(16),
  COOKIE_SECURE: z.string().optional(),
  ALLOW_SIGNUP: bool,
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./data/storage'),
  S3_ENDPOINT: z.string().optional(),
  /** Endpoint used in signed URLs handed to browsers, if it differs (MinIO in Docker). */
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,

  /* Guardrails: hard limits that keep usage, and the bill, bounded. */
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(500),
  STORAGE_QUOTA_MB: z.coerce.number().int().positive().default(5000),
  GENERATIONS_PER_DAY: z.coerce.number().int().min(0).default(20),
  EXPORTS_PER_DAY: z.coerce.number().int().min(0).default(30),
  MAX_PROJECTS_PER_USER: z.coerce.number().int().positive().default(50),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  FONT_PATH: z.string().default('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
  TMP_DIR: z.string().default(''),

  /** Cron for nightly Postgres backups to object storage. Empty disables. */
  BACKUP_CRON: z.string().default(''),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).default(14),
  PG_DUMP_PATH: z.string().default('pg_dump'),

  /** If set, the API also serves the built web app from this directory. */
  WEB_DIST_DIR: z.string().optional(),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  }
  const env = parsed.data;
  if (env.STORAGE_DRIVER === 's3') {
    for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (!env[key]) throw new Error(`${key} is required when STORAGE_DRIVER=s3`);
    }
  }
  const cookieSecure =
    env.COOKIE_SECURE === undefined ? env.NODE_ENV === 'production' : env.COOKIE_SECURE === 'true';
  return {
    ...env,
    cookieSecure,
    localStorageDir: path.resolve(env.LOCAL_STORAGE_DIR),
    maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
    storageQuotaBytes: env.STORAGE_QUOTA_MB * 1024 * 1024,
  };
}

export type Config = ReturnType<typeof load>;
export const config: Config = load();
