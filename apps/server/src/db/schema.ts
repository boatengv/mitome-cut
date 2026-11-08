import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { ExportSettings } from '@mitome/shared';

export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed', 'canceled']);
export const fileStatus = pgEnum('file_status', ['pending', 'ready']);
export const aiPurpose = pgEnum('ai_purpose', ['video', 'image', 'sketch', 'llm', 'tts']);

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    /** Legacy local-password accounts only; Clerk-managed users have none. */
    passwordHash: text('password_hash'),
    clerkId: text('clerk_id').unique(),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex('users_email_idx').on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token; the raw token only ever lives in the cookie. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt,
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/**
 * The editor's library: one JSON document per key (shows, seasons, episodes,
 * movies and their indexes). Keys are validated against DOC_KEY_RE.
 */
export const docs = pgTable(
  'docs',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    /** Bumped on every write; returned to the client for diagnostics and future merge rules. */
    revision: integer('revision').notNull().default(1),
    sizeBytes: integer('size_bytes').notNull(),
    updatedAt,
  },
  (t) => [uniqueIndex('docs_owner_key_idx').on(t.ownerId, t.key)],
);

/** Media files, addressed by the editor's logical path. */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    /** Never reused: a replacement upload gets a new key and the old object is deleted. */
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: fileStatus('status').notNull().default('pending'),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex('files_owner_path_ready_idx').on(t.ownerId, t.path).where(sql`${t.status} = 'ready'`),
    index('files_owner_idx').on(t.ownerId),
  ],
);

/** Every paid AI call, for status polling, usage limits and cost tracking. */
export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: text('project_id'),
    purpose: aiPurpose('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    /** Characters for TTS, used by the daily character limit. */
    units: integer('units').notNull().default(0),
    status: jobStatus('status').notNull().default('queued'),
    message: text('message'),
    output: jsonb('output'),
    error: text('error'),
    providerRequestId: text('provider_request_id'),
    createdAt,
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('ai_jobs_owner_day_idx').on(t.ownerId, t.purpose, t.createdAt)],
);

export const exportsTable = pgTable(
  'exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: text('project_id').notNull(),
    /** A copy of the project document at the moment the export was requested. */
    snapshot: jsonb('snapshot').notNull(),
    settings: jsonb('settings').$type<ExportSettings>().notNull(),
    status: jobStatus('status').notNull().default('queued'),
    progress: integer('progress').notNull().default(0),
    outputPath: text('output_path'),
    error: text('error'),
    createdAt,
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('exports_owner_idx').on(t.ownerId, t.createdAt)],
);

export type FileRow = typeof files.$inferSelect;
export type AiJob = typeof aiJobs.$inferSelect;
export type ExportRow = typeof exportsTable.$inferSelect;
