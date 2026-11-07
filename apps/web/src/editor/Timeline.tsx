import { memo, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { clipEnd, shortTime, type AnyClip, type AssetDTO, type Timeline as TL, type TrackKey } from '@mitome/shared';
import { IconSplit, IconTrash, IconZoomIn, IconZoomOut } from '../icons';
import { getClip, maxDuration, round2, TRACKS, updateClip, type Selection } from './model';
import { dotClass, STATUS_LABEL, videoClipStatus, waveBars } from './status';

interface Props {
  timeline: TL;
  assets: Map<string, AssetDTO>;
  playhead: number;
  duration: number;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onSeek: (t: number) => void;
  preview: (t: TL) => void;
  commit: (t: TL) => void;
  onSplit: () => void;
  onDelete: () => void;
}

type DragMode = 'move' | 'trimL' | 'trimR';
interface Drag {
  mode: DragMode;
  track: TrackKey;
  id: string;
  startX: number;
  base: TL;
  orig: AnyClip;
  moved: boolean;
  /** Latest previewed timeline; committed on pointer up. */
  last: TL | null;
}

const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const SNAP_PX = 8;

export const Timeline = memo(function Timeline(p: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(800);
  const [pps, setPps] = useState(24); // pixels per second
  const drag = useRef<Drag | null>(null);
  const fitted = useRef(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewWidth(el.clientWidth));
    ro.observe(el);
    setViewWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Fit the project to the view once it has content.
  useEffect(() => {
    if (fitted.current || p.duration <= 0 || viewWidth < 100) return;
    fitted.current = true;
    setPps(Math.max(4, Math.min(160, (viewWidth - 40) / Math.max(10, p.duration * 1.15))));
  }, [p.duration, viewWidth]);

  const fit = () => setPps(Math.max(4, Math.min(160, (viewWidth - 40) / Math.max(10, p.duration * 1.15))));
  const contentWidth = Math.max(viewWidth, (p.duration + 30) * pps);
  const step = TICK_STEPS.find((s) => s * pps >= 70) ?? 600;
  const ticks: number[] = [];
  for (let t = 0; t * pps <= contentWidth; t += step) ticks.push(t);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = p.playhead * pps;
    if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 80;
    else if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 40);
  }, [p.playhead, pps]);

  /* ---------- Ruler scrubbing ---------- */
  const seekFromEvent = (e: RPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    p.onSeek(Math.max(0, (e.clientX - rect.left) / pps));
  };

  /* ---------- Clip dragging ---------- */
  const snapPoints = (exclude: string) => {
    const pts = [0, p.playhead];
    for (const tr of TRACKS) {
      for (const c of p.timeline[tr.key] as AnyClip[]) {
        if (c.id === exclude) continue;
        pts.push(c.start, clipEnd(c));
      }
    }
    return pts;
  };
  const snap = (value: number, pts: number[]) => {
    let best = value;
    let bestDist = SNAP_PX / pps;
    for (const s of pts) {
      const d = Math.abs(s - value);
      if (d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best;
  };

  const onClipDown = (e: RPointerEvent<HTMLElement>, track: TrackKey, clip: AnyClip, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, track, id: clip.id, startX: e.clientX, base: p.timeline, orig: clip, moved: false, last: null };
    p.onSelect({ track, id: clip.id });
  };

  const onClipMove = (e: RPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / pps;
    if (!d.moved && Math.abs(e.clientX - d.startX) < 3) return;
    d.moved = true;
    const o = d.orig;
    const pts = snapPoints(o.id);
    const hasTrim = 'trimIn' in o;
    let patch: { start?: number; duration?: number; trimIn?: number };
    if (d.mode === 'move') {
      let start = Math.max(0, o.start + dx);
      const snappedStart = snap(start, pts);
      const snappedEnd = snap(start + o.duration, pts) - o.duration;
      start = Math.abs(snappedStart - start) <= Math.abs(snappedEnd - start) ? snappedStart : snappedEnd;
      patch = { start: round2(Math.max(0, start)) };
    } else if (d.mode === 'trimR') {
      const max = maxDuration(o, p.assets);
      const end = snap(o.start + o.duration + dx, pts);
      patch = { duration: round2(Math.min(max, Math.max(0.1, end - o.start))) };
    } else {
      const minDelta = -Math.min(o.start, hasTrim ? (o as { trimIn: number }).trimIn : o.start);
      let newStart = snap(o.start + dx, pts);
      const delta = Math.max(minDelta, Math.min(o.duration - 0.1, newStart - o.start));
      newStart = o.start + delta;
      patch = { start: round2(newStart), duration: round2(o.duration - delta) };
      if (hasTrim) patch.trimIn = round2((o as { trimIn: number }).trimIn + delta);
    }
    d.last = updateClip(d.base, d.track, d.id, patch);
    p.preview(d.last);
  };

  const onClipUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && d.last) p.commit(d.last);
  };

  const selected = getClip(p.timeline, p.selection);
  const playheadInside = selected ? p.playhead > selected.start && p.playhead < clipEnd(selected) : false;

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="tl-toolbar">
        <button className="icon-btn" aria-label="Split clip at playhead" title="Split at playhead (S)" onClick={p.onSplit} disabled={!playheadInside}>
          <IconSplit />
        </button>
        <button className="icon-btn" aria-label="Delete selected clip" title="Delete (Del)" onClick={p.onDelete} disabled={!selected}>
          <IconTrash />
        </button>
        <div className="spacer" />
        <span className="caption tabular" style={{ marginRight: 8 }}>
          {shortTime(p.duration)} total
        </span>
        <button className="icon-btn" aria-label="Zoom out" onClick={() => setPps((v) => Math.max(2, v / 1.5))}>
          <IconZoomOut />
        </button>
        <button className="btn btn-ghost" onClick={fit}>
          Fit
        </button>
        <button className="icon-btn" aria-label="Zoom in" onClick={() => setPps((v) => Math.min(400, v * 1.5))}>
          <IconZoomIn />
        </button>
      </div>
      <div className="tl-body">
        <div className="tl-heads">
          <div style={{ height: 24, borderBottom: '1px solid var(--border)' }} />
          {TRACKS.map((t) => (
            <div key={t.key} className="tl-head" style={{ height: t.height }}>
              <span className={`badge-track ${t.badge}`}>{t.label}</span>
            </div>
          ))}
        </div>
        <div
          className="tl-scroll"
          ref={scrollRef}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              setPps((v) => Math.max(2, Math.min(400, v * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
            }
          }}
        >
          <div className="tl-content" style={{ width: contentWidth }}>
            <div
              className="ruler"
              role="slider"
              tabIndex={0}
              aria-label="Playhead position"
              aria-valuemin={0}
              aria-valuemax={Math.round(p.duration)}
              aria-valuenow={Math.round(p.playhead)}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                seekFromEvent(e);
              }}
              onPointerMove={(e) => e.buttons === 1 && seekFromEvent(e)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') p.onSeek(p.playhead + (e.shiftKey ? 1 : 1 / 24));
                if (e.key === 'ArrowLeft') p.onSeek(Math.max(0, p.playhead - (e.shiftKey ? 1 : 1 / 24)));
              }}
            >
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: t * pps }}>
                  <span>{shortTime(t)}</span>
                </div>
              ))}
            </div>

            {TRACKS.map((tr) => {
              const clips = p.timeline[tr.key] as AnyClip[];
              return (
                <div
                  key={tr.key}
                  className="lane"
                  style={{ height: tr.height }}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) p.onSelect(null);
                  }}
                >
                  {clips.length === 0 && <div className="lane-empty">{tr.empty}</div>}
                  {clips.map((c) => (
                    <ClipView
                      key={c.id}
                      track={tr.key}
                      clip={c}
                      pps={pps}
                      assets={p.assets}
                      selected={p.selection?.id === c.id}
                      onDown={onClipDown}
                      onMove={onClipMove}
                      onUp={onClipUp}
                    />
                  ))}
                </div>
              );
            })}
            <div className="playhead" style={{ left: p.playhead * pps }} aria-hidden="true" />
          </div>
        </div>
      </div>
    </section>
  );
});

interface ClipProps {
  track: TrackKey;
  clip: AnyClip;
  pps: number;
  assets: Map<string, AssetDTO>;
  selected: boolean;
  onDown: (e: RPointerEvent<HTMLElement>, track: TrackKey, clip: AnyClip, mode: DragMode) => void;
  onMove: (e: RPointerEvent<HTMLElement>) => void;
  onUp: () => void;
}

function ClipView({ track, clip, pps, assets, selected, onDown, onMove, onUp }: ClipProps) {
  const width = Math.max(4, clip.duration * pps - 2);
  const style = { left: clip.start * pps + 1, width };
  const common = {
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: onUp,
  };
  const handles = (
    <>
      <span className="handle l" onPointerDown={(e) => onDown(e, track, clip, 'trimL')} {...common} />
      <span className="handle r" onPointerDown={(e) => onDown(e, track, clip, 'trimR')} {...common} />
    </>
  );

  if (track === 'video' && 'assetId' in clip) {
    const status = videoClipStatus(clip as never, assets);
    const asset = clip.assetId ? assets.get(clip.assetId) : undefined;
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`${(clip as { name: string }).name}, ${STATUS_LABEL[status]}`}
        aria-pressed={selected}
        className={`clip ${status === 'none' ? 'none' : ''} ${status === 'failed' || status === 'missing' ? 'failed' : ''} ${selected ? 'selected' : ''}`}
        style={style}
        onPointerDown={(e) => onDown(e, track, clip, 'move')}
        {...common}
      >
        {asset?.thumbUrl && <span className="clip-thumbs" style={{ backgroundImage: `url("${asset.thumbUrl}")` }} />}
        <span className="clip-name" style={{ position: 'relative' }}>
          {(clip as { name: string }).name}
        </span>
        <span className="status" style={{ position: 'relative' }}>
          <span className={dotClass(status)} />
          {STATUS_LABEL[status]}
        </span>
        {handles}
      </div>
    );
  }

  if (track === 'text' && 'text' in clip) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`Text: ${clip.text}`}
        aria-pressed={selected}
        className={`clip text ${selected ? 'selected' : ''}`}
        style={style}
        onPointerDown={(e) => onDown(e, track, clip, 'move')}
        {...common}
      >
        <span className="clip-name" style={{ fontWeight: 500 }}>
          {clip.text || 'Empty text'}
        </span>
        {handles}
      </div>
    );
  }

  const audio = clip as { assetId: string; name: string };
  const asset = assets.get(audio.assetId);
  const ready = asset?.status === 'ready';
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Audio: ${audio.name}`}
      aria-pressed={selected}
      className={`clip audio ${selected ? 'selected' : ''} ${!asset || asset.status === 'failed' ? 'failed' : ''}`}
      style={style}
      onPointerDown={(e) => onDown(e, track, clip, 'move')}
      {...common}
    >
      <span className="clip-name">{audio.name}</span>
      {ready ? (
        <span className="wave" aria-hidden="true">
          {waveBars(audio.assetId + clip.id, Math.min(160, Math.max(4, Math.floor(width / 5)))).map((h, i) => (
            <i key={i} style={{ height: `${h}%` }} />
          ))}
        </span>
      ) : (
        <span className="status">
          <span className={`dot dot-${asset?.status === 'failed' ? 'failed' : 'processing'}`} />
          {asset?.status === 'failed' ? 'Failed' : 'Processing'}
        </span>
      )}
      {handles}
    </div>
  );
}
