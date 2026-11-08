/*
 * Mitome Cut – connects the editor (app.js) to the server.
 *
 *  - Sign-in is Clerk's (src/main.tsx). Once signed in it calls Backend.start() with a token
 *    getter; every API call carries the Clerk session token.
 *  - `store`: the editor's synchronous key-value store. Library keys (ms_projects, ms_proj_*,
 *    ms_shows, ms_show_*, ms_seasons, ms_season_*) live on the server and are cached here;
 *    writes are debounced and sent in the background. Device preferences (theme, settings)
 *    stay in this browser's localStorage.
 *  - `Backend`: files, AI and export calls. API keys never reach the browser.
 */
'use strict';

const Backend = (() => {
  const LIB_RE = /^(ms_projects|ms_shows|ms_seasons|ms_(proj|show|season)_[a-z0-9]{1,40})$/;
  const cache = new Map(); // key -> JSON string
  const timers = new Map(); // key -> timeout
  const pending = new Map(); // key -> JSON string | null (null = delete)
  const inflight = new Set();
  let user = null;
  let auth = null; // { getToken, signOut, email }
  let lastToken = null; // for keepalive saves while the page closes
  let ai = { fal: false, elevenlabs: false, anthropic: false, limits: {} };
  let onSync = () => {};

  async function req(method, url, body, opts = {}) {
    const headers = body === undefined ? {} : { 'content-type': 'application/json' };
    const token = opts.keepalive ? lastToken : auth ? await auth.getToken().catch(() => null) : null;
    if (token) { headers.Authorization = 'Bearer ' + token; lastToken = token; }
    const r = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive: opts.keepalive,
    });
    if (r.status === 401) {
      onSync('error', 'Your session has ended');
      if (auth && !opts.keepalive) auth.signOut().catch(() => location.reload());
      throw new Error('Signed out');
    }
    const type = r.headers.get('content-type') || '';
    if (!r.ok) {
      let msg = r.status + ' ' + r.statusText;
      if (type.includes('json')) {
        try { msg = (await r.json()).message || msg; } catch (e) {}
      }
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    if (opts.raw) return r;
    return type.includes('json') ? r.json() : r.text();
  }

  /* ---------------- Library sync ---------------- */

  function schedule(key) {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => send(key), 700));
    onSync('saving');
  }

  async function send(key, keepalive) {
    timers.delete(key);
    if (!pending.has(key)) return;
    const val = pending.get(key);
    pending.delete(key);
    const p = (async () => {
      try {
        if (val === null) await req('DELETE', '/api/docs/' + key, undefined, { keepalive });
        else await req('PUT', '/api/docs/' + key, { value: JSON.parse(val) }, { keepalive });
      } catch (e) {
        if (e.message === 'Signed out') return;
        if (!pending.has(key)) pending.set(key, val); // retry with the next change or flush
        onSync('error', e.message);
        clearTimeout(timers.get(key));
        timers.set(key, setTimeout(() => send(key), 5000));
        throw e;
      }
    })();
    inflight.add(p);
    p.catch(() => {}).finally(() => {
      inflight.delete(p);
      if (!pending.size && !inflight.size) onSync('saved');
    });
    return p;
  }

  /** Sends every pending change now (before exports and on page hide). */
  async function flush(keepalive) {
    const keys = [...pending.keys()];
    keys.forEach((k) => clearTimeout(timers.get(k)));
    await Promise.all([...keys.map((k) => send(k, keepalive)), ...inflight]);
  }
  const dirty = () => pending.size > 0 || inflight.size > 0;

  const store = {
    get(k, d) {
      if (LIB_RE.test(k)) {
        const v = cache.get(k);
        return v === undefined ? d : JSON.parse(v);
      }
      try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
    },
    set(k, v) {
      if (LIB_RE.test(k)) {
        const s = JSON.stringify(v);
        if (cache.get(k) === s) return true;
        cache.set(k, s);
        pending.set(k, s);
        schedule(k);
        return true;
      }
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    remove(k) {
      if (LIB_RE.test(k)) {
        cache.delete(k);
        pending.set(k, null);
        schedule(k);
        return;
      }
      try { localStorage.removeItem(k); } catch (e) {}
    },
  };

  /* ---------------- Files ---------------- */

  const MIME_BY_EXT = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  const SIGN_TTL = 5 * 3600 * 1000; // server signs for 6 hours
  const signed = new Map(); // path -> { url, at }

  async function sign(paths) {
    const want = [...new Set(paths.filter(Boolean))].filter((p) => {
      const s = signed.get(p);
      return !s || Date.now() - s.at > SIGN_TTL;
    });
    for (let i = 0; i < want.length; i += 400) {
      const { urls } = await req('POST', '/api/files/urls', { paths: want.slice(i, i + 400) });
      const at = Date.now();
      for (const [p, u] of Object.entries(urls)) signed.set(p, { url: u, at });
    }
    const out = {};
    for (const p of paths) if (signed.has(p)) out[p] = signed.get(p).url;
    return out;
  }

  const Vault = {
    backend: 'server',
    async put(path, blob) {
      let mime = (blob.type || '').split(';')[0];
      if (!/^(video|audio|image)\//.test(mime)) mime = MIME_BY_EXT[path.split('.').pop()] || mime;
      const t = await req('POST', '/api/files/upload', { path, mime, size: blob.size });
      const r = await fetch(t.uploadUrl, { method: 'PUT', headers: t.headers, body: blob });
      if (!r.ok) throw new Error('Upload failed (' + r.status + ')');
      await req('POST', '/api/files/complete', { id: t.id });
      signed.delete(path);
    },
    async get(path) {
      const u = (await sign([path]))[path];
      if (!u) return null;
      const r = await fetch(u);
      return r.ok ? r.blob() : null;
    },
    async url(path) {
      return (await sign([path]))[path] || null;
    },
    async del(path) {
      signed.delete(path);
      await req('DELETE', '/api/files?path=' + encodeURIComponent(path));
    },
    async delPrefix(prefix) {
      for (const k of signed.keys()) if (k.startsWith(prefix)) signed.delete(k);
      await req('DELETE', '/api/files?prefix=' + encodeURIComponent(prefix));
    },
    async list(prefix) {
      return (await req('GET', '/api/files?prefix=' + encodeURIComponent(prefix))).files;
    },
  };

  /* ---------------- AI ---------------- */

  /** Runs a fal.ai queue job on the server; resolves with fal's output. */
  async function falJob(model, input, { purpose, projectId, onStatus = () => {}, shouldStop = () => false } = {}) {
    const { job } = await req('POST', '/api/ai/fal', { model, input, purpose, projectId: projectId || undefined });
    let last = '';
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      if (shouldStop()) {
        req('POST', '/api/ai/jobs/' + job.id + '/cancel').catch(() => {});
        throw new Error('Stopped');
      }
      const { job: j } = await req('GET', '/api/ai/jobs/' + job.id);
      if (j.status === 'succeeded') return j.output;
      if (j.status === 'failed') throw new Error(j.error || 'Generation failed');
      if (j.status === 'canceled') throw new Error('Stopped');
      if (j.message && j.message !== last) onStatus((last = j.message));
    }
  }

  async function tts(voice, model, text) {
    const r = await req('POST', '/api/ai/tts', { voice, model, text }, { raw: true });
    return r.blob();
  }

  async function llm(provider, model, system, userText) {
    return (await req('POST', '/api/ai/llm', { provider, model, system, user: userText })).text;
  }

  /* ---------------- Exports ---------------- */

  async function startExport(pid, settings) {
    await flush();
    return (await req('POST', '/api/projects/' + pid + '/exports', settings)).export;
  }
  const getExport = async (id) => (await req('GET', '/api/exports/' + id)).export;
  const cancelExport = (id) => req('POST', '/api/exports/' + id + '/cancel');
  const usage = () => req('GET', '/api/usage');

  /* ---------------- Start (called by src/main.tsx once Clerk has a session) ---------------- */

  async function loadAll() {
    const [{ docs }, cfg] = await Promise.all([req('GET', '/api/library'), req('GET', '/api/ai/config')]);
    cache.clear();
    for (const [k, v] of Object.entries(docs)) cache.set(k, JSON.stringify(v));
    ai = cfg;
  }

  let started = false;
  async function start(a) {
    if (started) return;
    started = true;
    auth = a;
    user = { email: a.email };
    try {
      await loadAll();
    } catch (e) {
      document.body.insertAdjacentHTML('beforeend', '<div class="bootfail" role="alert">Could not load your studio: ' + String(e.message).replace(/[<>&]/g, '') + '. <a href="/">Try again</a></div>');
      return;
    }
    const s = document.createElement('script');
    s.src = '/app.js';
    document.body.appendChild(s);
  }

  async function logout() {
    await flush().catch(() => {});
    if (auth) await auth.signOut();
    else location.reload();
  }

  window.addEventListener('pagehide', () => { if (dirty()) flush(true); });
  window.addEventListener('beforeunload', (e) => { if (dirty()) { flush(true); e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty()) flush(true); });

  return {
    start, store, Vault, sign, falJob, tts, llm, startExport, getExport, cancelExport, usage, flush, logout,
    get ai() { return ai; },
    get user() { return user; },
    set onSync(fn) { onSync = fn; },
  };
})();

const store = Backend.store;
const Vault = Backend.Vault;

window.Backend = Backend;
