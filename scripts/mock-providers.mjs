#!/usr/bin/env node
// Stand-in for fal.ai, ElevenLabs and the Claude API, for local tests without keys.
//   node scripts/mock-providers.mjs [port]
// Then run the API and worker with:
//   FAL_KEY=mock FAL_QUEUE_URL=http://localhost:4010/queue FAL_RUN_URL=http://localhost:4010/run
//   ELEVENLABS_API_KEY=mock ELEVENLABS_URL=http://localhost:4010
//   ANTHROPIC_API_KEY=mock ANTHROPIC_URL=http://localhost:4010
// Generated media are small FFmpeg test patterns. No credits are spent.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.argv[2] ?? 4010);
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitome-mock-'));
const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);

ff('-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=24:d=5', '-f', 'lavfi', '-i', 'sine=frequency=330:d=5',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'clip.mp4'));
ff('-f', 'lavfi', '-i', 'testsrc2=s=1024x1024', '-frames:v', '1', path.join(dir, 'image.png'));

const jobs = new Map(); // id -> { polls, model, canceled }
const log = (...a) => console.log('[mock]', ...a);

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let s = '';
  for await (const c of req) s += c;
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, BASE);
    const p = url.pathname;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
      return res.end();
    }
    if (p.startsWith('/media/')) {
      const f = path.join(dir, path.basename(p));
      if (!fs.existsSync(f)) return send(res, 404, { error: 'missing' });
      return send(res, 200, fs.readFileSync(f), f.endsWith('.png') ? 'image/png' : 'video/mp4');
    }

    // fal.ai queue
    const sub = p.match(/^\/queue\/(fal-ai\/.+)$/);
    if (req.method === 'POST' && sub && !p.includes('/requests/')) {
      const body = await readJson(req);
      const id = randomUUID();
      jobs.set(id, { polls: 0, model: sub[1], canceled: false });
      log('fal submit', sub[1], Object.keys(body).join(','));
      const r = `${BASE}/queue/requests/${id}`;
      return send(res, 200, { request_id: id, status_url: `${r}/status`, response_url: r, cancel_url: `${r}/cancel` });
    }
    const st = p.match(/^\/queue\/requests\/([^/]+)(\/status|\/cancel)?$/);
    if (st) {
      const job = jobs.get(st[1]);
      if (!job) return send(res, 404, { detail: 'not found' });
      if (st[2] === '/cancel') {
        job.canceled = true;
        log('fal cancel', st[1]);
        return send(res, 202, { status: 'CANCELLATION_REQUESTED' });
      }
      if (st[2] === '/status') {
        job.polls++;
        if (job.polls === 1) return send(res, 200, { status: 'IN_QUEUE', queue_position: 2 });
        if (job.polls === 2) return send(res, 200, { status: 'IN_PROGRESS' });
        return send(res, 200, { status: 'COMPLETED' });
      }
      const isVideo = /video|seedance|kling|veo|wan|hailuo|ltx/i.test(job.model);
      return send(res, 200, isVideo ? { video: { url: `${BASE}/media/clip.mp4` } } : { images: [{ url: `${BASE}/media/image.png` }] });
    }

    // fal.ai sync (any-llm)
    if (req.method === 'POST' && p.startsWith('/run/')) {
      const body = await readJson(req);
      return send(res, 200, { output: `MOCK ANSWER: ${String(body.prompt ?? '').slice(0, 60)}` });
    }

    // ElevenLabs TTS: a tone whose length follows the text (about 15 characters a second)
    const tts = p.match(/^\/v1\/text-to-speech\/([^/]+)$/);
    if (req.method === 'POST' && tts) {
      const body = await readJson(req);
      const secs = Math.max(1, Math.min(30, String(body.text ?? '').length / 15)).toFixed(2);
      const out = path.join(dir, `tts-${randomUUID()}.mp3`);
      ff('-f', 'lavfi', '-i', `sine=frequency=220:d=${secs}`, '-c:a', 'libmp3lame', '-b:a', '64k', out);
      log('tts', tts[1], `${secs}s`);
      const buf = fs.readFileSync(out);
      fs.rmSync(out);
      return send(res, 200, buf, 'audio/mpeg');
    }

    // Claude messages
    if (req.method === 'POST' && p === '/v1/messages') {
      const body = await readJson(req);
      const user = String(body.messages?.[0]?.content ?? '');
      return send(res, 200, { content: [{ type: 'text', text: `MOCK CLAUDE: ${user.slice(0, 60)}` }] });
    }

    send(res, 404, { error: 'no mock for ' + p });
  })
  .listen(PORT, () => log(`listening on ${BASE}`));
