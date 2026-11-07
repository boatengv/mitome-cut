import type { FastifyInstance } from 'fastify';
import { and, count, eq, gt, sql, sum } from 'drizzle-orm';
import {
  RESOLUTION_SIZE,
  createExportBody,
  createGenerationBody,
  createUploadBody,
  referencedAssetIds,
  timelineDuration,
  type AssetKind,
  type UploadTicketDTO,
} from '@mitome/shared';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { requireUser } from '../auth.js';
import { assetDTO, exportDTO } from '../dto.js';
import { HttpError, notFound, parse } from '../http.js';
import { enqueue, QUEUES } from '../queue.js';
import { extFor, keys, storage } from '../storage/index.js';
import { findProvider } from '../providers/index.js';
import { getOwnedProject } from './projects.js';

function kindForMime(mime: string): AssetKind {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  throw new HttpError(415, 'unsupported_type', 'Upload a video, audio or image file.');
}

async function usedBytes(ownerId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(schema.assets.sizeBytes) })
    .from(schema.assets)
    .where(eq(schema.assets.ownerId, ownerId));
  return Number(row?.total ?? 0);
}

async function getOwnedAsset(assetId: string, ownerId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) throw notFound('Asset');
  const [a] = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.id, assetId), eq(schema.assets.ownerId, ownerId)))
    .limit(1);
  if (!a) throw notFound('Asset');
  return a;
}

const since24h = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

export async function mediaRoutes(app: FastifyInstance) {
  /* ---------- Uploads: browser → storage directly, via a signed URL ---------- */

  app.post<{ Params: { id: string } }>('/api/projects/:id/uploads', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(createUploadBody, req.body);
    const p = await getOwnedProject(req.params.id, user.id);
    const kind = kindForMime(body.mime);

    if (body.size > config.maxUploadBytes) {
      throw new HttpError(413, 'too_large', `Files can be up to ${config.MAX_UPLOAD_MB} MB.`);
    }
    if ((await usedBytes(user.id)) + body.size > config.storageQuotaBytes) {
      throw new HttpError(413, 'quota_exceeded', `Your storage limit is ${config.STORAGE_QUOTA_MB} MB. Delete unused media first.`);
    }

    const id = crypto.randomUUID();
    const storageKey = keys.original(user.id, p.id, id, extFor(body.name, body.mime));
    const [asset] = await db
      .insert(schema.assets)
      .values({
        id,
        projectId: p.id,
        ownerId: user.id,
        kind,
        source: 'upload',
        status: 'pending_upload',
        name: body.name,
        storageKey,
        mime: body.mime,
        sizeBytes: body.size,
      })
      .returning();

    const signed = await storage.presignPut(storageKey, body.mime);
    const ticket: UploadTicketDTO = {
      asset: await assetDTO(asset!),
      uploadUrl: signed.url,
      method: 'PUT',
      headers: signed.headers,
    };
    return reply.code(201).send(ticket);
  });

  /** Called by the browser after its PUT finishes. Verifies the file and queues processing. */
  app.post<{ Params: { id: string } }>('/api/assets/:id/complete', async (req) => {
    const user = requireUser(req);
    const a = await getOwnedAsset(req.params.id, user.id);
    if (a.status !== 'pending_upload') return { asset: await assetDTO(a) };

    const head = await storage.head(a.storageKey);
    if (!head) throw new HttpError(400, 'upload_missing', 'The upload has not finished yet.');
    if (head.size > config.maxUploadBytes) {
      await storage.delete(a.storageKey);
      await db.update(schema.assets).set({ status: 'failed', error: 'File too large' }).where(eq(schema.assets.id, a.id));
      throw new HttpError(413, 'too_large', `Files can be up to ${config.MAX_UPLOAD_MB} MB.`);
    }
    const [updated] = await db
      .update(schema.assets)
      .set({ status: 'processing', sizeBytes: head.size })
      .where(eq(schema.assets.id, a.id))
      .returning();
    await enqueue(QUEUES.processAsset, { assetId: a.id });
    return { asset: await assetDTO(updated!) };
  });

  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (req) => {
    const user = requireUser(req);
    const a = await getOwnedAsset(req.params.id, user.id);
    const p = await getOwnedProject(a.projectId, user.id);
    if (referencedAssetIds(p.timeline).includes(a.id)) {
      throw new HttpError(409, 'asset_in_use', 'Remove this media from the timeline before deleting it.');
    }
    await db.delete(schema.assets).where(eq(schema.assets.id, a.id));
    await Promise.allSettled([storage.delete(a.storageKey), a.thumbKey ? storage.delete(a.thumbKey) : null]);
    return { ok: true };
  });

  /* ---------- AI generation ---------- */

  app.post<{ Params: { id: string } }>('/api/projects/:id/generations', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(createGenerationBody, req.body);
    const p = await getOwnedProject(req.params.id, user.id);
    const provider = findProvider(body.model);
    if (!provider) throw new HttpError(400, 'unknown_model', `Model "${body.model}" is not available.`);

    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.generations)
      .where(and(eq(schema.generations.ownerId, user.id), gt(schema.generations.createdAt, since24h())));
    if (n >= config.GENERATIONS_PER_DAY) {
      throw new HttpError(429, 'generation_limit', `You can generate ${config.GENERATIONS_PER_DAY} scenes per day.`);
    }

    const assetId = crypto.randomUUID();
    const { width, height } = RESOLUTION_SIZE[body.resolution];
    const result = await db.transaction(async (tx) => {
      const [asset] = await tx
        .insert(schema.assets)
        .values({
          id: assetId,
          projectId: p.id,
          ownerId: user.id,
          kind: 'video',
          source: 'generation',
          status: 'processing',
          name: body.prompt.slice(0, 80),
          storageKey: keys.original(user.id, p.id, assetId, '.mp4'),
          mime: 'video/mp4',
        })
        .returning();
      const [gen] = await tx
        .insert(schema.generations)
        .values({
          projectId: p.id,
          ownerId: user.id,
          assetId,
          provider: provider.id,
          model: body.model,
          prompt: body.prompt,
          params: { durationSec: body.durationSec, width, height },
        })
        .returning();
      return { asset: asset!, gen: gen! };
    });

    await enqueue(QUEUES.runGeneration, { generationId: result.gen.id });
    return reply.code(201).send({ asset: await assetDTO(result.asset), generationId: result.gen.id });
  });

  /* ---------- Exports ---------- */

  app.post<{ Params: { id: string } }>('/api/projects/:id/exports', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(createExportBody, req.body);
    const p = await getOwnedProject(req.params.id, user.id);
    if (timelineDuration(p.timeline) <= 0) {
      throw new HttpError(400, 'empty_timeline', 'Add something to the timeline before exporting.');
    }
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.exportsTable)
      .where(and(eq(schema.exportsTable.ownerId, user.id), gt(schema.exportsTable.createdAt, since24h())));
    if (n >= config.EXPORTS_PER_DAY) {
      throw new HttpError(429, 'export_limit', `You can export ${config.EXPORTS_PER_DAY} times per day.`);
    }

    const row = await db.transaction(async (tx) => {
      await tx
        .insert(schema.projectSnapshots)
        .values({ projectId: p.id, revision: p.revision, timeline: p.timeline })
        .onConflictDoNothing();
      const [e] = await tx
        .insert(schema.exportsTable)
        .values({ projectId: p.id, ownerId: user.id, revision: p.revision, settings: body })
        .returning();
      return e!;
    });
    await enqueue(QUEUES.renderExport, { exportId: row.id });
    return reply.code(201).send({ export: await exportDTO(row, null, p.title) });
  });

  app.get<{ Params: { id: string } }>('/api/exports/:id', async (req) => {
    const user = requireUser(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw notFound('Export');
    const [row] = await db
      .select({ e: schema.exportsTable, title: schema.projects.title })
      .from(schema.exportsTable)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.exportsTable.projectId))
      .where(and(eq(schema.exportsTable.id, req.params.id), eq(schema.exportsTable.ownerId, user.id)))
      .limit(1);
    if (!row) throw notFound('Export');
    const output = row.e.outputAssetId
      ? (await db.select().from(schema.assets).where(eq(schema.assets.id, row.e.outputAssetId)))[0] ?? null
      : null;
    return { export: await exportDTO(row.e, output, row.title) };
  });

  app.post<{ Params: { id: string } }>('/api/exports/:id/cancel', async (req) => {
    const user = requireUser(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw notFound('Export');
    await db
      .update(schema.exportsTable)
      .set({ status: 'canceled', completedAt: new Date() })
      .where(
        and(
          eq(schema.exportsTable.id, req.params.id),
          eq(schema.exportsTable.ownerId, user.id),
          sql`${schema.exportsTable.status} in ('queued', 'running')`,
        ),
      );
    return { ok: true };
  });

  /* ---------- Usage, for the UI to show limits ---------- */

  app.get('/api/usage', async (req) => {
    const user = requireUser(req);
    const [gens] = await db
      .select({ n: count() })
      .from(schema.generations)
      .where(and(eq(schema.generations.ownerId, user.id), gt(schema.generations.createdAt, since24h())));
    return {
      storageBytes: await usedBytes(user.id),
      storageQuotaBytes: config.storageQuotaBytes,
      maxUploadBytes: config.maxUploadBytes,
      generationsToday: gens?.n ?? 0,
      generationsPerDay: config.GENERATIONS_PER_DAY,
    };
  });
}
