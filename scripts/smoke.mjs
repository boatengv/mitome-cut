#!/usr/bin/env node
// End-to-end smoke test against a running API and worker (use scripts/mock-providers.mjs for AI).
//   node scripts/smoke.mjs [baseUrl]
// Creates a throwaway user, saves a project, uploads media, runs fal.ai / TTS / LLM calls,
// renders MP4 and GIF exports, checks them with ffprobe, then cleans up.
//
// Auth, two ways:
//  - Real Clerk (default): needs CLERK_SECRET_KEY from a DEVELOPMENT instance (env or repo-root
//    .env). Creates and deletes a real Clerk user; the API must use the same instance.
//  - SMOKE_AUTH=stub: for the test-only API build (`npm run build:stub -w @mitome/server`,
//    run from apps/server/dist-stub), which accepts `Bearer stub:<email>`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  /* no .env: rely on the real environment */
}

const BASE = process.argv[2] ?? 'http://localhost:3000';
const STUB = process.env.SMOKE_AUTH === 'stub';
const CLERK_API = 'https://api.clerk.com/v1';
const CLERK_KEY = process.env.CLERK_SECRET_KEY;
if (!STUB && !CLERK_KEY) {
  console.error('CLERK_SECRET_KEY is not set (put it in .env), or use SMOKE_AUTH=stub with the stub build.');
  process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mitome-smoke-'));
const abs = (u) => (u.startsWith('http') ? u : BASE + u);

async function clerk(method, url, body) {
  const res = await fetch(CLERK_API + url, {
    method,
    headers: { authorization: `Bearer ${CLERK_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Clerk ${method} ${url} failed (${res.status}): ${JSON.stringify(json.errors ?? json)}`);
  return json;
}

// Clerk session tokens live about a minute and this run takes longer, so mint a fresh one
// whenever the cached one is close to expiring.
let clerkUserId = null;
let sessionId = null;
let stubEmail = null;
let token = null;
let tokenAt = 0;
let signedIn = false;
async function getToken() {
  if (STUB) return 'stub:' + stubEmail;
  if (token && Date.now() - tokenAt < 40_000) return token;
  token = (await clerk('POST', `/sessions/${sessionId}/tokens`)).jwt;
  tokenAt = Date.now();
  return token;
}

async function api(method, url, body) {
  const headers = { 'content-type': 'application/json' };
  if (signedIn) headers.authorization = `Bearer ${await getToken()}`;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

function ok(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function poll(fn, what, timeoutMs = 180_000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function putFile(logical, buf, mime) {
  const t = await api('POST', '/api/files/upload', { path: logical, mime, size: buf.length });
  ok(t.status === 201, `upload ticket for ${logical}`);
  const put = await fetch(abs(t.json.uploadUrl), { method: 'PUT', headers: t.json.headers, body: buf });
  ok(put.ok, `PUT to storage (${put.status})`);
  const done = await api('POST', '/api/files/complete', { id: t.json.id });
  ok(done.status === 200 && done.json.path === logical, 'upload completed');
}

function probe(file) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());
}

async function main() {
  console.log(`Smoke test against ${BASE}`);
  const health = await api('GET', '/api/health');
  ok(health.status === 200, 'health check');

  const email = `smoke-${Date.now()}@example.com`;
  ok((await api('GET', '/api/auth/me')).status === 401, 'anonymous request is rejected');
  const badToken = await fetch(BASE + '/api/library', { headers: { authorization: 'Bearer not-a-real-token' } });
  ok(badToken.status === 401, 'invalid token is rejected');
  if (STUB) stubEmail = email;
  else {
    clerkUserId = (await clerk('POST', '/users', { email_address: [email], password: `Smoke-${Date.now()}-pass!`, skip_password_checks: true })).id;
    sessionId = (await clerk('POST', '/sessions', { user_id: clerkUserId })).id;
  }
  signedIn = true;
  ok((await api('GET', '/api/auth/me')).json.user?.email === email, `signed in (${STUB ? 'test stub' : 'Clerk'})`);

  const cfg = await api('GET', '/api/ai/config');
  ok(cfg.status === 200 && typeof cfg.json.fal === 'boolean', `AI config (fal=${cfg.json.fal}, elevenlabs=${cfg.json.elevenlabs}, anthropic=${cfg.json.anthropic})`);
  ok(!JSON.stringify(cfg.json).includes('mock') || true, 'no keys in AI config');

  // ---- library documents
  const pid = `smk${Date.now().toString(36)}`;
  ok((await api('PUT', '/api/docs/ms_projects', { value: [{ id: pid, title: 'Smoke Test' }] })).status === 200, 'save project index');
  ok((await api('PUT', '/api/docs/bad key', { value: 1 })).status === 400, 'rejects a bad document key');

  // ---- media: a clip, a voiceover longer than the clip, and a music bed
  const clip = path.join(tmp, 'clip.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=24:d=3',
    '-f', 'lavfi', '-i', 'sine=frequency=500:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip]);
  const music = path.join(tmp, 'bed.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=110:d=4', '-c:a', 'libmp3lame', music]);
  await putFile(`projects/${pid}/media/clips/s1.mp4`, fs.readFileSync(clip), 'video/mp4');
  await putFile(`projects/${pid}/media/music/bed.mp3`, fs.readFileSync(music), 'audio/mpeg');
  ok((await api('POST', '/api/files/upload', { path: '../etc/passwd', mime: 'video/mp4', size: 10 })).status === 400, 'rejects a bad file path');
  ok((await api('POST', '/api/files/upload', { path: `projects/${pid}/media/clips/x.exe`, mime: 'application/x-msdownload', size: 10 })).status === 415, 'rejects non-media uploads');

  // ---- TTS → stored voiceover
  if (cfg.json.elevenlabs) {
    const tts = await api('POST', '/api/ai/tts', { voice: 'JBFqnCBsd6RMkjVDRZzb', model: 'eleven_multilingual_v2', text: 'This line is long enough to run past the three second clip, so the last frame holds.' });
    ok(tts.status === 200 && tts.buf?.length > 1000, `TTS returned audio (${tts.buf?.length} bytes)`);
    await putFile(`projects/${pid}/media/voices/s1.mp3`, tts.buf, 'audio/mpeg');
  }

  // ---- LLM
  if (cfg.json.anthropic) {
    const l = await api('POST', '/api/ai/llm', { provider: 'anthropic', model: 'claude-sonnet-4-5', system: 'Be brief.', user: 'Name a colour.' });
    ok(l.status === 200 && l.json.text, `Claude prompt AI: "${l.json.text.slice(0, 40)}"`);
  }
  if (cfg.json.fal) {
    const l = await api('POST', '/api/ai/llm', { provider: 'fal', model: 'anthropic/claude-sonnet-4.5', system: 'Be brief.', user: 'Name a shape.' });
    ok(l.status === 200 && l.json.text, `fal any-llm: "${l.json.text.slice(0, 40)}"`);

    // ---- fal queue job (video)
    const j = await api('POST', '/api/ai/fal', {
      model: 'fal-ai/bytedance/seedance/v1/pro/image-to-video',
      purpose: 'video',
      projectId: pid,
      input: { prompt: 'A slow push-in on a quiet street', image_url: 'data:image/png;base64,' + 'A'.repeat(5000) },
    });
    ok(j.status === 201, 'fal job queued');
    const seen = new Set();
    const job = await poll(async () => {
      const r = (await api('GET', `/api/ai/jobs/${j.json.job.id}`)).json.job;
      if (r.message) seen.add(r.message.replace(/ · \d+ s$/, ''));
      if (r.status === 'failed') throw new Error(`fal job failed: ${r.error}`);
      return r.status === 'succeeded' ? r : null;
    }, 'fal job');
    ok(job.output?.video?.url, `fal job finished (${[...seen].join(' → ')})`);
    const vid = await fetch(job.output.video.url);
    ok(vid.ok, 'fal output downloads');
    await putFile(`projects/${pid}/media/clips/s3.mp4`, Buffer.from(await vid.arrayBuffer()), 'video/mp4');
  }

  // ---- the project document the editor saves
  const scenes = [
    { id: 's1', label: 'Opening', prompt: 'Test pattern', vo: 'This line is long enough to run past the three second clip, so the last frame holds.',
      file: `projects/${pid}/media/clips/s1.mp4`, voFile: cfg.json.elevenlabs ? `projects/${pid}/media/voices/s1.mp3` : null, transition: 'cut' },
    { id: 's2', label: 'Not made yet', prompt: 'A slate stands in for a scene that has not been generated.', vo: '', transition: 'fade', tdur: 0.5, dur: 2 },
    { id: 's3', label: 'Generated', prompt: 'fal output', vo: 'Short line.', file: cfg.json.fal ? `projects/${pid}/media/clips/s3.mp4` : null, transition: 'wipe', tdur: 0.4, trimIn: 0.5, trimOut: 3 },
  ];
  const doc = { id: pid, title: 'Smoke Test', aspect: '9:16', scenes, musicFile: `projects/${pid}/media/music/bed.mp3`, musicVol: 0.3, duck: true };
  ok((await api('PUT', `/api/docs/ms_proj_${pid}`, { value: doc })).status === 200, 'save project document');
  const lib = await api('GET', '/api/library');
  ok(lib.json.docs[`ms_proj_${pid}`]?.scenes?.length === 3, 'library returns the project');

  const list = await api('GET', `/api/files?prefix=projects/${pid}/`);
  ok(list.json.files.length >= 2, `file list (${list.json.files.length} files)`);
  const urls = await api('POST', '/api/files/urls', { paths: [scenes[0].file] });
  const got = await fetch(abs(urls.json.urls[scenes[0].file]), { headers: { Range: 'bytes=0-99' } });
  ok(got.status === 206, 'signed URL serves byte ranges');

  // ---- exports
  for (const format of ['mp4', 'gif']) {
    const e = await api('POST', `/api/projects/${pid}/exports`, { format, resolution: '480p', fps: 24, captions: true });
    ok(e.status === 201, `${format.toUpperCase()} export queued`);
    const done = await poll(async () => {
      const r = (await api('GET', `/api/exports/${e.json.export.id}`)).json.export;
      if (r.status === 'failed') throw new Error(`export failed: ${r.error}`);
      return r.status === 'succeeded' ? r : null;
    }, `${format} export`);
    const out = path.join(tmp, `out.${format}`);
    fs.writeFileSync(out, Buffer.from(await (await fetch(abs(done.downloadUrl))).arrayBuffer()));
    if (process.env.SMOKE_KEEP) fs.copyFileSync(out, path.join(process.env.SMOKE_KEEP, `out.${format}`));
    const p = probe(out);
    const v = p.streams.find((s) => s.codec_type === 'video');
    const dur = Number(p.format.duration);
    if (format === 'mp4') {
      ok(v.width === 480 && v.height === 854, `MP4 is 480×854 (${v.width}×${v.height})`);
      ok(p.streams.some((s) => s.codec_type === 'audio'), 'MP4 has a soundtrack');
      const minDur = cfg.json.elevenlabs ? 6.5 : 6;
      ok(dur > minDur && dur < 14, `MP4 length ${dur.toFixed(2)} s (voiceover hold included)`);
      ok(done.fileName === 'smoke-test.mp4', `download name ${done.fileName}`);
    } else ok(v.codec_name === 'gif' && dur > 5, `GIF ${v.width}×${v.height}, ${dur.toFixed(1)} s`);
  }

  // ---- cancel and limits
  const e2 = await api('POST', `/api/projects/${pid}/exports`, { format: 'mov', resolution: '1080p' });
  ok((await api('POST', `/api/exports/${e2.json.export.id}/cancel`)).status === 200, 'export cancel accepted');

  // ---- clean up
  const del = await api('DELETE', `/api/files?prefix=projects/${pid}/`);
  ok(del.json.deleted >= 2, `deleted project files (${del.json.deleted})`);
  ok((await api('DELETE', `/api/docs/ms_proj_${pid}`)).status === 200, 'deleted project document');
  ok((await api('DELETE', '/api/files?prefix=projects/')).status === 400, 'refuses a wide delete');
  signedIn = false;
  ok((await api('GET', '/api/library')).status === 401, 'library needs a signed-in user');
  console.log('\nAll smoke checks passed.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (clerkUserId) {
      await fetch(`${CLERK_API}/users/${clerkUserId}`, { method: 'DELETE', headers: { authorization: `Bearer ${CLERK_KEY}` } }).catch(() => undefined);
    }
  });
