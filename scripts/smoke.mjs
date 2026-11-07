#!/usr/bin/env node
// End-to-end smoke test against a running API and worker.
//   node scripts/smoke.mjs [baseUrl]
// Creates a throwaway Clerk user, uploads media, generates a scene, edits the
// timeline, exports, and checks the downloaded file with ffprobe.
//
// Needs CLERK_SECRET_KEY (from the environment or the repo-root .env) and the API
// must be running with keys from the same Clerk instance. Use a development
// instance: this creates and deletes a real user there.
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
const CLERK_API = 'https://api.clerk.com/v1';
const CLERK_KEY = process.env.CLERK_SECRET_KEY;
if (!CLERK_KEY) {
  console.error('CLERK_SECRET_KEY is not set (put it in .env or the environment).');
  process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mitome-smoke-'));

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
let token = null;
let tokenAt = 0;
async function getToken() {
  if (token && Date.now() - tokenAt < 40_000) return token;
  token = (await clerk('POST', `/sessions/${sessionId}/tokens`)).jwt;
  tokenAt = Date.now();
  return token;
}

async function api(method, url, body, { auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth && sessionId) headers.authorization = `Bearer ${await getToken()}`;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  return { status: res.status, json };
}

function ok(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function poll(fn, what, timeoutMs = 120_000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function upload(projectId, file, mime) {
  const size = fs.statSync(file).size;
  const t = await api('POST', `/api/projects/${projectId}/uploads`, { name: path.basename(file), mime, size });
  ok(t.status === 201, `upload ticket for ${path.basename(file)}`);
  const url = t.json.uploadUrl.startsWith('http') ? t.json.uploadUrl : BASE + t.json.uploadUrl;
  const put = await fetch(url, { method: 'PUT', headers: t.json.headers, body: fs.readFileSync(file) });
  ok(put.ok, `PUT ${path.basename(file)} to storage (${put.status})`);
  const done = await api('POST', `/api/assets/${t.json.asset.id}/complete`);
  ok(done.status === 200, 'upload completed');
  return t.json.asset.id;
}

async function assetReady(projectId, id) {
  const p = await api('GET', `/api/projects/${projectId}`);
  const a = p.json.project.assets.find((x) => x.id === id);
  if (a?.status === 'failed') throw new Error(`asset failed: ${a.error}`);
  return a?.status === 'ready' ? a : null;
}

console.log(`Smoke test against ${BASE}`);
const email = `smoke-${Date.now()}@example.com`;

try {
  console.log('Auth');
  ok((await api('GET', '/api/auth/me')).status === 401, 'anonymous request is rejected');
  const badToken = await fetch(BASE + '/api/auth/me', { headers: { authorization: 'Bearer not-a-real-token' } });
  ok(badToken.status === 401, 'invalid token is rejected');
  clerkUserId = (await clerk('POST', '/users', { email_address: [email], password: `Smoke-${Date.now()}-pass!`, skip_password_checks: true })).id;
  sessionId = (await clerk('POST', '/sessions', { user_id: clerkUserId })).id;
  ok(Boolean(clerkUserId && sessionId), 'created a throwaway Clerk user and session');
  const me = await api('GET', '/api/auth/me');
  ok(me.status === 200 && me.json.user.email === email, 'Clerk token is accepted and the user row is created');
  const again = await api('GET', '/api/auth/me');
  ok(again.json.user.id === me.json.user.id, 'second request reuses the same user');


  console.log('Project');
  const created = await api('POST', '/api/projects', { title: 'Smoke test' });
  ok(created.status === 201, 'create project');
  const pid = created.json.project.id;

  console.log('Uploads');
  const clip = path.join(tmp, 'clip.mp4');
  const voice = path.join(tmp, 'voice.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=3', '-shortest', '-pix_fmt', 'yuv420p', clip]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', voice]);
  const clipId = await upload(pid, clip, 'video/mp4');
  const voiceId = await upload(pid, voice, 'audio/wav');
  const clipAsset = await poll(() => assetReady(pid, clipId), 'video processing');
  ok(Math.abs(clipAsset.durationSec - 3) < 0.2 && clipAsset.thumbUrl, 'video probed with a thumbnail');
  const voiceAsset = await poll(() => assetReady(pid, voiceId), 'audio processing');
  ok(voiceAsset.kind === 'audio' && !voiceAsset.thumbUrl, 'audio probed');

  console.log('Generation');
  const gen = await api('POST', `/api/projects/${pid}/generations`, { prompt: 'A lighthouse at dusk, slow push in', model: 'demo', durationSec: 2 });
  ok(gen.status === 201, 'generation queued');
  const genAsset = await poll(() => assetReady(pid, gen.json.asset.id), 'generation');
  ok(genAsset.source === 'generation' && genAsset.durationSec > 1.5, 'generated scene is ready');

  console.log('Timeline');
  let project = (await api('GET', `/api/projects/${pid}`)).json.project;
  const timeline = {
    schemaVersion: 1,
    video: [
      { id: 'v1', assetId: clipId, name: 'Upload', start: 0, duration: 2.5, trimIn: 0.25 },
      { id: 'v2', assetId: null, name: 'Scene not generated', start: 2.5, duration: 1, trimIn: 0, prompt: 'TBD' },
      { id: 'v3', assetId: genAsset.id, name: 'Lighthouse', start: 3.5, duration: 2, trimIn: 0 },
    ],
    text: [{ id: 't1', text: "Smoke test: it's working", start: 0.5, duration: 2, position: 'bottom', size: 56 }],
    audio: [{ id: 'a1', assetId: voiceId, name: 'Voice', start: 1, duration: 3, trimIn: 0, volume: 0.8, fade: true }],
    music: [],
  };
  const save = await api('PUT', `/api/projects/${pid}/timeline`, { revision: project.revision, timeline });
  ok(save.status === 200 && save.json.revision === project.revision + 1, 'timeline saved, revision bumped');
  const stale = await api('PUT', `/api/projects/${pid}/timeline`, { revision: project.revision, timeline });
  ok(stale.status === 409, 'stale save is rejected with 409');
  const bad = await api('PUT', `/api/projects/${pid}/timeline`, {
    revision: save.json.revision,
    timeline: { ...timeline, audio: [{ ...timeline.audio[0], assetId: '00000000-0000-4000-8000-000000000000' }] },
  });
  ok(bad.status === 400, "another project's asset id is rejected");

  console.log('Export');
  for (const format of ['mp4', 'gif']) {
    const e = await api('POST', `/api/projects/${pid}/exports`, { format, resolution: '720p', fps: 24 });
    ok(e.status === 201, `${format} export queued`);
    const done = await poll(async () => {
      const r = await api('GET', `/api/exports/${e.json.export.id}`);
      if (r.json.export.status === 'failed') throw new Error(`export failed: ${r.json.export.error}`);
      return r.json.export.status === 'succeeded' ? r.json.export : null;
    }, `${format} export`);
    const url = done.downloadUrl.startsWith('http') ? done.downloadUrl : BASE + done.downloadUrl;
    const file = path.join(tmp, `out.${format}`);
    fs.writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString());
    const v = probe.streams.find((s) => s.codec_type === 'video');
    const dur = Number(probe.format.duration);
    ok(v.width === (format === 'gif' ? 640 : 1280), `${format}: width ${v.width}`);
    ok(Math.abs(dur - 5.5) < 0.3, `${format}: duration ${dur.toFixed(2)}s matches the 5.5s timeline`);
    if (format === 'mp4') ok(probe.streams.some((s) => s.codec_type === 'audio'), 'mp4 has an audio track');
  }

  console.log('Guardrails');
  const tooBig = await api('POST', `/api/projects/${pid}/uploads`, { name: 'huge.mp4', mime: 'video/mp4', size: 50 * 1024 ** 3 });
  ok(tooBig.status === 413, 'oversized upload is refused before any bytes move');
  const wrongType = await api('POST', `/api/projects/${pid}/uploads`, { name: 'x.exe', mime: 'application/x-msdownload', size: 10 });
  ok(wrongType.status === 415, 'non-media upload is refused');

  console.log('\nAll checks passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (clerkUserId) {
    await fetch(`${CLERK_API}/users/${clerkUserId}`, { method: 'DELETE', headers: { authorization: `Bearer ${CLERK_KEY}` } }).catch(() => undefined);
  }
}
