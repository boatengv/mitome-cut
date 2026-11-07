import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  createProjectBody,
  emptyTimeline,
  referencedAssetIds,
  saveTimelineBody,
  timelineDuration,
  updateProjectBody,
  type ProjectDTO,
  type ProjectSummaryDTO,
} from '@mitome/shared';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { requireUser } from '../auth.js';
import { assetDTO, exportDTO, generationDTO } from '../dto.js';
import { HttpError, notFound, parse } from '../http.js';
import { storage } from '../storage/index.js';

export async function getOwnedProject(projectId: string, ownerId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw notFound('Project');
  const [p] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, ownerId), isNull(schema.projects.archivedAt)))
    .limit(1);
  if (!p) throw notFound('Project');
  return p;
}

export async function loadProjectDTO(projectId: string, ownerId: string): Promise<ProjectDTO> {
  const p = await getOwnedProject(projectId, ownerId);
  const [assetRows, genRows, exportRows] = await Promise.all([
    db.select().from(schema.assets).where(eq(schema.assets.projectId, p.id)).orderBy(schema.assets.createdAt),
    db.select().from(schema.generations).where(eq(schema.generations.projectId, p.id)).orderBy(desc(schema.generations.createdAt)),
    db.select().from(schema.exportsTable).where(eq(schema.exportsTable.projectId, p.id)).orderBy(desc(schema.exportsTable.createdAt)).limit(10),
  ]);
  const byId = new Map(assetRows.map((a) => [a.id, a]));
  return {
    id: p.id,
    title: p.title,
    revision: p.revision,
    timeline: p.timeline,
    settings: p.settings,
    // Rendered exports are listed under exports, not in the media library.
    assets: await Promise.all(assetRows.filter((a) => a.source !== 'render').map(assetDTO)),
    generations: genRows.map(generationDTO),
    exports: await Promise.all(
      exportRows.map((e) => exportDTO(e, e.outputAssetId ? byId.get(e.outputAssetId) ?? null : null, p.title)),
    ),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function projectRoutes(app: FastifyInstance) {
  app.get('/api/projects', async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.ownerId, user.id), isNull(schema.projects.archivedAt)))
      .orderBy(desc(schema.projects.updatedAt))
      .limit(200);

    // One query for every project's cover thumbnail: the first scene's asset.
    const coverIds = rows.map((p) => p.timeline.video.find((c) => c.assetId)?.assetId).filter((x): x is string => !!x);
    const covers = coverIds.length
      ? await db.select().from(schema.assets).where(inArray(schema.assets.id, coverIds))
      : [];
    const coverById = new Map(covers.map((a) => [a.id, a]));

    const projects: ProjectSummaryDTO[] = await Promise.all(
      rows.map(async (p) => {
        const coverId = p.timeline.video.find((c) => c.assetId)?.assetId;
        const cover = coverId ? coverById.get(coverId) : undefined;
        return {
          id: p.id,
          title: p.title,
          revision: p.revision,
          durationSec: timelineDuration(p.timeline),
          sceneCount: p.timeline.video.length,
          thumbUrl: cover?.thumbKey ? await storage.presignGet(cover.thumbKey) : null,
          updatedAt: p.updatedAt.toISOString(),
          createdAt: p.createdAt.toISOString(),
        };
      }),
    );
    return { projects };
  });

  app.post('/api/projects', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(createProjectBody, req.body);
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.projects)
      .where(and(eq(schema.projects.ownerId, user.id), isNull(schema.projects.archivedAt)));
    if (n >= config.MAX_PROJECTS_PER_USER) {
      throw new HttpError(429, 'project_limit', `You can have up to ${config.MAX_PROJECTS_PER_USER} projects.`);
    }
    const [p] = await db
      .insert(schema.projects)
      .values({
        ownerId: user.id,
        title: body.title,
        settings: { width: 1920, height: 1080, fps: 24 },
        timeline: emptyTimeline(),
      })
      .returning();
    return reply.code(201).send({ project: await loadProjectDTO(p!.id, user.id) });
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const user = requireUser(req);
    return { project: await loadProjectDTO(req.params.id, user.id) };
  });

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const user = requireUser(req);
    const body = parse(updateProjectBody, req.body);
    const p = await getOwnedProject(req.params.id, user.id);
    await db.update(schema.projects).set({ title: body.title }).where(eq(schema.projects.id, p.id));
    return { ok: true };
  });

  /** Archive (soft delete). Files are kept; a cleanup job can purge them later. */
  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const user = requireUser(req);
    const p = await getOwnedProject(req.params.id, user.id);
    await db.update(schema.projects).set({ archivedAt: new Date() }).where(eq(schema.projects.id, p.id));
    return { ok: true };
  });

  /**
   * Saves the whole timeline document with optimistic concurrency: the client
   * sends the revision it last saw, and a stale save gets 409 with the current
   * revision instead of silently overwriting another tab's edits.
   */
  app.put<{ Params: { id: string } }>('/api/projects/:id/timeline', { bodyLimit: 5 * 1024 * 1024 }, async (req, reply) => {
    const user = requireUser(req);
    const body = parse(saveTimelineBody, req.body);
    const p = await getOwnedProject(req.params.id, user.id);

    // Clips may only point at this project's own assets.
    const ids = referencedAssetIds(body.timeline);
    if (ids.length) {
      const owned = await db
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(and(eq(schema.assets.projectId, p.id), inArray(schema.assets.id, ids)));
      if (owned.length !== ids.length) {
        throw new HttpError(400, 'unknown_asset', 'The timeline references media that is not in this project.');
      }
    }

    const [saved] = await db
      .update(schema.projects)
      .set({ timeline: body.timeline, revision: sql`${schema.projects.revision} + 1` })
      .where(and(eq(schema.projects.id, p.id), eq(schema.projects.revision, body.revision)))
      .returning({ revision: schema.projects.revision, updatedAt: schema.projects.updatedAt });

    if (!saved) {
      const [current] = await db
        .select({ revision: schema.projects.revision })
        .from(schema.projects)
        .where(eq(schema.projects.id, p.id));
      return reply.code(409).send({
        error: 'revision_conflict',
        message: 'This project was changed somewhere else. Reload to get the latest version.',
        details: { currentRevision: current?.revision },
      });
    }
    return { revision: saved.revision, updatedAt: saved.updatedAt.toISOString() };
  });
}
