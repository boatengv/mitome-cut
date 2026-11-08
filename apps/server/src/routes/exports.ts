import type { FastifyInstance } from 'fastify';
import { and, count, eq, gt, sql } from 'drizzle-orm';
import { exportBody, type ExportDTO } from '@mitome/shared';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { requireUser } from '../auth.js';
import { HttpError, parse } from '../http.js';
import { enqueue, QUEUES } from '../queue.js';
import { storage } from '../storage/index.js';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export';

async function exportDTO(e: typeof schema.exportsTable.$inferSelect): Promise<ExportDTO> {
  let downloadUrl: string | null = null;
  let sizeBytes: number | null = null;
  const title = String((e.snapshot as { title?: string }).title ?? 'export');
  const fileName = `${slug(title)}.${e.settings.format}`;
  if (e.status === 'succeeded' && e.outputPath) {
    const [f] = await db
      .select()
      .from(schema.files)
      .where(and(eq(schema.files.ownerId, e.ownerId), eq(schema.files.path, e.outputPath), eq(schema.files.status, 'ready')))
      .limit(1);
    if (f) {
      downloadUrl = await storage.presignGet(f.storageKey, { downloadName: fileName, expiresSec: 6 * 3600 });
      sizeBytes = f.sizeBytes;
    }
  }
  return { id: e.id, status: e.status, progress: e.progress, error: e.error, downloadUrl, fileName: downloadUrl ? fileName : null, sizeBytes };
}

export async function exportRoutes(app: FastifyInstance) {
  /** Renders the project as it is saved right now (the editor saves before calling this). */
  app.post<{ Params: { pid: string } }>('/api/projects/:pid/exports', async (req, reply) => {
    const user = requireUser(req);
    if (!/^[a-z0-9]{1,40}$/.test(req.params.pid)) throw new HttpError(404, 'not_found', 'Project not found.');
    const settings = parse(exportBody, req.body);
    const [doc] = await db
      .select({ value: schema.docs.value })
      .from(schema.docs)
      .where(and(eq(schema.docs.ownerId, user.id), eq(schema.docs.key, `ms_proj_${req.params.pid}`)))
      .limit(1);
    if (!doc) throw new HttpError(404, 'not_found', 'Project not found. Save it first.');
    const scenes = (doc.value as { scenes?: unknown[] }).scenes ?? [];
    if (!scenes.length) throw new HttpError(400, 'empty', 'Add at least one scene before exporting.');
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.exportsTable)
      .where(and(eq(schema.exportsTable.ownerId, user.id), gt(schema.exportsTable.createdAt, new Date(Date.now() - 864e5))));
    if (n >= config.EXPORTS_PER_DAY) throw new HttpError(429, 'export_limit', `You can export ${config.EXPORTS_PER_DAY} times per day.`);
    const [row] = await db
      .insert(schema.exportsTable)
      .values({ ownerId: user.id, projectId: req.params.pid, snapshot: doc.value as object, settings })
      .returning();
    await enqueue(QUEUES.renderExport, { exportId: row!.id });
    return reply.code(201).send({ export: await exportDTO(row!) });
  });

  app.get<{ Params: { id: string } }>('/api/exports/:id', async (req) => {
    const user = requireUser(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new HttpError(404, 'not_found', 'Export not found.');
    const [row] = await db
      .select()
      .from(schema.exportsTable)
      .where(and(eq(schema.exportsTable.id, req.params.id), eq(schema.exportsTable.ownerId, user.id)))
      .limit(1);
    if (!row) throw new HttpError(404, 'not_found', 'Export not found.');
    return { export: await exportDTO(row) };
  });

  app.post<{ Params: { id: string } }>('/api/exports/:id/cancel', async (req) => {
    const user = requireUser(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new HttpError(404, 'not_found', 'Export not found.');
    await db
      .update(schema.exportsTable)
      .set({ status: 'canceled', completedAt: new Date() })
      .where(
        and(
          eq(schema.exportsTable.id, req.params.id),
          eq(schema.exportsTable.ownerId, user.id),
          sql`${schema.exportsTable.status} in ('queued','running')`,
        ),
      );
    return { ok: true };
  });
}
