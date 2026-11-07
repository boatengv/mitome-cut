import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { shortTime, trackEnd, type AssetDTO, type TrackKey } from '@mitome/shared';
import { api, ApiError, putWithProgress } from '../api';
import { IconPlus, IconTrash } from '../icons';
import { addClip, type Selection } from './model';
import { assetStatus, dotClass, newId, STATUS_LABEL } from './status';
import type { ProjectStore } from './useProject';

export type PanelTab = 'media' | 'text' | 'audio' | 'generate';

interface Props {
  tab: PanelTab;
  store: ProjectStore;
  projectId: string;
  playhead: number;
  onSelect: (s: Selection) => void;
  notify: (msg: string) => void;
}

interface UploadRow {
  key: string;
  name: string;
  progress: number;
}

const TITLES: Record<PanelTab, string> = { media: 'Media', text: 'Text', audio: 'Audio', generate: 'Generate' };

export function LeftPanel({ tab, store, projectId, playhead, onSelect, notify }: Props) {
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [over, setOver] = useState(false);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // In-progress uploads are shown from local state with a progress bar instead.
  const assets = (store.project?.assets ?? []).filter((a) => a.status !== 'pending_upload');

  async function uploadFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const key = newId();
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
      try {
        const ticket = await api.createUpload(projectId, file);
        await putWithProgress(ticket, file, (f) =>
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: f } : x))),
        );
        const { asset } = await api.completeUpload(ticket.asset.id);
        store.upsertAsset(asset);
      } catch (e) {
        notify(`${file.name}: ${e instanceof ApiError || e instanceof Error ? e.message : 'upload failed'}`);
      } finally {
        setUploads((u) => u.filter((x) => x.key !== key));
      }
    }
  }

  function addToTimeline(a: AssetDTO, track: TrackKey = a.kind === 'audio' ? 'audio' : 'video') {
    const t = store.timeline;
    if (!t) return;
    const id = newId();
    const duration = a.kind === 'image' ? 5 : Math.max(0.1, a.durationSec ?? 5);
    if (track === 'video') {
      store.commit(addClip(t, 'video', { id, assetId: a.id, name: a.name, start: trackEnd(t.video), duration, trimIn: 0 }));
    } else {
      store.commit(
        addClip(t, track, { id, assetId: a.id, name: a.name, start: trackEnd(t[track]), duration, trimIn: 0, volume: 1, fade: false }),
      );
    }
    onSelect({ track, id });
  }

  async function removeAsset(a: AssetDTO) {
    if (!confirm(`Delete “${a.name}” from this project?`)) return;
    try {
      await api.deleteAsset(a.id);
      store.removeAsset(a.id);
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not delete.');
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
  };

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      multiple
      accept={tab === 'audio' ? 'audio/*' : 'video/*,audio/*,image/*'}
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => {
        if (e.target.files) void uploadFiles(e.target.files);
        e.target.value = '';
      }}
    />
  );

  const uploadRows = uploads.map((u) => (
    <div key={u.key} className="media-row" aria-live="polite">
      <span className="media-thumb" />
      <span className="media-info">
        <span className="name">{u.name}</span>
        <span className="progress">
          <div style={{ width: `${Math.round(u.progress * 100)}%` }} />
        </span>
      </span>
    </div>
  ));

  const assetRow = (a: AssetDTO) => {
    const s = assetStatus(a);
    return (
      <div key={a.id} className="media-row">
        <span
          className={`media-thumb ${a.kind === 'audio' ? 'audio' : ''}`}
          style={a.thumbUrl ? { backgroundImage: `url("${a.thumbUrl}")` } : undefined}
        >
          {a.kind === 'audio' ? '♪' : a.durationSec ? shortTime(a.durationSec) : ''}
        </span>
        <span className="media-info">
          <span className="name" title={a.name}>
            {a.name}
          </span>
          <span className="status" title={a.error ?? undefined}>
            <span className={dotClass(s)} />
            {s === 'failed' && a.error ? `Failed: ${a.error.slice(0, 40)}` : STATUS_LABEL[s]}
            {a.source === 'generation' ? ' · Generated' : ''}
          </span>
        </span>
        <span className="media-actions">
          <button className="icon-btn" aria-label={`Add ${a.name} to the timeline`} disabled={a.status !== 'ready'} onClick={() => addToTimeline(a)}>
            <IconPlus size={14} />
          </button>
          <button className="icon-btn" aria-label={`Delete ${a.name}`} onClick={() => removeAsset(a)}>
            <IconTrash size={14} />
          </button>
        </span>
      </div>
    );
  };

  return (
    <aside className="panel" onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <div className="panel-head">
        <h2>{TITLES[tab]}</h2>
        {(tab === 'media' || tab === 'audio') && (
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <IconPlus size={14} /> Import
          </button>
        )}
      </div>
      {fileInput}

      {tab === 'media' && (
        <div className="panel-body">
          <label className="field">
            <span className="sr-only">Search media</span>
            <input className="input" type="search" placeholder="Search media" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <span className="caption">
            In this project · {assets.length} {assets.length === 1 ? 'item' : 'items'}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {uploadRows}
            {assets.filter((a) => a.name.toLowerCase().includes(query.toLowerCase())).map(assetRow)}
          </div>
          <div className={`dropzone ${over ? 'over' : ''}`}>Drop video, audio or images here, or use Import.</div>
        </div>
      )}

      {tab === 'text' && <TextPanel store={store} playhead={playhead} onSelect={onSelect} />}

      {tab === 'audio' && (
        <div className="panel-body">
          <span className="caption">Audio in this project</span>
          {uploadRows}
          {assets.filter((a) => a.kind === 'audio').length === 0 && uploads.length === 0 && (
            <div className={`dropzone ${over ? 'over' : ''}`}>Import a voiceover, music or sound effect.</div>
          )}
          {assets
            .filter((a) => a.kind === 'audio')
            .map((a) => (
              <div key={a.id} className="media-row" style={{ flexWrap: 'wrap' }}>
                <span className="media-thumb audio">♪</span>
                <span className="media-info">
                  <span className="name">{a.name}</span>
                  <span className="status">
                    <span className={dotClass(assetStatus(a))} />
                    {STATUS_LABEL[assetStatus(a)]}
                    {a.durationSec ? ` · ${shortTime(a.durationSec)}` : ''}
                  </span>
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <button className="btn" style={{ height: 28, padding: '0 8px' }} disabled={a.status !== 'ready'} onClick={() => addToTimeline(a, 'audio')}>
                    A1
                  </button>
                  <button className="btn" style={{ height: 28, padding: '0 8px' }} disabled={a.status !== 'ready'} onClick={() => addToTimeline(a, 'music')}>
                    A2
                  </button>
                </span>
              </div>
            ))}
        </div>
      )}

      {tab === 'generate' && <GeneratePanel store={store} projectId={projectId} onSelect={onSelect} notify={notify} />}
    </aside>
  );
}

function TextPanel({ store, playhead, onSelect }: { store: ProjectStore; playhead: number; onSelect: (s: Selection) => void }) {
  const presets = [
    { label: 'Title card', text: '[Title]', position: 'center' as const, size: 96, duration: 4, style: { height: 64, fontSize: 20, fontWeight: 600 } },
    { label: 'Lower third', text: '[Name · Role]', position: 'bottom' as const, size: 48, duration: 5, style: { height: 52, fontSize: 14, fontWeight: 500 } },
    { label: 'Caption', text: '[Caption]', position: 'bottom' as const, size: 40, duration: 3, style: { height: 44, fontSize: 12 } },
  ];
  return (
    <div className="panel-body">
      <span className="caption">Adds at the playhead on T1</span>
      {presets.map((p) => (
        <button
          key={p.label}
          className="preset"
          style={p.style}
          onClick={() => {
            const id = newId();
            store.commit((t) =>
              addClip(t, 'text', { id, text: p.text, start: Math.round(playhead * 100) / 100, duration: p.duration, position: p.position, size: p.size }),
            );
            onSelect({ track: 'text', id });
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function GeneratePanel({ store, projectId, onSelect, notify }: { store: ProjectStore; projectId: string; onSelect: (s: Selection) => void; notify: (m: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('demo');
  const [models, setModels] = useState<{ id: string; label: string }[]>([{ id: 'demo', label: 'Demo (test pattern, free)' }]);
  const [length, setLength] = useState(5);
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ generationsToday: number; generationsPerDay: number } | null>(null);

  useEffect(() => {
    api.models().then((r) => setModels(r.models)).catch(() => undefined);
    api.usage().then(setUsage).catch(() => undefined);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || !store.timeline) return;
    setBusy(true);
    try {
      const { asset } = await api.generate(projectId, { prompt: prompt.trim(), model, durationSec: length, resolution });
      store.upsertAsset(asset);
      const id = newId();
      store.commit((t) =>
        addClip(t, 'video', { id, assetId: asset.id, name: prompt.trim().slice(0, 60), start: trackEnd(t.video), duration: length, trimIn: 0, prompt: prompt.trim() }),
      );
      onSelect({ track: 'video', id });
      setPrompt('');
      setUsage((u) => (u ? { ...u, generationsToday: u.generationsToday + 1 } : u));
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not start the generation.');
    } finally {
      setBusy(false);
    }
  }

  function addPlaceholder() {
    const id = newId();
    store.commit((t) =>
      addClip(t, 'video', { id, assetId: null, name: `Scene ${t.video.length + 1}`, start: trackEnd(t.video), duration: length, trimIn: 0, prompt: prompt.trim() || undefined }),
    );
    onSelect({ track: 'video', id });
  }

  return (
    <form className="panel-body" style={{ gap: 14, padding: 16 }} onSubmit={submit}>
      <label className="field">
        <span>Prompt</span>
        <textarea className="textarea" rows={5} placeholder="[Describe the shot you want]" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000} />
      </label>
      <label className="field">
        <span>Model</span>
        <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid-2">
        <label className="field">
          <span>Length</span>
          <select className="select" value={length} onChange={(e) => setLength(Number(e.target.value))}>
            {[3, 5, 8, 10].map((s) => (
              <option key={s} value={s}>
                {s} s
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Resolution</span>
          <select className="select" value={resolution} onChange={(e) => setResolution(e.target.value as '720p' | '1080p')}>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </label>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy || !prompt.trim()}>
        {busy ? 'Starting…' : 'Generate scene'}
      </button>
      <button type="button" className="btn btn-block" onClick={addPlaceholder}>
        Add as placeholder scene
      </button>
      <span className="caption">
        New scenes land at the end of V1.
        {usage ? ` ${usage.generationsToday} of ${usage.generationsPerDay} generations used today.` : ''}
      </span>
    </form>
  );
}
