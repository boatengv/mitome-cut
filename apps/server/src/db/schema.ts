import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ASSET_KINDS,
  ASSET_SOURCES,
  ASSET_STATUSES,
  JOB_STATUSES,
  type CreateExportBody,
  type Timeline,
} from '@mitome/shared';

export const assetKind = pgEnum('asset_kind', ASSET_KINDS);
export const assetSource = pgEnum('asset_source', ASSET_SOURCES);
export const assetStatus = pgEnum('asset_status', ASSET_STATUSES);
export const jobStatus = pgEnum('job_status', JOB_STATUSES);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    ...timestamps,
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
}

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    settings: jsonb('settings').$type<ProjectSettings>().notNull(),
    timeline: jsonb('timeline').$type<Timeline>().notNull(),
    /** Incremented on every timeline save; stale saves are rejected with 409. */
    revision: integer('revision').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('projects_owner_idx').on(t.ownerId, t.updatedAt)],
);

/** Point-in-time copies of a timeline, taken on export (and usable for version history). */
export const projectSnapshots = pgTable(
  'project_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    timeline: jsonb('timeline').$type<Timeline>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('snapshots_project_revision_idx').on(t.projectId, t.revision)],
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: assetKind('kind').notNull(),
    source: assetSource('source').notNull(),
    status: assetStatus('status').notNull(),
    name: text('name').notNull(),
    /** Never overwritten: every new version of a file gets a new key. */
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    /** Derived files can always be rebuilt from the original. */
    thumbKey: text('thumb_key'),
    error: text('error'),
    ...timestamps,
  },
  (t) => [index('assets_project_idx').on(t.projectId, t.createdAt), index('assets_owner_idx').on(t.ownerId)],
);

export const generations = pgTable(
  'generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    prompt: text('prompt').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatus('status').notNull().default('queued'),
    error: text('error'),
    providerJobId: text('provider_job_id'),
    /** What this generation cost us, for pricing and limits. */
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('generations_project_idx').on(t.projectId), index('generations_owner_day_idx').on(t.ownerId, t.createdAt)],
);

export const exportsTable = pgTable(
  'exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The timeline revision rendered; its snapshot is in project_snapshots. */
    revision: integer('revision').notNull(),
    settings: jsonb('settings').$type<CreateExportBody>().notNull(),
    status: jobStatus('status').notNull().default('queued'),
    progress: integer('progress').notNull().default(0),
    outputAssetId: uuid('output_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('exports_project_idx').on(t.projectId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Generation = typeof generations.$inferSelect;
export type ExportRow = typeof exportsTable.$inferSelect;
