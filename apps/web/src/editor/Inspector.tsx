import { useEffect, useState } from 'react';
import { TRACK_LABELS, clipEnd, shortTime, type AnyClip, type AudioClip, type TextClip, type VideoClip } from '@mitome/shared';
import { api, ApiError } from '../api';
import { getClip, maxDuration, round2, removeClip, updateClip, type ClipPatch, type Selection } from './model';
import { assetStatus, dotClass, formatBytes, STATUS_LABEL, videoClipStatus } from './status';
import type { ProjectStore } from './useProject';

interface Props {
  store: ProjectStore;
  projectId: string;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  notify: (msg: string) => void;
}

/** A number input that commits on blur or Enter, so typing doesn't spam history. */
function NumField(props: { label: string; value: number; min?: number; max?: number; step?: number; suffix?: string; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => setDraft(String(props.value)), [props.value]);
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) return setDraft(String(props.value));
    const clamped = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, n));
    setDraft(String(round2(clamped)));
    if (round2(clamped) !== props.value) props.onCommit(round2(clamped));
  };
  return (
    <label className="field">
      <span>
        {props.label}
        {props.suffix ? ` (${props.suffix})` : ''}
      </span>
      <input
        className="input tabular"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
    </label>
  );
}

function TextField(props: { label: string; value: string; multiline?: boolean; placeholder?: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => draft !== props.value && props.onCommit(draft);
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.multiline ? (
        <textarea className="textarea" rows={4} value={draft} placeholder={props.placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      ) : (
        <input
          className="input"
          value={draft}
          placeholder={props.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        />
      )}
    </label>
  );
}

export function Inspector({ store, projectId, selection, onSelect, notify }: Props) {
  const t = store.timeline;
  const clip = t ? getClip(t, selection) : undefined;
  const [busy, setBusy] = useState(false);

  if (!t || !selection || !clip) {
    return (
      <aside className="inspector" aria-label="Inspector">
        <div className="panel-head">
          <h2>Inspector</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ margin: 0 }}>
            Select a clip on the timeline to edit it.
          </p>
          <p className="caption" style={{ margin: 0 }}>
            Drag clips to move them, drag their edges to trim. Ctrl/⌘+Z undoes.
          </p>
        </div>
      </aside>
    );
  }

  const track = selection.track;
  const set = (patch: ClipPatch) => store.commit((tl) => updateClip(tl, track, clip.id, patch));
  const max = maxDuration(clip, store.assets);

  async function generate(v: VideoClip) {
    if (!v.prompt?.trim()) return notify('Write a prompt for this scene first.');
    setBusy(true);
    try {
      const { asset } = await api.generate(projectId, {
        prompt: v.prompt.trim(),
        model: 'demo',
        durationSec: Math.min(20, Math.max(1, Math.round(v.duration))),
        resolution: '720p',
      });
      store.upsertAsset(asset);
      set({ assetId: asset.id, trimIn: 0 });
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not start the generation.');
    } finally {
      setBusy(false);
    }
  }

  const header = (label: string, name: string, status?: { cls: string; label: string }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="caption">{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</span>
      {status && (
        <span className="status">
          <span className={status.cls} />
          {status.label}
        </span>
      )}
    </div>
  );

  const timing = (
    <div className="grid-2">
      <NumField label="Start" suffix="s" value={round2(clip.start)} min={0} onCommit={(v) => set({ start: v })} />
      <NumField label="Duration" suffix="s" value={round2(clip.duration)} min={0.1} max={max} onCommit={(v) => set({ duration: v })} />
      {'trimIn' in clip && (
        <NumField
          label="Trim in"
          suffix="s"
          value={round2(clip.trimIn)}
          min={0}
          max={Math.max(0, clip.trimIn + max - 0.1)}
          onCommit={(v) => set({ trimIn: v, duration: Math.min(clip.duration, clip.trimIn + max - v) })}
        />
      )}
      <label className="field">
        <span>Ends at</span>
        <input className="input tabular" value={shortTime(clipEnd(clip))} readOnly />
      </label>
    </div>
  );

  let body: React.ReactNode = null;
  if (track === 'video') {
    const v = clip as VideoClip;
    const status = videoClipStatus(v, store.assets);
    const asset = v.assetId ? store.assets.get(v.assetId) : undefined;
    body = (
      <>
        {header(`${TRACK_LABELS.video} · Video clip`, v.name, { cls: dotClass(status), label: STATUS_LABEL[status] })}
        <TextField label="Name" value={v.name} onCommit={(name) => set({ name: name || 'Untitled scene' })} />
        {timing}
        {asset?.status === 'failed' && (
          <div className="alert alert-error">
            <span className="dot dot-failed" style={{ marginTop: 5 }} />
            <span>{asset.error ?? 'Processing failed.'}</span>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <TextField label="Prompt" multiline placeholder="[Describe the shot]" value={v.prompt ?? ''} onCommit={(prompt) => set({ prompt })} />
          {status === 'none' ? (
            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => generate(v)}>
              {busy ? 'Starting…' : 'Generate'}
            </button>
          ) : (
            <button className="btn btn-block" disabled={busy || status === 'generating'} onClick={() => generate(v)}>
              {busy ? 'Starting…' : 'Regenerate'}
            </button>
          )}
          {asset && (
            <span className="caption">
              {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}
              {asset.durationSec ? `${shortTime(asset.durationSec)} source · ` : ''}
              {formatBytes(asset.sizeBytes)}
            </span>
          )}
        </div>
      </>
    );
  } else if (track === 'text') {
    const x = clip as TextClip;
    body = (
      <>
        {header(`${TRACK_LABELS.text} · Text`, x.text || 'Empty text')}
        <TextField label="Text" multiline value={x.text} onCommit={(text) => set({ text })} />
        {timing}
        <div className="grid-2">
          <NumField label="Size" suffix="px at 1080p" value={x.size} min={8} max={400} step={1} onCommit={(size) => set({ size: Math.round(size) })} />
          <label className="field">
            <span>Position</span>
            <select className="select" value={x.position} onChange={(e) => set({ position: e.target.value as TextClip['position'] })}>
              <option value="top">Top</option>
              <option value="center">Centre</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
        </div>
      </>
    );
  } else {
    const a = clip as AudioClip;
    const asset = store.assets.get(a.assetId);
    const s = assetStatus(asset);
    body = (
      <>
        {header(`${TRACK_LABELS[track]} · Audio`, a.name, { cls: dotClass(s), label: STATUS_LABEL[s] })}
        {timing}
        <label className="field">
          <span>Volume · {Math.round(a.volume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            defaultValue={a.volume}
            key={a.id + a.volume}
            style={{ accentColor: 'var(--action)' }}
            onPointerUp={(e) => set({ volume: Number((e.target as HTMLInputElement).value) })}
            onKeyUp={(e) => set({ volume: Number((e.target as HTMLInputElement).value) })}
          />
        </label>
        <label className="row" style={{ justifyContent: 'space-between' }}>
          Fade in and out
          <input type="checkbox" checked={a.fade} onChange={(e) => set({ fade: e.target.checked })} style={{ accentColor: 'var(--action)', width: 16, height: 16 }} />
        </label>
      </>
    );
  }

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="panel-head">
        <h2>Inspector</h2>
      </div>
      <div className="panel-body" style={{ gap: 16, padding: 16 }} key={`${track}-${clip.id}`}>
        {body}
        <button
          className="btn btn-ghost btn-danger"
          onClick={() => {
            store.commit((tl) => removeClip(tl, track, clip.id));
            onSelect(null);
          }}
        >
          Remove from timeline
        </button>
      </div>
    </aside>
  );
}

export type { AnyClip };
