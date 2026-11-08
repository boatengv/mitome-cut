import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { frameSize, sceneForRender, type ExportSettings } from '@mitome/shared';
import { config } from './config.js';
import { db, schema } from './db/client.js';
import { ffprobe, runFfmpeg, type ProbeResult } from './media/ffmpeg.js';
import { audioPlan, captionEvents, captionsAss, planTimings, xfadeName, type AudioSource, type SceneInput } from './media/scenes.js';
import { falCancel, falResult, falStatus, falSubmit } from './ai.js';
import { purgeExpiredSessions } from './auth.js';
import { keys, storage } from './storage/index.js';

type Log = (msg: string, extra?: Record<string, unknown>) => void;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1000);

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(config.TMP_DIR || os.tmpdir(), 'mitome-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/* ======================= fal.ai jobs ======================= */

/** Replaces inline data URLs (start frames) so stored job inputs stay small. */
function redact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = typeof v === 'string' && v.startsWith('data:') ? `[data URL, ${Math.round(v.length / 1024)} KB]` : v;
  }
  return out;
}

async function jobStatus(id: string) {
  const [r] = await db.select({ status: schema.aiJobs.status }).from(schema.aiJobs).where(eq(schema.aiJobs.id, id));
  return r?.status;
}

export async function runAiJob(jobId: string, log: Log) {
  const [job] = await db.select().from(schema.aiJobs).where(eq(schema.aiJobs.id, jobId));
  if (!job || job.status !== 'queued') return;
  const setMsg = (message: string) => db.update(schema.aiJobs).set({ message }).where(eq(schema.aiJobs.id, jobId));
  await db.update(schema.aiJobs).set({ status: 'running', message: 'Submitting' }).where(eq(schema.aiJobs.id, jobId));
  try {
    const sub = await falSubmit(job.model, job.input);
    await db
      .update(schema.aiJobs)
      .set({ providerRequestId: sub.request_id, input: redact(job.input), message: 'In queue' })
      .where(eq(schema.aiJobs.id, jobId));
    const t0 = Date.now();
    let last = '';
    for (;;) {
      await sleep(3000);
      if ((await jobStatus(jobId)) === 'canceled') {
        await falCancel(sub.cancel_url);
        log('ai job canceled', { jobId });
        return;
      }
      if (Date.now() - t0 > config.AI_JOB_TIMEOUT_MIN * 60_000) throw new Error(`Timed out after ${config.AI_JOB_TIMEOUT_MIN} minutes`);
      const st = await falStatus(sub.status_url);
      if (st.status === 'COMPLETED') break;
      if (st.status === 'FAILED' || st.error) throw new Error(`fal.ai: ${st.error ?? 'failed'}`);
      const secs = Math.round((Date.now() - t0) / 1000);
      const msg = (st.status === 'IN_QUEUE' ? `In queue${st.queue_position != null ? ` (#${st.queue_position})` : ''}` : 'Generating') + ` · ${secs} s`;
      if (msg !== last) {
        last = msg;
        await setMsg(msg);
      }
    }
    const output = await falResult(sub.response_url);
    await db
      .update(schema.aiJobs)
      .set({ status: 'succeeded', output: output as object, message: 'Done', completedAt: new Date() })
      .where(eq(schema.aiJobs.id, jobId));
    log('ai job succeeded', { jobId, model: job.model, secs: Math.round((Date.now() - t0) / 1000) });
  } catch (err) {
    await db
      .update(schema.aiJobs)
      .set({ status: 'failed', error: errMsg(err), message: null, completedAt: new Date() })
      .where(eq(schema.aiJobs.id, jobId));
    log('ai job failed', { jobId, error: errMsg(err) });
  }
}

/* ======================= Scene render ======================= */

interface ProjectDoc {
  title?: string;
  aspect?: string;
  scenes?: unknown[];
  musicFile?: string | null;
  musicVol?: number;
  duck?: boolean;
}

const enc = (fps: number) => [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-r', String(fps), '-video_track_timescale', '90000', '-an',
];

function wrapText(text: string, width: number, maxLines: number) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) return lines.join('\n') + '…';
    } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

async function lastFrame(video: string, png: string) {
  await runFfmpeg(['-sseof', '-0.3', '-i', video, '-update', '1', '-q:v', '2', png]);
}

async function concatCopy(parts: string[], out: string, dir: string, name: string) {
  const list = path.join(dir, `${name}.txt`);
  await fs.writeFile(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
}

export async function renderExport(exportId: string, log: Log) {
  const [row] = await db.select().from(schema.exportsTable).where(eq(schema.exportsTable.id, exportId));
  if (!row || row.status !== 'queued') return;
  const setProgress = (p: number) =>
    db.update(schema.exportsTable).set({ progress: Math.max(1, Math.min(99, Math.round(p))) }).where(eq(schema.exportsTable.id, exportId));
  const exportStatus = async () =>
    (await db.select({ s: schema.exportsTable.status }).from(schema.exportsTable).where(eq(schema.exportsTable.id, exportId)))[0]?.s;
  await db.update(schema.exportsTable).set({ status: 'running', progress: 1 }).where(eq(schema.exportsTable.id, exportId));

  const settings = row.settings as ExportSettings;
  const doc = row.snapshot as ProjectDoc;
  const controller = new AbortController();
  const cancelPoll = setInterval(async () => {
    if ((await exportStatus().catch(() => undefined)) === 'canceled') controller.abort();
  }, 2000);

  try {
    await withTmp(async (dir) => {
      const scenes = (doc.scenes ?? []).map((s) => sceneForRender.parse(s));
      const { width: W, height: H } = frameSize(doc.aspect === '9:16' ? '9:16' : '16:9', settings.resolution);
      const fps = settings.fps;

      // Fetch every file the project uses.
      const wanted = [...new Set([...scenes.flatMap((s) => [s.file, s.voFile]), doc.musicFile].filter((p): p is string => !!p))];
      const rows = wanted.length
        ? await db
            .select()
            .from(schema.files)
            .where(and(eq(schema.files.ownerId, row.ownerId), eq(schema.files.status, 'ready'), inArray(schema.files.path, wanted)))
        : [];
      const local = new Map<string, { file: string; probe: ProbeResult }>();
      for (const [i, f] of rows.entries()) {
        const file = path.join(dir, `in-${i}${path.extname(f.path)}`);
        await storage.getToFile(f.storageKey, file);
        try {
          local.set(f.path, { file, probe: await ffprobe(file) });
        } catch {
          /* unreadable file: the scene falls back to a slate */
        }
      }
      if (controller.signal.aborted) throw new Error('Canceled');

      const inputs: SceneInput[] = scenes.map((s, index) => {
        const clip = s.file ? local.get(s.file) : undefined;
        const vo = s.voFile ? local.get(s.voFile) : undefined;
        const isVideo = !!clip && clip.probe.hasVideo && !clip.probe.isImage && (clip.probe.durationSec ?? 0) > 0.1;
        return {
          index,
          label: s.label,
          prompt: s.prompt || s.vo,
          vo: s.vo,
          kind: isVideo ? 'video' : 'slate',
          clipDur: clip?.probe.durationSec ?? 0,
          trimIn: s.trimIn,
          trimOut: s.trimOut ?? null,
          dur: s.dur,
          voDur: vo?.probe.durationSec ?? 0,
          transition: s.transition,
          tdur: s.tdur,
        };
      });
      const timings = planTimings(inputs);
      const total = timings.reduce((a, t) => a + t.len, 0);

      /* ---- 1. one video segment per scene, at the final size ---- */
      const segs: string[] = [];
      let prevLast: string | null = null;
      for (const [i, s] of inputs.entries()) {
        if (controller.signal.aborted) throw new Error('Canceled');
        const tm = timings[i]!;
        const body = path.join(dir, `body-${i}.mp4`);
        if (s.kind === 'video') {
          const clip = local.get(scenes[i]!.file!)!;
          const part = path.join(dir, `part-${i}.mp4`);
          await runFfmpeg(
            [
              '-ss', String(s.trimIn), '-t', String(tm.clipLen), '-i', clip.file,
              '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},format=yuv420p,tpad=stop_mode=clone:stop_duration=${tm.clipLen}`,
              '-t', String(tm.clipLen), ...enc(fps), part,
            ],
            { signal: controller.signal },
          );
          if (tm.holdLen > 0.02) {
            // Voiceover runs longer than the clip: hold the last frame with a slow push-in.
            const still = path.join(dir, `still-${i}.png`);
            const hold = path.join(dir, `hold-${i}.mp4`);
            await lastFrame(part, still);
            const frames = Math.max(1, Math.round(tm.holdLen * fps));
            await runFfmpeg(
              [
                '-loop', '1', '-framerate', String(fps), '-i', still,
                '-vf', `scale=${W * 2}:${H * 2},zoompan=z='min(1+0.05*on/(4*${fps}),1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${fps},format=yuv420p`,
                '-frames:v', String(frames), ...enc(fps), hold,
              ],
              { signal: controller.signal },
            );
            await concatCopy([part, hold], body, dir, `cat-${i}`);
          } else await fs.rename(part, body);
        } else {
          // Not generated yet (or a demo placeholder): a slate with the scene's description.
          const title = path.join(dir, `title-${i}.txt`);
          const desc = path.join(dir, `desc-${i}.txt`);
          const titleText = `Scene ${i + 1}${s.label ? ' · ' + s.label : ''}`;
          await fs.writeFile(title, titleText);
          await fs.writeFile(desc, `Not generated yet\n\n${wrapText(s.prompt || 'No description', W > H ? 52 : 30, 6)}`);
          // Fit the title to 80% of the width (DejaVu Bold averages about 0.62 em per character).
          const fs1 = Math.round(Math.min(Math.min(W, H) * 0.045, (W * 0.8) / (titleText.length * 0.62)));
          const fs2 = Math.round(Math.min(W, H) * 0.028);
          await runFfmpeg(
            [
              '-f', 'lavfi', '-i', `color=c=0x0B0B0D:s=${W}x${H}:r=${fps}:d=${tm.len}`,
              '-vf',
              [
                `drawbox=x=iw*0.05:y=ih*0.05:w=iw*0.9:h=ih*0.9:color=white@0.12:t=2`,
                `drawtext=fontfile='${config.FONT_PATH}':textfile='${title}':fontcolor=0xFF8F52:fontsize=${fs1}:x=w*0.1:y=h*0.28`,
                `drawtext=fontfile='${config.FONT_PATH}':textfile='${desc}':fontcolor=0x9C9CA6:fontsize=${fs2}:line_spacing=${Math.round(fs2 * 0.4)}:x=w*0.1:y=h*0.28+${Math.round(fs1 * 1.8)}`,
              ].join(','),
              '-t', String(tm.len), ...enc(fps), body,
            ],
            { signal: controller.signal },
          );
        }

        // Transition in: from the previous scene's last frame, over this scene's opening.
        const seg = path.join(dir, `seg-${i}.mp4`);
        const xf = i > 0 ? xfadeName(s.transition) : null;
        const d = Math.min(s.tdur, tm.len - 0.05, 2);
        if (xf && prevLast && d > 0.04) {
          await runFfmpeg(
            [
              '-loop', '1', '-framerate', String(fps), '-t', String(d), '-i', prevLast, '-i', body,
              '-filter_complex',
              `[0:v]scale=${W}:${H},setsar=1,fps=${fps},format=yuv420p,settb=AVTB[a];[1:v]fps=${fps},format=yuv420p,settb=AVTB[b];[a][b]xfade=transition=${xf}:duration=${d}:offset=0,format=yuv420p[v]`,
              '-map', '[v]', '-t', String(tm.len), ...enc(fps), seg,
            ],
            { signal: controller.signal },
          );
        } else await fs.rename(body, seg);
        prevLast = path.join(dir, `last-${i}.png`);
        await lastFrame(seg, prevLast);
        segs.push(seg);
        await setProgress(5 + ((i + 1) / inputs.length) * 70);
      }

      const video = path.join(dir, 'video.mp4');
      await concatCopy(segs, video, dir, 'all');

      /* ---- 2. soundtrack, captions and the final encode ---- */
      const foreground: AudioSource[] = [];
      inputs.forEach((s, i) => {
        const tm = timings[i]!;
        const vo = scenes[i]!.voFile ? local.get(scenes[i]!.voFile!) : undefined;
        if (vo?.probe.hasAudio) foreground.push({ path: vo.file, at: tm.t0 });
        if (settings.clipAudio && s.kind === 'video') {
          const clip = local.get(scenes[i]!.file!)!;
          if (clip.probe.hasAudio) foreground.push({ path: clip.file, at: tm.t0, seek: s.trimIn, len: tm.clipLen });
        }
      });
      const music = doc.musicFile ? local.get(doc.musicFile) : undefined;
      const audio = audioPlan({
        foreground,
        music: music?.probe.hasAudio ? { path: music.file, volume: doc.musicVol ?? 0.25, duck: doc.duck ?? true } : null,
        total,
        firstInput: 1,
      });

      let vchain = '[0:v]null';
      if (settings.captions) {
        const events = captionEvents(inputs, timings);
        if (events.length) {
          const ass = path.join(dir, 'captions.ass');
          await fs.writeFile(ass, captionsAss(events, W, H), 'utf8');
          vchain = `[0:v]subtitles='${ass}':fontsdir='${path.dirname(config.FONT_PATH)}'`;
        }
      }

      const ext = settings.format;
      const out = path.join(dir, `export.${ext}`);
      const onProgress = (sec: number) => void setProgress(75 + (sec / Math.max(0.1, total)) * 24);
      if (ext === 'gif') {
        const gw = Math.min(W, W > H ? 640 : 360);
        await runFfmpeg(
          [
            '-i', video,
            '-filter_complex', `${vchain},fps=12,scale=${gw}:-2:flags=lanczos,split[g1][g2];[g1]palettegen=stats_mode=diff[p];[g2][p]paletteuse=dither=bayer:bayer_scale=4[v]`,
            '-map', '[v]', '-loop', '0', out,
          ],
          { signal: controller.signal, onProgress },
        );
      } else {
        await runFfmpeg(
          [
            '-i', video, ...audio.inputs,
            '-filter_complex', `${vchain}[v];${audio.filter}`,
            '-map', '[v]', '-map', audio.out,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps),
            '-c:a', 'aac', '-b:a', '192k', '-t', String(total),
            ...(ext === 'mp4' ? ['-movflags', '+faststart'] : []),
            out,
          ],
          { signal: controller.signal, onProgress },
        );
      }
      if ((await exportStatus()) === 'canceled') return;

      /* ---- 3. store it as a project file ---- */
      const logical = `projects/${row.projectId}/media/renders/${row.id}.${ext}`;
      const storageKey = keys.file(row.ownerId, logical);
      const mime = ext === 'gif' ? 'image/gif' : ext === 'mov' ? 'video/quicktime' : 'video/mp4';
      await storage.putFile(storageKey, out, mime);
      const stat = await fs.stat(out);
      await db.insert(schema.files).values({ ownerId: row.ownerId, path: logical, storageKey, mime, sizeBytes: stat.size, status: 'ready' });
      await db
        .update(schema.exportsTable)
        .set({ status: 'succeeded', progress: 100, outputPath: logical, completedAt: new Date() })
        .where(eq(schema.exportsTable.id, exportId));
      log('export succeeded', { exportId, scenes: inputs.length, seconds: Math.round(total), bytes: stat.size });
    });
  } catch (err) {
    const canceled = (await exportStatus()) === 'canceled';
    if (!canceled) {
      await db
        .update(schema.exportsTable)
        .set({ status: 'failed', error: errMsg(err), completedAt: new Date() })
        .where(eq(schema.exportsTable.id, exportId));
    }
    log(canceled ? 'export canceled' : 'export failed', { exportId, error: errMsg(err) });
  } finally {
    clearInterval(cancelPoll);
  }
}

/* ======================= Maintenance ======================= */

/** pg_dump | gzip → object storage, then prune backups past the retention window. */
export async function backupDatabase(log: Log) {
  await withTmp(async (dir) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, 'backup.sql.gz');
    const dump = spawn(config.PG_DUMP_PATH, ['--no-owner', '--no-privileges', config.DATABASE_URL], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    dump.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const exited = new Promise<number>((resolve, reject) => {
      dump.on('error', reject);
      dump.on('close', (code) => resolve(code ?? 1));
    });
    await pipeline(dump.stdout, createGzip(), createWriteStream(file));
    if ((await exited) !== 0) throw new Error(`pg_dump failed: ${stderr.slice(-500)}`);
    await storage.putFile(keys.backup(stamp), file, 'application/gzip');
    const cutoff = Date.now() - config.BACKUP_RETENTION_DAYS * 864e5;
    const old = (await storage.list('backups/postgres/')).filter((o) => o.lastModified.getTime() < cutoff);
    for (const o of old) await storage.delete(o.key);
    log('backup stored', { key: keys.backup(stamp), pruned: old.length });
  });
}

/** Removes abandoned uploads and expired sessions, and fails jobs a crashed worker left running. */
export async function cleanup(log: Log) {
  const dayAgo = new Date(Date.now() - 864e5);
  const stale = await db
    .delete(schema.files)
    .where(and(eq(schema.files.status, 'pending'), lt(schema.files.createdAt, dayAgo)))
    .returning({ storageKey: schema.files.storageKey });
  await Promise.allSettled(stale.map((f) => storage.delete(f.storageKey)));
  await purgeExpiredSessions();
  const aiCutoff = new Date(Date.now() - (config.AI_JOB_TIMEOUT_MIN + 15) * 60_000);
  await db
    .update(schema.aiJobs)
    .set({ status: 'failed', error: 'Interrupted', completedAt: new Date() })
    .where(and(sql`${schema.aiJobs.status} in ('queued','running')`, lt(schema.aiJobs.createdAt, aiCutoff)));
  await db
    .update(schema.exportsTable)
    .set({ status: 'failed', error: 'Interrupted', completedAt: new Date() })
    .where(and(sql`${schema.exportsTable.status} in ('queued','running')`, lt(schema.exportsTable.createdAt, new Date(Date.now() - 2 * 3600_000))));
  if (stale.length) log('cleanup', { abandonedUploads: stale.length });
}
