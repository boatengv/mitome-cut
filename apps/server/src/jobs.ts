import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { RESOLUTION_SIZE, referencedAssetIds } from '@mitome/shared';
import { config } from './config.js';
import { db, schema } from './db/client.js';
import { ffprobe, makeThumbnail, runFfmpeg } from './media/ffmpeg.js';
import { buildRenderPlan, type RenderMedia } from './media/render.js';
import { findProvider } from './providers/index.js';
import { purgeExpiredSessions } from './auth.js';
import { keys, storage } from './storage/index.js';

type Log = (msg: string, extra?: Record<string, unknown>) => void;

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(config.TMP_DIR || os.tmpdir(), 'mitome-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1000);

/** Probes a local file, makes its thumbnail and records the results on the asset. */
async function finishAsset(asset: typeof schema.assets.$inferSelect, file: string, dir: string) {
  const info = await ffprobe(file);
  let kind = asset.kind;
  if (info.isImage) kind = 'image';
  else if (!info.hasVideo && info.hasAudio) kind = 'audio';
  else if (!info.hasVideo && !info.hasAudio) throw new Error('The file has no video or audio.');

  let thumbKey: string | null = null;
  if (kind !== 'audio') {
    const thumb = path.join(dir, 'thumb.jpg');
    await makeThumbnail(file, thumb, Math.min(1, (info.durationSec ?? 0) / 2), kind === 'image');
    thumbKey = keys.thumb(asset.ownerId, asset.projectId, asset.id);
    await storage.putFile(thumbKey, thumb, 'image/jpeg');
  }
  const stat = await fs.stat(file);
  await db
    .update(schema.assets)
    .set({
      kind,
      status: 'ready',
      error: null,
      sizeBytes: stat.size,
      durationMs: info.durationSec == null ? null : Math.round(info.durationSec * 1000),
      width: info.width,
      height: info.height,
      thumbKey,
    })
    .where(eq(schema.assets.id, asset.id));
}

/* ---------------- asset.process ---------------- */

export async function processAsset(assetId: string, log: Log) {
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, assetId));
  if (!asset || asset.status !== 'processing') return;
  await withTmp(async (dir) => {
    const file = path.join(dir, `source${path.extname(asset.storageKey)}`);
    await storage.getToFile(asset.storageKey, file); // storage errors throw → job retries
    try {
      await finishAsset(asset, file, dir);
      log('asset ready', { assetId });
    } catch (err) {
      // A bad file will not get better on retry: mark it failed and stop.
      await db.update(schema.assets).set({ status: 'failed', error: errMsg(err) }).where(eq(schema.assets.id, asset.id));
      log('asset failed', { assetId, error: errMsg(err) });
    }
  });
}

/* ---------------- generation.run ---------------- */

export async function runGeneration(generationId: string, log: Log) {
  const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, generationId));
  if (!gen || gen.status !== 'queued') return;
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, gen.assetId));
  if (!asset) return;
  await db.update(schema.generations).set({ status: 'running' }).where(eq(schema.generations.id, gen.id));

  const fail = async (err: unknown) => {
    await db
      .update(schema.generations)
      .set({ status: 'failed', error: errMsg(err), completedAt: new Date() })
      .where(eq(schema.generations.id, gen.id));
    await db.update(schema.assets).set({ status: 'failed', error: errMsg(err) }).where(eq(schema.assets.id, asset.id));
    log('generation failed', { generationId, error: errMsg(err) });
  };

  const provider = findProvider(gen.model);
  if (!provider) return fail(new Error(`Model ${gen.model} is no longer available.`));

  await withTmp(async (dir) => {
    const out = path.join(dir, 'scene.mp4');
    const params = gen.params as { durationSec?: number; width?: number; height?: number };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25 * 60 * 1000);
    try {
      const result = await provider.generate({
        prompt: gen.prompt,
        durationSec: params.durationSec ?? 5,
        width: params.width ?? RESOLUTION_SIZE['720p'].width,
        height: params.height ?? RESOLUTION_SIZE['720p'].height,
        outPath: out,
        signal: controller.signal,
      });
      await storage.putFile(asset.storageKey, out, 'video/mp4');
      await finishAsset(asset, out, dir);
      await db
        .update(schema.generations)
        .set({
          status: 'succeeded',
          completedAt: new Date(),
          costUsd: result.costUsd == null ? null : String(result.costUsd),
          providerJobId: result.providerJobId ?? null,
        })
        .where(eq(schema.generations.id, gen.id));
      log('generation succeeded', { generationId });
    } catch (err) {
      await fail(err);
    } finally {
      clearTimeout(timer);
    }
  });
}

/* ---------------- export.render ---------------- */

async function exportStatus(id: string) {
  const [row] = await db
    .select({ status: schema.exportsTable.status })
    .from(schema.exportsTable)
    .where(eq(schema.exportsTable.id, id));
  return row?.status;
}

export async function renderExport(exportId: string, log: Log) {
  const [exp] = await db.select().from(schema.exportsTable).where(eq(schema.exportsTable.id, exportId));
  if (!exp || exp.status !== 'queued') return;
  const [snapshot] = await db
    .select()
    .from(schema.projectSnapshots)
    .where(and(eq(schema.projectSnapshots.projectId, exp.projectId), eq(schema.projectSnapshots.revision, exp.revision)));
  await db.update(schema.exportsTable).set({ status: 'running', progress: 0 }).where(eq(schema.exportsTable.id, exp.id));

  const fail = async (err: unknown) => {
    const canceled = (await exportStatus(exp.id)) === 'canceled';
    if (!canceled) {
      await db
        .update(schema.exportsTable)
        .set({ status: 'failed', error: errMsg(err), completedAt: new Date() })
        .where(eq(schema.exportsTable.id, exp.id));
    }
    log(canceled ? 'export canceled' : 'export failed', { exportId, error: errMsg(err) });
  };

  if (!snapshot) return fail(new Error('The timeline snapshot for this export is missing.'));

  await withTmp(async (dir) => {
    const controller = new AbortController();
    const cancelPoll = setInterval(async () => {
      if ((await exportStatus(exp.id).catch(() => undefined)) === 'canceled') controller.abort();
    }, 2000);
    try {
      // Fetch every ready asset the timeline uses.
      const ids = referencedAssetIds(snapshot.timeline);
      const rows = ids.length
        ? await db.select().from(schema.assets).where(and(inArray(schema.assets.id, ids), eq(schema.assets.status, 'ready')))
        : [];
      const media = new Map<string, RenderMedia>();
      for (const a of rows) {
        const file = path.join(dir, `in-${a.id}${path.extname(a.storageKey)}`);
        await storage.getToFile(a.storageKey, file);
        const info = await ffprobe(file);
        media.set(a.id, { path: file, hasVideo: info.hasVideo, hasAudio: info.hasAudio, isImage: info.isImage });
      }

      const { width, height } = RESOLUTION_SIZE[exp.settings.resolution];
      const out = path.join(dir, `export.${exp.settings.format}`);
      const plan = buildRenderPlan(
        snapshot.timeline,
        media,
        { width, height, fps: exp.settings.fps, format: exp.settings.format },
        { workDir: dir, fontPath: config.FONT_PATH, outPath: out },
      );
      for (const f of plan.files) await fs.writeFile(f.path, f.content, 'utf8');

      let lastWrite = 0;
      await runFfmpeg(plan.args, {
        signal: controller.signal,
        onProgress: (sec) => {
          const now = Date.now();
          if (now - lastWrite < 1000) return;
          lastWrite = now;
          const pct = Math.max(1, Math.min(99, Math.floor((sec / plan.durationSec) * 100)));
          void db.update(schema.exportsTable).set({ progress: pct }).where(eq(schema.exportsTable.id, exp.id));
        },
      });

      const mime = exp.settings.format === 'gif' ? 'image/gif' : exp.settings.format === 'mov' ? 'video/quicktime' : 'video/mp4';
      const assetId = crypto.randomUUID();
      const storageKey = `${keys.original(exp.ownerId, exp.projectId, assetId, `.${exp.settings.format}`)}`;
      await storage.putFile(storageKey, out, mime);
      const stat = await fs.stat(out);
      await db.insert(schema.assets).values({
        id: assetId,
        projectId: exp.projectId,
        ownerId: exp.ownerId,
        kind: 'video',
        source: 'render',
        status: 'ready',
        name: `Export r${exp.revision}.${exp.settings.format}`,
        storageKey,
        mime,
        sizeBytes: stat.size,
        durationMs: Math.round(plan.durationSec * 1000),
        width,
        height,
      });
      if ((await exportStatus(exp.id)) === 'canceled') return;
      await db
        .update(schema.exportsTable)
        .set({ status: 'succeeded', progress: 100, outputAssetId: assetId, completedAt: new Date() })
        .where(eq(schema.exportsTable.id, exp.id));
      log('export succeeded', { exportId, bytes: stat.size });
    } catch (err) {
      await fail(err);
    } finally {
      clearInterval(cancelPoll);
    }
  });
}

/* ---------------- maintenance ---------------- */

/** pg_dump | gzip → object storage, then prune backups past the retention window. */
export async function backupDatabase(log: Log) {
  await withTmp(async (dir) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, 'backup.sql.gz');
    const dump = spawn(config.PG_DUMP_PATH, ['--no-owner', '--no-privileges', config.DATABASE_URL], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    dump.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const exited = new Promise<number>((resolve, reject) => {
      dump.on('error', reject);
      dump.on('close', (code) => resolve(code ?? 1));
    });
    await pipeline(dump.stdout, createGzip(), createWriteStream(file));
    const code = await exited;
    if (code !== 0) throw new Error(`pg_dump failed: ${stderr.slice(-500)}`);
    await storage.putFile(keys.backup(stamp), file, 'application/gzip');

    const cutoff = Date.now() - config.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const old = (await storage.list('backups/postgres/')).filter((o) => o.lastModified.getTime() < cutoff);
    for (const o of old) await storage.delete(o.key);
    log('backup stored', { key: keys.backup(stamp), pruned: old.length });
  });
}

/** Removes abandoned uploads and expired sessions. */
export async function cleanup(log: Log) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.status, 'pending_upload'), lt(schema.assets.createdAt, dayAgo)));
  for (const a of stale) {
    await storage.delete(a.storageKey).catch(() => undefined);
    await db.delete(schema.assets).where(eq(schema.assets.id, a.id));
  }
  await purgeExpiredSessions();
  if (stale.length) log('cleanup', { abandonedUploads: stale.length });
}
