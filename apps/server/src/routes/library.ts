import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, like, sql, sum } from 'drizzle-orm';
import {
  DOC_KEY_RE,
  FILE_PATH_RE,
  FILE_PREFIX_RE,
  completeBody,
  putDocBody,
  uploadBody,
  urlsBody,
  type FileDTO,
} from '@mitome/shared';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { requireUser } from '../auth.js';
import { HttpError, parse } from '../http.js';
import { keys, storage } from '../storage/index.js';

const MEDIA_MIME = /^(video|audio|image)\//;

function checkKey(key: string) {
  if (!DOC_KEY_RE.test(key)) throw new HttpError(400, 'invalid_key', 'Unknown document.');
  return key;
}

function checkPrefix(prefix: string) {
  if (!FILE_PREFIX_RE.test(prefix) || prefix.includes('..')) throw new HttpError(400, 'invalid_prefix', 'Invalid path.');
  return prefix;
}

/** Escapes LIKE wildcards so a prefix only matches literally. */
const likePrefix = (p: string) => p.replace(/[\\%_]/g, (c) => '\\' + c) + '%';

export async function usedBytes(ownerId: string) {
  const [row] = await db
    .select({ total: sum(schema.files.sizeBytes) })
    .from(schema.files)
    .where(eq(schema.files.ownerId, ownerId));
  return Number(row?.total ?? 0);
}

/** Deletes ready files (rows and objects) whose path starts with a prefix. */
export async function deleteFilesWithPrefix(ownerId: string, prefix: string) {
  const rows = await db
    .delete(schema.files)
    .where(and(eq(schema.files.ownerId, ownerId), like(schema.files.path, likePrefix(prefix))))
    .returning({ storageKey: schema.files.storageKey });
  await Promise.allSettled(rows.map((r) => storage.delete(r.storageKey)));
  return rows.length;
}

export async function libraryRoutes(app: FastifyInstance) {
  /* ---------------- Documents ---------------- */

  /** Everything the editor needs at start-up, in one request. */
  app.get('/api/library', async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select({ key: schema.docs.key, value: schema.docs.value })
      .from(schema.docs)
      .where(eq(schema.docs.ownerId, user.id));
    return { docs: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  });

  app.put<{ Params: { key: string } }>(
    '/api/docs/:key',
    { bodyLimit: config.MAX_DOC_KB * 1024 + 1024, config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req) => {
      const user = requireUser(req);
      const key = checkKey(req.params.key);
      const { value } = parse(putDocBody, req.body);
      const json = JSON.stringify(value ?? null);
      if (json.length > config.MAX_DOC_KB * 1024) {
        throw new HttpError(413, 'doc_too_large', 'This project is too large to save. Remove unused scenes or assets.');
      }
      const [row] = await db
        .insert(schema.docs)
        .values({ ownerId: user.id, key, value: value ?? null, sizeBytes: json.length })
        .onConflictDoUpdate({
          target: [schema.docs.ownerId, schema.docs.key],
          set: { value: value ?? null, sizeBytes: json.length, revision: sql`${schema.docs.revision} + 1`, updatedAt: new Date() },
        })
        .returning({ revision: schema.docs.revision, updatedAt: schema.docs.updatedAt });
      return { revision: row!.revision, updatedAt: row!.updatedAt.toISOString() };
    },
  );

  app.delete<{ Params: { key: string } }>('/api/docs/:key', async (req) => {
    const user = requireUser(req);
    const key = checkKey(req.params.key);
    await db.delete(schema.docs).where(and(eq(schema.docs.ownerId, user.id), eq(schema.docs.key, key)));
    return { ok: true };
  });

  /* ---------------- Files ---------------- */

  /** Step 1 of an upload: checks limits and returns a signed URL for the browser to PUT to. */
  app.post('/api/files/upload', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(uploadBody, req.body);
    if (!MEDIA_MIME.test(body.mime)) throw new HttpError(415, 'unsupported_type', 'Only video, audio and image files can be stored.');
    if (body.size > config.maxUploadBytes) throw new HttpError(413, 'too_large', `Files can be up to ${config.MAX_UPLOAD_MB} MB.`);
    if ((await usedBytes(user.id)) + body.size > config.storageQuotaBytes) {
      throw new HttpError(413, 'quota_exceeded', `Your storage limit is ${config.STORAGE_QUOTA_MB} MB. Delete unused projects or media first.`);
    }
    const [row] = await db
      .insert(schema.files)
      .values({ ownerId: user.id, path: body.path, storageKey: keys.file(user.id, body.path), mime: body.mime, sizeBytes: body.size })
      .returning();
    const signed = await storage.presignPut(row!.storageKey, body.mime);
    return reply.code(201).send({ id: row!.id, uploadUrl: signed.url, headers: signed.headers });
  });

  /** Step 2: verifies the bytes arrived, makes the file live and removes the version it replaces. */
  app.post('/api/files/complete', async (req) => {
    const user = requireUser(req);
    const { id } = parse(completeBody, req.body);
    const [row] = await db
      .select()
      .from(schema.files)
      .where(and(eq(schema.files.id, id), eq(schema.files.ownerId, user.id)))
      .limit(1);
    if (!row) throw new HttpError(404, 'not_found', 'Upload not found.');
    if (row.status === 'ready') return { path: row.path };
    const head = await storage.head(row.storageKey);
    if (!head) throw new HttpError(400, 'upload_missing', 'The upload has not finished yet.');
    if (head.size > config.maxUploadBytes) {
      await storage.delete(row.storageKey);
      await db.delete(schema.files).where(eq(schema.files.id, row.id));
      throw new HttpError(413, 'too_large', `Files can be up to ${config.MAX_UPLOAD_MB} MB.`);
    }
    const replaced = await db.transaction(async (tx) => {
      const old = await tx
        .delete(schema.files)
        .where(and(eq(schema.files.ownerId, user.id), eq(schema.files.path, row.path), eq(schema.files.status, 'ready')))
        .returning({ storageKey: schema.files.storageKey });
      await tx.update(schema.files).set({ status: 'ready', sizeBytes: head.size }).where(eq(schema.files.id, row.id));
      return old;
    });
    await Promise.allSettled(replaced.map((o) => storage.delete(o.storageKey)));
    return { path: row.path };
  });

  app.get<{ Querystring: { prefix?: string } }>('/api/files', async (req) => {
    const user = requireUser(req);
    const prefix = checkPrefix(req.query.prefix ?? '');
    const rows = await db
      .select()
      .from(schema.files)
      .where(and(eq(schema.files.ownerId, user.id), eq(schema.files.status, 'ready'), like(schema.files.path, likePrefix(prefix))));
    const files: FileDTO[] = rows.map((r) => ({ path: r.path, type: r.mime, size: r.sizeBytes, updated: r.updatedAt.getTime() }));
    return { files };
  });

  /** Signed, short-lived URLs for many files at once (the editor loads a project's media in one go). */
  app.post('/api/files/urls', async (req) => {
    const user = requireUser(req);
    const { paths } = parse(urlsBody, req.body);
    if (!paths.length) return { urls: {} };
    const rows = await db
      .select({ path: schema.files.path, storageKey: schema.files.storageKey })
      .from(schema.files)
      .where(and(eq(schema.files.ownerId, user.id), eq(schema.files.status, 'ready'), inArray(schema.files.path, paths)));
    const urls: Record<string, string> = {};
    for (const r of rows) urls[r.path] = await storage.presignGet(r.storageKey, { expiresSec: 6 * 3600 });
    return { urls };
  });

  app.delete<{ Querystring: { path?: string; prefix?: string } }>('/api/files', async (req) => {
    const user = requireUser(req);
    if (req.query.path) {
      if (!FILE_PATH_RE.test(req.query.path)) throw new HttpError(400, 'invalid_path', 'Invalid path.');
      const rows = await db
        .delete(schema.files)
        .where(and(eq(schema.files.ownerId, user.id), eq(schema.files.path, req.query.path)))
        .returning({ storageKey: schema.files.storageKey });
      await Promise.allSettled(rows.map((r) => storage.delete(r.storageKey)));
      return { deleted: rows.length };
    }
    const prefix = checkPrefix(req.query.prefix ?? '');
    if (!/^(projects|shows|seasons)\/[a-z0-9]{1,40}\//.test(prefix)) throw new HttpError(400, 'invalid_prefix', 'Prefix too broad.');
    return { deleted: await deleteFilesWithPrefix(user.id, prefix) };
  });

  app.get('/api/usage', async (req) => {
    const user = requireUser(req);
    return { storageBytes: await usedBytes(user.id), storageQuotaBytes: config.storageQuotaBytes, maxUploadBytes: config.maxUploadBytes };
  });
}
