'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); };
const tcode = t => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t % 60), f = Math.floor((t % 1) * 30); return [h, m, s, f].map(n => String(n).padStart(2, '0')).join(':'); };
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(m, ms = 3200) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', ms); }
// `store` and `Vault` come from backend.js (server-backed library and files).
const AI = Backend.ai;
function confirmBox(q) { try { return window.confirm(q); } catch (e) { return true; } }

// ---------------- State ----------------
const DEF = {
  llm: 'off', llmModel: 'google/gemini-2.5-flash', antModel: 'claude-sonnet-5-5', imgModel: 'fal-ai/flux/schnell', provider: 'demo', t2v: 'fal-ai/kling-video/v2.1/standard/text-to-video',
  i2v: 'fal-ai/kling-video/v2.1/standard/image-to-video', durs: '5,10', durStr: true,
  voice: '21m00Tcm4TlvDq8ikWAM', elModel: 'eleven_multilingual_v2', wps: 2.6, target: 6
};
const S = {
  settings: Object.assign({}, DEF, store.get('lfs_settings', {})),
  stage: 'studio', scenes: [], assets: [], aSel: null, aFilter: 'all', sel: null, tab: 'clip', charRef: null, music: null, musicName: '', musicFile: null, musicVol: 0.25, duck: true,
  stopGen: false, genBusy: false, muted: false
};
for (const k of ['falKey', 'elKey', 'antKey', 'remember']) delete S.settings[k];
function saveSettings() { store.set('lfs_settings', S.settings); }
let savedAt = 0;
function projData() { return { pid: S.pid, seasonId: S.season ? S.season.id : undefined, title: $('#title').value, aspect: $('#aspect').value, script: $('#script').value, style: $('#style').value, scenes: S.scenes.map(sceneMeta), assets: S.assets.filter(a => a.scope !== 'season' && a.scope !== 'show').map(assetMeta), type: S.season ? 'episode' : 'movie', stage: S.stage === 'home' || S.stage === 'season' ? (S.lastStage || 'script') : S.stage, charRefFile: S.charRefFile || null, musicFile: S.musicFile || null, musicName: S.musicName || '', musicVol: S.musicVol, duck: S.duck }; }
function saveDraft() {
  if (S.season && S.pid) { S.season.assets = S.assets.filter(a => a.scope === 'season').map(assetMeta); saveSeason(); }
  if (S.show && S.pid) { S.show.assets = S.assets.filter(a => a.scope === 'show').map(assetMeta); saveShow(); }
  if (!S.pid) return;
  const d = projData(), ok = store.set('ms_proj_' + S.pid, d);
  const ix = store.get('ms_projects', []).filter(p => p.id !== S.pid);
  ix.unshift({ id: S.pid, title: d.title, updated: Date.now(), scenes: d.scenes.length, assets: d.assets.length, seasonId: d.seasonId, type: d.type });
  store.set('ms_projects', ix.slice(0, 50));
  if (ok) { savedAt = Date.now(); updSaved(); $('#savedDot').className = 'dot ready'; $('#savedDot').title = 'Saved ' + new Date().toLocaleTimeString(); } else { $('#savedDot').className = 'dot error'; $('#savedDot').title = 'Not saved – app storage is full'; toast('App storage is full. Remove old projects from the start screen.', 5000); }
  if (typeof renderExplorer === 'function') renderExplorer();
}
Backend.onSync = (st, msg) => {
  const d = $('#savedDot'); if (!d) return;
  if (st === 'saving') { d.className = 'dot busy'; d.title = 'Saving…'; }
  else if (st === 'saved') { d.className = 'dot ready'; d.title = 'Saved ' + new Date().toLocaleTimeString(); }
  else { d.className = 'dot error'; d.title = 'Not saved: ' + msg; $('#saved').textContent = 'Not saved – retrying'; }
};
function updSaved() { if (!savedAt) { $('#saved').textContent = ''; return; } const s = Math.round((Date.now() - savedAt) / 1000); $('#saved').textContent = s < 10 ? 'Saved just now' : s < 60 ? 'Saved ' + s + ' s ago' : 'Saved ' + Math.round(s / 60) + ' min ago'; }
setInterval(updSaved, 10000);
function keepUrl(u) { return /^https?:/.test(u || '') && !/X-Amz-|\/storage\//.test(u) ? u : null; }
function sceneMeta(s) { return { id: s.id, vo: s.vo, prompt: s.prompt, style: s.style, ownStyle: s.ownStyle, label: s.label, history: s.history, histN: s.histN, assets: s.assets, board: keepUrl(s.board), boardFile: s.boardFile, approved: s.approved, file: s.file, voFile: s.voFile, dur: s.dur, transition: s.transition, tdur: s.tdur, chain: s.chain, trimIn: s.trimIn, trimOut: s.trimOut, remote: s.remote, kind: s.kind === 'demo' ? 'demo' : null, hue: s.hue, fx: s.fx, fy: s.fy }; }
function newScene(o = {}) {
  return Object.assign({ id: uid(), vo: '', prompt: '', style: '', ownStyle: false, label: '', history: false, histN: 1, assets: [], dur: 6, transition: 'cut', tdur: 0.5, chain: true, kind: null, video: null, remote: null,
    trimIn: 0, trimOut: null, vEl: null, vDur: 0, voUrl: null, aEl: null, aDur: 0, peaks: null, status: 'idle', msg: '', hue: 190 + Math.floor(Math.random() * 40), chainImg: null, thumb: null }, o);
}
const selScene = () => S.scenes.find(x => x.id === S.sel);

// ---------------- Canvas / sizing ----------------
const cv = $('#stage'), cx = cv.getContext('2d');
let W = 1280, H = 720;
function setAspect() {
  const ar = $('#aspect').value;
  if (ar === '9:16') { W = 720; H = 1280; } else { W = 1280; H = 720; }
  cv.width = W; cv.height = H;
  $$('.seg [data-ar]').forEach(b => b.setAttribute('aria-pressed', b.dataset.ar === ar));
  fitStage(); drawAt(P.t); renderTimeline(); renderScenes();
}
function fitStage() {
  const wrap = $('.stagewrap'), r = wrap.getBoundingClientRect(), pw = r.width - 48, ph = r.height - 36;
  if (pw <= 0 || ph <= 0) return; const sc = Math.min(pw / W, ph / H);
  cv.style.width = Math.floor(W * sc) + 'px'; cv.style.height = Math.floor(H * sc) + 'px';
}
window.addEventListener('resize', fitStage);
$$('.seg [data-ar]').forEach(b => b.onclick = () => { $('#aspect').value = b.dataset.ar; setAspect(); saveDraft(); });

// ---------------- Left rail ----------------
function showPane(name) {
  if (name === 'assets') { goStage('assets'); return; }
  if (name === 'style') $('#style2').value = $('#style').value;
  $$('#rail button').forEach(b => b.toggleAttribute('aria-current', b.dataset.pane === name));
  $$('#rail button').forEach(b => { if (b.dataset.pane === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $$('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === name));
  if (name === 'voice') { $('#vVoice').value = S.settings.voice; $('#vModel').value = S.settings.elModel; $('#voKeyNote').textContent = AI.elevenlabs ? 'ElevenLabs is connected on the server.' : 'ElevenLabs is not set up on the server yet. You can still upload audio per scene in the Audio tab.'; }
  if (name === 'script') { $('#sWps2').value = S.settings.wps; $('#sTarget2').value = S.settings.target; }
}
$$('#rail button').forEach(b => b.onclick = () => showPane(b.dataset.pane));
$('#vVoice').onchange = e => { S.settings.voice = e.target.value.trim(); saveSettings(); };
$('#vModel').onchange = e => { S.settings.elModel = e.target.value.trim(); saveSettings(); };
$('#sWps2').onchange = e => { S.settings.wps = +e.target.value || 2.6; saveSettings(); scriptStats(); };
$('#sTarget2').onchange = e => { S.settings.target = +e.target.value || 6; saveSettings(); scriptStats(); };

// ---------------- Script splitting ----------------
function scriptChunks(text) {
  const wps = +S.settings.wps || 2.6, target = +S.settings.target || 6, maxW = target * wps;
  const chunks = [];
  text.split(/\n\s*\n/).forEach(p => {
    p = p.replace(/\s+/g, ' ').trim(); if (!p) return;
    const sents = p.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [p];
    let cur = '';
    sents.forEach(se => { se = se.trim(); if (!se) return; const next = cur ? cur + ' ' + se : se; if (cur && next.split(' ').length > maxW) { chunks.push(cur); cur = se; } else cur = next; });
    if (cur) chunks.push(cur);
  });
  return chunks;
}
function splitScript() {
  const text = $('#script').value.trim();
  if (!text) { toast('Paste a script first'); return; }
  const wps = +S.settings.wps || 2.6, chunks = scriptChunks(text);
  if (S.scenes.length && !confirmBox('Replace the current ' + S.scenes.length + ' scenes?')) return;
  stop();
  S.scenes = chunks.map((c, i) => newScene({ vo: c, prompt: 'Visual for narration: "' + c + '"', dur: Math.min(15, Math.max(3, Math.round(c.split(' ').length / wps))), chain: i > 0 }));
  S.sel = S.scenes[0]?.id || null; P.t = 0;
  renderAll(); saveDraft(); goStage('scenes'); setTimeout(() => { F.fitted = false; autoArrange(); }, 60); toast(S.scenes.length + ' scenes created');
}
function seasonStyle() { return [S.show && S.show.style, S.season && S.season.style].map(x => (x || '').trim().replace(/[.\s]+$/, '')).filter(Boolean).join('. '); }
function styleOf(s) { const own = (s.ownStyle ? s.style : $('#style').value).trim(), base = seasonStyle(); return [base, own].filter(Boolean).map(x => x.replace(/[.\s]+$/, '')).join('. '); }
function historyText(s) {
  const i = S.scenes.indexOf(s); if (!s.history || i < 1) return '';
  return S.scenes.slice(Math.max(0, i - (s.histN || 1)), i).map(x => {
    const st = styleOf(x);
    return `Scene ${S.scenes.indexOf(x) + 1}${st ? ' [style: ' + st + ']' : ''}: ${(x.vo || x.prompt || '').trim().replace(/[.!?\s]+$/, '')}`;
  }).join(' | ');
}
function fullPrompt(s) {
  const st = styleOf(s), p = (s.prompt || s.vo || '').trim(), hx = historyText(s), mc = mustContain(s);
  let core = st ? st + '. ' + p : p; if (mc) core += (/[.!?]["'”)]*$/.test(core) ? ' ' : '. ') + 'Must contain: ' + mc + '.';
  return hx ? 'Continuity – previous: ' + hx + '. NOW: ' + core : core;
}

// ---------------- Status ----------------
function statusOf(s) {
  if (s.status === 'busy') return { k: 'busy', label: 'Generating', tag: 'Generating…', gen: 'Generating…' };
  if (s.status === 'error') return { k: 'error', label: 'Failed', tag: 'Failed', gen: 'Try again' };
  if (s.kind === 'video') return { k: 'ready', label: 'Ready', tag: s.remote ? 'AI clip' : 'Imported', gen: 'Regenerate clip' };
  if (s.kind === 'demo') return { k: 'demo', label: 'Demo clip', tag: 'Demo', gen: S.settings.provider === 'fal' ? 'Generate with fal.ai' : 'Regenerate demo' };
  return { k: 'none', label: 'Not generated', tag: 'Empty', gen: 'Generate clip' };
}

// ---------------- Render: scenes ----------------
function renderAll() { renderScenes(); renderTimeline(); renderInspector(); renderViewerTop(); renderFlow(); drawAt(P.t); refreshStage(); }
function renderScenes() {
  const n = S.scenes.length, done = S.scenes.filter(s => s.kind).length, pct = n ? Math.round(done / n * 100) : 0;
  $('#sceneCount').textContent = n ? n + ' · ' + fmt(totalLen()) : '';
  $('#progTxt').textContent = done + ' of ' + n + ' generated'; $('#progPct').textContent = pct + '%'; $('#progBar').style.width = pct + '%';
  const missing = S.scenes.filter(s => !s.kind || s.status === 'error').length;
  $('#btnGenAll').textContent = 'Generate missing' + (missing ? ' (' + missing + ')' : '');
  const list = $('#sceneList'); list.innerHTML = '';
  if (!n) { list.innerHTML = '<p class="muted" style="padding:10px 6px">No scenes yet. Use Create scene, paste a script in Script, or import videos in Media.</p>'; return; }
  S.scenes.forEach((s, i) => {
    const st = statusOf(s), b = document.createElement('button');
    b.className = 'srow'; b.setAttribute('aria-pressed', s.id === S.sel); b.dataset.id = s.id;
    b.innerHTML = `<span class="th"><canvas width="144" height="80"></canvas><span class="num">${i + 1}</span></span>
      <span class="tx"><span class="vo">${s.label ? '<b>' + esc(s.label) + '</b> · ' : ''}${esc(s.vo || s.prompt || 'Empty scene')}</span>
      <span class="meta"><span class="dot ${st.k}"></span>${st.label}${s.ownStyle ? '<span class="own">own style</span>' : ''}${s.history && i > 0 ? '<span class="own" style="color:var(--sun-text)">history</span>' : ''}<span class="d">${fmt(segLen(s)).replace(/^0/, '')}</span></span></span>`;
    b.onclick = () => select(s.id, true);
    list.appendChild(b); thumb(s, i, b.querySelector('canvas'));
  });
}
function select(id, seek) {
  S.sel = id; renderScenes(); renderInspector(); renderTimeline(); renderViewerTop(); markFlowSel(); renderExplorer();
  if (seek) { const g = buildSegs().find(g => g.s.id === id); if (g) seekTo(g.t0 + 0.01); }
}
function renderViewerTop() {
  const s = selScene(); if (!s) { $('#vScene').textContent = 'No scene'; $('#vModel2').textContent = '–'; return; }
  const i = S.scenes.indexOf(s), st = statusOf(s);
  $('#vScene').textContent = 'Scene ' + (i + 1) + (s.label ? ' · ' + s.label : '');
  $('#vModel2').textContent = st.k === 'ready' ? (s.remote ? S.settings.i2v.split('/').slice(1, 3).join(' ') : 'Imported clip') + ' · ' + clipLen(s).toFixed(1) + ' s' : st.label;
}

// ---------------- Render: inspector ----------------
$$('.tabs button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; renderInspector(); });
const TR_NAMES = { cut: 'Cut', fade: 'Crossfade', black: 'Dip to black', white: 'Dip to white', wipe: 'Wipe', zoom: 'Zoom in' };
const TRI = {
  white: '<svg width="28" height="16" viewBox="0 0 28 16"><rect width="11" height="16" rx="2" fill="#3A3A42"/><rect x="11" width="6" height="16" fill="#EDEDF0"/><rect x="17" width="11" height="16" rx="2" fill="#6A6A74"/></svg>',
  wipe: '<svg width="28" height="16" viewBox="0 0 28 16"><rect width="28" height="16" rx="2" fill="#3A3A42"/><rect x="12" width="16" height="16" rx="2" fill="#6A6A74"/><path d="M12 0v16" stroke="#FF8F52" stroke-width="1.5"/></svg>',
  zoom: '<svg width="28" height="16" viewBox="0 0 28 16"><rect width="28" height="16" rx="2" fill="#3A3A42"/><rect x="7" y="3" width="14" height="10" rx="2" fill="#6A6A74"/><path d="M3 2l3 2M25 2l-3 2M3 14l3-2M25 14l-3-2" stroke="#9C9CA6" stroke-width="1.2"/></svg>',
  cut: '<svg width="28" height="16" viewBox="0 0 28 16"><rect width="13" height="16" rx="2" fill="#3A3A42"/><rect x="15" width="13" height="16" rx="2" fill="#6A6A74"/></svg>',
  fade: '<svg width="28" height="16" viewBox="0 0 28 16"><rect width="18" height="16" rx="2" fill="#3A3A42"/><rect x="10" width="18" height="16" rx="2" fill="#6A6A74" opacity="0.7"/></svg>',
  black: '<svg width="28" height="16" viewBox="0 0 28 16"><rect width="11" height="16" rx="2" fill="#3A3A42"/><rect x="11" width="6" height="16" fill="#000"/><rect x="17" width="11" height="16" rx="2" fill="#6A6A74"/></svg>'
};
function renderInspector() {
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  const s = selScene(), box = $('#inspBody');
  $('#iGenMain').disabled = !s; $('#iMore').disabled = !s;
  if (!s) { box.innerHTML = '<p class="muted">Select a scene, or use Create scene to start one.</p>'; $('#iGenLbl').textContent = 'Generate clip'; return; }
  const i = S.scenes.indexOf(s), st = statusOf(s);
  $('#iGenLbl').textContent = st.gen; $('#iGenMain').disabled = s.status === 'busy';
  let h = `<div class="ihead"><b>Scene ${i + 1}</b><span><span class="dot ${st.k}"></span>${st.label}</span></div>`;
  if (s.msg) h += `<div class="note ${s.status === 'error' ? 'err' : ''}" id="iMsg">${esc(s.msg)}</div>`; else h += `<div class="note" id="iMsg" style="display:none"></div>`;
  if (S.tab === 'clip') {
    h += `
    <div class="field"><label class="lbl" for="iLabel">Scene name</label><input id="iLabel" class="inp" value="${esc(s.label)}" placeholder="e.g. Cold open – rooftop"></div>
    <div class="field"><label class="lbl" for="iVo">Script</label><textarea id="iVo" class="inp" rows="4" placeholder="What is said in this scene. Used for voiceover and captions.">${esc(s.vo)}</textarea></div>
    <div class="field"><label class="lbl" for="iPrompt">What we see</label><textarea id="iPrompt" class="inp" rows="4" placeholder="Action, camera and framing, e.g. slow push-in on the lead at the window">${esc(s.prompt)}</textarea></div>
    <div class="field"><div style="display:flex;justify-content:space-between;align-items:center"><span class="lbl">Assets in this scene</span><button class="btn sm" id="iAutoTag" style="height:22px;border:none;background:transparent;color:var(--accent);padding:0 4px">Auto-tag</button></div>
      ${S.assets.length ? `<div class="chips">${S.assets.map(a => `<button class="chipb" data-aid="${a.id}" aria-pressed="${(s.assets || []).includes(a.id)}">${a.img ? `<img src="${esc(a.img)}" alt="">` : ''}${esc(a.name)}</button>`).join('')}</div>` : '<span class="cap">No assets yet. Add cast, locations and props in Assets on the left.</span>'}</div>
    <div class="field"><span class="lbl">Style</span>
      <div class="seg wide" role="group" aria-label="Style source"><button id="iSP" aria-pressed="${!s.ownStyle}">Project style</button><button id="iSC" aria-pressed="${s.ownStyle}">Custom</button></div>
      <div id="iStyleWrap" style="display:${s.ownStyle ? 'flex' : 'none'};flex-direction:column;gap:6px">
        <textarea id="iStyle" class="inp" rows="3" placeholder="e.g. neon noir, high contrast, handheld">${esc(s.style)}</textarea>
        <div style="display:flex;gap:6px"><button class="btn sm" id="iStyleNext" style="flex:1">Apply to following</button><button class="btn sm" id="iStyleAll" style="flex:1">Apply to all</button></div>
      </div>
      <span class="cap" id="iStyleHint" style="display:${s.ownStyle ? 'none' : 'block'}">${esc($('#style').value.trim() || 'No project style set yet (Style in the left menu).')}</span>
    </div>
    <div class="trow"><div><div class="t1">Include history</div><div class="t2">Adds earlier scenes' script and style to the prompt</div></div><label class="tg"><input type="checkbox" id="iHist" ${s.history ? 'checked' : ''} ${i === 0 ? 'disabled' : ''} aria-label="Include history"><span></span></label></div>
    <div class="field" id="iHistRow" style="display:${s.history && i > 0 ? 'flex' : 'none'}"><span class="lbl">Scenes back</span>
      <div class="seg" role="group" style="width:max-content">${[1, 2, 3].map(n => `<button data-hn="${n}" aria-pressed="${(s.histN || 1) === n}">${n}</button>`).join('')}</div></div>
    <div class="trow"><div><div class="t1">Continue from last frame</div><div class="t2">${i === 0 ? 'First scene – starts fresh' : 'Starts from scene ' + i + '’s final frame'}</div></div><label class="tg"><input type="checkbox" id="iChain" ${s.chain && i > 0 ? 'checked' : ''} ${i === 0 ? 'disabled' : ''} aria-label="Continue from last frame"><span></span></label></div>
    <div class="field"><span class="lbl">Prompt sent to the model</span><div class="final" id="iFinal">${esc(fullPrompt(s))}</div></div>
    <div class="field"><label class="lbl" for="iDur">Length when there's no clip (s)</label><input id="iDur" class="inp" type="number" min="1" max="30" step="0.5" value="${s.dur}"></div>
    <div class="grid2" style="${s.kind === 'video' ? '' : 'opacity:.4;pointer-events:none'}">
      <div class="field"><label class="lbl" for="iIn">Trim in (s)</label><input id="iIn" class="inp" type="number" min="0" step="0.1" value="${s.trimIn}"></div>
      <div class="field"><label class="lbl" for="iOut">Trim out (s)</label><input id="iOut" class="inp" type="number" min="0" step="0.1" value="${s.trimOut ?? (s.vDur ? s.vDur.toFixed(1) : '')}"></div>
    </div>
    <label class="btn dash sm"><input id="iUpV" type="file" accept="video/*" hidden>Replace with my own video…</label>
    ${s.remote ? `<a href="${esc(s.remote)}" target="_blank" rel="noopener" class="cap" style="color:var(--accent)">Open source clip ↗</a>` : ''}`;
  } else if (S.tab === 'audio') {
    h += `
    <div class="field"><label class="lbl" for="iVo">Narration (scene script)</label><textarea id="iVo" class="inp" rows="4">${esc(s.vo)}</textarea></div>
    <div class="field"><span class="lbl">Voiceover</span>
      <div class="note">${s.voUrl ? 'Voiceover ready · ' + s.aDur.toFixed(1) + ' s' + (s.aDur > clipLen(s) ? ' (longer than the clip, so the last frame holds)' : '') : 'No voiceover yet.'}</div>
      <button class="btn sm" id="iVoGen">${s.voUrl ? 'Re-voice with ElevenLabs' : 'Voice with ElevenLabs'}</button>
      <span class="cap">Voice: ${esc(S.settings.voice)} · change it in Voice on the left.</span></div>
    <div class="trow"><div><div class="t1">Duck music under voice</div><div class="t2">Lowers the music bed while narration plays</div></div><label class="tg"><input type="checkbox" id="iDuck" ${S.duck ? 'checked' : ''} aria-label="Duck music under voice"><span></span></label></div>
    <label class="btn dash sm"><input id="iUpA" type="file" accept="audio/*" hidden>Replace with audio file…</label>
    ${s.voUrl ? '<button class="btn sm" id="iVoDel">Remove voiceover</button>' : ''}`;
  } else {
    h += `
    <span class="lbl">Transition in</span>
    <div class="trgrid">${Object.entries(TR_NAMES).map(([k, l]) => `<button data-tr="${k}" aria-pressed="${s.transition === k}">${TRI[k]}${l}</button>`).join('')}</div>
    <div class="field"><div style="display:flex;justify-content:space-between;font-size:12px"><label class="lbl" for="iTd">Duration</label><span id="iTdTxt" style="font-variant-numeric:tabular-nums">${s.tdur.toFixed(1)} s</span></div>
      <input id="iTd" type="range" min="0.1" max="2" step="0.1" value="${s.tdur}"></div>
    <p class="cap" style="margin:0;line-height:1.5">${i === 0 ? 'This is the first scene, so the transition plays from black or straight in.' : 'Plays between scene ' + i + ' and this scene.'} If the voiceover runs longer than the clip, the last frame holds with a slow push-in so audio is never cut.</p>`;
  }
  box.innerHTML = h;
  wireInspector(s, i);
}
function wireInspector(s, i) {
  const upd = (fn, full) => e => { fn(e); saveDraft(); if (full) { renderTimeline(); renderScenes(); renderViewerTop(); } };
  const fin = () => { const f = $('#iFinal'); if (f) f.textContent = fullPrompt(s); };
  const on = (id, ev, fn) => { const el = $('#' + id); if (el) el[ev] = fn; };
  on('iLabel', 'oninput', upd(e => s.label = e.target.value, true));
  on('iVo', 'oninput', upd(e => { s.vo = e.target.value; fin(); }, true));
  on('iPrompt', 'oninput', upd(e => { s.prompt = e.target.value; fin(); }));
  const setOwn = v => { s.ownStyle = v; if (v && !s.style) s.style = $('#style').value; saveDraft(); renderInspector(); renderScenes(); };
  on('iSP', 'onclick', () => setOwn(false)); on('iSC', 'onclick', () => setOwn(true));
  on('iStyle', 'oninput', upd(e => { s.style = e.target.value; fin(); }));
  const applyStyle = from => { S.scenes.slice(from).forEach(x => { x.ownStyle = true; x.style = s.style; }); saveDraft(); renderScenes(); toast('Style applied to ' + (S.scenes.length - from) + ' scene(s)'); };
  on('iStyleNext', 'onclick', () => applyStyle(i + 1)); on('iStyleAll', 'onclick', () => applyStyle(0));
  on('iHist', 'onchange', upd(e => { s.history = e.target.checked; $('#iHistRow').style.display = s.history ? 'flex' : 'none'; fin(); }, true));
  $$('#iHistRow [data-hn]').forEach(b => b.onclick = () => { s.histN = +b.dataset.hn; saveDraft(); renderInspector(); });
  on('iChain', 'onchange', upd(e => s.chain = e.target.checked));
  $$('#inspBody [data-aid]').forEach(b => b.onclick = () => { const id = b.dataset.aid; s.assets = s.assets || []; s.assets = s.assets.includes(id) ? s.assets.filter(x => x !== id) : [...s.assets, id]; b.setAttribute('aria-pressed', s.assets.includes(id)); fin(); saveDraft(); renderAssets(); });
  on('iAutoTag', 'onclick', () => { autoTag([s]); renderInspector(); renderAssets(); });
  on('iDur', 'onchange', upd(e => s.dur = Math.max(1, +e.target.value || 6), true));
  on('iIn', 'onchange', upd(e => s.trimIn = Math.max(0, Math.min(+e.target.value || 0, (s.vDur || 99) - 0.3)), true));
  on('iOut', 'onchange', upd(e => { const v = +e.target.value; s.trimOut = v && v > s.trimIn + 0.2 ? Math.min(v, s.vDur || v) : null; }, true));
  on('iUpV', 'onchange', async e => { const f = e.target.files[0]; if (!f) return; await setClip(s, URL.createObjectURL(f), null); s.status = 'done'; s.msg = 'Using ' + f.name; renderAll(); });
  on('iVoGen', 'onclick', () => runVo([s]));
  on('iDuck', 'onchange', e => { S.duck = e.target.checked; $('#duckOn').checked = S.duck; });
  on('iUpA', 'onchange', async e => { const f = e.target.files[0]; if (!f) return; await setVo(s, URL.createObjectURL(f)); renderAll(); });
  on('iVoDel', 'onclick', () => { if (s.aEl) s.aEl.pause(); s.voUrl = null; s.aEl = null; s.aDur = 0; s.peaks = null; renderAll(); });
  $$('.trgrid [data-tr]').forEach(b => b.onclick = () => { s.transition = b.dataset.tr; saveDraft(); renderInspector(); renderTimeline(); });
  on('iTd', 'oninput', e => { s.tdur = +e.target.value; $('#iTdTxt').textContent = s.tdur.toFixed(1) + ' s'; saveDraft(); });
}
$('#iGenMain').onclick = () => { const s = selScene(); if (s) runGen([s]); };
$('#iMore').onclick = e => { e.stopPropagation(); $('#moreMenu').classList.toggle('on'); };
document.addEventListener('click', () => $('#moreMenu').classList.remove('on'));
$$('#moreMenu button').forEach(b => b.onclick = () => {
  const s = selScene(); if (!s) return; const i = S.scenes.indexOf(s);
  ({ dup: () => { const c = newScene(Object.assign(sceneMeta(s), { id: uid(), kind: null, remote: null })); S.scenes.splice(i + 1, 0, c); select(c.id, true); },
     left: () => move(s, -1), right: () => move(s, 1),
     clear: () => { if (s.vEl) s.vEl.pause(); dropFile(s.file, s); Object.assign(s, { file: null, kind: null, vEl: null, video: null, remote: null, vDur: 0, thumb: null, chainImg: null, status: 'idle', msg: '' }); renderAll(); },
     del: () => deleteScene(s) })[b.dataset.act]();
  saveDraft(); $('#moreMenu').classList.remove('on');
});
function deleteScene(s) { stop(); const i = S.scenes.indexOf(s); [s.file, s.voFile, s.boardFile].forEach(f => dropFile(f, s)); S.scenes.splice(i, 1); S.sel = S.scenes[Math.min(i, S.scenes.length - 1)]?.id || null; P.t = Math.min(P.t, totalLen()); renderAll(); saveDraft(); }
function move(s, d) { const i = S.scenes.indexOf(s), j = i + d; if (j < 0 || j >= S.scenes.length) return; stop(); S.scenes.splice(i, 1); S.scenes.splice(j, 0, s); renderAll(); saveDraft(); }

function createScene(atIdx, pos) {
  const cur = S.scenes.findIndex(x => x.id === S.sel), at = Number.isInteger(atIdx) ? atIdx : (cur < 0 ? S.scenes.length : cur + 1);
  const prev = S.scenes[at - 1], hist = $('#newHist').checked && !!prev;
  const s = newScene({ chain: at > 0, history: hist, ownStyle: hist ? prev.ownStyle : false, style: hist ? prev.style : '' });
  if (pos) { s.fx = pos.x; s.fy = pos.y; } else if (prev && prev.fx != null) { s.fx = prev.fx + 300; s.fy = prev.fy; }
  S.scenes.splice(at, 0, s); S.tab = 'clip'; if (S.stage === 'studio') showPane('scenes'); select(s.id, true); saveDraft();
  if (S.stage === 'scenes') renderSceneCards();
  setTimeout(() => { const v = S.stage === 'scenes' ? $('.scard.sel textarea') : $('#iVo'); if (v) v.focus(); }, 50);
  toast('Scene ' + (at + 1) + ' created' + (hist ? ' with history from scene ' + at : ''));
}
$('#btnAddScene').onclick = () => createScene(); $('#btnAddScene2').onclick = () => createScene();

// ---------------- Timeline ----------------
let dragId = null;
function pps() { return +$('#zoom').value; }
function renderTimeline() {
  const p = pps(), segs = buildSegs(), total = totalLen(), width = Math.max(total * p + 40, 600);
  const lv = $('#laneV'), lt = $('#laneT'), la = $('#laneA'), lm = $('#laneM');
  [lv, lt, la, lm, $('#ruler')].forEach(l => l.style.width = width + 'px');
  lv.innerHTML = lt.innerHTML = la.innerHTML = lm.innerHTML = '';
  segs.forEach(g => {
    const s = g.s, st = statusOf(s), w = Math.max(18, g.len * p - 2);
    const c = document.createElement('button');
    c.className = 'clip' + (st.k === 'none' ? ' none' : '') + (st.k === 'error' ? ' error' : '') + (s.id === S.sel ? ' sel' : '');
    c.style.width = w + 'px'; c.draggable = true; c.setAttribute('aria-label', 'Select scene ' + (g.i + 1));
    if (st.k !== 'none') { const th = document.createElement('canvas'); th.width = 160; th.height = 90; c.appendChild(th); thumb(s, g.i, th); th.style.opacity = st.k === 'ready' ? 1 : st.k === 'demo' ? .55 : .3; }
    c.insertAdjacentHTML('beforeend', `${s.transition !== 'cut' ? '<span class="trm" title="' + TR_NAMES[s.transition] + '"></span>' : ''}<span class="cl">${g.i + 1} · ${esc(s.label || (s.vo || s.prompt || 'Empty').slice(0, 50))}</span><span class="ct">${st.tag}</span>`);
    c.onclick = () => select(s.id, true);
    c.ondragstart = e => { dragId = s.id; c.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; };
    c.ondragend = () => { dragId = null; c.classList.remove('drag'); };
    c.ondragover = e => { if (dragId) e.preventDefault(); };
    c.ondrop = e => { if (!dragId) return; e.preventDefault(); e.stopPropagation(); if (dragId === s.id) return; const a = S.scenes.findIndex(x => x.id === dragId), b = S.scenes.indexOf(s); const [m] = S.scenes.splice(a, 1); S.scenes.splice(b, 0, m); stop(); renderAll(); saveDraft(); };
    lv.appendChild(c);
    const cb = document.createElement('span'); cb.className = 'capb' + (s.vo ? '' : ' off'); cb.style.width = w + 'px'; cb.textContent = s.vo ? s.vo : ''; lt.appendChild(cb);
    const vb = document.createElement('span'); vb.className = 'vob' + (s.voUrl ? '' : ' off'); vb.style.width = w + 'px';
    if (s.voUrl) { const wc = document.createElement('canvas'); wc.width = Math.max(10, Math.round(w)); wc.height = 28; vb.appendChild(wc); drawWave(wc, s, g.len); }
    la.appendChild(vb);
  });
  if (S.music) { const m = document.createElement('div'); m.className = 'musb on'; m.style.width = Math.max(120, total * p - 2) + 'px'; m.innerHTML = '<span class="badge b-t" style="width:auto;padding:0 5px">♪</span>' + esc(S.musicName) + '<span class="cap" style="margin-left:auto">' + Math.round(S.musicVol * 100) + '%' + (S.duck ? ' · ducks under voice' : '') + '</span>'; lm.appendChild(m); }
  else { const m = document.createElement('button'); m.className = 'musb'; m.style.width = Math.max(300, total * p - 2) + 'px'; m.textContent = '+ Add a music bed · ducks automatically under the voiceover'; m.onclick = () => $('#musicFile').click(); lm.appendChild(m); }
  const r = $('#ruler'); const major = p < 15 ? 20 : p < 35 ? 4 : 2, minor = major / 2;
  let h = ''; for (let t = 0; t <= total + minor; t += minor) { const isM = Math.abs(t / major - Math.round(t / major)) < 1e-6; h += `<span style="left:${t * p}px;height:${isM ? 24 : 8}px">${isM ? fmt(t) : ''}</span>`; }
  r.innerHTML = h; movePlayhead();
  if (flowOn()) renderFlow();
}
function drawWave(c, s, len) {
  const x = c.getContext('2d'), w = c.width, h = c.height; x.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--wave').trim() || '#FFC72C'; x.lineWidth = 1.6; x.lineCap = 'round'; x.beginPath();
  const frac = Math.min(1, s.aDur / len), ww = w * frac;
  for (let px = 1; px < ww - 1; px += 3) {
    let a;
    if (s.peaks) { const k = Math.floor(px / ww * s.peaks.length); a = s.peaks[k] || 0; } else a = 0.3 + 0.5 * Math.abs(Math.sin(px / 7));
    a = Math.max(0.06, a) * (h / 2 - 1); x.moveTo(px, h / 2 - a); x.lineTo(px, h / 2 + a);
  }
  x.stroke();
}
function movePlayhead() {
  $('#playhead').style.left = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr')) + P.t * pps()) + 'px';
  $('#tc').innerHTML = tcode(P.t) + '<span> / ' + tcode(totalLen()) + '</span>';
}
$('#zoom').oninput = renderTimeline;
$('#ruler').addEventListener('click', e => { const r = $('#ruler').getBoundingClientRect(); seekTo((e.clientX - r.left) / pps()); });
$('#tlDel').onclick = () => { const s = selScene(); if (s) deleteScene(s); };
$('#tlSplit').onclick = () => {
  const g = segAt(P.t); if (!g) return; const s = g.s, local = P.t - g.t0;
  if (local < 0.3 || local > g.len - 0.3) { toast('Move the playhead inside a clip to split it'); return; }
  stop();
  const b = newScene(Object.assign(sceneMeta(s), { id: uid(), transition: 'cut', label: s.label ? s.label + ' (b)' : '' }));
  if (s.kind === 'video') {
    const cut = s.trimIn + Math.min(local, clipLen(s));
    b.kind = 'video'; b.video = s.video; b.file = s.file; b.remote = s.remote; b.vDur = s.vDur; b.trimIn = cut; b.trimOut = s.trimOut; s.trimOut = cut;
    loadVideo(s.video).then(v => { b.vEl = v; routeEl(v); b.thumb = s.thumb; renderTimeline(); });
  } else { b.dur = Math.max(1, s.dur - local); s.dur = Math.max(1, local); b.kind = s.kind; b.chainImg = s.chainImg; }
  b.vo = ''; S.scenes.splice(g.i + 1, 0, b); renderAll(); saveDraft(); toast('Split scene ' + (g.i + 1) + ' at ' + fmt(P.t));
};
function thumb(s, i, th) {
  const c = th.getContext('2d'), w = th.width, h = th.height;
  c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
  if (s.kind === 'video' && s.thumb) { drawCover(c, s.thumb, w, h, 1); return; }
  if (s.kind === 'demo') { const o = off(); drawDemo(o.getContext('2d'), s, s.dur / 2, i, o.width, o.height, true); drawCover(c, o, w, h, 1); return; }
  c.fillStyle = '#131316'; c.fillRect(0, 0, w, h); c.strokeStyle = '#3A3A42'; c.setLineDash([4, 4]); c.strokeRect(4, 4, w - 8, h - 8);
}
let _off; function off() { if (!_off || _off.width !== W || _off.height !== H) { _off = document.createElement('canvas'); _off.width = W; _off.height = H; } return _off; }
// drag & drop video files onto timeline
const tlEl = $('#tl');
tlEl.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); tlEl.classList.add('drop'); } });
tlEl.addEventListener('dragleave', e => { if (e.target === tlEl) tlEl.classList.remove('drop'); });
tlEl.addEventListener('drop', e => { tlEl.classList.remove('drop'); if (e.dataTransfer.files.length) { e.preventDefault(); importVideos(e.dataTransfer.files); } });

// ---------------- Media helpers ----------------
function seekV(v, t) {
  return new Promise(res => {
    let done = false; const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', fin); res(); };
    v.addEventListener('seeked', fin); setTimeout(fin, 2000);
    try { v.currentTime = Math.max(0, t); } catch (e) { fin(); }
  });
}
function loadVideo(url) {
  return new Promise((res, rej) => {
    const v = document.createElement('video'); v.playsInline = true; v.preload = 'auto'; v.muted = true; v.crossOrigin = 'anonymous';
    v.onloadeddata = () => res(v); v.onerror = () => rej(new Error('Could not load video')); v.src = url;
  });
}
function loadAudio(url) { return new Promise((res, rej) => { const a = new Audio(); a.preload = 'auto'; a.onloadedmetadata = () => res(a); a.onerror = () => rej(new Error('Could not load audio')); a.src = url; }); }
async function setClip(s, url, remote, keepFile) {
  const v = await loadVideo(url);
  if (!keepFile) { s.file = null; storeFrom(url, 'clips', s.id).then(pth => { if (pth) { s.file = pth; saveDraft(); } }); }
  s.video = url; s.remote = remote; s.vEl = v; s.vDur = v.duration || s.dur; s.trimIn = 0; s.trimOut = null; s.kind = 'video';
  await seekV(v, Math.min(s.vDur / 2, 1)); const o = document.createElement('canvas'); o.width = 320; o.height = Math.round(320 * (v.videoHeight || 9) / (v.videoWidth || 16)); drawCover(o.getContext('2d'), v, o.width, o.height, 1); s.thumb = o;
  routeEl(v);
}
async function setVo(s, url, keepFile) {
  const a = await loadAudio(url); if (!keepFile) { s.voFile = null; storeFrom(url, 'voices', s.id).then(pth => { if (pth) { s.voFile = pth; saveDraft(); } }); } s.voUrl = url; s.aEl = a; s.aDur = a.duration || 0; s.peaks = null; routeEl(a); saveDraft();
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
    const ab = await ac.decodeAudioData(buf), d = ab.getChannelData(0), N = 300, step = Math.floor(d.length / N) || 1, pk = [];
    let mx = 0; for (let i = 0; i < N; i++) { let m = 0; for (let j = i * step; j < (i + 1) * step && j < d.length; j += 8) m = Math.max(m, Math.abs(d[j])); pk.push(m); mx = Math.max(mx, m); }
    s.peaks = pk.map(v => v / (mx || 1)); renderTimeline();
  } catch (e) { /* keep placeholder waveform */ }
}
function imgFrom(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
async function lastFrame(s, i) {
  const o = off(), c = o.getContext('2d');
  if (s.kind === 'demo') { drawDemo(c, s, s.dur, i, W, H, true); return o.toDataURL('image/jpeg', 0.9); }
  if (s.kind === 'video' && s.vEl) { await seekV(s.vEl, (s.trimOut ?? s.vDur) - 0.06); c.fillStyle = '#000'; c.fillRect(0, 0, W, H); drawCover(c, s.vEl, W, H, 1); return o.toDataURL('image/jpeg', 0.9); }
  return null;
}
async function importVideos(files) {
  files = [...files].filter(f => f.type.startsWith('video/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!files.length) { toast('No video files found'); return; }
  stop(); let last = null; showPane('scenes');
  for (const f of files) {
    const s = newScene({ prompt: f.name.replace(/\.[^.]+$/, ''), chain: false });
    S.scenes.push(s); s.status = 'busy'; s.msg = 'Importing ' + f.name + '…'; renderScenes();
    try { await setClip(s, URL.createObjectURL(f), null); s.dur = s.vDur; s.status = 'done'; s.msg = 'Imported ' + f.name + ' · ' + s.vDur.toFixed(1) + ' s'; }
    catch (e) { s.status = 'error'; s.msg = 'Could not read ' + f.name + ' (try MP4/H.264)'; }
    last = s;
  }
  if (last) S.sel = last.id; renderAll(); saveDraft(); toast(files.length + ' video' + (files.length > 1 ? 's' : '') + ' imported');
}
$('#importVids').onchange = e => { importVideos(e.target.files); e.target.value = ''; };
$('#charRef').onchange = e => {
  const f = e.target.files[0]; if (!f) return; const r = new FileReader();
  r.onload = () => { S.charRef = r.result; storeFrom(r.result, 'refs', 'character').then(pth => { S.charRefFile = pth; saveDraft(); }); $('#charPrev').innerHTML = `<img src="${r.result}" alt="Character reference" style="max-width:100%;max-height:120px;border-radius:6px;display:block;margin-bottom:6px">Used as the first frame for scene 1 and any scene that isn't chained.`; };
  r.readAsDataURL(f);
};

// ---------------- Generation ----------------
function setStatus(s, st, msg) {
  s.status = st; s.msg = msg || ''; renderScenes();
  if (S.sel === s.id) { const m = $('#iMsg'); if (m) { m.textContent = s.msg; m.style.display = s.msg ? '' : 'none'; m.className = 'note' + (st === 'error' ? ' err' : ''); } const so = statusOf(s); $('#iGenLbl').textContent = so.gen; $('#iGenMain').disabled = st === 'busy'; }
}
async function runGen(list) {
  if (S.genBusy) { toast('Generation already running'); return; }
  if (!list.length) { toast('Nothing to generate'); return; }
  S.genBusy = true; S.stopGen = false; $('#btnStopGen').disabled = false;
  try {
    for (const s of list) {
      if (S.stopGen) break;
      try { await genScene(s); } catch (e) { setStatus(s, 'error', e.message || String(e)); }
      renderTimeline(); if (S.sel === s.id) { renderInspector(); renderViewerTop(); }
    }
  } finally { S.genBusy = false; $('#btnStopGen').disabled = true; saveDraft(); renderAll(); }
}
async function genScene(s) {
  const i = S.scenes.indexOf(s); if (i < 0) return;
  const prev = S.scenes[i - 1];
  let startImg = null, how = 'from text';
  if (s.chain && prev && prev.kind) { setStatus(s, 'busy', 'Grabbing the last frame of scene ' + i + '…'); startImg = await lastFrame(prev, i - 1); how = 'continuing from scene ' + i; }
  else if (s.board && s.approved) { startImg = await imgToData(s.board); how = 'from the approved storyboard frame'; }
  else if (sceneRefImg(s)) { const a = sceneRefImg(s); startImg = await imgToData(a.img); how = 'from the ' + a.name + ' reference'; }
  else if (S.charRef) { startImg = S.charRef; how = 'from the character reference'; }
  const prompt = fullPrompt(s);
  if (S.settings.provider === 'demo') {
    setStatus(s, 'busy', 'Rendering demo clip (' + how + ')…'); await sleep(500);
    s.chainImg = startImg ? await imgFrom(startImg) : null; s.fromLbl = startImg ? how : ''; s.kind = 'demo'; s.vEl = null; s.video = null; s.remote = null;
    setStatus(s, 'done', 'Placeholder clip ' + how + '. Connect fal.ai in Settings to generate real video.'); return;
  }
  const durs = String(S.settings.durs).split(',').map(Number).filter(Boolean);
  const want = Math.max(s.dur, s.aDur || 0);
  const d = durs.length ? (durs.find(x => x >= want) || durs[durs.length - 1]) : Math.round(want);
  const input = { prompt, aspect_ratio: $('#aspect').value, duration: S.settings.durStr ? String(d) : d };
  if (startImg) input.image_url = startImg;
  const model = startImg ? S.settings.i2v : S.settings.t2v;
  setStatus(s, 'busy', 'Submitting to fal.ai (' + how + ')…');
  const url = await falRun(model, input, st => setStatus(s, 'busy', st + ' · ' + how));
  setStatus(s, 'busy', 'Downloading clip…');
  let local = url;
  try { const b = await (await fetch(url)).blob(); local = URL.createObjectURL(b); } catch (e) { /* use remote url */ }
  await setClip(s, local, url);
  setStatus(s, 'done', 'Generated ' + how + ' · ' + s.vDur.toFixed(1) + ' s');
}
async function falRun(model, input, onStatus) {
  const out = await falQueue(model, input, onStatus);
  const url = out.video?.url || out.videos?.[0]?.url || out.output?.video?.url || out.data?.video?.url;
  if (!url) throw new Error('No video URL in the result: ' + JSON.stringify(out).slice(0, 200));
  return url;
}
async function falQueue(model, input, onStatus = () => {}, purpose) {
  if (!AI.fal) throw new Error('fal.ai is not set up on the server yet.');
  purpose = purpose || (input.image_size ? 'image' : 'video');
  return Backend.falJob(model, input, { purpose, projectId: S.pid, onStatus, shouldStop: () => S.stopGen });
}
async function runVo(list) {
  if (!AI.elevenlabs) { toast('ElevenLabs is not set up on the server yet. You can upload audio per scene in the Audio tab.', 5000); return; }
  for (const s of list) {
    if (!s.vo.trim()) continue;
    try {
      setStatus(s, 'busy', 'Making voiceover…');
      if (S.stopGen) break;
      await setVo(s, URL.createObjectURL(await Backend.tts(S.settings.voice, S.settings.elModel, s.vo)));
      setStatus(s, s.kind ? 'done' : 'idle', 'Voiceover ' + s.aDur.toFixed(1) + ' s');
    } catch (e) { setStatus(s, 'error', e.message); }
  }
  renderAll();
}
$('#btnGenAll').onclick = () => runGen(S.scenes.filter(s => !s.kind || s.status === 'error'));
$('#btnVoAll').onclick = $('#btnVoAll2').onclick = () => runVo(S.scenes.filter(s => !s.voUrl));
$('#btnStopGen').onclick = () => { S.stopGen = true; toast('Stopping after the current step…'); };

// ---------------- Drawing ----------------
function drawCover(c, src, w, h, z) {
  const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
  if (!sw || !sh) return;
  const sc = Math.max(w / sw, h / sh) * z, dw = sw * sc, dh = sh * sc;
  c.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
function drawDemo(c, s, t, i, w, h, bare) {
  const k = t / Math.max(1, s.dur);
  if (s.chainImg) { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); drawCover(c, s.chainImg, w, h, 1 + 0.06 * k); c.fillStyle = `hsla(${s.hue},60%,30%,${0.1 + 0.08 * k})`; c.fillRect(0, 0, w, h); }
  else {
    c.fillStyle = `hsl(${s.hue},62%,${14 + 5 * k}%)`; c.fillRect(0, 0, w, h);
    c.fillStyle = `hsl(${s.hue},68%,${9 + 3 * k}%)`; c.fillRect(0, h * 0.55, w, h * 0.45);
    c.fillStyle = 'rgba(159,211,234,.12)';
    [[0.26, 0.39, 0.19, 0.04], [0.56, 0.63, 0.54, 0.44], [0.79, 0.83, 0.78, 0.72]].forEach(([a, b, d, e]) => { c.beginPath(); c.moveTo(w * a, 0); c.lineTo(w * b, 0); c.lineTo(w * d, h); c.lineTo(w * e, h); c.fill(); });
  }
  for (let j = 0; j < 7; j++) {
    const x = w * ((0.12 + j * 0.13 + k * 0.05 + i * 0.07) % 1), y = h * (0.25 + 0.5 * ((j * 0.37 + i * 0.11) % 1) - 0.05 * k), r = Math.min(w, h) * (0.004 + 0.002 * (j % 3));
    c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fillStyle = 'rgba(207,234,245,.5)'; c.fill();
  }
  if (bare) return;
  const fs = Math.round(Math.min(w, h) * 0.026);
  c.font = `500 ${fs}px Inter,system-ui,sans-serif`; c.textBaseline = 'middle';
  const tag = `[Demo clip · scene ${i + 1}${s.fromLbl ? ' · ' + s.fromLbl : ''}]`, tw = c.measureText(tag).width;
  c.fillStyle = 'rgba(11,11,13,.75)'; c.fillRect(fs, fs, tw + fs, fs * 1.8); c.fillStyle = '#EDEDF0'; c.fillText(tag, fs * 1.5, fs * 1.9);
}
function drawSlate(c, s, i, w, h) {
  c.fillStyle = '#0B0B0D'; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(255,255,255,.12)'; c.setLineDash([10, 10]); c.lineWidth = 2; c.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9); c.setLineDash([]);
  const fs = Math.round(Math.min(w, h) * 0.04);
  c.fillStyle = '#FF8F52'; c.font = `600 ${fs}px Inter,system-ui,sans-serif`; c.textBaseline = 'middle'; c.textAlign = 'left';
  c.fillText('Scene ' + (i + 1) + ' · not generated', fs * 2, h * 0.3);
  c.fillStyle = '#9C9CA6'; c.font = `${Math.round(fs * 0.62)}px Inter,system-ui,sans-serif`;
  wrap(c, fullPrompt(s) || 'Write a script and a visual for this scene in the inspector.', fs * 2, h * 0.3 + fs * 1.5, w - fs * 4, fs * 0.95, 7);
}
function wrap(c, text, x, y, mw, lh, maxL) {
  const words = String(text).split(/\s+/); let line = '', n = 0;
  for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (c.measureText(t).width > mw && line) { c.fillText(line, x, y + n * lh); line = wd; if (++n >= maxL) return; } else line = t; }
  if (line) c.fillText(line, x, y + n * lh);
}
function drawCaption(c, text, w, h) {
  if (!text) return;
  const fs = Math.round(Math.min(w, h) * 0.04); c.font = `600 ${fs}px Inter,system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  const words = text.split(/\s+/), lines = []; let line = '';
  for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (c.measureText(t).width > w * 0.8 && line) { lines.push(line); line = wd; } else line = t; }
  if (line) lines.push(line);
  const show = lines.slice(-2), lh = fs * 1.35, y0 = h - h * 0.08 - (show.length - 1) * lh;
  show.forEach((l, j) => { const tw = c.measureText(l).width; c.fillStyle = 'rgba(0,0,0,.65)'; const bx = w / 2 - tw / 2 - fs * 0.5, by = y0 + j * lh - lh / 2; c.beginPath(); (c.roundRect ? c.roundRect(bx, by, tw + fs, lh, 4) : c.rect(bx, by, tw + fs, lh)); c.fill(); c.fillStyle = '#fff'; c.fillText(l, w / 2, y0 + j * lh); });
  c.textAlign = 'left';
}
function captionText(s, local, len) {
  if (!s.vo) return '';
  const words = s.vo.split(/\s+/), span = s.aDur || len;
  const n = Math.min(words.length, Math.ceil(words.length * Math.min(1, (local + 0.3) / span)));
  const chunk = 10, start = Math.floor(Math.max(0, n - 1) / chunk) * chunk;
  return words.slice(start, n).join(' ');
}

// ---------------- Playback engine ----------------
function clipLen(s) { return s.kind === 'video' ? Math.max(0.2, (s.trimOut ?? s.vDur) - s.trimIn) : s.dur; }
function segLen(s) { return Math.max(clipLen(s), s.voUrl ? s.aDur + 0.25 : 0); }
function buildSegs() { let t = 0; return S.scenes.map((s, i) => { const g = { s, i, t0: t, len: segLen(s) }; t += g.len; return g; }); }
function totalLen() { return S.scenes.reduce((a, s) => a + segLen(s), 0); }
const P = { t: 0, playing: false, cur: -1, wall0: 0, snap: null, raf: 0, onEnd: null };
function segAt(t) { const segs = buildSegs(); for (const g of segs) if (t < g.t0 + g.len) return g; return segs[segs.length - 1]; }
function frame(g, local) {
  const s = g.s, cl = clipLen(s);
  cx.save();
  if (s.kind === 'video' && s.vEl) { const hold = local > cl ? 1 + 0.05 * Math.min(1, (local - cl) / 4) : 1; cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H); drawCover(cx, s.vEl, W, H, hold); }
  else if (s.kind === 'demo') drawDemo(cx, s, Math.min(local, s.dur), g.i, W, H);
  else drawSlate(cx, s, g.i, W, H);
  if (g.i > 0 && s.transition === 'fade' && local < s.tdur && P.snap) { cx.globalAlpha = 1 - local / s.tdur; cx.drawImage(P.snap, 0, 0, W, H); cx.globalAlpha = 1; }
  if ((s.transition === 'black' || s.transition === 'white') && local < s.tdur) { cx.fillStyle = (s.transition === 'black' ? 'rgba(0,0,0,' : 'rgba(255,255,255,') + (1 - local / s.tdur) + ')'; cx.fillRect(0, 0, W, H); }
  if (g.i > 0 && s.transition === 'wipe' && local < s.tdur && P.snap) { const x0 = W * (local / s.tdur); cx.drawImage(P.snap, x0, 0, W - x0, H, x0, 0, W - x0, H); cx.fillStyle = '#FF8F52'; cx.fillRect(x0 - 2, 0, 3, H); }
  if (g.i > 0 && s.transition === 'zoom' && local < s.tdur && P.snap) { const k = local / s.tdur, z = 1 + 0.6 * k; cx.globalAlpha = 1 - k; cx.drawImage(P.snap, W / 2 - W * z / 2, H / 2 - H * z / 2, W * z, H * z); cx.globalAlpha = 1; }
  const nx = S.scenes[g.i + 1];
  if (nx && (nx.transition === 'black' || nx.transition === 'white') && local > g.len - nx.tdur) { cx.fillStyle = (nx.transition === 'black' ? 'rgba(0,0,0,' : 'rgba(255,255,255,') + Math.min(1, (local - (g.len - nx.tdur)) / nx.tdur) + ')'; cx.fillRect(0, 0, W, H); }
  if ($('#captions').checked) drawCaption(cx, captionText(s, local, g.len), W, H);
  cx.restore();
}
function snapshot() { const o = P.snap && P.snap.width === W && P.snap.height === H ? P.snap : document.createElement('canvas'); o.width = W; o.height = H; o.getContext('2d').drawImage(cv, 0, 0); P.snap = o; }
async function enterSeg(g, local) {
  const s = g.s;
  if (s.kind === 'video' && s.vEl) { const v = s.vEl; v.muted = true; await seekV(v, s.trimIn + Math.min(local, clipLen(s) - 0.05)); if (local < clipLen(s)) v.play().catch(() => {}); }
  if (s.aEl) { s.aEl.currentTime = Math.min(local, s.aDur); if (local < s.aDur) s.aEl.play().catch(() => {}); }
  duck(!!s.aEl && local < s.aDur);
  const nx = S.scenes[g.i + 1]; if (nx && nx.vEl) seekV(nx.vEl, nx.trimIn);
}
function leaveSeg(g) { const s = g.s; if (s.vEl) s.vEl.pause(); if (s.aEl) s.aEl.pause(); }
function pauseAll() { S.scenes.forEach(s => { if (s.vEl) s.vEl.pause(); if (s.aEl) s.aEl.pause(); }); if (S.music) S.music.pause(); }
const PLAY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
async function play() {
  if (!S.scenes.length) { toast('No scenes yet'); return; }
  ensureAudio();
  if (P.t >= totalLen() - 0.05) P.t = 0;
  P.playing = true; $('#btnPlay').innerHTML = PAUSE_ICON; $('#btnPlay').setAttribute('aria-label', 'Pause');
  const g = segAt(P.t); P.cur = g.i;
  await enterSeg(g, P.t - g.t0);
  if (S.music) { S.music.currentTime = P.t % (S.music.duration || 1e9); S.music.play().catch(() => {}); }
  P.wall0 = performance.now() - P.t * 1000;
  cancelAnimationFrame(P.raf); P.raf = requestAnimationFrame(tick);
}
function stop() { P.playing = false; cancelAnimationFrame(P.raf); pauseAll(); $('#btnPlay').innerHTML = PLAY_ICON; $('#btnPlay').setAttribute('aria-label', 'Play'); }
let switching = false;
async function tick() {
  if (!P.playing) return;
  const segs = buildSegs(), total = totalLen();
  P.t = (performance.now() - P.wall0) / 1000;
  if (P.t >= total) { P.t = total; stop(); const L = segs[segs.length - 1]; frame(L, L.len - 0.01); movePlayhead(); if (P.onEnd) { const f = P.onEnd; P.onEnd = null; f(); } return; }
  let g = segs[P.cur];
  if (!g || P.t >= g.t0 + g.len) {
    if (switching) { P.raf = requestAnimationFrame(tick); return; }
    switching = true;
    if (g) { snapshot(); leaveSeg(g); }
    g = segAt(P.t); P.cur = g.i;
    if (S.sel !== g.s.id) { S.sel = g.s.id; renderScenes(); renderInspector(); renderViewerTop(); $$('.clip').forEach((c, k) => c.classList.toggle('sel', k === g.i)); }
    const tA = performance.now(); await enterSeg(g, P.t - g.t0); P.wall0 += performance.now() - tA;
    switching = false;
  }
  const local = P.t - g.t0;
  if (g.s.vEl && local >= clipLen(g.s) && !g.s.vEl.paused) g.s.vEl.pause();
  if (g.s.vEl && g.s.trimOut != null && g.s.vEl.currentTime >= g.s.trimOut) g.s.vEl.pause();
  if (g.s.aEl && local >= g.s.aDur) duck(false);
  frame(g, local); movePlayhead();
  P.raf = requestAnimationFrame(tick);
}
async function seekTo(t) { const was = P.playing; stop(); P.t = Math.max(0, Math.min(t, totalLen())); await drawAt(P.t); movePlayhead(); if (was) play(); }
async function drawAt(t) {
  if (!S.scenes.length) {
    cx.fillStyle = '#0B0B0D'; cx.fillRect(0, 0, W, H); cx.fillStyle = '#9C9CA6'; cx.font = `500 ${Math.round(Math.min(W, H) * 0.03)}px Inter,system-ui`; cx.textAlign = 'center';
    cx.fillText('Create a scene, paste a script, or import videos', W / 2, H / 2); cx.textAlign = 'left'; return;
  }
  const g = segAt(t); if (!g) return; const local = t - g.t0;
  if (g.s.vEl) await seekV(g.s.vEl, g.s.trimIn + Math.min(local, clipLen(g.s) - 0.05));
  P.snap = null; frame(g, local);
}
$('#btnPlay').onclick = () => P.playing ? stop() : play();
$('#btnPrev').onclick = () => { const segs = buildSegs(), g = segAt(P.t); if (!g) return; const tgt = P.t - g.t0 > 0.5 ? g : segs[Math.max(0, g.i - 1)]; select(tgt.s.id, true); };
$('#btnNext').onclick = () => { const segs = buildSegs(), g = segAt(P.t); if (!g) return; const n = segs[g.i + 1]; if (n) select(n.s.id, true); };
$('#captions').onchange = () => { if (!P.playing) drawAt(P.t); };
$('#btnFull').onclick = () => { try { (cv.requestFullscreen || cv.webkitRequestFullscreen).call(cv); } catch (e) { toast('Full screen is not available here'); } };
document.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (S.stage !== 'studio') return;
  if (e.code === 'Space') { e.preventDefault(); P.playing ? stop() : play(); }
  if (e.key === 'ArrowRight') $('#btnNext').click();
  if (e.key === 'ArrowLeft') $('#btnPrev').click();
});

// ---------------- Audio graph ----------------
let AC = null, DEST = null, MUSIC_G = null, MASTER = null;
function ensureAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    DEST = AC.createMediaStreamDestination(); MASTER = AC.createGain(); MASTER.gain.value = S.muted ? 0 : 1; MASTER.connect(AC.destination);
    S.scenes.forEach(s => { if (s.aEl) routeEl(s.aEl); });
    if (S.music) routeEl(S.music, true);
  } catch (e) { AC = null; }
}
function routeEl(el, isMusic) {
  if (!AC || el._routed) return;
  try {
    const src = AC.createMediaElementSource(el), g = AC.createGain();
    g.gain.value = isMusic ? S.musicVol : 1; src.connect(g); g.connect(MASTER); g.connect(DEST); el._routed = true;
    if (isMusic) MUSIC_G = g;
  } catch (e) { /* already routed */ }
}
function duck(on) { if (MUSIC_G && AC) MUSIC_G.gain.setTargetAtTime(on && S.duck ? S.musicVol * 0.3 : S.musicVol, AC.currentTime, 0.25); }
$('#btnMute').onclick = () => { S.muted = !S.muted; if (MASTER) MASTER.gain.value = S.muted ? 0 : 1; $('#muteWaves').style.display = S.muted ? 'none' : ''; $('#btnMute').setAttribute('aria-label', S.muted ? 'Unmute preview' : 'Mute preview'); };
$('#musicFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  if (S.music) S.music.pause();
  S.music = await loadAudio(URL.createObjectURL(f)); S.music.loop = true; S.musicName = f.name; MUSIC_G = null; if (AC) routeEl(S.music, true);
  $('#musicLbl').textContent = '♪ ' + f.name.slice(0, 28); renderTimeline(); e.target.value = '';
  S.musicFile = await storeFrom(S.music.src, 'music', 'bed'); saveDraft();
};
$('#musicVol').oninput = e => { S.musicVol = +e.target.value / 100; $('#musicVolTxt').textContent = e.target.value + '%'; if (MUSIC_G) MUSIC_G.gain.value = S.musicVol; renderTimeline(); };
$('#musicVol').onchange = () => saveDraft();
$('#duckOn').onchange = e => { S.duck = e.target.checked; renderTimeline(); saveDraft(); };
$('#musicRemove').onclick = () => { if (S.music) S.music.pause(); if (S.musicFile) Vault.del(S.musicFile).then(refreshFiles).catch(() => {}); S.music = null; S.musicFile = null; MUSIC_G = null; S.musicName = ''; saveDraft(); $('#musicLbl').textContent = 'Add a music bed…'; renderTimeline(); };

// ---------------- Export ----------------
async function quickRecord() {
  if (S.stage !== 'studio') { goStage('studio'); await sleep(80); }
  if (!S.scenes.length) { toast('Nothing to export yet'); return; }
  if (!window.MediaRecorder || !cv.captureStream) { toast('Export needs Chrome, Edge or Firefox on a computer'); return; }
  ensureAudio(); stop();
  if (AC && AC.state !== 'running') { try { await AC.resume(); } catch (e) {} }
  const hasAudio = !!(S.music || S.scenes.some(s => s.aEl)) && AC && AC.state === 'running';
  const types = ['video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  const tracks = [...cv.captureStream(30).getVideoTracks(), ...(hasAudio && DEST ? DEST.stream.getAudioTracks() : [])];
  const rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : undefined);
  const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const btn = $('#btnExport'), lbl = btn.querySelector('span');
  rec.onstop = () => {
    const type = rec.mimeType || mime || 'video/webm', ext = type.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(new Blob(chunks, { type }));
    const name = ($('#title').value || 'video').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.' + ext;
    $('#exportOut').innerHTML = `Export ready · <a href="${url}" download="${esc(name)}">Download ${esc(name)}</a>`;
    btn.disabled = false; lbl.textContent = 'Export';
    try { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); } catch (e) {}
  };
  btn.disabled = true; lbl.textContent = 'Recording…';
  $('#exportOut').textContent = 'Recording in real time (' + fmt(totalLen()) + '). Keep this tab visible.';
  P.t = 0; P.onEnd = () => setTimeout(() => rec.stop(), 300);
  rec.start(500); await play();
}
const EXP = { id: null, timer: null };
function exportSlug() { return ($('#title').value || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'video'; }
function exportMeta() {
  const fmtv = $('#exFormat').value, res = $('#exRes').value, secs = totalLen();
  $('#exName').textContent = exportSlug() + '.' + fmtv;
  const mbps = fmtv === 'gif' ? 1.2 : { '480p': 1.4, '720p': 2.8, '1080p': 5.5 }[res] * (fmtv === 'mov' ? 1.1 : 1);
  $('#exSize').textContent = 'About ' + fmtSize(Math.max(1e5, secs * mbps * 125000));
  $$('.excards button').forEach(b => b.setAttribute('aria-checked', b.dataset.fmt === fmtv));
  $$('#exResSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === res));
  $$('#exFpsSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === $('#exFps').value));
  $('#exClipAudio').disabled = $('#exCaps').disabled = false; if (fmtv === 'gif') $('#exClipAudio').disabled = true;
}
function openExport() {
  if (!S.pid) { toast('Open a project first'); return; }
  if (!S.scenes.length) { toast('Nothing to export yet'); return; }
  $('#exCaps').checked = $('#captions').checked;
  $('#exLen').textContent = pl(S.scenes.length, 'scene') + ' · ' + fmt(totalLen()) + ' · ' + $('#aspect').value;
  const missing = S.scenes.filter(s => s.kind !== 'video' || !s.file).length;
  $('#exReady').innerHTML = missing ? `<span class="dot busy" aria-hidden="true"></span>${missing} of ${S.scenes.length} not generated · they render as slates` : `<span class="dot ready" aria-hidden="true"></span>All ${S.scenes.length} clips ready`;
  const c = $('#exThumb'); if (S.scenes[0]) thumb(S.scenes[0], 0, c);
  if (!EXP.id) $('#exResult').textContent = '';
  exportMeta();
  $('#exportDlg').classList.add('on');
}
$$('.excards button').forEach(b => b.onclick = () => { $('#exFormat').value = b.dataset.fmt; exportMeta(); });
$$('#exResSeg button').forEach(b => b.onclick = () => { $('#exRes').value = b.dataset.v; exportMeta(); });
$$('#exFpsSeg button').forEach(b => b.onclick = () => { $('#exFps').value = b.dataset.v; exportMeta(); });
$('#exClose').onclick = () => closeExport();
function closeExport() { $('#exportDlg').classList.remove('on'); }
function showExport(e) {
  const busy = e.status === 'queued' || e.status === 'running';
  $('#exProg').style.display = 'flex'; $('#exBar').style.width = (e.status === 'succeeded' ? 100 : e.progress) + '%';
  $('#exPct').textContent = (e.status === 'succeeded' ? 100 : e.progress) + '%';
  $('#exState').textContent = { queued: 'Waiting for the renderer…', running: 'Rendering…', succeeded: 'Done', failed: 'Failed', canceled: 'Cancelled' }[e.status] || e.status;
  $('#exGo').disabled = busy; $('#exCancel').style.display = busy ? '' : 'none';
  $('#btnExport').querySelector('span').textContent = busy ? 'Rendering ' + e.progress + '%' : 'Export';
  if (e.status === 'succeeded') {
    $('#exResult').innerHTML = `Ready · <a href="${esc(e.downloadUrl)}" download="${esc(e.fileName)}">Download ${esc(e.fileName)}</a> (${fmtSize(e.sizeBytes || 0)})`;
    toast('Export ready: ' + e.fileName); refreshFiles();
  } else if (e.status === 'failed') $('#exResult').textContent = 'The render failed: ' + (e.error || 'unknown error');
  else if (e.status === 'canceled') $('#exResult').textContent = 'Render cancelled.';
}
async function pollExport() {
  clearTimeout(EXP.timer); if (!EXP.id) return;
  try {
    const e = await Backend.getExport(EXP.id); showExport(e);
    if (e.status === 'queued' || e.status === 'running') EXP.timer = setTimeout(pollExport, 1500); else EXP.id = null;
  } catch (err) { $('#exResult').textContent = 'Lost track of the render: ' + err.message; EXP.id = null; }
}
$('#btnExport').onclick = openExport;
$('#exX').onclick = closeExport;
$('#exGo').onclick = async () => {
  saveDraft(); $('#exGo').disabled = true; $('#exResult').textContent = 'Saving the project and sending it to the renderer…';
  try {
    const e = await Backend.startExport(S.pid, { format: $('#exFormat').value, resolution: $('#exRes').value, fps: +$('#exFps').value, captions: $('#exCaps').checked, clipAudio: $('#exClipAudio').checked });
    EXP.id = e.id; $('#exResult').textContent = ''; showExport(e); pollExport();
  } catch (err) { $('#exGo').disabled = false; $('#exResult').textContent = err.message; }
};
$('#exCancel').onclick = async () => { if (EXP.id) { await Backend.cancelExport(EXP.id).catch(() => {}); pollExport(); } };
$('#exQuick').onclick = () => { closeExport(); quickRecord(); };

// ---------------- Save / load ----------------
$('#btnSaveJson').onclick = () => {
  const data = { app: 'MitomeStudio', v: 2, title: $('#title').value, aspect: $('#aspect').value, script: $('#script').value, style: $('#style').value, scenes: S.scenes.map(sceneMeta), assets: S.assets.map(assetMeta) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = (data.title || 'project').replace(/\W+/g, '-') + '.json'; document.body.appendChild(a); a.click(); a.remove();
  saveDraft(); toast('Project saved. Imported clips are not inside the file; generated clips are linked by URL.');
};
$('#loadJson').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); S.pid = uid(); await loadProject(d); saveDraft(); goStage(d.stage || 'studio'); toast('Project opened'); } catch (err) { toast('Could not read project: ' + err.message); } e.target.value = ''; };
async function loadProject(d) {
  stop(); pauseAll(); S.aSel = null; S.sel = null; S.lastStage = d.stage; if (typeof F !== 'undefined') { F.fitted = false; closePop(); }
  $('#title').value = d.title || ''; $('#aspect').value = d.aspect || '16:9'; $('#script').value = d.script || ''; $('#style').value = d.style || '';
  S.season = d.seasonId ? store.get('ms_season_' + d.seasonId, null) : null;
  S.show = S.season && S.season.showId ? store.get('ms_show_' + S.season.showId, null) : null;
  S.assets = [...(S.show ? (S.show.assets || []).map(a => Object.assign({ status: '' }, a, { scope: 'show' })) : []), ...(S.season ? (S.season.assets || []).map(a => Object.assign({ status: '' }, a, { scope: 'season' })) : []), ...(d.assets || []).map(a => Object.assign({ status: '' }, a))];
  S.scenes = (d.scenes || []).map(m => newScene(Object.assign({}, m, { kind: m.kind === 'demo' ? 'demo' : null })));
  S.sel = S.scenes[0]?.id || null; P.t = 0; setAspect(); renderAll();
  S.charRef = null; S.charRefFile = d.charRefFile || null; $('#charPrev').textContent = 'Used as the first frame for scene 1 and any scene that isn\'t chained.';
  refreshFiles();
  try { await Backend.sign([...S.assets.map(a => a.imgFile), ...S.scenes.flatMap(s => [s.file, s.voFile, s.boardFile]), d.charRefFile, d.musicFile]); } catch (e) {}
  for (const a of S.assets) if (a.imgFile) { const u = await vaultURL(a.imgFile); if (u) a.img = u; }
  for (const s of S.scenes) {
    if (s.boardFile) { const u = await vaultURL(s.boardFile); if (u) s.board = u; }
    const tIn = s.trimIn, tOut = s.trimOut;
    if (s.file) { const u = await vaultURL(s.file); if (u) { try { await setClip(s, u, s.remote, true); s.trimIn = tIn || 0; s.trimOut = tOut ?? null; s.status = 'done'; } catch (e) { s.msg = 'Could not read ' + s.file; } } else s.msg = 'File missing from app storage'; }
    else if (s.remote) { try { await setClip(s, s.remote, s.remote); s.trimIn = tIn || 0; s.trimOut = tOut ?? null; s.status = 'done'; } catch (e) { s.msg = 'Clip link has expired – regenerate'; } }
    if (s.voFile) { const u = await vaultURL(s.voFile); if (u) { try { await setVo(s, u, true); } catch (e) {} } }
  }
  if (S.music) S.music.pause();
  S.music = null; MUSIC_G = null; S.musicFile = d.musicFile || null; S.musicName = d.musicName || ''; S.musicVol = d.musicVol ?? 0.25; S.duck = d.duck ?? true;
  $('#musicVol').value = Math.round(S.musicVol * 100); $('#musicVolTxt').textContent = Math.round(S.musicVol * 100) + '%'; $('#duckOn').checked = S.duck; $('#musicLbl').textContent = 'Add a music bed…';
  if (S.musicFile) { const u = await vaultURL(S.musicFile); if (u) { try { S.music = await loadAudio(u); S.music.loop = true; if (AC) routeEl(S.music, true); $('#musicLbl').textContent = '♪ ' + (S.musicName || 'Music').slice(0, 28); } catch (e) {} } }
  if (S.charRefFile) { const b = await Vault.get(S.charRefFile); if (b) { S.charRef = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); $('#charPrev').innerHTML = `<img src="${S.charRef}" alt="Character reference" style="max-width:100%;max-height:120px;border-radius:6px;display:block;margin-bottom:6px">Used as the first frame for scene 1 and any scene that isn't chained.`; } }
  renderAll();
}

// ---------------- Settings ----------------
const SF = { sLlm: 'llm', sLlmModel: 'llmModel', sImgModel: 'imgModel', sProvider: 'provider', sT2V: 't2v', sI2V: 'i2v', sDurs: 'durs', sVoice: 'voice', sElModel: 'elModel', sWps: 'wps', sTarget: 'target' };
const onOff = (on, name) => on ? name + ' is connected on the server.' : name + ' is not set up on the server yet (ask the admin to add the key).';
function syncSettingsControls() {
  $$('#sThemeSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === $('#sTheme').value));
  const prov = $('#sProvider').value;
  $$('.setcards button').forEach(b => b.setAttribute('aria-checked', b.dataset.v === prov));
  $('#falBox').classList.toggle('off', prov !== 'fal');
  $$('#falBox input').forEach(x => x.disabled = prov !== 'fal');
}
function openSettings() {
  for (const [id, k] of Object.entries(SF)) $('#' + id).value = S.settings[k];
  $('#sTheme').value = themePref();
  $('#sDurStr').checked = !!S.settings.durStr;
  $('#sFalNote').textContent = onOff(AI.fal, 'fal.ai') + (AI.limits && AI.limits.videoPerDay ? ' Daily limit: ' + AI.limits.videoPerDay + ' videos, ' + AI.limits.imagePerDay + ' images.' : '');
  $('#sLlmNote').textContent = 'fal.ai LLM: ' + (AI.fal ? 'ready' : 'not set up') + ' · Claude API: ' + (AI.anthropic ? 'ready' : 'not set up');
  $('#sElNote').textContent = onOff(AI.elevenlabs, 'ElevenLabs voiceover');
  $('#sAccount').textContent = 'Signed in as ' + (Backend.user ? Backend.user.email : '');
  syncSettingsControls();
  document.body.classList.add('insettings');
  $('#settings').classList.add('on'); $('#settings .setbody').scrollTop = 0;
  const cur = $('#sThemeSeg button[aria-pressed=true]'); if (cur) cur.focus();
}
// Settings save as you change them.
function saveSettingsForm() {
  for (const [id, k] of Object.entries(SF)) S.settings[k] = $('#' + id).value.trim();
  S.settings.wps = +S.settings.wps || 2.6; S.settings.target = +S.settings.target || 6;
  S.settings.durStr = $('#sDurStr').checked;
  saveSettings(); updatePill();
  const t = $('#setSaved'); if (t) { t.textContent = 'Saved'; }
}
function closeSettings() {
  saveSettingsForm();
  document.body.classList.remove('insettings');
  $('#settings').classList.remove('on'); renderInspector(); renderViewerTop(); renderExplorer();
}
$('#settings').addEventListener('change', e => { if (e.target.id !== 'sTheme') saveSettingsForm(); });
$('#settings').addEventListener('input', e => { if (e.target.matches('input.inp')) { clearTimeout(saveSettingsForm.t); saveSettingsForm.t = setTimeout(saveSettingsForm, 400); } });
$$('#sThemeSeg button').forEach(b => b.onclick = () => { $('#sTheme').value = b.dataset.v; setThemePref(b.dataset.v); applyTheme(); syncSettingsControls(); });
$$('.setcards button').forEach(b => b.onclick = () => { $('#sProvider').value = b.dataset.v; syncSettingsControls(); saveSettingsForm(); });
$$('.setnav a').forEach(a => a.onclick = e => { e.preventDefault(); const t = $(a.getAttribute('href')); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); $$('.setnav a').forEach(x => x.removeAttribute('aria-current')); a.setAttribute('aria-current', 'true'); });
function updatePill() { const fal = S.settings.provider === 'fal'; $('#provPill').innerHTML = `<span class="dot ${fal ? (AI.fal ? 'ready' : 'error') : 'demo'}"></span>${fal ? 'fal.ai · ' + esc(S.settings.i2v.split('/')[1] || '') + (AI.fal ? '' : ' (not set up)') : 'Demo mode'}`; }
$('#sLogout').onclick = () => Backend.logout();
$('#btnSettings').onclick = openSettings; $('#sClose').onclick = closeSettings; $('#sX').onclick = closeSettings;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#settings').classList.contains('on')) closeSettings(); });

// ---------------- Assets ----------------
const ATYPE = { character: 'Cast', location: 'Location', prop: 'Prop', look: 'Look' };
const AICON = {
  character: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  location: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V9l7-5 7 5v12M10 21v-6h4v6"/></svg>',
  prop: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
  look: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8L20 10l-5 3.6L16.5 20 12 16.4 7.5 20 9 13.6 4 10l6.1-1.2z"/></svg>'
};
function assetMeta(a) { return { id: a.id, scope: a.scope === 'season' || a.scope === 'show' ? a.scope : undefined, type: a.type, name: a.name, desc: a.desc, locks: a.locks, prompt: a.prompt, img: keepUrl(a.img), imgFile: a.imgFile, keys: a.keys }; }
function newAsset(o) { return Object.assign({ id: uid(), type: 'character', name: '', desc: '', locks: '', prompt: '', img: null, keys: '', status: '' }, o); }
function mustContain(s) {
  return (s.assets || []).map(id => S.assets.find(a => a.id === id)).filter(Boolean)
    .map(a => a.name + (a.desc ? ' (' + a.desc.replace(/[.\s]+$/, '') + (a.locks ? '; keep: ' + a.locks.replace(/[.\s]+$/, '') : '') + ')' : (a.locks ? ' (keep: ' + a.locks + ')' : ''))).join('; ');
}
function sceneRefImg(s) {
  const list = (s.assets || []).map(id => S.assets.find(a => a.id === id)).filter(a => a && a.img);
  return list.find(a => a.type === 'location') || list.find(a => a.type === 'character') || list[0] || null;
}
async function imgToData(src) {
  if (/^data:/.test(src)) return src;
  try { const b = await (await fetch(src)).blob(); return await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); } catch (e) { return src; }
}
function assetPrompt(a) {
  const st = [seasonStyle(), $('#style').value.trim()].filter(Boolean).join('. '), keep = a.locks ? ' Must keep: ' + a.locks.replace(/[.\s]+$/, '') + '.' : '', d = (a.desc || a.name).replace(/[.\s]+$/, '');
  const body = {
    character: `Character reference sheet of ${a.name}: ${d}. Front, three-quarter, side and back views in full body, plus a head-and-hair close-up. Neutral grey background, even studio light, no text.${keep}`,
    location: `Empty establishing shot of ${a.name}: ${d}. Wide angle, no people, clear layout of doors, windows and furniture, readable depth.${keep}`,
    prop: `${a.name}: ${d}. Single object, three-quarter view on a plain neutral background, true-to-scale detail, no text or logos.${keep}`,
    look: `Style frame for the film: ${d}. Shows the lighting, colour grade and texture to match.${keep}`
  }[a.type];
  return body + (st ? ' ' + st + '.' : '');
}
function aiMode() { return S.settings.llm === 'fal' ? (AI.fal ? 'fal.ai · ' + S.settings.llmModel : 'fal.ai (not set up on the server)') : S.settings.llm === 'anthropic' ? (AI.anthropic ? 'Claude · ' + S.settings.llmModel : 'Claude (not set up on the server)') : 'Built-in rules'; }
function renderAssets() {
  $('#assetCount').textContent = S.assets.length ? String(S.assets.length) : '';
  $('#aMode').textContent = 'Using: ' + aiMode() + ' · change in Settings';
  $$('[data-af]').forEach(b => b.setAttribute('aria-pressed', b.dataset.af === S.aFilter));
  const list = $('#assetList'); list.innerHTML = '';
  const items = S.assets.filter(a => S.aFilter === 'all' || a.type === S.aFilter);
  if (!items.length) { list.innerHTML = `<p class="muted" style="padding:10px 6px">${S.assets.length ? 'Nothing in this filter.' : 'No assets yet. Use “Find assets in script”, or add cast, locations, props and looks below.'}</p>`; return; }
  items.forEach(a => {
    const used = S.scenes.filter(s => (s.assets || []).includes(a.id)).map(s => S.scenes.indexOf(s) + 1);
    const c = document.createElement('button'); c.className = 'acard'; c.setAttribute('aria-expanded', S.aSel === a.id);
    c.innerHTML = `<span class="aimg" style="${a.img ? `background-image:url('${a.img.replace(/'/g, '%27')}')` : ''}">${a.img ? '' : AICON[a.type]}</span>
      <span class="atx"><b>${esc(a.name || 'Unnamed')}</b><span>${esc(a.desc || 'No description yet')}</span></span>
      <span style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><span style="display:flex;gap:4px">${a.scope === 'season' ? '<span class="atype season">Season</span>' : a.scope === 'show' ? '<span class="atype show">Show</span>' : ''}<span class="atype ${a.type}">${ATYPE[a.type]}</span></span><span class="cap">${used.length ? used.length + ' scene' + (used.length > 1 ? 's' : '') : 'unused'}</span></span>`;
    c.onclick = () => { S.aSel = S.aSel === a.id ? null : a.id; renderAssets(); };
    list.appendChild(c);
    if (S.aSel === a.id) list.appendChild(assetEditor(a, used));
  });
}
function assetEditor(a, used) {
  const e = document.createElement('div'); e.className = 'aedit';
  e.innerHTML = `
    <div class="grid2"><div class="field"><label class="lbl">Name</label><input class="inp" data-k="name" value="${esc(a.name)}"></div>
      <div class="field"><label class="lbl">Type</label><select class="inp" data-k="type">${Object.entries(ATYPE).map(([k, l]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="field"><label class="lbl">Description</label><textarea class="inp" rows="3" data-k="desc" placeholder="Look, age, clothes, materials, layout…">${esc(a.desc)}</textarea></div>
    ${S.season ? `<div class="field"><label class="lbl">Belongs to</label><select class="inp" data-scope><option value="">This episode only</option><option value="season" ${a.scope === 'season' ? 'selected' : ''}>Whole season · ${esc(S.season.title || '')}</option>${S.show ? `<option value="show" ${a.scope === 'show' ? 'selected' : ''}>Whole show · ${esc(S.show.title || '')}</option>` : ''}</select></div>` : ''}
    <div class="field"><label class="lbl">Locks (must never change)</label><input class="inp" data-k="locks" value="${esc(a.locks)}" placeholder="e.g. short close fade with waves, NOT an afro"></div>
    <div class="field"><label class="lbl">Script keywords (for auto-tagging)</label><input class="inp" data-k="keys" value="${esc(a.keys)}" placeholder="e.g. founder, he, Shiro"></div>
    <div class="field"><div style="display:flex;justify-content:space-between;align-items:center"><span class="lbl">Image prompt</span><span style="display:flex;gap:2px"><button class="btn sm" data-act="build" style="height:22px;border:none;background:transparent;color:var(--accent);padding:0 4px">Build</button><button class="btn sm" data-act="copy" style="height:22px;border:none;background:transparent;color:var(--accent);padding:0 4px">Copy</button></span></div>
      <textarea class="inp" rows="5" data-k="prompt" placeholder="Press Build to write a prompt from the description and project style">${esc(a.prompt)}</textarea></div>
    ${a.img ? `<div class="bigimg" style="background-image:url('${a.img.replace(/'/g, '%27')}')"></div>` : ''}
    <div style="display:flex;gap:6px"><label class="btn sm" style="flex:1;margin:0"><input type="file" accept="image/*" hidden data-act="upload">Upload image</label><button class="btn pri sm" data-act="gen" style="flex:1" ${a.status === 'busy' ? 'disabled' : ''}>${a.status === 'busy' ? 'Generating…' : a.img ? 'Regenerate image' : 'Generate image'}</button></div>
    ${a.status && a.status !== 'busy' ? `<div class="note ${a.status.startsWith('Error') ? 'err' : ''}">${esc(a.status)}</div>` : ''}
    <div class="field"><span class="lbl">Used in scenes</span><div class="chips">${S.scenes.map((s, i) => `<button class="chipb" data-sc="${s.id}" aria-pressed="${(s.assets || []).includes(a.id)}">${i + 1}</button>`).join('') || '<span class="cap">No scenes yet</span>'}</div></div>
    <div style="display:flex;gap:6px"><button class="btn sm" data-act="tag" style="flex:1">Auto-tag scenes</button><button class="btn sm" data-act="del" style="flex:1;color:#FF8B73">Delete asset</button></div>`;
  e.querySelectorAll('[data-k]').forEach(el => el.oninput = () => { a[el.dataset.k] = el.value; saveDraft(); if (el.dataset.k === 'type') renderAssets(); else { const card = e.previousElementSibling; if (card) { card.querySelector('.atx b').textContent = a.name || 'Unnamed'; card.querySelector('.atx span').textContent = a.desc || 'No description yet'; } } });
  const scb = e.querySelector('[data-scope]'); if (scb) scb.onchange = () => setScope(a, scb.value || undefined);
  const act = n => e.querySelector(`[data-act="${n}"]`);
  act('build').onclick = () => { a.prompt = assetPrompt(a); saveDraft(); renderAssets(); };
  act('copy').onclick = async () => { try { await navigator.clipboard.writeText(a.prompt || assetPrompt(a)); toast('Prompt copied'); } catch (err) { toast('Copy blocked – select the text and copy it'); } };
  act('upload').onchange = ev => { const f = ev.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = async () => { await setAssetImg(a, r.result); a.status = 'Using uploaded image'; saveDraft(); renderAssets(); renderInspector(); }; r.readAsDataURL(f); };
  act('gen').onclick = () => genAssetImage(a);
  act('tag').onclick = () => { const n = autoTag(S.scenes, [a]); toast(n ? 'Tagged in ' + n + ' scene(s)' : 'No mentions found – add script keywords'); renderAssets(); renderInspector(); };
  act('del').onclick = () => { dropFile(a.imgFile); S.assets = S.assets.filter(x => x !== a); S.scenes.forEach(s => s.assets = (s.assets || []).filter(id => id !== a.id)); S.aSel = null; saveDraft(); renderAssets(); renderInspector(); };
  e.querySelectorAll('[data-sc]').forEach(b => b.onclick = () => { const s = S.scenes.find(x => x.id === b.dataset.sc); s.assets = s.assets || []; s.assets = s.assets.includes(a.id) ? s.assets.filter(x => x !== a.id) : [...s.assets, a.id]; saveDraft(); renderAssets(); if (S.sel === s.id) renderInspector(); });
  return e;
}
async function genAssetImage(a) {
  if (!a.prompt) a.prompt = assetPrompt(a);
  a.status = 'busy'; renderAssets();
  try {
    if (S.settings.provider !== 'fal') {
      await sleep(400); await setAssetImg(a, placeholderAsset(a)); a.status = 'Placeholder image (demo mode). Switch to fal.ai in Settings for real images, or upload one.';
    } else {
      const out = await falQueue(S.settings.imgModel, { prompt: a.prompt, image_size: a.type === 'location' ? 'landscape_16_9' : 'square_hd', num_images: 1 }, undefined, 'image');
      const url = out.images?.[0]?.url || out.image?.url || out.output?.images?.[0]?.url;
      if (!url) throw new Error('No image in the result');
      await setAssetImg(a, url); a.status = 'Generated with ' + S.settings.imgModel;
    }
  } catch (e) { a.status = 'Error: ' + e.message; }
  saveDraft(); renderAssets(); renderInspector();
}
function placeholderAsset(a) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  const hue = { character: 22, location: 200, prop: 45, look: 280 }[a.type];
  x.fillStyle = `hsl(${hue},45%,16%)`; x.fillRect(0, 0, 256, 256); x.fillStyle = `hsl(${hue},70%,60%)`;
  x.font = '600 96px Inter,system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText((a.name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(), 128, 118);
  x.font = '500 18px Inter,system-ui,sans-serif'; x.fillStyle = '#9C9CA6'; x.fillText(ATYPE[a.type] + ' · placeholder', 128, 200);
  return c.toDataURL('image/png');
}
function autoTag(scenes, assets = S.assets) {
  let n = 0;
  scenes.forEach(s => {
    const txt = ((s.vo || '') + ' ' + (s.prompt || '')).toLowerCase();
    assets.forEach(a => {
      const keys = [a.name, ...(a.keys || '').split(',')].map(k => k.trim().toLowerCase()).filter(k => k.length > 1);
      const hit = keys.some(k => new RegExp('\\b' + k.replace(/^the\s+/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(txt));
      s.assets = s.assets || [];
      if (hit && !s.assets.includes(a.id)) { s.assets.push(a.id); n++; }
    });
  });
  saveDraft(); return n;
}
// built-in extraction (no AI)
const STOP = new Set('I The A An And But Then Yet So Or If When While This That These Those He She They We You It His Her Its Our Their My Your There Here What Who Why How Where Every Each Some All No Not One Two Three Four Five Six Seven Eight Nine Ten Glowing Giant Still'.split(' '));
const PLACE = 'room kitchen bedroom bathroom hallway office street road house home flat apartment cafe café bar club restaurant shop store school classroom hall stage studio garden park beach sea ocean lake river forest woods field city town village station platform train bus car taxi plane airport hospital church cathedral rooftop roof lobby lift elevator stairs stairwell basement garage warehouse factory lab laboratory library court courtroom prison cell market alley bridge tunnel desert mountain cave vent vents floor surface deep dark space lot plaza site boardroom meeting'.split(' ');
const PROPS = 'phone laptop computer key keys letter envelope bag case briefcase gun knife ring watch camera book notebook map photo photograph cup mug glass bottle champagne wine car bike door window chair table desk cap hat glasses sunglasses jacket coat suit dress shoes guitar ball trophy medal sign stamp seal plan blueprint sketch drawing model coin card ticket contract pen umbrella torch lamp candle mirror submarine'.split(' ');
const ROLES = 'man woman boy girl founder friend tutor trader teacher student mother father son daughter brother sister wife husband boss client cleaner guest lead doctor nurse officer driver stranger child kid baby grandmother grandfather manager worker engineer artist chef waiter'.split(' ');
function extractBasic(text) {
  const out = [], seen = new Set(), add = (type, name, desc) => { const k = type + ':' + name.toLowerCase(); if (seen.has(k) || S.assets.some(a => a.name.toLowerCase() === name.toLowerCase())) return; seen.add(k); out.push(newAsset({ type, name, desc })); };
  const names = {};
  text.split(/(?<=[.!?])\s+|\n+/).forEach(sent => { const toks = sent.match(/[A-Za-z][\w'’-]*/g) || []; toks.slice(1).forEach(t => { if (/^[A-Z][a-z]{2,}$/.test(t) && !STOP.has(t)) names[t] = (names[t] || 0) + 1; }); });
  Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([n]) => add('character', n, ''));
  (text.match(new RegExp('\\b(?:a|an|the|his|her|their)\\s+(?:(?:young|old|older|little|new)\\s+)?(' + ROLES.join('|') + ')s?\\b', 'gi')) || []).forEach(m => { const role = m.split(/\s+/).pop().toLowerCase().replace(/s$/, ''); add('character', 'The ' + role, m.trim()); });
  (text.match(/\b(?:in|at|inside|into|through|on|across|outside|near|onto|around|down)\s+(?:the|a|an|his|her|their)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,2})/gi) || []).forEach(m => {
    const words = m.split(/\s+/).slice(2), cut = []; for (const w of words) { cut.push(w.toLowerCase()); if (PLACE.includes(w.toLowerCase())) { add('location', cap(cut.join(' ')), ''); break; } }
  });
  (text.match(new RegExp('\\b(?:a|an|the|his|her|their)\\s+(?:[a-z]+\\s+)?(' + PROPS.join('|') + ')\\b', 'gi')) || []).forEach(m => { const w = m.split(/\s+/).slice(1).join(' '); add('prop', cap(w), ''); });
  return out;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
async function askAI(system, user) {
  const p = S.settings.llm;
  if (p === 'anthropic' && !AI.anthropic) throw new Error('The Claude API is not set up on the server yet.');
  if (p === 'fal' && !AI.fal) throw new Error('fal.ai is not set up on the server yet.');
  if (p === 'anthropic') return Backend.llm('anthropic', S.settings.llmModel || 'claude-sonnet-5-5', system, user);
  if (p === 'fal') return Backend.llm('fal', S.settings.llmModel, system, user);
  throw new Error('Prompt AI is off');
}
function parseJSON(t) { const m = t.match(/\{[\s\S]*\}/); if (!m) throw new Error('The AI did not return JSON'); return JSON.parse(m[0]); }
function scriptForAI() { return S.scenes.length ? S.scenes.map((s, i) => `Scene ${i + 1}: ${s.vo || s.prompt}`).join('\n') : $('#script').value; }
$('#aExtract').onclick = async () => {
  const text = scriptForAI().trim(); if (!text) { toast('Write a script or create scenes first'); return; }
  const btn = $('#aExtract'); btn.disabled = true; btn.textContent = 'Finding…';
  try {
    let found = [];
    if (S.settings.llm === 'off') found = extractBasic(text);
    else {
      const j = parseJSON(await askAI('You are a film pre-production assistant. Read the script and list the recurring visual assets needed to keep continuity: characters (cast), locations, important props, and at most one overall look. No real people or brands. Reply with JSON only: {"assets":[{"type":"character|location|prop|look","name":"short name","desc":"one-sentence visual description: age, build, clothes, hair / materials / layout","locks":"details that must never change, or empty","keys":"comma-separated words used for this asset in the script","scenes":[scene numbers]}]}', seasonContext() + 'Project style: ' + ([seasonStyle(), $('#style').value].filter(Boolean).join('. ') || 'none') + '\n\nScript:\n' + text));
      found = (j.assets || []).filter(x => ATYPE[x.type]).map(x => { const a = newAsset({ type: x.type, name: x.name || 'Unnamed', desc: x.desc || '', locks: x.locks || '', keys: x.keys || '' }); a._scenes = x.scenes || []; return a; })
        .filter(a => !S.assets.some(b => b.name.toLowerCase() === a.name.toLowerCase()));
    }
    found.forEach(a => { S.assets.push(a); (a._scenes || []).forEach(n => { const s = S.scenes[n - 1]; if (s) { s.assets = s.assets || []; if (!s.assets.includes(a.id)) s.assets.push(a.id); } }); delete a._scenes; });
    const tagged = autoTag(S.scenes, found);
    saveDraft(); renderAssets(); renderInspector(); renderScenes();
    toast(found.length ? found.length + ' asset(s) found' + (tagged ? ', tagged in scenes' : '') + '. Check and edit them.' : 'No new assets found');
  } catch (e) { toast(e.message, 5000); }
  btn.disabled = false; btn.textContent = 'Find in script';
};
$('#aWrite').onclick = async () => {
  if (!S.scenes.length) { toast('Create scenes first'); return; }
  const btn = $('#aWrite'); btn.disabled = true; btn.textContent = 'Writing…';
  try {
    if (S.settings.llm === 'off') {
      S.scenes.forEach(s => {
        const as = (s.assets || []).map(id => S.assets.find(a => a.id === id)).filter(Boolean);
        const who = as.filter(a => a.type === 'character').map(a => a.name), where = as.find(a => a.type === 'location'), what = as.filter(a => a.type === 'prop').map(a => a.name);
        s.prompt = [where ? 'Inside ' + where.name : '', who.length ? who.join(' and ') + ' in frame' : '', what.length ? 'featuring ' + what.join(', ') : '', 'showing: ' + (s.vo || '').replace(/[.\s]+$/, '')].filter(Boolean).join(', ') + '.';
      });
      toast('Scene prompts written from the assets. For camera and action detail, turn on Prompt AI in Settings.', 5000);
    } else {
      const lib = S.assets.map(a => `- ${a.name} (${ATYPE[a.type]}): ${a.desc}${a.locks ? ' | keep: ' + a.locks : ''}`).join('\n');
      const sc = S.scenes.map((s, i) => `Scene ${i + 1}${s.assets?.length ? ' [assets: ' + s.assets.map(id => S.assets.find(a => a.id === id)?.name).filter(Boolean).join(', ') + ']' : ''}: ${s.vo}`).join('\n');
      const j = parseJSON(await askAI('You write shot prompts for an AI video model. For each scene write one prompt (40-70 words) describing only what we see: subject and action, camera angle and movement, framing, setting, lighting. Refer to assets by name. Do not repeat the overall style (it is added separately). No real people or brands. Reply with JSON only: {"scenes":[{"n":1,"prompt":"...","assets":["asset names in this shot"]}]}', seasonContext() + 'Assets:\n' + (lib || 'none') + '\n\nScenes:\n' + sc));
      (j.scenes || []).forEach(x => { const s = S.scenes[(x.n || 0) - 1]; if (!s || !x.prompt) return; s.prompt = x.prompt; (x.assets || []).forEach(nm => { const a = S.assets.find(a => a.name.toLowerCase() === String(nm).toLowerCase()); if (a) { s.assets = s.assets || []; if (!s.assets.includes(a.id)) s.assets.push(a.id); } }); });
      toast('Scene prompts written. Check them in the inspector before generating.', 5000);
    }
    saveDraft(); renderAll(); renderAssets();
  } catch (e) { toast(e.message, 5000); }
  btn.disabled = false; btn.textContent = 'Write scene prompts';
};
function addAsset(type) { const a = newAsset({ type, name: 'New ' + ATYPE[type].toLowerCase() }); S.assets.push(a); S.aSel = a.id; S.aFilter = 'all'; saveDraft(); renderAssets(); setTimeout(() => { const el = $('.aedit [data-k=name]'); if (el) { el.focus(); el.select(); } }, 30); }
$$('[data-new]').forEach(b => b.onclick = () => addAsset(b.dataset.new));
$('#aNewBtn').onclick = () => addAsset(S.aFilter !== 'all' ? S.aFilter : 'character');
$$('[data-af]').forEach(b => b.onclick = () => { S.aFilter = b.dataset.af; renderAssets(); });

// ---------------- Flow canvas ----------------
const NW = 210, NH = 214, PY = 87;
const F = { x: 40, y: 60, z: 1, popFor: null };
function flowOn() { return S.stage === 'scenes'; }
function ensurePos() {
  let missing = S.scenes.some(s => s.fx == null);
  if (missing) S.scenes.forEach((s, i) => { if (s.fx == null) { const c = i % 4, r = Math.floor(i / 4); s.fx = 40 + c * 300; s.fy = 40 + r * 330; } });
}
function autoArrange() { S.scenes.forEach((s, i) => { s.fx = 40 + (i % 4) * 300; s.fy = 40 + Math.floor(i / 4) * 330; }); saveDraft(); renderFlow(); fitFlow(); }
function applyWorld() { $('#world').style.transform = `translate(${F.x}px,${F.y}px) scale(${F.z})`; $('#fZt').textContent = Math.round(F.z * 100) + '%'; positionPop(); }
function edgeGeom(a, b) {
  const x1 = a.fx + NW, y1 = a.fy + PY, x2 = b.fx, y2 = b.fy + PY;
  const back = x2 < x1 + 40, c = back ? Math.max(120, Math.abs(y2 - y1) * 0.6) : Math.max(60, (x2 - x1) / 2);
  const c1 = [x1 + c, y1], c2 = [x2 - c, y2];
  const bz = t => { const u = 1 - t; return [u * u * u * x1 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * x2, u * u * u * y1 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * y2]; };
  return { d: `M${x1},${y1} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x2},${y2}`, mid: bz(0.5) };
}
function renderFlow() {
  if (!flowOn()) return;
  ensurePos();
  const nodes = $('#fnodes'); nodes.innerHTML = '';
  $('#flowEmpty').style.display = S.scenes.length ? 'none' : 'flex';
  S.scenes.forEach((s, i) => {
    const st = statusOf(s), n = document.createElement('div');
    n.className = 'fnode' + (s.id === S.sel ? ' sel' : ''); n.dataset.id = s.id;
    n.style.left = s.fx + 'px'; n.style.top = s.fy + 'px';
    n.innerHTML = `<div class="fh"><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="ttl">${esc(s.label || 'Scene ' + (i + 1))}</span><span class="dot ${st.k}" title="${st.label}"></span></div>
      <div class="fth"><canvas width="388" height="224"></canvas><span class="tg2">${st.tag}</span></div>
      <div class="ftx">${esc(s.vo || s.prompt || 'No script yet')}</div>
      <div class="ff">${s.ownStyle ? '<span style="color:var(--accent)">own style</span>' : '<span>project style</span>'}${s.voUrl ? '<span style="color:var(--sun-text)">voice</span>' : ''}<span class="d">${fmt(segLen(s))}</span></div>
      ${i > 0 ? '<span class="port in on"></span>' : '<span class="port in"></span>'}${i < S.scenes.length - 1 ? '<span class="port out on"></span>' : '<span class="port out"></span>'}`;
    nodes.appendChild(n); thumb(s, i, n.querySelector('canvas'));
    nodeDrag(n, s);
  });
  renderEdges(); applyWorld();
}
function renderEdges() {
  const g = $('#edgeG'); let svg = '';
  $$('.tnode').forEach(t => t.remove());
  for (let i = 1; i < S.scenes.length; i++) {
    const a = S.scenes[i - 1], b = S.scenes[i], e = edgeGeom(a, b), chained = b.chain;
    svg += chained ? `<path d="${e.d}" fill="none" stroke="url(#gEdge)" stroke-width="2" stroke-linecap="round"/>`
                   : `<path d="${e.d}" fill="none" stroke="#3A3A42" stroke-width="2" stroke-dasharray="6 6" stroke-linecap="round"/>`;
    const t = document.createElement('button'); t.className = 'tnode' + (F.popFor === b.id ? ' open' : ''); t.dataset.id = b.id;
    t.style.left = e.mid[0] + 'px'; t.style.top = e.mid[1] + 'px';
    t.innerHTML = `<span class="ico">${TRI[b.transition] || TRI.cut}</span>${TR_NAMES[b.transition] || 'Cut'}${b.transition !== 'cut' ? ' · ' + b.tdur.toFixed(1) + 's' : ''}${chained ? '<span class="mini c" title="Continues from the last frame">chain</span>' : ''}${b.history ? '<span class="mini h" title="Includes history">history</span>' : ''}`;
    t.setAttribute('aria-label', 'Transition into scene ' + (i + 1));
    t.onpointerdown = ev => ev.stopPropagation();
    t.onclick = ev => { ev.stopPropagation(); openPop(b.id); };
    $('#fnodes').appendChild(t);
  }
  g.innerHTML = svg;
}
function markFlowSel() { $$('.fnode').forEach(n => n.classList.toggle('sel', n.dataset.id === S.sel)); $$('.scard').forEach(c => { const on = c.dataset.id === S.sel; c.classList.toggle('sel', on); if (on && S.stage === 'scenes' && !c.contains(document.activeElement)) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }); }
function nodeDrag(n, s) {
  n.onpointerdown = ev => {
    if (ev.button !== 0) return; ev.stopPropagation(); closePop();
    const sx = ev.clientX, sy = ev.clientY, ox = s.fx, oy = s.fy; let moved = false;
    n.setPointerCapture(ev.pointerId);
    n.onpointermove = e => {
      const dx = (e.clientX - sx) / F.z, dy = (e.clientY - sy) / F.z;
      if (!moved && Math.hypot(dx, dy) < 3) return; moved = true; n.classList.add('dragging');
      s.fx = Math.round(ox + dx); s.fy = Math.round(oy + dy); n.style.left = s.fx + 'px'; n.style.top = s.fy + 'px'; renderEdges();
    };
    n.onpointerup = () => { n.onpointermove = n.onpointerup = null; n.classList.remove('dragging'); if (moved) saveDraft(); else select(s.id, true); };
  };
  n.ondblclick = () => { select(s.id, true); goStage('studio'); };
}
// pan + zoom
(function () {
  const fl = $('#flow');
  fl.addEventListener('pointerdown', ev => {
    if (ev.target.closest('.fnode,.tnode,#tpop,.fbar,.fzoom')) return;
    closePop(); fl.classList.add('panning'); fl.setPointerCapture(ev.pointerId);
    const sx = ev.clientX, sy = ev.clientY, ox = F.x, oy = F.y;
    const mv = e => { F.x = ox + e.clientX - sx; F.y = oy + e.clientY - sy; applyWorld(); };
    const up = () => { fl.classList.remove('panning'); fl.removeEventListener('pointermove', mv); fl.removeEventListener('pointerup', up); };
    fl.addEventListener('pointermove', mv); fl.addEventListener('pointerup', up);
  });
  fl.addEventListener('wheel', ev => {
    if (ev.target.closest('#tpop')) return;
    ev.preventDefault(); const r = fl.getBoundingClientRect(); zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0015));
  }, { passive: false });
})();
function zoomAt(px, py, k) { const z = Math.min(2, Math.max(0.25, F.z * k)); const wx = (px - F.x) / F.z, wy = (py - F.y) / F.z; F.z = z; F.x = px - wx * z; F.y = py - wy * z; applyWorld(); }
function fitFlow() {
  if (!S.scenes.length) { F.x = 40; F.y = 60; F.z = 1; applyWorld(); return; }
  ensurePos(); const r = $('#flow').getBoundingClientRect();
  const xs = S.scenes.map(s => s.fx), ys = S.scenes.map(s => s.fy);
  const minX = Math.min(...xs) - 40, minY = Math.min(...ys) - 40, maxX = Math.max(...xs) + NW + 40, maxY = Math.max(...ys) + NH + 40;
  const z = Math.min(1.2, Math.max(0.25, Math.min(r.width / (maxX - minX), (r.height - 70) / (maxY - minY))));
  F.z = z; F.x = (r.width - (maxX - minX) * z) / 2 - minX * z; F.y = (r.height - 60 - (maxY - minY) * z) / 2 - minY * z + 20; applyWorld();
}
$('#fZi').onclick = () => { const r = $('#flow').getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.2); };
$('#fZo').onclick = () => { const r = $('#flow').getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.2); };
$('#fFit').onclick = fitFlow;
$('#fArrange').onclick = autoArrange;
$('#fAdd').onclick = () => { const r = $('#flow').getBoundingClientRect(); const cur = S.scenes.findIndex(x => x.id === S.sel); const prev = S.scenes[cur]; createScene(undefined, prev ? null : { x: Math.round((r.width / 2 - F.x) / F.z - NW / 2), y: Math.round((r.height / 2 - F.y) / F.z - NH / 2) }); };
$('#fGen').onclick = () => $('#btnGenAll').click();
$('#fPlay').onclick = () => { goStage('studio'); const s = selScene(); if (s) { const g = buildSegs().find(g => g.s.id === s.id); P.t = g ? g.t0 : 0; } play(); };
// transition popover
function openPop(id) {
  const b = S.scenes.find(x => x.id === id); if (!b) return; const i = S.scenes.indexOf(b);
  F.popFor = id; const pop = $('#tpop');
  pop.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between"><b style="font-size:13px;font-weight:600">Scene ${i} → Scene ${i + 1}</b><button class="ib" id="tpX" aria-label="Close" style="width:26px;height:26px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <span class="lbl">Transition style</span>
    <div class="trgrid">${Object.entries(TR_NAMES).map(([k, l]) => `<button data-ptr="${k}" aria-pressed="${b.transition === k}">${TRI[k]}${l}</button>`).join('')}</div>
    <div class="field" style="${b.transition === 'cut' ? 'opacity:.4;pointer-events:none' : ''}"><div style="display:flex;justify-content:space-between;font-size:12px"><span class="lbl">Duration</span><span id="tpD" style="font-variant-numeric:tabular-nums">${b.tdur.toFixed(1)} s</span></div><input id="tpR" type="range" min="0.1" max="2" step="0.1" value="${b.tdur}"></div>
    <div class="trow"><div><div class="t1">Continue from last frame</div><div class="t2">Scene ${i + 1} starts on scene ${i}'s final frame</div></div><label class="tg"><input type="checkbox" id="tpC" ${b.chain ? 'checked' : ''}><span></span></label></div>
    <div class="trow"><div><div class="t1">Include history</div><div class="t2">Carries scene ${i}'s script and style into the prompt</div></div><label class="tg"><input type="checkbox" id="tpH" ${b.history ? 'checked' : ''}><span></span></label></div>
    <div style="display:flex;gap:6px"><button class="btn sm" id="tpIns" style="flex:1">+ Insert scene here</button><button class="btn sm" id="tpPrev" style="flex:1">Preview join</button></div>`;
  pop.classList.add('on'); positionPop(); renderEdges();
  pop.onpointerdown = e => e.stopPropagation();
  $('#tpX').onclick = closePop;
  $$('#tpop [data-ptr]').forEach(x => x.onclick = () => { b.transition = x.dataset.ptr; saveDraft(); renderTimeline(); if (S.sel === b.id) renderInspector(); openPop(id); });
  $('#tpR').oninput = e => { b.tdur = +e.target.value; $('#tpD').textContent = b.tdur.toFixed(1) + ' s'; saveDraft(); renderEdges(); };
  $('#tpC').onchange = e => { b.chain = e.target.checked; saveDraft(); renderEdges(); if (S.sel === b.id) renderInspector(); };
  $('#tpH').onchange = e => { b.history = e.target.checked; saveDraft(); renderEdges(); renderScenes(); if (S.sel === b.id) renderInspector(); };
  $('#tpIns').onclick = () => { const a = S.scenes[i - 1]; closePop(); createScene(i, { x: Math.round((a.fx + b.fx) / 2), y: Math.round(Math.max(a.fy, b.fy) + 260) }); };
  $('#tpPrev').onclick = () => { closePop(); const g = buildSegs()[i]; goStage('studio'); P.t = Math.max(0, g.t0 - 1.5); play(); setTimeout(() => { if (P.playing && P.t > g.t0 + Math.max(1.5, b.tdur + 1)) stop(); }, (1.5 + Math.max(1.5, b.tdur + 1)) * 1000 + 300); };
}
function positionPop() {
  if (!F.popFor) return; const b = S.scenes.find(x => x.id === F.popFor), i = S.scenes.indexOf(b); if (!b || i < 1) return closePop();
  const e = edgeGeom(S.scenes[i - 1], b), r = $('#flow').getBoundingClientRect(), pop = $('#tpop');
  let x = e.mid[0] * F.z + F.x - 145, y = e.mid[1] * F.z + F.y + 22;
  x = Math.max(8, Math.min(x, r.width - 298)); if (y + pop.offsetHeight > r.height - 8) y = Math.max(8, e.mid[1] * F.z + F.y - 22 - pop.offsetHeight);
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
}
function closePop() { if (!F.popFor) return; F.popFor = null; $('#tpop').classList.remove('on'); if (flowOn()) renderEdges(); }
window.addEventListener('resize', () => { if (flowOn()) positionPop(); });

// ---------------- Stages ----------------
const STAGES = ['home', 'show', 'season', 'script', 'scenes', 'assets', 'board', 'studio'];
const STAGE_EL = { home: 'stHome', show: 'stShow', season: 'stSeason', script: 'stScript', scenes: 'stScenes', assets: 'stAssets', board: 'stBoard', studio: 'stStudio' };
function goStage(name) {
  if (!STAGES.includes(name)) name = 'studio';
  if (name === 'show' && !S.show) name = 'home';
  if (name === 'season' && !S.season) name = S.show ? 'show' : 'home';
  if (!['home', 'season', 'show'].includes(name) && !S.pid) name = S.season ? 'season' : S.show ? 'show' : 'home';
  if (S.stage === 'scenes' && name !== 'scenes') closePop();
  if (name === 'home') { stop(); } else if (name !== 'season' && name !== 'show') S.lastStage = name;
  if (name === 'season' || name === 'show') stop(); S.stage = name; document.body.classList.toggle('home', name === 'home'); document.body.classList.toggle('instudio', name === 'studio'); document.body.classList.toggle('seasonpg', name === 'season' || name === 'show'); if (!['home', 'season', 'show'].includes(name)) saveDraft(); updateCrumb();
  STAGES.forEach(k => $('#' + STAGE_EL[k]).classList.toggle('on', k === name));
  $$('#steps button').forEach(b => { if (b.dataset.st === name) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  refreshStage();
  if (name === 'scenes') requestAnimationFrame(() => { renderFlow(); if (!F.fitted) { fitFlow(); F.fitted = true; } });
  if (name === 'studio') requestAnimationFrame(() => { fitStage(); renderAll(); });
}
$$('#steps button').forEach(b => b.onclick = () => goStage(b.dataset.st));
function refreshSteps() {
  const n = S.scenes.length, ap = S.scenes.filter(s => s.approved).length;
  $('#stN2').textContent = n || ''; $('#stN3').textContent = S.assets.length || ''; $('#stN4').textContent = n ? ap + '/' + n : '';
  const done = { script: !!$('#script').value.trim(), scenes: n > 0, assets: S.assets.length > 0, board: n > 0 && ap === n, studio: false };
  $$('#steps button').forEach(b => b.classList.toggle('done', !!done[b.dataset.st]));
}
function refreshStage() {
  refreshSteps();
  if (S.stage === 'script') scriptStats();
  if (S.stage === 'scenes') renderSceneCards();
  if (S.stage === 'assets') { renderAssets(); renderMatrix(); }
  if (S.stage === 'board') renderBoard();
  if (S.stage === 'home') renderHome();
  if (S.stage === 'season') renderSeason();
  if (S.stage === 'show') renderShow();
  if (S.stage === 'script') renderSeasonBox();
  renderExplorer();
}
function syncName() {
  const sc = $('#scName'); if (!sc) return; if (document.activeElement !== sc) sc.value = $('#title').value;
  const ep = S.season ? S.season.episodes.indexOf(S.pid) + 1 : 0;
  const sIdx = S.show && S.season ? S.show.seasons.indexOf(S.season.id) + 1 : 0;
  $('#scOver').textContent = ep ? (S.show ? (S.show.title || 'Show') + ' · S' + String(sIdx).padStart(2, '0') + ' · ' : '') + 'EPISODE ' + String(ep).padStart(2, '0') : 'MOVIE';
  sc.placeholder = ep ? 'Name this episode' : 'Name this movie';
}
function scriptStats() {
  syncName();
  const t = $('#script').value.trim(), w = t ? t.split(/\s+/).length : 0, secs = w / (+S.settings.wps || 2.6);
  const sections = t ? t.split(/\n\s*\n/).filter(x => x.trim()).length : 0;
  $('#scStats').textContent = w ? w + ' words · about ' + Math.round(secs) + ' seconds read aloud · ' + pl(sections, 'section') : '';
  $('#sWps2').value = S.settings.wps; $('#sTarget2').value = S.settings.target;
  // preview of the scenes a split would create, as proportional bars
  const pv = $('#scPrev');
  if (pv) {
    const ch = t ? scriptChunks(t) : [], wpsv = +S.settings.wps || 2.6, durs = ch.map(c => Math.min(15, Math.max(3, Math.round(c.split(' ').length / wpsv)))), mx = Math.max(1, ...durs);
    pv.innerHTML = ch.length ? `<div class="pvh"><b>${pl(ch.length, 'scene')}</b><span>${fmt(durs.reduce((a, b) => a + b, 0))}</span></div>` + ch.slice(0, 40).map((c, i) => `<div class="pvr"><span class="n">${i + 1}</span><span class="b"><i style="width:${Math.round(durs[i] / mx * 100)}%"></i></span><span class="d">${durs[i]} s</span></div>`).join('') + (ch.length > 40 ? `<div class="cap">and ${ch.length - 40} more</div>` : '')
      : '<span class="cap">Write or paste a script to see the scenes it will make.</span>';
  }
  scriptNums();
}
// Section numbers beside the script: a hidden mirror measures where each section starts.
function scriptNums() {
  const ta = $('#script'), box = $('#scNums'); if (!ta || !box || S.stage !== 'script') return;
  let m = scriptNums.m; if (!m) { m = scriptNums.m = document.createElement('div'); m.className = 'scmirror'; m.setAttribute('aria-hidden', 'true'); document.body.appendChild(m); }
  const cs = getComputedStyle(ta); m.style.width = ta.clientWidth + 'px'; m.style.font = cs.font; m.style.padding = cs.padding; m.style.lineHeight = cs.lineHeight;
  const parts = ta.value.split(/(\n\s*\n)/); let html = '', n = 0;
  parts.forEach(pt => { if (/^\n\s*\n$/.test(pt)) html += esc(pt); else if (pt.trim()) { n++; html += `<span data-n="${n}"></span>` + esc(pt); } else html += esc(pt); });
  m.innerHTML = html + ' ';
  const top0 = m.getBoundingClientRect().top;
  box.innerHTML = [...m.querySelectorAll('span[data-n]')].map(sp => `<span style="top:${sp.getBoundingClientRect().top - top0 - ta.scrollTop}px">${sp.dataset.n}</span>`).join('');
}
$('#script').addEventListener('scroll', () => scriptNums());
window.addEventListener('resize', () => scriptNums());
$('#scImport').onchange = async e => { const f = e.target.files[0]; if (!f) return; const txt = await f.text(); const ta = $('#script'); ta.value = ta.value.trim() ? ta.value.replace(/\s*$/, '') + '\n\n' + txt : txt; ta.dispatchEvent(new Event('input')); e.target.value = ''; toast('Imported ' + f.name); };
$('#scPaste').onclick = async () => { try { const txt = await navigator.clipboard.readText(); const ta = $('#script'); const a = ta.selectionStart, b = ta.selectionEnd; ta.setRangeText(txt, a, b, 'end'); ta.dispatchEvent(new Event('input')); ta.focus(); } catch (e) { toast('Paste with Ctrl+V (or ⌘V); this browser blocks reading the clipboard.'); } };
$('#script').addEventListener('input', () => { scriptStats(); refreshSteps(); });
$('#scName').addEventListener('input', () => { if (S.pid) renameEpisode(S.pid, $('#scName').value); });
$('#title').addEventListener('input', () => { const sc = $('#scName'); if (sc) sc.value = $('#title').value; renderExplorer(); });
$('#style2').addEventListener('input', () => { $('#style').value = $('#style2').value; $('#style').dispatchEvent(new Event('input')); });

// Scenes stage: editable cards
let flowTimer = 0;
function flowSoon() { clearTimeout(flowTimer); flowTimer = setTimeout(() => { renderFlow(); }, 250); }
function trLabel(s) { if (s.chain && s.transition === 'cut') return 'Continue from last frame'; return (TR_NAMES[s.transition] || 'Cut') + (s.transition !== 'cut' ? ' · ' + s.tdur + ' s' : '') + (s.chain ? ' · from last frame' : ''); }
function renderSceneCards() {
  const box = $('#sceneCards'); if (!box) return;
  $('#scnCount').textContent = S.scenes.length ? S.scenes.length + ' · ' + fmt(totalLen()) : '';
  box.innerHTML = '';
  if (!S.scenes.length) { box.innerHTML = '<p class="muted" style="padding:6px 2px">No scenes yet. Split your script in the Script stage, or create one here.</p>'; return; }
  S.scenes.forEach((s, i) => {
    if (i > 0) {
      const t = document.createElement('div'); t.className = 'trlink' + (S.trOpen === s.id ? ' open' : '');
      t.innerHTML = `<button class="trpill" aria-expanded="${S.trOpen === s.id}" title="Transition from scene ${i} to ${i + 1}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>${esc(trLabel(s))}</button>
        <div class="trbar"><select data-k="transition" aria-label="Transition">${Object.entries(TR_NAMES).map(([k, l]) => `<option value="${k}" ${s.transition === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input type="number" data-k="tdur" min="0.1" max="2" step="0.1" value="${s.tdur}" aria-label="Transition seconds" ${s.transition === 'cut' ? 'disabled' : ''}><span class="cap">s</span>
        <label><input type="checkbox" data-k="chain" ${s.chain ? 'checked' : ''}>Continue from last frame</label>
        <label><input type="checkbox" data-k="history" ${s.history ? 'checked' : ''}>Carry style forward</label></div>`;
      t.querySelector('.trpill').onclick = () => { S.trOpen = S.trOpen === s.id ? null : s.id; renderSceneCards(); };
      t.querySelectorAll('[data-k]').forEach(el => { el.onchange = () => { const k = el.dataset.k; s[k] = el.type === 'checkbox' ? el.checked : k === 'tdur' ? Math.max(0.1, +el.value || 0.5) : el.value; saveDraft(); flowSoon(); renderSceneCards(); }; });
      box.appendChild(t);
    }
    const st = statusOf(s), c = document.createElement('div');
    c.className = 'scard' + (s.id === S.sel ? ' sel' : ''); c.dataset.id = s.id;
    c.innerHTML = `<div class="scmain"><span class="scth"><canvas width="224" height="126"></canvas></span>
        <div class="sctx"><div class="sch"><span class="no">${String(i + 1).padStart(2, '0')}</span><b>${esc(s.label || 'Scene ' + (i + 1))}</b><span class="d">${fmt(segLen(s))}</span>
          <button class="ib scmore" aria-label="Actions for scene ${i + 1}" title="More">⋯</button></div>
          <p class="vo">${esc(s.vo || 'No script line yet')}</p>
          <p class="we"><b>We see:</b> ${esc(s.prompt || 'Not described yet')}</p>
          <span class="stl"><span class="dot ${st.k}" aria-hidden="true"></span>${st.label}</span></div></div>
      <div class="scedit">
        <div class="field"><span class="lbl">Scene name</span><input class="inp" data-k="label" value="${esc(s.label)}" placeholder="Scene ${i + 1}"></div>
        <div class="field"><span class="lbl">Script</span><textarea class="inp" rows="2" data-k="vo" placeholder="What is said">${esc(s.vo)}</textarea></div>
        <div class="field"><span class="lbl">What we see</span><textarea class="inp" rows="3" data-k="prompt" placeholder="Action, camera, framing, setting">${esc(s.prompt)}</textarea></div>
        <div class="scact"><button class="btn sm" data-act="ins">+ Scene after</button><button class="btn sm" data-act="studio">Open in Studio</button><span class="sp"></span><button class="btn sm ghost" data-act="del">Delete</button></div>
      </div>`;
    thumb(s, i, c.querySelector('canvas'));
    c.querySelector('.scmain').onclick = e => { if (e.target.closest('.scmore')) return; if (S.sel !== s.id) { S.sel = s.id; markFlowSel(); } };
    c.querySelector('.scmore').onclick = e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); S.sel = s.id; markFlowSel(); showCtx(r.left - 180, r.bottom + 4, { dataset: { kind: 'scene', id: s.id, open: 'scene:' + s.id }, querySelector: () => null }); };
    c.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k;
      el.oninput = () => {
        s[k] = el.value; saveDraft(); flowSoon(); if (k === 'vo' || k === 'label') refreshSteps();
        if (k === 'label') c.querySelector('.sch b').textContent = s.label || 'Scene ' + (i + 1);
        if (k === 'vo') c.querySelector('.vo').textContent = s.vo || 'No script line yet';
        if (k === 'prompt') c.querySelector('.we').innerHTML = '<b>We see:</b> ' + esc(s.prompt || 'Not described yet');
      };
    });
    c.querySelector('[data-act=del]').onclick = () => deleteScene(s);
    c.querySelector('[data-act=ins]').onclick = () => { S.sel = s.id; createScene(i + 1, s.fx != null ? { x: s.fx + 40, y: s.fy + 250 } : null); renderSceneCards(); };
    c.querySelector('[data-act=studio]').onclick = () => { S.sel = s.id; goStage('studio'); select(s.id, true); };
    box.appendChild(c);
  });
}
$('#newHistS').onchange = e => { $('#newHist').checked = e.target.checked; };
$('#newHist').onchange = e => { $('#newHistS').checked = e.target.checked; };
$('#scnAdd').onclick = () => { createScene(); renderSceneCards(); setTimeout(() => { const c = $('.scard.sel input[data-k=label]'); if (c) c.focus(); }, 60); };

// Assets stage: matrix
function renderMatrix() {
  const m = $('#matrix'); if (!m) return;
  if (!S.scenes.length || !S.assets.length) { m.innerHTML = `<p class="muted" style="padding:14px">${!S.scenes.length ? 'Create scenes first.' : 'Add assets on the left, or use “Find in script”.'}</p>`; return; }
  // scenes are columns (thumbnail + number), assets are rows
  let t = '<table><thead><tr><th class="an">Asset</th>' + S.scenes.map((s, i) => `<th class="sh" title="Scene ${i + 1}: ${esc(s.vo || s.prompt || '')}"><canvas width="64" height="36" data-i="${i}"></canvas><span>${i + 1}</span></th>`).join('') + '</tr></thead><tbody>';
  S.assets.forEach(a => {
    t += `<tr class="${a.id === S.aSel ? 'sel' : ''}"><th class="an"><button class="ah" data-aid="${a.id}" title="${esc(a.desc || a.name)}"><b>${esc(a.name)}</b><span>· ${ATYPE[a.type]}</span></button></th>` +
      S.scenes.map((s, i) => { const on = (s.assets || []).includes(a.id); return `<td><button class="cell" data-s="${s.id}" data-a="${a.id}" aria-pressed="${on}" aria-label="${esc(a.name)} in scene ${i + 1}"></button></td>`; }).join('') + '</tr>';
  });
  m.innerHTML = t + '</tbody></table>';
  m.querySelectorAll('canvas[data-i]').forEach(c => { const i = +c.dataset.i; thumb(S.scenes[i], i, c); });
  m.querySelectorAll('.cell').forEach(b => b.onclick = () => {
    const s = S.scenes.find(x => x.id === b.dataset.s), id = b.dataset.a; s.assets = s.assets || [];
    s.assets = s.assets.includes(id) ? s.assets.filter(x => x !== id) : [...s.assets, id];
    b.setAttribute('aria-pressed', s.assets.includes(id)); saveDraft(); renderAssets();
  });
  m.querySelectorAll('.ah').forEach(d => d.onclick = () => { S.aSel = d.dataset.aid; renderAssets(); renderMatrix(); const el = $('.acard[aria-expanded=true]'); if (el) el.scrollIntoView({ block: 'nearest' }); });
}
$('#mxAuto').onclick = () => { const n = autoTag(S.scenes); renderMatrix(); renderAssets(); toast(n ? n + ' new tag(s) added' : 'No new mentions found – add script keywords to your assets'); };

// Storyboard stage
const IMG = {};
function getImg(src, cb) {
  if (!src) return null; let e = IMG[src];
  if (e && e.ok) return e.img;
  if (!e) { const img = new Image(); e = IMG[src] = { img, ok: false, cbs: [] }; img.crossOrigin = /^data:/.test(src) ? null : 'anonymous'; img.onload = () => { e.ok = true; e.cbs.forEach(f => f()); e.cbs = []; }; img.onerror = () => { e.cbs = []; }; img.src = src; }
  if (cb) e.cbs.push(cb); return null;
}
function boardFrame(s, i, c, redraw) {
  const x = c.getContext('2d'), w = c.width, h = c.height;
  x.fillStyle = '#16161a'; x.fillRect(0, 0, w, h);
  if (s.board) { const im = getImg(s.board, redraw); if (im) { drawCover(x, im, w, h, 1); return 'Sketch'; } }
  if (s.kind) { thumb(s, i, c); return s.kind === 'demo' ? 'Demo clip' : 'Clip'; }
  const as = (s.assets || []).map(id => S.assets.find(a => a.id === id)).filter(Boolean);
  const loc = as.find(a => a.type === 'location' && a.img);
  if (loc) { const im = getImg(loc.img, redraw); if (im) { x.globalAlpha = .55; drawCover(x, im, w, h, 1); x.globalAlpha = 1; } }
  const ppl = as.filter(a => a.type !== 'location' && a.img).slice(0, 4), r = Math.min(w, h) * 0.17;
  ppl.forEach((a, k) => { const im = getImg(a.img, redraw), cx0 = w * 0.08 + r + k * (r * 2.2), cy0 = h - r * 1.25;
    x.save(); x.beginPath(); x.arc(cx0, cy0, r, 0, 6.28); x.fillStyle = '#2A2A31'; x.fill(); if (im) { x.clip(); x.drawImage(im, cx0 - r, cy0 - r, r * 2, r * 2); } x.restore();
    x.strokeStyle = '#FF8F52'; x.lineWidth = 2; x.beginPath(); x.arc(cx0, cy0, r, 0, 6.28); x.stroke(); });
  x.fillStyle = 'rgba(255,255,255,.12)'; x.setLineDash([6, 6]); x.strokeStyle = 'rgba(255,255,255,.18)'; x.strokeRect(6, 6, w - 12, h - 12); x.setLineDash([]);
  x.fillStyle = '#EDEDF0'; x.font = `500 ${Math.round(Math.min(w, h) * 0.07)}px Inter,system-ui`; x.textBaseline = 'top';
  wrap(x, s.prompt || s.vo || 'No description yet', w * 0.06, h * 0.08, w * 0.88, Math.min(w, h) * 0.09, ppl.length ? 3 : 6);
  return as.length ? 'Composed from assets' : 'Text only';
}
function sketchPrompt(s) {
  const mc = mustContain(s), ar = $('#aspect').value === '9:16' ? 'vertical 9:16' : 'widescreen 16:9';
  return `Black-and-white storyboard sketch, loose pencil lines on white paper, ${ar} frame, clear staging and camera angle. ${(s.prompt || s.vo || '').replace(/[.\s]+$/, '')}.${mc ? ' Must contain: ' + mc + '.' : ''} No colour, no text.`;
}
function boardState(s) { return s.approved ? 'ok' : s.board ? 'review' : 'text'; }
const BD_LABEL = { ok: 'Approved', review: 'Needs review', text: 'Text only' }, BD_DOT = { ok: 'ready', review: 'busy', text: 'none' };
function renderBoard() {
  const b = $('#board'); if (!b) return;
  const tall = $('#aspect').value === '9:16'; b.classList.toggle('tall', tall);
  const n = S.scenes.length, f = S.bdFilter || 'all';
  renderBoardStats();
  const counts = { all: n, review: 0, text: 0, ok: 0 }; S.scenes.forEach(x => counts[boardState(x)]++);
  $('#bdFilter').innerHTML = [['all', 'All'], ['review', 'Needs review'], ['text', 'Text only'], ['ok', 'Approved']].map(([k, l]) => `<button data-f="${k}" aria-pressed="${f === k}">${l} <span>${counts[k]}</span></button>`).join('');
  $$('#bdFilter button').forEach(x => x.onclick = () => { S.bdFilter = x.dataset.f; renderBoard(); });
  b.innerHTML = '';
  if (!n) { b.innerHTML = '<p class="muted">No scenes yet. Start in Script or Scenes.</p>'; return; }
  S.scenes.forEach((s, i) => {
    const state = boardState(s); if (f !== 'all' && f !== state) return;
    const p = document.createElement('div'); p.className = 'panel bd-' + state;
    const trk = i === 0 ? 'OPEN' : s.chain ? 'EXTEND' : (s.transition === 'cut' ? 'CUT' : (TR_NAMES[s.transition] || 'Cut').toUpperCase());
    const acts = state === 'ok' ? `<button class="btn sm ghost" data-act="gen">Redo</button>${upBtn()}`
      : state === 'review' ? `<button class="btn sm pri" data-act="ok"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Approve</button><button class="btn sm" data-act="gen">Redo</button>`
      : upBtn();
    p.innerHTML = `<div class="pfr">${s.board ? `<canvas width="${tall ? 360 : 640}" height="${tall ? 640 : 360}"></canvas>` : `<div class="ptext"><span>${esc(s.prompt || 'No scene description yet.')}</span><button class="btn sm" data-act="gen"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>Sketch frame</button></div>`}
        <span class="fchip l">${esc(trk)}</span><span class="fchip r">${fmt(segLen(s))}</span></div>
      <div class="pbody"><div class="phd"><span class="no">${String(i + 1).padStart(2, '0')}</span><b>${esc(s.label || 'Scene ' + (i + 1))}</b><span class="stl"><span class="dot ${BD_DOT[state]}" aria-hidden="true"></span>${BD_LABEL[state]}</span></div>
        ${s.vo ? `<div class="line">“${esc(s.vo)}”</div>` : '<div class="line muted">No script line.</div>'}</div>
      <div class="pact">${acts}<span class="sp"></span><button class="ib" data-act="more" aria-label="More actions for scene ${i + 1}" title="More">⋯</button></div>`;
    function upBtn() { return `<label class="btn sm ghost" style="margin:0"><input type="file" accept="image/*" hidden data-act="up"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5M5 20h14"/></svg>Upload</label>`; }
    const cv2 = p.querySelector('canvas'); if (cv2) { const draw = () => boardFrame(s, i, cv2, draw); draw(); }
    const ok = p.querySelector('[data-act=ok]'); if (ok) ok.onclick = () => { s.approved = true; saveDraft(); refreshSteps(); renderBoard(); };
    p.querySelectorAll('[data-act=gen]').forEach(x => x.onclick = () => sketchScenes([s]));
    const up = p.querySelector('[data-act=up]'); if (up) up.onchange = e => { const fl = e.target.files[0]; if (!fl) return; const r = new FileReader(); r.onload = async () => { await setBoard(s, r.result); saveDraft(); renderBoard(); }; r.readAsDataURL(fl); };
    p.querySelector('[data-act=more]').onclick = e => {
      const r = e.currentTarget.getBoundingClientRect(), items = [['Edit in Scenes', () => { S.sel = s.id; goStage('scenes'); markFlowSel(); }]];
      if (s.approved) items.push(['Mark as not approved', () => { s.approved = false; saveDraft(); refreshSteps(); renderBoard(); }]);
      else if (s.board) items.push(['Approve', () => { s.approved = true; saveDraft(); refreshSteps(); renderBoard(); }]);
      if (s.board) items.push(['Redo sketch', () => sketchScenes([s])]);
      items.push(['Upload a frame…', () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = () => { const fl = inp.files[0]; if (!fl) return; const rd = new FileReader(); rd.onload = async () => { await setBoard(s, rd.result); saveDraft(); renderBoard(); }; rd.readAsDataURL(fl); }; inp.click(); }]);
      showCtx(r.left - 160, r.bottom + 4, { dataset: { kind: 'custom', id: '' }, items, focus: () => e.target.focus() });
    };
    b.appendChild(p);
  });
}
function renderBoardStats() {
  const n = S.scenes.length, ap = S.scenes.filter(s => s.approved).length, sk = S.scenes.filter(s => s.board).length;
  $('#bdStats').textContent = n ? `${n} frames · ${sk} sketched · ${ap} approved · ${fmt(totalLen())}` : '';
  const a = $('#bdAp'); if (a) a.textContent = n ? `${ap} of ${n} approved` : ''; const bar = $('#bdApBar'); if (bar) bar.style.width = (n ? ap / n * 100 : 0) + '%';
}
async function sketchScenes(list) {
  if (!list.length) { toast('Every frame already has a sketch'); return; }
  if (S.settings.provider === 'fal' && list.length > 1 && !confirmBox('Sketch ' + list.length + ' frames with ' + S.settings.imgModel + '? This spends fal.ai credits.')) return;
  for (const s of list) {
    const i = S.scenes.indexOf(s);
    try {
      if (S.settings.provider === 'fal') {
        toast('Sketching frame ' + (i + 1) + '…');
        const out = await falQueue(S.settings.imgModel, { prompt: sketchPrompt(s), image_size: $('#aspect').value === '9:16' ? 'portrait_16_9' : 'landscape_16_9', num_images: 1 }, undefined, 'sketch');
        const url = out.images?.[0]?.url || out.image?.url; if (!url) throw new Error('No image returned');
        await setBoard(s, url);
      } else {
        const c = document.createElement('canvas'); const tall = $('#aspect').value === '9:16'; c.width = tall ? 360 : 640; c.height = tall ? 640 : 360;
        const prev = s.board; s.board = null; const kind = s.kind; s.kind = null; boardFrame(s, i, c, null); s.kind = kind; s.board = prev;
        const x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height), px = d.data;
        for (let k = 0; k < px.length; k += 4) { const g = 255 - (0.3 * px[k] + 0.59 * px[k + 1] + 0.11 * px[k + 2]) * 0.8; px[k] = px[k + 1] = px[k + 2] = g; }
        x.putImageData(d, 0, 0); x.fillStyle = '#F26B1D'; x.font = '600 14px Inter,system-ui'; x.fillText('DEMO SKETCH', 12, c.height - 14);
        await setBoard(s, c.toDataURL('image/png'));
      }
    } catch (e) { toast('Frame ' + (i + 1) + ': ' + e.message, 5000); break; }
    saveDraft(); renderBoard();
  }
  if (S.settings.provider !== 'fal') toast('Demo sketches made from the scene text and assets. Switch to fal.ai in Settings for real sketches.', 5000);
}
$('#bdGen').onclick = () => sketchScenes(S.scenes.filter(s => !s.board));
$('#bdPrint').onclick = () => { try { window.print(); } catch (e) { toast('Printing is blocked here'); } };

// ---------------- File storage ----------------
// Files live in the account's storage (backend.js → /api/files). URLs are signed and short-lived.
const URLS = {};
const fmtSize = n => n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
const EXT = t => ({ 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[(t || '').split(';')[0]] || 'bin');
async function storeFrom(src, kind, id, base) {
  base = base || (S.pid ? 'projects/' + S.pid : null);
  if (!base || !src) return null;
  try {
    const blob = await (await fetch(src)).blob();
    const pref = `${base}/media/${kind}/${id}.`, old = (await Vault.list(pref)).map(f => f.path);
    const path = pref + EXT(blob.type);
    await Vault.put(path, blob); URLS[path] = src.startsWith('blob:') ? src : null;
    for (const o of old) if (o !== path) await Vault.del(o);
    refreshFiles(); return path;
  } catch (e) { toast('Could not save a file: ' + e.message, 5000); return null; }
}
async function vaultURL(path) { if (!path) return null; if (URLS[path]) return URLS[path]; return Vault.url(path); }
function dropFile(path, except) {
  if (!path) return; const users = S.scenes.filter(x => x !== except && (x.file === path || x.voFile === path || x.boardFile === path)).length + S.assets.filter(a => a.imgFile === path).length;
  if (!users) Vault.del(path).then(refreshFiles).catch(() => {});
}
function assetBase(a) { return a.scope === 'show' && S.show ? 'shows/' + S.show.id : a.scope === 'season' && S.season ? 'seasons/' + S.season.id : null; }
async function setScope(a, scope) { const was = a.scope; a.scope = scope; if (a.img && was !== scope) { const src = a.img; a.imgFile = null; await setAssetImg(a, src); } saveDraft(); refreshStage(); renderExplorer(); toast(a.name + (scope === 'show' ? ' is now shared with the whole show' : scope === 'season' ? ' is now shared with the whole season' : ' now belongs to this episode only')); }
async function setAssetImg(a, src) { a.img = src; const pth = await storeFrom(src, 'images', a.id, assetBase(a)); if (pth) { a.imgFile = pth; a.img = await vaultURL(pth) || src; } saveDraft(); }
async function setBoard(s, src) { s.board = src; const pth = await storeFrom(src, 'storyboard', s.id); if (pth) { s.boardFile = pth; s.board = await vaultURL(pth) || src; } saveDraft(); }
async function refreshFiles() {
  if (!S.pid) { S.files = []; return; }
  try {
    const pref = `projects/${S.pid}/media/`;
    S.files = (await Vault.list(pref)).map(f => { const rest = f.path.slice(pref.length).split('/'); return Object.assign(f, { kind: rest[0], name: rest.slice(1).join('/') }); });
  } catch (e) { S.files = []; }
  renderExplorer(); storageUsage();
}
function fileTarget(f) {
  const id = f.name.replace(/\.[^.]+$/, '');
  if (f.kind === 'images') return 'asset:' + id;
  if (f.kind === 'storyboard') return 'stage:board';
  if (f.kind === 'refs' || f.kind === 'music') return 'stage:studio';
  if (f.kind === 'renders') return 'render:' + f.path;
  const s = S.scenes.find(x => x.id === id || x.file === f.path || x.voFile === f.path); return s ? 'scene:' + s.id : 'stage:studio';
}
async function storageUsage() {
  try {
    const e = await Backend.usage(), used = e.storageBytes || 0, q = e.storageQuotaBytes || 1;
    const proj = (S.files || []).reduce((n, f) => n + (f.size || 0), 0);
    const txt = (S.pid && S.stage !== 'home' ? 'This project ' + fmtSize(proj) + ' · ' : '') + 'Account storage ' + fmtSize(used) + ' of ' + fmtSize(q);
    const ks = $('#kStorage'); if (ks) ks.textContent = fmtSize(used);
    const u = $('#exUsage'); if (u) { u.textContent = fmtSize(used) + ' of ' + fmtSize(q); u.title = txt; } const b = $('#exUsageBar'); if (b) b.style.width = Math.min(100, used / q * 100).toFixed(1) + '%';
    const hn = $('#hNote'); if (hn && S.stage === 'home') hn.textContent = 'Everything is saved to your Mitome Cut account: scripts, scenes, assets, storyboard frames, clips, voices and renders. ' + fmtSize(used) + ' used of ' + fmtSize(q) + ' available.';
  } catch (e) {}
}

// ---------------- Projects, home, explorer ----------------
const SAMPLE = { title: 'Into the Deep (sample)', style: 'cinematic nature documentary, deep blue underwater lighting, 35mm film grain, slow camera drift', script: `The ocean covers more than seventy percent of our planet. Yet we have mapped less of its floor than the surface of Mars.

Six thousand metres down, there is no sunlight at all. The pressure would crush a submarine built for shallow water. And still, life finds a way.

Glowing jellyfish drift through the dark. Giant tube worms cluster around volcanic vents, feeding on chemicals instead of light.

This is the story of the deep — and the people risking everything to explore it.`, stage: 'script' };
const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
async function newProject(d) { S.show = null; S.season = null; S.pid = uid(); await loadProject(Object.assign({ title: '' }, d || {})); saveDraft(); goStage((d && d.stage) || 'script'); if (S.stage === 'script') setTimeout(() => $('#script').focus(), 50); }
async function openProject(id) { const d = store.get('ms_proj_' + id, null); if (!d) { toast('Project not found'); return; } S.pid = id; await loadProject(d); goStage(d.stage || 'studio'); }
function prodStats(d) {
  const sc = d.scenes || [], n = sc.length;
  return { n, ap: sc.filter(s => s.approved).length, clips: sc.filter(s => s.file || s.remote).length, demo: sc.filter(s => s.kind === 'demo' && !s.file).length, voices: sc.filter(s => s.voFile).length, script: !!(d.script || '').trim(), boardFile: (sc.find(s => s.boardFile) || {}).boardFile, clipScene: sc.find(s => s.file), assets: (d.assets || []).length, sketched: sc.filter(s => s.boardFile || s.board).length };
}
function phaseOf(st) { return !st.n ? 'writing' : st.ap < st.n ? 'storyboard' : st.clips < st.n ? 'shooting' : 'edit'; }
const PHASES = { writing: 'Writing', storyboard: 'Storyboard', shooting: 'Shooting', edit: 'Edit' };
function libraryItems() {
  const ix = store.get('ms_projects', []), out = [];
  store.get('ms_shows', []).forEach(s0 => {
    const sh = store.get('ms_show_' + s0.id, null); if (!sh) return;
    (sh.seasons || []).forEach((sid, si) => { const sn = store.get('ms_season_' + sid, null); if (!sn) return; (sn.episodes || []).forEach((pid, ei) => { const p = ix.find(x => x.id === pid) || {}, d = store.get('ms_proj_' + pid, {}) || {}; out.push({ id: pid, kind: 'episode', title: epLabel(p.title || d.title, ei + 1), sub: (sh.title || 'Untitled show') + ' · S' + String(si + 1).padStart(2, '0') + 'E' + String(ei + 1).padStart(2, '0'), updated: p.updated || 0, show: sh, st: prodStats(d) }); }); });
  });
  ix.filter(p => !p.seasonId).forEach(p => { const d = store.get('ms_proj_' + p.id, {}) || {}; out.push({ id: p.id, kind: 'movie', title: p.title || 'Untitled movie', sub: 'Movie', updated: p.updated || 0, st: prodStats(d) }); });
  return out;
}
const FLOW_ICONS = {
  show: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 3l4 3 4-3"/></svg>',
  season: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 13h8"/></svg>',
  script: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
  scenes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.5 7C14 7 10 17 15.5 17"/></svg>',
  assets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M15 4h6v6h-6z"/></svg>',
  board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/></svg>',
  studio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18M8 3v6M15 9v6M10 15v6"/></svg>',
  premiere: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/></svg>'
};
function renderFlowStrip(items, shows) {
  const box = $('#hFlow'); if (!box) return;
  const tot = items.reduce((a, i) => ({ n: a.n + i.st.n, ap: a.ap + i.st.ap, clips: a.clips + i.st.clips, scripts: a.scripts + (i.st.script ? 1 : 0), withScenes: a.withScenes + (i.st.n ? 1 : 0), ready: a.ready + (i.st.n && i.st.clips === i.st.n ? 1 : 0) }), { n: 0, ap: 0, clips: 0, scripts: 0, withScenes: 0, ready: 0 });
  const seasons = shows.reduce((n, s) => n + (s.seasons || []).length, 0);
  const assets = items.reduce((n, i) => n + ((store.get('ms_proj_' + i.id, {}) || {}).assets || []).length, 0) + shows.reduce((n, s) => n + (s.assets || []).length, 0) + shows.reduce((n, s) => n + (s.seasons || []).reduce((m, sid) => m + ((store.get('ms_season_' + sid, null) || {}).assets || []).length, 0), 0);
  const phases = items.map(i => phaseOf(i.st)), count = k => phases.filter(p => p === k).length;
  const hotKey = !items.length ? 'show' : { writing: count('writing'), storyboard: count('storyboard'), shooting: count('shooting'), edit: count('edit') };
  const hot = typeof hotKey === 'string' ? hotKey : ({ writing: 'script', storyboard: 'board', shooting: 'studio', edit: 'premiere' })[Object.entries(hotKey).sort((a, b) => b[1] - a[1])[0][0]];
  const steps = [
    { k: 'show', t: 'Show or movie', ln: 'Start a series or a single film', stat: pl(shows.length, 'show') + ' · ' + pl(items.filter(i => i.kind === 'movie').length, 'movie'), done: shows.length || items.length },
    { k: 'season', t: 'Season', ln: 'TV only: theme, style and cast every episode inherits', stat: pl(seasons, 'season'), done: seasons },
    { k: 'script', t: 'Script', ln: 'Write it once, split it into beats', stat: tot.scripts + ' written', done: tot.scripts },
    { k: 'scenes', t: 'Scenes', ln: 'Shape each beat, link them with transitions', stat: pl(tot.n, 'scene'), done: tot.n },
    { k: 'assets', t: 'Assets', ln: 'Cast, places and props that must be in shot', stat: pl(assets, 'asset'), done: assets },
    { k: 'board', t: 'Storyboard', ln: 'Sketch every frame, approve before spending', stat: tot.ap + '/' + tot.n + ' approved', done: tot.n && tot.ap === tot.n },
    { k: 'studio', t: 'Studio', ln: 'Generate, voice, cut and grade', stat: pl(tot.clips, 'clip'), done: tot.n && tot.clips === tot.n },
    { k: 'premiere', t: 'Premiere', ln: 'Export and post it to the world', stat: tot.ready + ' ready', done: tot.ready }
  ];
  box.innerHTML = steps.map((s, i) => `<button class="pnode${s.k === hot ? ' hot' : ''}${s.done && s.k !== hot ? ' done' : ''}" data-k="${s.k}" role="listitem" title="${s.k === hot ? 'Most of your work is here right now' : ''}">${s.tvonly ? '<span class="tvonly">TV shows</span>' : ''}<span class="disc">${FLOW_ICONS[s.k]}<span class="num">${i + 1}</span></span><b>${s.t}</b><span class="ln">${s.ln}</span><span class="stat">${s.stat}</span></button>`).join('') + '<div class="pbypass" id="pBypass"><span>Movies skip ahead</span></div>';
  // place the movie bypass from node 1 to node 3, over Season
  requestAnimationFrame(() => { const n = box.querySelectorAll('.pnode .disc'), bp = $('#pBypass'); if (n.length < 3 || !bp) return; const r0 = box.getBoundingClientRect(), a = n[0].getBoundingClientRect(), c = n[2].getBoundingClientRect(); bp.style.left = (a.left + a.width / 2 - r0.left + box.scrollLeft) + 'px'; bp.style.width = (c.left - a.left) + 'px'; });
  const latest = items.slice().sort((a, b) => b.updated - a.updated)[0];
  box.querySelectorAll('.pnode').forEach(b => b.onclick = async () => {
    const k = b.dataset.k;
    if (k === 'show') { if (!shows.length && !items.length) newShow(); else toast('Use + New TV show or + New movie at the top, or pick one below'); return; }
    if (k === 'season') { const sh = S.show || shows[0]; if (sh) openShow(sh.id); else toast('Seasons live inside a TV show. Create a show first.'); return; }
    if (!latest) { toast('Start a TV show or a movie first'); return; }
    await openProject(latest.id);
    goStage({ script: 'script', scenes: 'scenes', assets: 'assets', board: 'board', studio: 'studio', premiere: 'studio' }[k]);
    if (k === 'premiere') toast('Press Export (top right) to render the finished film');
  });
}
// Pipeline stage of an episode or movie, for Home.
const PIPE = [['script', 'Script'], ['scenes', 'Scenes'], ['assets', 'Assets'], ['board', 'Storyboard'], ['studio', 'Studio'], ['premiere', 'Premiere']];
function pipeOf(st) { if (!st.n) return 'script'; if (st.clips >= st.n) return 'premiere'; if (st.ap >= st.n) return 'studio'; if (st.sketched) return 'board'; if (st.assets) return 'assets'; return 'scenes'; }
const PIPE_LABEL = Object.fromEntries(PIPE);
function nextHint(st) {
  const k = pipeOf(st);
  if (k === 'script') return st.script ? 'split the script into scenes.' : 'write the script.';
  if (k === 'scenes') return 'find the cast, places and props in your scenes.';
  if (k === 'assets') return 'sketch the storyboard frames.';
  if (k === 'board') { const left = st.n - st.ap; return 'review ' + pl(st.sketched - st.ap > 0 ? st.sketched - st.ap : left, 'frame') + (st.sketched < st.n ? ' and sketch the last ' + (st.n - st.sketched) : '') + '.'; }
  if (k === 'studio') return 'generate ' + pl(st.n - st.clips, 'clip') + ' and add voiceover.';
  return 'export and premiere.';
}
function statusLine(k) { const dot = k === 'premiere' ? 'ready' : k === 'script' ? 'none' : 'busy'; return `<span class="stl"><span class="dot ${dot}" aria-hidden="true"></span>${PIPE_LABEL[k]}</span>`; }
function renderHome() {
  const items = libraryItems(), shows = store.get('ms_shows', []).map(s => store.get('ms_show_' + s.id, null)).filter(Boolean);
  const eps = items.filter(i => i.kind === 'episode').length, movies = items.filter(i => i.kind === 'movie');
  const tot = items.reduce((a, i) => ({ n: a.n + i.st.n, ap: a.ap + i.st.ap, clips: a.clips + i.st.clips }), { n: 0, ap: 0, clips: 0 });
  const openIt = (it, stage) => openProject(it.id).then(() => { if (stage) goStage(stage); });
  const thumbFor = async (it, el) => { const f = it.st.boardFile; const u = f ? await vaultURL(f).catch(() => null) : null; if (u) { el.style.backgroundImage = `url('${u}')`; el.classList.add('img'); } };
  const cover = (id, type) => coverFor(id, type).replace('class="cv"', 'class="cv big"');

  // continue where you left off
  const cont = $('#hCont'), it = items.slice().sort((a, b) => b.updated - a.updated)[0];
  if (!it) cont.innerHTML = `<div class="hempty"><b>Nothing in production yet</b><span>Start a TV show or a movie, or open the sample to look around.</span></div>`;
  else {
    const st = it.st, k = pipeOf(st), segs = [['Script', st.script || st.n ? 1 : 0], ['Scenes', st.n ? 1 : 0], ['Assets', st.assets ? 1 : 0], ['Storyboard', st.n ? st.ap / st.n : 0], ['Studio', st.n ? st.clips / st.n : 0]];
    const curIdx = { script: 0, scenes: 1, assets: 2, board: 3, studio: 4, premiere: 4 }[k];
    const target = k === 'premiere' ? 'studio' : k;
    cont.innerHTML = `<div class="hcth">${cover(it.id, it.kind === 'episode' ? 'show' : 'movie')}<span class="hcbadge">${st.n ? pl(st.n, 'scene') : 'No scenes yet'}</span></div>
      <div class="hcb"><span class="cap2">Continue where you left off</span>
        <div><div class="hct">${esc(it.title)}</div><div class="hcm">${esc(it.sub)} · ${pl(st.n, 'scene')} · edited ${ago(it.updated)}</div></div>
        <div class="hseg">${segs.map(([l, f], i) => `<div><div class="bar"><i style="width:${Math.round(Math.min(1, f) * 100)}%"></i></div><span class="${i === curIdx ? 'cur' : f ? 'done' : ''}">${l}</span></div>`).join('')}</div>
        <div class="hnext"><span class="dot ${k === 'premiere' ? 'ready' : 'busy'}" aria-hidden="true"></span><span><b>Next:</b> ${esc(nextHint(st))}</span></div>
        <div class="hca"><button class="btn pri" data-a="cont">Continue in ${PIPE_LABEL[target]}</button>${target !== 'studio' ? '<button class="btn" data-a="studio">Open in Studio</button>' : ''}</div></div>`;
    cont.querySelector('[data-a=cont]').onclick = () => openIt(it, target);
    const sb = cont.querySelector('[data-a=studio]'); if (sb) sb.onclick = () => openIt(it, 'studio');
    thumbFor(it, cont.querySelector('.cv'));
  }

  // totals
  const stat = (v, l, id) => `<div><b ${id ? `id="${id}"` : ''}>${v}</b><span>${l}</span></div>`;
  $('#hKpis').innerHTML = stat(shows.length + movies.length, 'Productions') + stat(eps, 'Episodes') + stat(tot.n, 'Scenes') + stat(tot.ap + ' / ' + tot.n, 'Frames approved') + stat(tot.clips, 'Clips made') + stat('…', 'Storage', 'kStorage');

  // productions
  const f = S.homeFilter || 'all', prod = $('#hProd'); prod.innerHTML = '';
  $$('#hFilter button').forEach(b => b.setAttribute('aria-pressed', b.dataset.f === f));
  const card = (o) => {
    const c = document.createElement('div'); c.className = 'pcard'; c.tabIndex = 0; c.setAttribute('role', 'button');
    c.innerHTML = `<div class="pcth">${cover(o.id, o.type)}</div><div class="pcb"><div class="pcr"><span class="tchip">${o.type === 'show' ? 'TV SHOW' : 'MOVIE'}</span>${statusLine(o.k)}</div><b class="nm">${esc(o.title)}</b><span class="cap2">${esc(o.meta)}</span></div><button class="ib pcmore" aria-label="More actions for ${esc(o.title)}" title="More actions">⋯</button>`;
    c.onclick = e => { if (!e.target.closest('.pcmore, input')) o.open(); };
    c.onkeydown = e => { if (e.key === 'Enter' && e.target === c) o.open(); };
    c.dataset.kind = o.type === 'show' ? 'showrow' : 'movierow'; c.dataset.id = o.id;
    const menu = (x, y) => showCtx(x, y, c);
    c.querySelector('.pcmore').onclick = e => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); menu(r.left, r.bottom + 4); };
    c.oncontextmenu = e => { e.preventDefault(); menu(e.clientX, e.clientY); };
    if (o.thumb) thumbFor(o.thumb, c.querySelector('.cv'));
    prod.appendChild(c);
  };
  if (f !== 'movie') shows.forEach(sh => {
    const its = items.filter(i => i.show && i.show.id === sh.id), firstSeason = its[0];
    const k = its.length ? PIPE[Math.min(...its.map(i => PIPE.findIndex(p => p[0] === pipeOf(i.st))))][0] : 'script';
    card({ id: sh.id, type: 'show', title: sh.title || 'Untitled show', k, meta: pl((sh.seasons || []).length, 'season') + ' · ' + pl(its.length, 'episode'), open: () => openShow(sh.id), thumb: firstSeason });
  });
  if (f !== 'show') movies.forEach(m => card({ id: m.id, type: 'movie', title: m.title, k: pipeOf(m.st), meta: pl(m.st.n, 'scene') + ' · edited ' + ago(m.updated), open: () => openProject(m.id), thumb: m }));
  const start = document.createElement('div'); start.className = 'pstart';
  start.innerHTML = `<span class="pplus" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span><b>Start a production</b><span class="cap2">A TV show has seasons and episodes. A movie goes straight to the script.</span><div><button class="btn sm" data-a="show">TV show</button><button class="btn sm" data-a="movie">Movie</button></div>`;
  start.querySelector('[data-a=show]').onclick = () => newShow(); start.querySelector('[data-a=movie]').onclick = () => newProject();
  prod.appendChild(start);

  // pipeline
  const pipe = $('#hPipe'); pipe.innerHTML = '';
  PIPE.forEach(([k, label]) => {
    const list = items.filter(i => pipeOf(i.st) === k).sort((a, b) => b.updated - a.updated);
    const col = document.createElement('div'); col.className = 'pcol';
    col.innerHTML = `<div class="pch"><span>${label}</span><em>${list.length}</em></div>`;
    if (!list.length) col.insertAdjacentHTML('beforeend', '<span class="pnone">Nothing here yet</span>');
    list.forEach(it => {
      const b = document.createElement('button'); b.className = 'pitem';
      const sub = it.kind === 'episode' ? it.sub.replace(/^.* · S0?(\d+)E0?(\d+)$/, 'S$1 · Episode $2') : k === 'board' ? 'Movie · ' + it.st.ap + ' of ' + it.st.n + ' approved' : 'Movie';
      b.innerHTML = `${coverFor(it.id, it.kind === 'episode' ? 'show' : 'movie').replace('class="cv"', 'class="cv mini"')}<span><b>${esc(it.kind === 'episode' && it.show ? (it.show.title || 'Untitled show') : it.title)}</b><span>${esc(sub)}</span></span>`;
      b.onclick = () => openIt(it, k === 'premiere' ? 'studio' : k);
      col.appendChild(b);
    });
    pipe.appendChild(col);
  });
  storageUsage(); renderExplorer();
}
$$('#hFilter button').forEach(b => b.onclick = () => { S.homeFilter = b.dataset.f; renderHome(); });
function deleteProject(id) {
  const p = store.get('ms_projects', []).find(x => x.id === id); if (!confirmBox('Delete “' + ((p && p.title) || 'this project') + '” and all its files from the app?')) return;
  store.remove('ms_proj_' + id); Vault.delPrefix('projects/' + id + '/').then(storageUsage);
  store.set('ms_projects', store.get('ms_projects', []).filter(x => x.id !== id));
  if (p && p.seasonId) { const sn = store.get('ms_season_' + p.seasonId, null); if (sn) { sn.episodes = (sn.episodes || []).filter(x => x !== id); store.set('ms_season_' + sn.id, sn); if (S.season && S.season.id === sn.id) S.season.episodes = sn.episodes; } }
  if (S.pid === id) S.pid = null;
  if (S.stage === 'season') renderSeason(); else if (S.stage === 'show') renderShow(); else renderHome();
}
// ---------- TV shows ----------
function saveShow() {
  if (!S.show) return; const sh = S.show;
  store.set('ms_show_' + sh.id, sh);
  const ix = store.get('ms_shows', []).filter(x => x.id !== sh.id); ix.unshift({ id: sh.id, title: sh.title, updated: Date.now() }); store.set('ms_shows', ix);
}
function unloadAll() { if (S.pid) saveDraft(); stop(); S.pid = null; S.scenes = []; S.assets = []; S.files = []; }
async function resolveImgs(list) { for (const a of list || []) if (a.imgFile) { const u = await vaultURL(a.imgFile); if (u) a.img = u; } }
async function newShow() {
  unloadAll(); S.season = null;
  S.show = { id: uid(), title: '', theme: '', style: '', script: '', assets: [], seasons: [] };
  saveShow(); goStage('show'); setTimeout(() => $('#shTitle').focus(), 50);
}
async function openShow(id) {
  const sh = store.get('ms_show_' + id, null); if (!sh) { toast('Show not found'); return; }
  unloadAll(); S.season = null; S.show = Object.assign({ seasons: [], assets: [] }, sh);
  await resolveImgs(S.show.assets); goStage('show');
}
function deleteShow(id) {
  const sh = store.get('ms_show_' + id, null); if (!sh) return;
  if (!confirmBox('Delete the show “' + (sh.title || 'Untitled show') + '”, its ' + (sh.seasons || []).length + ' season(s), all episodes and files?')) return;
  (sh.seasons || []).forEach(sid => deleteSeason(sid, true));
  Vault.delPrefix('shows/' + id + '/').then(storageUsage);
  store.remove('ms_show_' + id);
  store.set('ms_shows', store.get('ms_shows', []).filter(x => x.id !== id));
  if (S.show && S.show.id === id) { S.show = null; S.season = null; S.pid = null; goStage('home'); } else renderHome();
}
function seasonLabel(t, n) { return (t || '').trim() || 'Season ' + n; }
function renderOwnerAssets(box, owner, base, scope, save, rerender) {
  box.innerHTML = (owner.assets || []).length ? '' : '<p class="muted" style="margin:0">None yet.</p>';
  (owner.assets || []).forEach(a => {
    const r = document.createElement('div'); r.className = 'sas';
    r.innerHTML = `<label class="aimg" title="Upload image" style="${a.img ? `background-image:url('${a.img.replace(/'/g, '%27')}')` : ''}">${a.img ? '' : AICON[a.type]}<input type="file" accept="image/*" hidden></label>
      <div class="r"><input class="inp" data-k="name" value="${esc(a.name)}" placeholder="Name"><select class="inp" data-k="type" style="width:110px">${Object.entries(ATYPE).map(([k, l]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="ib" data-del title="Delete" aria-label="Delete asset">✕</button></div>
      <input class="inp" data-k="desc" value="${esc(a.desc)}" placeholder="Description: look, clothes, materials, layout">
      <input class="inp" data-k="locks" value="${esc(a.locks)}" placeholder="Locks, e.g. short close fade with waves, NOT an afro">`;
    r.querySelectorAll('[data-k]').forEach(el => el[el.tagName === 'SELECT' ? 'onchange' : 'oninput'] = () => { a[el.dataset.k] = el.value; save(); if (el.tagName === 'SELECT') rerender(); else renderExplorer(); });
    r.querySelector('input[type=file]').onchange = ev => { const f = ev.target.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = async () => { a.img = fr.result; const pth = await storeFrom(fr.result, 'images', a.id, base); if (pth) { a.imgFile = pth; a.img = await vaultURL(pth); } save(); rerender(); }; fr.readAsDataURL(f); };
    r.querySelector('[data-del]').onclick = () => { if (a.imgFile) Vault.del(a.imgFile); owner.assets = owner.assets.filter(x => x !== a); save(); rerender(); };
    box.appendChild(r);
  });
}
function renderShow() {
  const sh = S.show; if (!sh) return;
  const set = (id, k) => { const el = $('#' + id); if (document.activeElement !== el) el.value = sh[k] || ''; el.oninput = () => { sh[k] = el.value; saveShow(); if (k === 'title') { updateCrumb(); renderExplorer(); } }; };
  set('shTitle', 'title'); set('shTheme', 'theme'); set('shStyle', 'style'); set('shScript', 'script');
  $('#shCover').innerHTML = coverFor(sh.id, 'show').replace('class="cv"', 'class="cv big"');
  const ix = store.get('ms_projects', []), seasons = sh.seasons.map(sid => store.get('ms_season_' + sid, null) || { id: sid, episodes: [] });
  const nEps = seasons.reduce((n, sn) => n + (sn.episodes || []).length, 0);
  $('#shMeta').textContent = pl(seasons.length, 'season') + ' · ' + pl(nEps, 'episode') + ' · ' + pl((sh.assets || []).length, 'recurring asset');
  $('#shSnCount').textContent = (sh.assets || []).length || '';
  $('#shStartSeason').textContent = 'Start season ' + (seasons.length + 1);
  const box = $('#shSeasons'); box.innerHTML = seasons.length ? '' : '<p class="muted" style="margin:0">No seasons yet. Start one to add episodes.</p>';
  seasons.forEach((sn, k) => {
    const sid = sh.seasons[k], c = document.createElement('div'); c.className = 'shcard snc';
    c.innerHTML = `<div class="snh"><span class="overline">SEASON ${k + 1}</span><input class="epname" value="${esc(sn.title || '')}" placeholder="Season ${k + 1}" aria-label="Season ${k + 1} name"><span class="cap2">${pl((sn.episodes || []).length, 'episode')}</span>
      <button class="ib" data-a="up" title="Move up" aria-label="Move season up">↑</button><button class="ib" data-a="down" title="Move down" aria-label="Move season down">↓</button><button class="ib" data-a="del" title="Delete season" aria-label="Delete season">✕</button><button class="btn sm" data-a="open">Season page</button></div><div class="eps"></div>`;
    const eps = c.querySelector('.eps');
    if (!(sn.episodes || []).length) eps.innerHTML = '<p class="cap2" style="margin:4px 0 0">No episodes yet.</p>';
    (sn.episodes || []).forEach((pid, e) => {
      const pr = ix.find(x => x.id === pid) || {}, d = store.get('ms_proj_' + pid, {}) || {}, st = prodStats(d), kk = pipeOf(st);
      const r = document.createElement('button'); r.className = 'eprow';
      r.innerHTML = `${coverFor(pid, 'show').replace('class="cv"', 'class="cv mini"')}<span class="ept"><span class="overline">EPISODE ${e + 1}</span><b>${esc(pr.title || d.title || 'Untitled episode')}</b><span class="cap2">${st.n ? pl(st.n, 'scene') + ' · ' + st.ap + ' of ' + st.n + ' frames approved' : st.script ? 'Script written' : 'No script yet'}</span></span>${statusLine(kk)}<span class="chev" aria-hidden="true">›</span>`;
      r.onclick = () => openSeason(sid).then(() => openProject(pid));
      eps.appendChild(r);
    });
    const nm = c.querySelector('.epname'); nm.oninput = () => { const s2 = store.get('ms_season_' + sid, null); if (s2) { s2.title = nm.value; store.set('ms_season_' + sid, s2); } renderExplorer(); }; nm.onkeydown = e => { if (e.key === 'Enter') nm.blur(); };
    c.querySelector('[data-a=open]').onclick = () => openSeason(sid);
    c.querySelector('[data-a=up]').onclick = () => { if (k > 0) { sh.seasons.splice(k, 1); sh.seasons.splice(k - 1, 0, sid); saveShow(); renderShow(); } };
    c.querySelector('[data-a=down]').onclick = () => { if (k < sh.seasons.length - 1) { sh.seasons.splice(k, 1); sh.seasons.splice(k + 1, 0, sid); saveShow(); renderShow(); } };
    c.querySelector('[data-a=del]').onclick = () => { deleteSeason(sid); renderShow(); };
    box.appendChild(c);
  });
  renderOwnerAssets($('#shAssets'), sh, 'shows/' + sh.id, 'show', saveShow, renderShow);
  renderExplorer();
}
function showTab(t) { $$('.shtabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === t)); $$('#stShow [data-tab]').forEach(el => el.hidden = el.dataset.tab !== t); }
$$('.shtabs button').forEach(b => b.onclick = () => showTab(b.dataset.t));
$('#shBibleLink').onclick = () => { showTab('bible'); $('#shScript').focus(); };
$('#shStartSeason').onclick = () => newSeason();
$('#shNewEp').onclick = () => { const sh = S.show; if (!sh) return; if (!sh.seasons.length) { newSeason(); return; } openSeason(sh.seasons[sh.seasons.length - 1]).then(() => exNewEpisode()); };
$('#shFromScript').onclick = () => { const sh = S.show; if (!sh) return; if (!sh.seasons.length) { newSeason(); return; } openSeason(sh.seasons[sh.seasons.length - 1]).then(() => { const b = $('#snSplit'); if (b) b.click(); }); };
$('#shNewSeason').onclick = () => newSeason();
$$('[data-shnew]').forEach(b => b.onclick = () => { const sh = S.show; sh.assets = sh.assets || []; sh.assets.push({ id: uid(), scope: 'show', type: b.dataset.shnew, name: 'New ' + ATYPE[b.dataset.shnew].toLowerCase(), desc: '', locks: '', keys: '', prompt: '', img: null }); saveShow(); renderShow(); });
$('#hNewShow').onclick = () => newShow();
$('#crumbShow').onclick = () => { if (S.show) openShow(S.show.id); };

// ---------- seasons ----------
function saveSeason() {
  if (!S.season) return; const sn = S.season;
  store.set('ms_season_' + sn.id, sn);
  const ix = store.get('ms_seasons', []).filter(x => x.id !== sn.id); ix.unshift({ id: sn.id, title: sn.title, updated: Date.now() }); store.set('ms_seasons', ix);
}
function seasonContext() {
  const shc = S.show ? `TV show: ${S.show.title || ''}\nShow theme: ${S.show.theme || 'none'}\n${S.show.script ? 'Show bible (for context):\n' + S.show.script.slice(0, 2500) + '\n' : ''}` : '';
  if (!S.season) return shc;
  const sn = S.season, ep = sn.episodes.indexOf(S.pid) + 1;
  return shc + `Season: ${sn.title || ''}${ep ? ' (this is episode ' + ep + ')' : ''}\nSeason theme: ${sn.theme || 'none'}\n${sn.script ? 'Season script (for context):\n' + sn.script.slice(0, 3000) + '\n' : ''}\n`;
}
async function newSeason() {
  if (!S.show) { toast('Seasons live inside a TV show. Create a show first.'); return; }
  unloadAll();
  const n = S.show.seasons.length + 1;
  S.season = { id: uid(), showId: S.show.id, title: '', theme: '', style: '', script: '', assets: [], episodes: [] };
  S.show.seasons.push(S.season.id); saveShow(); saveSeason(); goStage('season'); setTimeout(() => { $('#snTitle').focus(); }, 50);
}
async function openSeason(id) {
  const sn = store.get('ms_season_' + id, null); if (!sn) { toast('Season not found'); return; }
  unloadAll(); S.season = Object.assign({ episodes: [], assets: [] }, sn);
  S.show = sn.showId ? Object.assign({ seasons: [], assets: [] }, store.get('ms_show_' + sn.showId, {})) : null;
  await resolveImgs(S.season.assets); if (S.show) await resolveImgs(S.show.assets);
  goStage('season');
}
function deleteSeason(id, silent) {
  const sn = store.get('ms_season_' + id, null); if (!sn) return;
  if (!silent && !confirmBox('Delete the season “' + sn.title + '”, its ' + (sn.episodes || []).length + ' episode(s) and all their files?')) return;
  (sn.episodes || []).forEach(pid => { store.remove('ms_proj_' + pid); Vault.delPrefix('projects/' + pid + '/'); });
  Vault.delPrefix('seasons/' + id + '/').then(storageUsage);
  store.remove('ms_season_' + id);
  store.set('ms_seasons', store.get('ms_seasons', []).filter(x => x.id !== id));
  store.set('ms_projects', store.get('ms_projects', []).filter(x => !(sn.episodes || []).includes(x.id)));
  if (sn.showId) { const sh = store.get('ms_show_' + sn.showId, null); if (sh) { sh.seasons = (sh.seasons || []).filter(x => x !== id); store.set('ms_show_' + sh.id, sh); if (S.show && S.show.id === sh.id) S.show.seasons = sh.seasons; } }
  if (silent) return;
  if (S.season && S.season.id === id) { S.season = null; S.pid = null; if (S.show) goStage('show'); else goStage('home'); } else if (S.stage === 'show') renderShow(); else renderHome();
}
async function newEpisode(d) {
  const sn = S.season; if (!sn) return;
  const n = sn.episodes.length + 1, pid = uid();
  const data = Object.assign({ pid, seasonId: sn.id, title: '', script: '', style: '', scenes: [], assets: [], stage: 'script' }, d || {});
  store.set('ms_proj_' + pid, data);
  const ix = store.get('ms_projects', []); ix.unshift({ id: pid, title: data.title, updated: Date.now(), scenes: 0, assets: 0, seasonId: sn.id }); store.set('ms_projects', ix);
  sn.episodes.push(pid); saveSeason(); return pid;
}
function renderSeason() {
  const sn = S.season; if (!sn) return;
  const set = (id, k) => { const el = $('#' + id); if (document.activeElement !== el) el.value = sn[k] || ''; el.oninput = () => { sn[k] = el.value; saveSeason(); if (k === 'title') { updateCrumb(); renderExplorer(); } }; };
  set('snTitle', 'title'); set('snTheme', 'theme'); set('snStyle', 'style'); set('snScript', 'script');
  const sh = S.show, sIdx = sh ? sh.seasons.indexOf(sn.id) + 1 : 0;
  $('#snOver').textContent = sh ? (sh.title || 'Untitled show') + ' · SEASON ' + sIdx : 'SEASON';
  $('#snTitle').placeholder = 'Season ' + (sIdx || '');
  const shn = $('#snShowNote'); shn.style.display = sh && sh.style ? '' : 'none'; if (sh) shn.innerHTML = '<span class="lbl">Show style, applied before this</span><div>' + esc(sh.style || '') + '</div>';
  const ix = store.get('ms_projects', []), box = $('#snEps');
  $('#snEpCount').textContent = sn.episodes.length ? sn.episodes.length : '';
  box.innerHTML = sn.episodes.length ? '' : '<p class="muted" style="margin:0">No episodes yet. Add one, or write the season script with “Episode 1: …” headings and create them all at once.</p>';
  sn.episodes.forEach((pid, k) => {
    const p = ix.find(x => x.id === pid) || {}, d = store.get('ms_proj_' + pid, {}) || {}, ap = (d.scenes || []).filter(s => s.approved).length;
    const c = document.createElement('div'); c.className = 'epc';
    c.innerHTML = `<span class="no">EP ${String(k + 1).padStart(2, '0')}</span><span class="t"><input class="epname" value="${esc(p.title || d.title || '')}" placeholder="Name this episode" aria-label="Episode ${k + 1} name"><span>${(d.scenes || []).length} scenes · ${ap}/${(d.scenes || []).length} frames approved${p.updated ? ' · ' + ago(p.updated) : ''}</span></span>
      <button class="ib" data-a="up" title="Move up" aria-label="Move up">↑</button><button class="ib" data-a="down" title="Move down" aria-label="Move down">↓</button><button class="ib" data-a="del" title="Delete episode" aria-label="Delete episode">✕</button><button class="btn sm" data-a="open">Open</button>`;
    const nm = c.querySelector('.epname'); nm.oninput = () => renameEpisode(pid, nm.value); nm.onkeydown = e => { if (e.key === 'Enter') { nm.blur(); } };
    c.querySelector('[data-a=open]').onclick = () => openProject(pid);
    c.querySelector('[data-a=up]').onclick = () => { if (k > 0) { sn.episodes.splice(k, 1); sn.episodes.splice(k - 1, 0, pid); saveSeason(); renderSeason(); renderExplorer(); } };
    c.querySelector('[data-a=down]').onclick = () => { if (k < sn.episodes.length - 1) { sn.episodes.splice(k, 1); sn.episodes.splice(k + 1, 0, pid); saveSeason(); renderSeason(); renderExplorer(); } };
    c.querySelector('[data-a=del]').onclick = () => deleteProject(pid);
    box.appendChild(c);
  });
  renderOwnerAssets($('#snAssets'), sn, 'seasons/' + sn.id, 'season', saveSeason, renderSeason);
  renderExplorer();
}
$('#snNewEp').onclick = async () => { await newEpisode({ title: '' }); renderSeason(); const ins = $$('#snEps .epname'); const el = ins[ins.length - 1]; if (el) { el.focus(); el.scrollIntoView({ block: 'nearest' }); } toast('Episode added – type its name, then press Open'); };
$('#snSplit').onclick = async () => {
  const sn = S.season, text = sn.script || '';
  const re = /^[ \t]*(?:#+[ \t]*)?(?:episode|ep\.?)[ \t]*(\d+)[ \t]*[:.\-–—]?[ \t]*(.*)$/gim, heads = []; let m;
  while ((m = re.exec(text))) heads.push({ n: +m[1], title: m[2].trim(), at: m.index, end: m.index + m[0].length });
  if (!heads.length) { toast('Add headings like “Episode 1: Title” to the season script first', 5000); return; }
  const ix = store.get('ms_projects', []); let made = 0;
  for (let k = 0; k < heads.length; k++) {
    const hd = heads[k], body = text.slice(hd.end, k + 1 < heads.length ? heads[k + 1].at : text.length).trim();
    const title = hd.title || 'Episode ' + hd.n;
    if (sn.episodes.some(pid => (ix.find(x => x.id === pid) || {}).title === title)) continue;
    await newEpisode({ title, script: body }); made++;
  }
  renderSeason(); toast(made ? made + ' episode(s) created from the season script' : 'Those episodes already exist');
};
$$('[data-snnew]').forEach(b => b.onclick = () => { const sn = S.season; sn.assets = sn.assets || []; sn.assets.push({ id: uid(), scope: 'season', type: b.dataset.snnew, name: 'New ' + ATYPE[b.dataset.snnew].toLowerCase(), desc: '', locks: '', keys: '', prompt: '', img: null }); saveSeason(); renderSeason(); });
function epLabel(t, n) { return (t || '').trim() || 'Episode ' + n; }
function renameEpisode(pid, title) {
  if (pid === S.pid) { $('#title').value = title; const sc = $('#scName'); if (sc && document.activeElement !== sc) sc.value = title; saveDraft(); }
  else { const d = store.get('ms_proj_' + pid, null); if (d) { d.title = title; store.set('ms_proj_' + pid, d); } }
  const ix = store.get('ms_projects', []), e = ix.find(x => x.id === pid); if (e) { e.title = title; e.updated = Date.now(); store.set('ms_projects', ix); }
  renderExplorer(); updateCrumb();
}
function renderSeasonBox() {
  const b = $('#seasonBox'); if (!b) return;
  if (!S.season) { b.style.display = 'none'; return; }
  const sn = S.season, ep = sn.episodes.indexOf(S.pid) + 1;
  const sIdx = S.show ? S.show.seasons.indexOf(sn.id) + 1 : 0;
  b.style.display = ''; b.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span class="overline">${S.show ? esc(S.show.title || 'Show') + ' · S' + sIdx + ' · ' : 'SEASON · '}EP ${String(ep).padStart(2, '0')}</span><button class="btn sm" id="sbOpen" style="height:24px">Open season</button></div>
    <b style="color:var(--text);font-size:13px">${esc(seasonLabel(sn.title, sIdx || 1))}</b>
    ${S.show && S.show.style ? `<div style="margin-top:6px"><span class="lbl">Show style (applied first)</span><div>${esc(S.show.style)}</div></div>` : ''}
    ${sn.theme ? `<div style="margin-top:6px"><span class="lbl">Theme</span><div>${esc(sn.theme)}</div></div>` : ''}
    <div style="margin-top:6px"><span class="lbl">Season style</span><div>${esc(sn.style || 'Not set')}</div></div>`;
  $('#sbOpen').onclick = () => openSeason(sn.id);
}
function updateCrumb() {
  const sh = S.show, sn = S.season, st = S.stage, inEp = !!(S.pid && sn && !['season', 'show', 'home'].includes(st));
  const csh = $('#crumbShow'), cs = $('#crumbSeason');
  csh.style.display = sh && st !== 'home' ? '' : 'none'; csh.textContent = sh ? (sh.title || 'Untitled show') : ''; csh.style.color = st === 'show' ? 'var(--text)' : 'var(--muted)';
  $('#crumbShowSep').style.display = sh && sn && st !== 'home' ? '' : 'none';
  cs.style.display = sn && st !== 'home' ? '' : 'none'; cs.style.color = st === 'season' ? 'var(--text)' : 'var(--muted)';
  cs.textContent = sn ? seasonLabel(sn.title, sh ? sh.seasons.indexOf(sn.id) + 1 : 1) : '';
  $('#crumbSeasonSep').style.display = inEp ? '' : 'none';
  const ep = $('#crumbEp'); ep.style.display = inEp ? '' : 'none'; if (inEp) ep.textContent = 'EP ' + String(sn.episodes.indexOf(S.pid) + 1).padStart(2, '0');
}
$('#crumbSeason').onclick = () => { if (S.season) openSeason(S.season.id); };
$('#hNew').onclick = () => newProject();
$('#hSample').onclick = () => newProject(SAMPLE);
['#crumbHome', '#logoHome'].forEach(q => $(q).onclick = e => { e.preventDefault(); saveDraft(); goStage('home'); });
// explorer
S.exOpen = { scenes: true, assets: true, character: true, location: true, prop: true, look: true, media: false };
const slug = t => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 26) || 'untitled';
const EXI = {
  folder: o => `<svg width="14" height="14" viewBox="0 0 24 24" fill="${o ? 'none' : 'none'}" stroke="#9C9CA6" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  md: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9C9CA6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
  canvas: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFC72C" stroke-width="1.8" stroke-linecap="round"><circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.5 7C14 7 10 17 15.5 17"/></svg>',
  scene: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF8F52" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z" fill="#FF8F52"/></svg>',
  asset: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFC72C" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/></svg>',
  board: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fc7e0" stroke-width="1.8"><rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/></svg>',
  studio: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F26B1D" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18M8 3v6M15 9v6M10 15v6"/></svg>',
  media: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9C9CA6" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/></svg>',
  tv: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF8F52" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 3l4 3 4-3"/></svg>',
  film: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF8F52" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16"/></svg>',
  cloud: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF8F52" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.7-1.5A4 4 0 0 1 17.5 18z"/></svg>',
  json: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9C9CA6" stroke-width="1.8" stroke-linecap="round"><path d="M8 4c-2 0-2 2-2 4s-2 4-2 4 2 0 2 4 0 4 2 4M16 4c2 0 2 2 2 4s2 4 2 4-2 0-2 4 0 4-2 4"/></svg>'
};
// ---- sidebar: productions, the open production's stages ----
const COVERS = [
  '<i class="cv" style="background:#F26B1D"><b style="right:12%;top:14%;width:24%;background:#FFC72C"></b><b style="left:-12%;bottom:-46%;width:64%;background:#C2410C"></b><b style="right:-10%;bottom:-60%;width:70%;background:#7C2D12"></b></i>',
  '<i class="cv" style="background:#071422"><b style="left:22%;top:18%;width:20%;background:rgba(127,227,216,.75)"></b><b style="left:58%;top:36%;width:15%;background:rgba(158,140,255,.7)"></b><b style="left:40%;top:64%;width:11%;background:rgba(127,227,216,.5)"></b></i>',
  '<i class="cv" style="background:#2B1A10"><b style="left:30%;top:22%;width:40%;background:#F26B1D"></b></i>',
  '<i class="cv" style="background:#FFC72C"><b style="left:30%;top:22%;width:40%;background:#F26B1D"></b></i>',
  '<i class="cv" style="background:#C2410C"><b style="left:30%;top:22%;width:40%;background:#FFC72C"></b></i>'
];
function coverFor(id, type) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return type === 'show' ? COVERS[[0, 0, 3, 4][h % 4]] : COVERS[1]; }
const curStageOpen = () => 'stage:' + (['home', 'show', 'season'].includes(S.stage) ? (S.lastStage || 'script') : S.stage);
const STAGE_LINKS = [['script', 'Script'], ['scenes', 'Scenes'], ['assets', 'Assets'], ['board', 'Storyboard'], ['studio', 'Studio']];
function renderExplorer() {
  const t = $('#exTree'); if (!t) return;
  const hadFocus = t.contains(document.activeElement) && !document.activeElement.classList.contains('ren');
  if (t.querySelector('input.ren')) return; // don't disturb an active rename
  const q = ($('#sbSearch') ? $('#sbSearch').value : '').trim().toLowerCase(), match = n => !q || String(n || '').toLowerCase().includes(q);
  const rows = [], st = S.stage;
  const row = (cls, inner, o = {}) => rows.push(`<button class="exr ${cls}${o.on ? ' on' : ''}" data-key="${o.kind || 'x'}:${o.id || ''}" data-kind="${o.kind || ''}" data-id="${o.id || ''}" ${o.open ? `data-open="${o.open}"` : ''} ${o.tog ? `data-tog="${o.tog}"` : ''} title="${esc(o.title || '')}" role="treeitem" tabindex="-1">${inner}</button>`);
  const nm = n => `<span class="nm">${esc(n)}</span>`, mt = m => m === '' || m == null ? '' : `<span class="mt">${m}</span>`;
  const stages = () => {
    const done = { script: !!$('#script').value.trim(), scenes: S.scenes.length > 0, assets: S.assets.length > 0, board: S.scenes.length > 0 && S.scenes.every(x => x.approved), studio: S.scenes.length > 0 && S.scenes.every(x => x.kind === 'video') };
    STAGE_LINKS.forEach(([k, label]) => row('stg', `<span class="sdot${st === k ? ' cur' : done[k] ? ' done' : ''}" aria-hidden="true"></span>${nm(label)}`, { open: 'stage:' + k, on: st === k, kind: 'file', id: k, title: label }));
  };
  const shows = store.get('ms_shows', []), ix = store.get('ms_projects', []), movies = ix.filter(p => !p.seasonId);
  let any = false;
  shows.forEach(s0 => {
    const sh = (S.show && S.show.id === s0.id) ? S.show : (store.get('ms_show_' + s0.id, null) || { seasons: [] });
    const eps = (sh.seasons || []).reduce((n, sid) => n + ((store.get('ms_season_' + sid, null) || {}).episodes || []).length, 0);
    if (!match(sh.title)) return; any = true;
    const open = S.show && S.show.id === s0.id;
    row('prod', coverFor(s0.id, 'show') + nm(sh.title || 'Untitled show') + mt(eps ? eps + ' ep' : ''), { open: 'showid:' + s0.id, on: open && st === 'show', kind: open ? 'show' : 'showrow', id: s0.id, title: 'TV show · right-click for actions' });
    if (!open) return;
    (sh.seasons || []).forEach((sid, k) => {
      const sn = S.season && S.season.id === sid ? S.season : store.get('ms_season_' + sid, null); if (!sn) return;
      const cur = S.season && S.season.id === sid;
      row('sub', nm('Season ' + (k + 1) + (sn.title && !/^season\s*\d+$/i.test(sn.title) ? ' · ' + sn.title : '')) + mt((sn.episodes || []).length || ''), { open: 'seasonid:' + sid, on: cur && st === 'season', kind: cur ? 'season' : 'libseason', id: sid });
      if (!cur) return;
      (sn.episodes || []).forEach((pid, e) => {
        const p = ix.find(x => x.id === pid) || {}, title = pid === S.pid ? ($('#title').value || p.title) : p.title;
        row('sub2', nm('E' + (e + 1) + ' · ' + (title || 'Untitled episode')), { open: pid === S.pid ? curStageOpen() : 'episode:' + pid, on: pid === S.pid && false, kind: 'episode', id: pid });
        if (pid === S.pid) stages();
      });
    });
  });
  movies.forEach(p => {
    const open = p.id === S.pid && !S.season, title = open ? ($('#title').value || p.title) : p.title;
    if (!match(title)) return; any = true;
    row('prod', coverFor(p.id, 'movie') + nm(title || 'Untitled movie') + mt(p.scenes || ''), { open: open ? curStageOpen() : 'episode:' + p.id, kind: open ? 'project' : 'movierow', id: p.id, title: 'Movie · right-click for actions' });
    if (open) stages();
  });
  if (!any) rows.push(`<p class="sbempty">${q ? 'No productions match “' + esc(q) + '”.' : 'No productions yet. Use + to start a TV show or a movie.'}</p>`);
  t.innerHTML = rows.join('');
  $$('#explorer .sbnav button').forEach(b => b.toggleAttribute('aria-current', (b.id === 'navHome' && st === 'home') || (b.id === 'navAssets' && st === 'assets')));
  if (hadFocus && S.exFocus) { const el = t.querySelector(`[data-key="${CSS.escape(S.exFocus)}"]`); if (el) el.focus(); }
}
$('#sbSearch').addEventListener('input', () => renderExplorer());
$('#navHome').onclick = () => goStage('home');
$('#navAssets').onclick = () => { if (S.pid) goStage('assets'); else if (S.show) { goStage('show'); } else toast('Open a production to see its assets'); };
$('#navSettings').onclick = () => openSettings();
$('#sbNew').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); showCtx(r.left, r.bottom + 4, { dataset: { kind: 'fnew', id: '' } }); };
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (S.stage === 'studio') goStage('home'); setTimeout(() => $('#sbSearch').focus(), 30); } });
// ---- explorer behaviour (delegated) ----
const EXT_RENAMABLE = ['showrow', 'movierow', 'libseason', 'show', 'season', 'seasonrow', 'project', 'episode', 'scene', 'asset', 'sasset', 'shasset'];
let renTimer = 0;
function exRow(key) { return $('#exTree').querySelector(`[data-key="${CSS.escape(key)}"]`); }
function exOpenRow(b) {
  const [kind, id] = (b.dataset.open || '').split(':');
  if (b.dataset.kind === 'empty') return;
  if (b.dataset.tog && !b.dataset.open) { S.exOpen[b.dataset.tog] = !S.exOpen[b.dataset.tog]; renderExplorer(); return; }
  if (b.dataset.tog && b.dataset.kind === 'episode') { S.exOpen[b.dataset.tog] = !S.exOpen[b.dataset.tog]; renderExplorer(); return; }
  if (kind === 'stage') goStage(id);
  if (kind === 'scene') { if (S.stage !== 'studio') goStage('studio'); select(id, true); }
  if (kind === 'asset') { S.aSel = id; if (S.stage !== 'assets') goStage('assets'); else renderAssets(); setTimeout(() => { const el = $('.acard[aria-expanded=true]'); if (el) el.scrollIntoView({ block: 'nearest' }); }, 30); renderExplorer(); }
  if (kind === 'episode') openProject(id);
  if (kind === 'render') Vault.url(id).then(u => { if (u) window.open(u, '_blank', 'noopener'); });
  if (kind === 'seasonid') openSeason(id);
  if (kind === 'showid') openShow(id);
  if (kind === 'show' && S.show) { const go = () => { if (id) { const el = $('#' + id); if (el) { el.scrollIntoView({ block: 'center' }); if (el.focus) el.focus(); } } }; if (S.stage === 'show') go(); else openShow(S.show.id).then(() => setTimeout(go, 60)); }
  if (kind === 'season') { const sn = S.season, go = () => { if (id) { const el = $('#' + id); if (el) { el.scrollIntoView({ block: 'center' }); if (el.focus) el.focus(); } } }; if (S.stage === 'season') go(); else openSeason(sn.id).then(() => setTimeout(go, 60)); }
}
(function wireExplorer() {
  const t = $('#exTree');
  t.addEventListener('click', e => {
    const b = e.target.closest('.exr'); if (!b || b.querySelector('input.ren')) return;
    S.exFocus = b.dataset.key;
    if (b.dataset.tog && b.dataset.open && e.target.closest('.chev')) { S.exOpen[b.dataset.tog] = !S.exOpen[b.dataset.tog]; renderExplorer(); return; }
    if (EXT_RENAMABLE.includes(b.dataset.kind) && b.dataset.open && /^(episode|seasonid|showid):/.test(b.dataset.open)) { clearTimeout(renTimer); renTimer = setTimeout(() => exOpenRow(b), 250); return; }
    exOpenRow(b);
  });
  t.addEventListener('dblclick', e => { const b = e.target.closest('.exr'); if (b && EXT_RENAMABLE.includes(b.dataset.kind)) { e.preventDefault(); clearTimeout(renTimer); startRename(b); } });
  t.addEventListener('focusin', e => { const b = e.target.closest('.exr'); if (b) S.exFocus = b.dataset.key; });
  t.addEventListener('keydown', e => {
    const b = e.target.closest('.exr'); if (!b || e.target.tagName === 'INPUT') return;
    const all = [...t.querySelectorAll('.exr')], i = all.indexOf(b);
    if (e.key === 'ArrowDown') { e.preventDefault(); (all[i + 1] || b).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (all[i - 1] || b).focus(); }
    else if (e.key === 'ArrowRight' && b.dataset.tog) { e.preventDefault(); if (!S.exOpen[b.dataset.tog]) { S.exOpen[b.dataset.tog] = true; renderExplorer(); } else (all[i + 1] || b).focus(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (b.dataset.tog && S.exOpen[b.dataset.tog]) { S.exOpen[b.dataset.tog] = false; renderExplorer(); } else { const pad = parseInt(b.style.paddingLeft); for (let k = i - 1; k >= 0; k--) if (parseInt(all[k].style.paddingLeft) < pad) { all[k].focus(); break; } } }
    else if (e.key === 'Enter') { e.preventDefault(); exOpenRow(b); }
    else if (e.key === 'F2') { e.preventDefault(); if (EXT_RENAMABLE.includes(b.dataset.kind)) startRename(b); }
    else if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); exDelete(b.dataset.kind, b.dataset.id); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); exDuplicate(b.dataset.kind, b.dataset.id); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = b.getBoundingClientRect(); showCtx(r.left + 30, r.bottom, b); }
  });
  t.addEventListener('contextmenu', e => { e.preventDefault(); const b = e.target.closest('.exr'); if (b) { b.focus(); S.exFocus = b.dataset.key; } showCtx(e.clientX, e.clientY, b); });
  // drag to reorder scenes / episodes, drop video files to import
  let drag = null;
  t.addEventListener('dragstart', e => { const b = e.target.closest('.exr[draggable]'); if (!b) return; drag = { kind: b.dataset.kind, id: b.dataset.id }; b.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.dataset.key); });
  t.addEventListener('dragend', () => { drag = null; t.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
  t.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('Files')) { if (S.pid) { e.preventDefault(); t.classList.add('dropfile'); } return; }
    if (!drag) return; const b = e.target.closest('.exr'); t.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    if (!b || b.dataset.kind !== drag.kind || b.dataset.id === drag.id) return;
    e.preventDefault(); const r = b.getBoundingClientRect(); b.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  t.addEventListener('dragleave', e => { if (e.target === t) t.classList.remove('dropfile'); });
  t.addEventListener('drop', e => {
    t.classList.remove('dropfile');
    if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); if (S.pid) importVideos(e.dataTransfer.files); return; }
    const b = e.target.closest('.exr'); if (!drag || !b || b.dataset.kind !== drag.kind) return; e.preventDefault();
    const after = b.classList.contains('drop-after');
    if (drag.kind === 'scene') { const a = S.scenes.findIndex(x => x.id === drag.id); const [m] = S.scenes.splice(a, 1); let k = S.scenes.findIndex(x => x.id === b.dataset.id); S.scenes.splice(k + (after ? 1 : 0), 0, m); stop(); saveDraft(); renderAll(); }
    if (drag.kind === 'seasonrow' && S.show) { const L = S.show.seasons, a = L.indexOf(drag.id); L.splice(a, 1); let k = L.indexOf(b.dataset.id); if (k < 0) k = L.length; L.splice(k + (after ? 1 : 0), 0, drag.id); saveShow(); renderExplorer(); if (S.stage === 'show') renderShow(); }
    if (drag.kind === 'episode') { const L = S.season.episodes, a = L.indexOf(drag.id); L.splice(a, 1); let k = L.indexOf(b.dataset.id); L.splice(k + (after ? 1 : 0), 0, drag.id); saveSeason(); renderExplorer(); if (S.stage === 'season') renderSeason(); updateCrumb(); }
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#ctx')) hideCtx(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtx(); });
  window.addEventListener('blur', hideCtx);
})();
function startRename(btn) {
  clearTimeout(renTimer);
  const kind = btn.dataset.kind, id = btn.dataset.id, nm = btn.querySelector('.nm'); if (!nm) return;
  const cur = exGetName(kind, id);
  const inp = document.createElement('input'); inp.className = 'ren'; inp.value = cur; inp.placeholder = { showrow: 'Show name', movierow: 'Movie name', libseason: 'Season name', show: 'Show name', seasonrow: 'Season name', shasset: 'Asset name', scene: 'Scene name', asset: 'Asset name', sasset: 'Asset name', episode: 'Episode name', season: 'Season name', project: 'Project name' }[kind];
  nm.replaceWith(inp); inp.focus(); inp.select();
  ['click', 'pointerdown', 'dblclick'].forEach(ev => inp.addEventListener(ev, e => e.stopPropagation()));
  let finished = false;
  const done = keep => { if (finished) return; finished = true; inp.remove(); if (keep && inp.value.trim() !== cur) exSetName(kind, id, inp.value.trim()); renderExplorer(); setTimeout(() => { const el = exRow(kind + ':' + id); if (el) el.focus(); }, 0); };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  inp.addEventListener('blur', () => done(true));
}
function findAsset(id) { return S.assets.find(a => a.id === id) || (S.season && (S.season.assets || []).find(a => a.id === id)) || (S.show && (S.show.assets || []).find(a => a.id === id)); }
function saveOwners() { if (S.pid) saveDraft(); else { saveSeason(); saveShow(); } }
function exGetName(kind, id) {
  if (kind === 'scene') { const s = S.scenes.find(x => x.id === id); return s ? s.label : ''; }
  if (['asset', 'sasset', 'shasset'].includes(kind)) { const a = findAsset(id); return a ? a.name : ''; }
  if (kind === 'episode') return id === S.pid ? $('#title').value : ((store.get('ms_projects', []).find(x => x.id === id) || {}).title || '');
  if (kind === 'season') return S.season ? S.season.title : '';
  if (kind === 'show') return S.show ? S.show.title : '';
  if (kind === 'seasonrow' || kind === 'libseason') return (store.get('ms_season_' + id, null) || {}).title || '';
  if (kind === 'showrow') return (store.get('ms_show_' + id, null) || {}).title || '';
  if (kind === 'movierow' || kind === 'libep') return (store.get('ms_projects', []).find(x => x.id === id) || {}).title || '';
  if (kind === 'project') return $('#title').value;
  return '';
}
function exSetName(kind, id, v) {
  if (kind === 'scene') { const s = S.scenes.find(x => x.id === id); if (s) { s.label = v; saveDraft(); renderScenes(); renderTimeline(); renderInspector(); renderViewerTop(); refreshStage(); } }
  if (['asset', 'sasset', 'shasset'].includes(kind)) {
    const a = findAsset(id); if (!a) return; a.name = v;
    if (S.pid) { const m = S.assets.find(x => x.id === id); if (m) m.name = v; } saveOwners();
    if (S.stage === 'assets') { renderAssets(); renderMatrix(); } if (S.stage === 'season') renderSeason(); if (S.stage === 'show') renderShow(); renderInspector();
  }
  if (kind === 'episode') { renameEpisode(id, v); if (S.stage === 'season') renderSeason(); }
  if (kind === 'season' && S.season) { S.season.title = v; saveSeason(); updateCrumb(); if (S.stage === 'season') renderSeason(); renderSeasonBox(); }
  if (kind === 'project') { $('#title').value = v; syncName(); saveDraft(); }
  if (kind === 'show' && S.show) { S.show.title = v; saveShow(); updateCrumb(); if (S.stage === 'show') renderShow(); renderSeasonBox(); }
  if (kind === 'showrow') { const s2 = store.get('ms_show_' + id, null); if (s2) { s2.title = v; store.set('ms_show_' + id, s2); const ix = store.get('ms_shows', []), e = ix.find(x => x.id === id); if (e) { e.title = v; store.set('ms_shows', ix); } } if (S.stage === 'home') renderHome(); }
  if (kind === 'movierow' || kind === 'libep') { renameEpisode(id, v); if (S.stage === 'home') renderHome(); }
  if (kind === 'seasonrow' || kind === 'libseason') { const s2 = store.get('ms_season_' + id, null); if (s2) { s2.title = v; store.set('ms_season_' + id, s2); } if (S.stage === 'show') renderShow(); }
}
async function exDelete(kind, id) {
  if (kind === 'scene') { const s = S.scenes.find(x => x.id === id); if (s && confirmBox('Delete scene ' + (S.scenes.indexOf(s) + 1) + (s.label ? ' “' + s.label + '”' : '') + ' and its files?')) deleteScene(s); }
  else if (['asset', 'sasset', 'shasset'].includes(kind)) {
    const a = findAsset(id); if (!a || !confirmBox('Delete the asset “' + a.name + '”' + (a.scope === 'season' ? ' from the whole season' : '') + '?')) return;
    if (a.imgFile) Vault.del(a.imgFile).then(refreshFiles).catch(() => {});
    S.assets = S.assets.filter(x => x.id !== id); S.scenes.forEach(s => s.assets = (s.assets || []).filter(x => x !== id));
    if (S.season) S.season.assets = (S.season.assets || []).filter(x => x.id !== id);
    if (S.show) S.show.assets = (S.show.assets || []).filter(x => x.id !== id);
    if (S.aSel === id) S.aSel = null; saveOwners();
    renderInspector(); refreshStage(); if (S.stage === 'season') renderSeason(); if (S.stage === 'show') renderShow();
  }
  else if (kind === 'episode') { const wasCur = id === S.pid; deleteProject(id); if (wasCur && S.season) openSeason(S.season.id); else renderExplorer(); }
  else if (kind === 'season' || kind === 'seasonrow') { deleteSeason(id); if (S.stage === 'show') renderShow(); renderExplorer(); }
  else if (kind === 'show' || kind === 'showrow') { deleteShow(id); renderExplorer(); }
  else if (kind === 'libseason') { deleteSeason(id); renderExplorer(); }
  else if (kind === 'movierow' || kind === 'libep') { deleteProject(id); renderExplorer(); }
  else if (kind === 'project') { deleteProject(id); if (!S.pid) goStage('home'); }
  else if (kind === 'media') {
    if (!confirmBox('Delete this file from the app? Anything using it will lose it.')) return;
    S.scenes.forEach(s => { if (s.file === id) { if (s.vEl) s.vEl.pause(); Object.assign(s, { file: null, kind: null, vEl: null, video: null, vDur: 0, thumb: null, status: 'idle', msg: 'Clip file deleted' }); } if (s.voFile === id) { if (s.aEl) s.aEl.pause(); Object.assign(s, { voFile: null, voUrl: null, aEl: null, aDur: 0, peaks: null }); } if (s.boardFile === id) Object.assign(s, { boardFile: null, board: null }); });
    S.assets.forEach(a => { if (a.imgFile === id) Object.assign(a, { imgFile: null, img: null }); });
    await Vault.del(id); saveDraft(); refreshFiles(); renderAll();
  }
}
function exDuplicate(kind, id) {
  if (kind === 'scene') { const s = S.scenes.find(x => x.id === id); if (!s) return; const i = S.scenes.indexOf(s); const c = newScene(Object.assign(sceneMeta(s), { id: uid(), label: s.label ? s.label + ' copy' : '', kind: null, remote: null, file: null, voFile: null, boardFile: null, board: null, approved: false, fx: s.fx != null ? s.fx + 30 : undefined, fy: s.fy != null ? s.fy + 30 : undefined })); S.scenes.splice(i + 1, 0, c); saveDraft(); select(c.id, false); renderAll(); return c; }
  if (['asset', 'sasset', 'shasset'].includes(kind)) { const a = findAsset(id); if (!a) return; const c = Object.assign({}, a, { id: uid(), name: a.name + ' copy', status: '' }); if (S.pid) S.assets.push(c); else if (kind === 'shasset') S.show.assets.push(c); else S.season.assets.push(c); saveOwners(); refreshStage(); if (S.stage === 'season') renderSeason(); if (S.stage === 'show') renderShow(); renderExplorer(); return c; }
  if (kind === 'episode' && S.season) {
    if (id === S.pid) saveDraft();
    const d = JSON.parse(JSON.stringify(store.get('ms_proj_' + id, {}))), pid = uid();
    d.pid = pid; d.title = (d.title || 'Episode') + ' copy'; (d.scenes || []).forEach(s => { s.file = s.voFile = s.boardFile = null; s.board = null; s.approved = false; }); (d.assets || []).forEach(a => { a.imgFile = null; });
    store.set('ms_proj_' + pid, d); const ix = store.get('ms_projects', []); ix.unshift({ id: pid, title: d.title, updated: Date.now(), scenes: (d.scenes || []).length, assets: (d.assets || []).length, seasonId: S.season.id }); store.set('ms_projects', ix);
    const L = S.season.episodes; L.splice(L.indexOf(id) + 1, 0, pid); saveSeason(); renderExplorer(); if (S.stage === 'season') renderSeason();
    toast('Episode duplicated. Text, scenes and settings are copied; media files are not.', 4500); return pid;
  }
}
function exMove(kind, id, d) {
  if ((kind === 'season' || kind === 'seasonrow') && S.show) { const L = S.show.seasons, i = L.indexOf(id), j = i + d; if (j < 0 || j >= L.length) return; L.splice(i, 1); L.splice(j, 0, id); saveShow(); renderExplorer(); if (S.stage === 'show') renderShow(); updateCrumb(); return; }
  if (kind === 'scene') { const s = S.scenes.find(x => x.id === id); if (s) move(s, d); }
  if (kind === 'episode' && S.season) { const L = S.season.episodes, i = L.indexOf(id), j = i + d; if (j < 0 || j >= L.length) return; L.splice(i, 1); L.splice(j, 0, id); saveSeason(); renderExplorer(); if (S.stage === 'season') renderSeason(); updateCrumb(); }
}
async function exNewScene(afterId) {
  if (!S.pid) { toast(S.season ? 'Open an episode first, then add scenes to it' : 'Open a project first'); return; }
  const i = afterId ? S.scenes.findIndex(x => x.id === afterId) + 1 : S.scenes.length;
  S.exOpen.scenes = true; createScene(i); if (S.season) S.exOpen['ep_' + S.pid] = true;
  const s = S.scenes[i]; renderExplorer(); setTimeout(() => { const el = s && exRow('scene:' + s.id); if (el) startRename(el); }, 30);
}
async function exNewEpisode() {
  if (!S.season) { toast('Episodes live inside a season. Create a season from the start screen.'); return; }
  const pid = await newEpisode({ title: '' }); S.exOpen.episodes = true; renderExplorer(); if (S.stage === 'season') renderSeason();
  setTimeout(() => { const el = exRow('episode:' + pid); if (el) startRename(el); }, 30);
}
function exNewAsset(type, scope) {
  if (scope === true) scope = 'season';
  const a = newAsset({ type, name: 'New ' + ATYPE[type].toLowerCase() });
  if (scope === 'show' && S.show) { a.scope = 'show'; if (S.pid) S.assets.push(a); else S.show.assets = [...(S.show.assets || []), a]; S.exOpen.shassets = true; }
  else if (scope === 'season' && S.season) { a.scope = 'season'; if (S.pid) S.assets.push(a); else S.season.assets.push(a); S.exOpen.sassets = true; }
  else { if (!S.pid) { toast('Open an episode first, or add the asset to the whole season or show'); return; } S.assets.push(a); S.exOpen.assets = true; S.exOpen[type] = true; }
  saveOwners(); refreshStage(); if (S.stage === 'season') renderSeason(); if (S.stage === 'show') renderShow(); renderExplorer();
  setTimeout(() => { const el = exRow((a.scope === 'show' ? 'shasset:' : a.scope === 'season' ? 'sasset:' : 'asset:') + a.id); if (el) startRename(el); }, 30);
}
function exCollapseAll() { Object.keys(S.exOpen).forEach(k => S.exOpen[k] = false); if (S.pid) { S.exOpen['ep_' + S.pid] = true; S.exOpen['mv_' + S.pid] = true; } S.exOpen.episodes = true; S.exOpen.seasons = true; S.exOpen.lib_shows = true; S.exOpen.lib_movies = true; renderExplorer(); }
// ---- context menu ----
function hideCtx() { const c = $('#ctx'); if (c) c.classList.remove('on'); }
function showCtx(x, y, b) {
  const kind = b ? b.dataset.kind : '', id = b ? b.dataset.id : '', items = [];
  const add = (label, fn, o = {}) => items.push({ label, fn, ...o }), sep = () => items.push({ sep: true });
  const assetTypes = sc => Object.entries(ATYPE).forEach(([k, l]) => add('New ' + l.toLowerCase() + (sc === true || sc === 'season' ? ' (season)' : sc === 'show' ? ' (show)' : ''), () => exNewAsset(k, sc)));
  const rnm = () => add('Rename', () => startRename(b), { k: 'F2' });
  const del = (lbl) => add(lbl || 'Delete', () => exDelete(kind, id), { k: 'Del', danger: true });
  if (b && b.items) b.items.forEach(([l, fn, o]) => add(l, fn, o || {}));
  else if (kind === 'scene') { add('Open in Studio', () => exOpenRow(b), { k: '↵' }); add('Edit in Scenes', () => { S.sel = id; goStage('scenes'); markFlowSel(); }); add('Show in Storyboard', () => goStage('board')); sep(); add('New scene after', () => exNewScene(id)); add('Duplicate', () => exDuplicate(kind, id), { k: 'Ctrl+D' }); sep(); rnm(); add('Move up', () => exMove(kind, id, -1), { disabled: S.scenes[0] && S.scenes[0].id === id }); add('Move down', () => exMove(kind, id, 1), { disabled: S.scenes.length && S.scenes[S.scenes.length - 1].id === id }); sep(); del('Delete scene'); }
  else if (['asset', 'sasset', 'shasset'].includes(kind)) { const a = findAsset(id); add('Open', () => exOpenRow(b), { k: '↵' }); add('Duplicate', () => exDuplicate(kind, id), { k: 'Ctrl+D' }); if (S.season && S.pid && a) { if (a.scope) add('Make episode-only', () => setScope(a, undefined)); if (a.scope !== 'season') add('Share with the whole season', () => setScope(a, 'season')); if (S.show && a.scope !== 'show') add('Share with the whole show', () => setScope(a, 'show')); } sep(); rnm(); del('Delete asset'); }
  else if (kind === 'episode') { add(id === S.pid ? 'Collapse / expand' : 'Open episode', () => exOpenRow(b), { k: '↵' }); add('Open season page', () => openSeason(S.season.id)); sep(); add('New episode', exNewEpisode); add('Duplicate episode', () => exDuplicate(kind, id), { k: 'Ctrl+D' }); sep(); rnm(); add('Move up', () => exMove(kind, id, -1), { disabled: S.season.episodes[0] === id }); add('Move down', () => exMove(kind, id, 1), { disabled: S.season.episodes[S.season.episodes.length - 1] === id }); sep(); del('Delete episode'); }
  else if (kind === 'season') { add('Open season page', () => openSeason(id), { k: '↵' }); sep(); add('New episode', exNewEpisode); assetTypes('season'); sep(); rnm(); if (S.show) { add('Move up', () => exMove(kind, id, -1)); add('Move down', () => exMove(kind, id, 1)); } add('Collapse folders', exCollapseAll); sep(); del('Delete season'); }
  else if (kind === 'seasonrow') { add('Open season', () => openSeason(id), { k: '↵' }); sep(); rnm(); add('Move up', () => exMove(kind, id, -1)); add('Move down', () => exMove(kind, id, 1)); sep(); del('Delete season'); }
  else if (kind === 'show') { add('Open show page', () => openShow(id), { k: '↵' }); sep(); add('New season', () => { openShow(id).then(newSeason); }); assetTypes('show'); sep(); rnm(); add('Collapse folders', exCollapseAll); sep(); del('Delete TV show'); }
  else if (kind === 'fseasons') { add('New season', () => { if (S.stage !== 'show') openShow(S.show.id).then(newSeason); else newSeason(); }); }
  else if (kind === 'fshassets') { assetTypes('show'); }
  else if (kind === 'fshows') { add('New TV show', newShow); add('Collapse folders', exCollapseAll); }
  else if (kind === 'fmovies') { add('New movie', () => newProject()); add('Open the sample movie', () => newProject(SAMPLE)); }
  else if (kind === 'showrow') { add('Open show', () => openShow(id), { k: '↵' }); add('New season', () => openShow(id).then(newSeason)); sep(); rnm(); sep(); del('Delete TV show'); }
  else if (kind === 'libseason') { add('Open season', () => openSeason(id), { k: '↵' }); sep(); rnm(); sep(); del('Delete season'); }
  else if (kind === 'movierow') { add('Open movie', () => openProject(id), { k: '↵' }); sep(); rnm(); sep(); del('Delete movie'); }
  else if (kind === 'libep') { add('Open episode', () => openProject(id), { k: '↵' }); sep(); rnm(); sep(); del('Delete episode'); }
  else if (kind === 'project') { add('New scene', () => exNewScene()); assetTypes(false); sep(); rnm(); add('Collapse folders', exCollapseAll); sep(); del('Delete project'); }
  else if (kind === 'fscenes') { add('New scene', () => exNewScene()); add('Import videos…', () => { if (S.stage !== 'studio') goStage('studio'); $('#importVids').click(); }); add('Edit in Scenes', () => goStage('scenes')); }
  else if (kind === 'fassets') { assetTypes(false); sep(); add('Find assets in script', () => { goStage('assets'); $('#aExtract').click(); }); }
  else if (kind === 'ftype') { add('New ' + ATYPE[id].toLowerCase(), () => exNewAsset(id, false)); }
  else if (kind === 'fsassets') { assetTypes('season'); }
  else if (kind === 'feps') { add('New episode', exNewEpisode); add('Create episodes from season script', () => { openSeason(S.season.id).then(() => $('#snSplit').click()); }); }
  else if (kind === 'media') { add('Open', () => exOpenRow(b), { k: '↵' }); sep(); add('Delete file', () => exDelete(kind, id), { danger: true, k: 'Del' }); }
  else if (kind === 'file' || kind === 'sfile' || kind === 'shfile') { add('Open', () => exOpenRow(b), { k: '↵' }); }
  else { add('New TV show', newShow); add('New movie', () => newProject()); sep(); if (S.pid) add('New scene', () => exNewScene()); if (S.season) add('New episode', exNewEpisode); if (S.pid) assetTypes(false); sep(); add('Collapse folders', exCollapseAll); add('Refresh', () => { refreshFiles(); renderExplorer(); }); }
  const c = $('#ctx');
  c.innerHTML = items.filter((it, i, a) => !(it.sep && (i === 0 || a[i - 1].sep || i === a.length - 1))).map((it, i) => it.sep ? '<hr>' : `<button role="menuitem" data-i="${items.indexOf(it)}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}${it.k ? `<span class="k">${it.k}</span>` : ''}</button>`).join('');
  c.querySelectorAll('button').forEach(btn => btn.onclick = () => { hideCtx(); items[+btn.dataset.i].fn(); });
  c.onkeydown = e => { const bs = [...c.querySelectorAll('button:not(:disabled)')], k = bs.indexOf(document.activeElement); if (e.key === 'ArrowDown') { e.preventDefault(); (bs[k + 1] || bs[0]).focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); (bs[k - 1] || bs[bs.length - 1]).focus(); } if (e.key === 'Escape') { hideCtx(); if (b) b.focus(); } };
  c.classList.add('on'); const r = c.getBoundingClientRect();
  c.style.left = Math.min(x, innerWidth - r.width - 6) + 'px'; c.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
  const f = c.querySelector('button:not(:disabled)'); if (f) f.focus({ preventScroll: true });
}
const toggleExplorer = () => { document.body.classList.toggle('noexp'); store.set('ms_noexp', document.body.classList.contains('noexp')); if (S.stage === 'studio') fitStage(); if (S.stage === 'scenes') renderFlow(); };
// (old explorer toolbar button #exNewScene removed in the redesign)
// (old explorer toolbar button #exNewEp removed in the redesign)
// (old explorer toolbar button #exNewAsset removed in the redesign)
// (old explorer toolbar button #exRefresh removed in the redesign)
// (old explorer toolbar button #exCollapse removed in the redesign)
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!S.pid) return; saveDraft(); Backend.flush().then(() => toast('Saved to your account'), e => toast('Not saved: ' + e.message, 5000)); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && S.stage !== 'home') { e.preventDefault(); toggleExplorer(); }
});

// ---------------- Theme ----------------
const MOON = '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>';
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
function themePref() { try { const v = localStorage.getItem('mitome-theme'); return v === 'dark' || v === 'light' ? v : 'system'; } catch (e) { return 'system'; } }
function setThemePref(v) { try { if (v === 'system') localStorage.removeItem('mitome-theme'); else localStorage.setItem('mitome-theme', v); } catch (e) {} }
function applyTheme() {
  const pref = themePref(), t = pref === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : pref;
  document.documentElement.dataset.theme = t;
  $('#thIcon').innerHTML = t === 'light' ? MOON : SUN;
  $('#btnTheme').setAttribute('aria-label', t === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
  if (typeof renderTimeline === 'function' && S.stage === 'studio') renderTimeline();
}
$('#btnTheme').onclick = () => { const cur = document.documentElement.dataset.theme; setThemePref(cur === 'light' ? 'dark' : 'light'); applyTheme(); const s = $('#sTheme'); if (s) s.value = themePref(); };
$('#sTheme').onchange = e => { setThemePref(e.target.value); applyTheme(); };
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (themePref() === 'system') applyTheme(); });
applyTheme();

// ---------------- Misc ----------------
$('#btnSplit').onclick = splitScript;
['#title', '#script', '#style'].forEach(q => $(q).addEventListener('input', saveDraft));
$('#style').addEventListener('input', () => { const s = selScene(); const f = $('#iFinal'); if (s && f) f.textContent = fullPrompt(s); const hnt = $('#iStyleHint'); if (hnt) hnt.textContent = $('#style').value.trim() || 'No project style set yet.'; if (!P.playing) drawAt(P.t); });
$('#styleResetAll').onclick = () => { S.scenes.forEach(s => s.ownStyle = false); saveDraft(); renderAll(); toast('All scenes now use the project style'); };

// ---------------- Boot ----------------
(function boot() {
  // migrate the single draft from earlier versions into the projects list
  if (!store.get('ms_projects', []).length) { const d = store.get('lfs_draft', null); if (d && ((d.scenes && d.scenes.length) || (d.assets && d.assets.length) || d.script)) { const id = uid(); d.pid = id; store.set('ms_proj_' + id, d); store.set('ms_projects', [{ id, title: d.title || 'Untitled project', updated: Date.now(), scenes: (d.scenes || []).length, assets: (d.assets || []).length }]); } }
  // seasons made before TV shows existed: wrap each in its own show
  store.get('ms_seasons', []).forEach(s0 => { const sn = store.get('ms_season_' + s0.id, null); if (sn && !sn.showId) { const sh = { id: uid(), title: (sn.title || 'Untitled show').replace(/\s*[·\-–]\s*season\s*\d+$/i, ''), theme: '', style: '', script: '', assets: [], seasons: [sn.id] }; sn.showId = sh.id; store.set('ms_season_' + sn.id, sn); store.set('ms_show_' + sh.id, sh); const ix = store.get('ms_shows', []); ix.push({ id: sh.id, title: sh.title, updated: Date.now() }); store.set('ms_shows', ix); } });
  if (store.get('ms_noexp', false)) document.body.classList.add('noexp');
  setAspect(); updatePill(); showPane('scenes');
  goStage('home');
})();
