import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clipAt, clipEnd, timecode, type AssetDTO, type AudioClip, type Timeline } from '@mitome/shared';
import { IconNext, IconPause, IconPlay, IconPrev } from '../icons';
import { dotClass, STATUS_LABEL, videoClipStatus } from './status';

interface Props {
  timeline: Timeline;
  assets: Map<string, AssetDTO>;
  playhead: number;
  playing: boolean;
  duration: number;
  fps: number;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
}

/**
 * Keeps a media element in step with the timeline clock: loads the right
 * source, seeks when drift exceeds a threshold, and plays or pauses.
 */
function useSyncedMedia(
  ref: React.RefObject<HTMLMediaElement | null>,
  url: string | null,
  expected: number | null,
  playing: boolean,
  volume = 1,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!url || expected == null) {
      if (!el.paused) el.pause();
      return;
    }
    if (el.dataset.src !== url) {
      el.dataset.src = url;
      el.src = url;
    }
    el.volume = Math.max(0, Math.min(1, volume));
    const drift = Math.abs(el.currentTime - expected);
    if (playing) {
      if (drift > 0.3 && el.readyState >= 1) el.currentTime = expected;
      if (el.paused) el.play().catch(() => undefined);
    } else {
      if (!el.paused) el.pause();
      if (drift > 0.02 && el.readyState >= 1) el.currentTime = expected;
    }
  });
  // Seek once metadata arrives for a freshly loaded source.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMeta = () => {
      if (expected != null) el.currentTime = expected;
    };
    el.addEventListener('loadedmetadata', onMeta);
    return () => el.removeEventListener('loadedmetadata', onMeta);
  });
}

function audioTarget(clips: AudioClip[], t: number, assets: Map<string, AssetDTO>) {
  const c = clipAt(clips, t);
  const a = c ? assets.get(c.assetId) : undefined;
  if (!c || !a || a.status !== 'ready' || !a.url) return { url: null, expected: null, volume: 1 };
  return { url: a.url, expected: c.trimIn + (t - c.start), volume: c.volume };
}

export const Viewer = memo(function Viewer(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const a1Ref = useRef<HTMLAudioElement>(null);
  const a2Ref = useRef<HTMLAudioElement>(null);
  const [box, setBox] = useState({ w: 640, h: 360 });

  // Fit a 16:9 stage inside the available space.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 48;
      const h = el.clientHeight - 40;
      const width = Math.max(160, Math.min(w, (h * 16) / 9));
      setBox({ w: width, h: (width * 9) / 16 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clip = clipAt(p.timeline.video, p.playhead);
  const status = clip ? videoClipStatus(clip, p.assets) : null;
  const asset = clip?.assetId ? p.assets.get(clip.assetId) : undefined;
  const isVideo = status === 'ready' && asset?.kind === 'video' && !!asset.url;
  const isImage = status === 'ready' && asset?.kind === 'image' && !!asset.url;
  const expected = clip && isVideo ? clip.trimIn + (p.playhead - clip.start) : null;

  useSyncedMedia(videoRef, isVideo ? asset!.url : null, expected, p.playing);
  const a1 = audioTarget(p.timeline.audio, p.playhead, p.assets);
  const a2 = audioTarget(p.timeline.music, p.playhead, p.assets);
  useSyncedMedia(a1Ref, a1.url, a1.expected, p.playing, a1.volume);
  useSyncedMedia(a2Ref, a2.url, a2.expected, p.playing, a2.volume);

  const texts = p.timeline.text.filter((t) => p.playhead >= t.start && p.playhead < clipEnd(t));
  const starts = [...new Set(p.timeline.video.map((c) => c.start))].sort((a, b) => a - b);

  return (
    <main className="viewer">
      <div className="stage-wrap" ref={wrapRef}>
        <div className="stage" style={{ width: box.w, height: box.h, maxHeight: 'none' }}>
          <video ref={videoRef} playsInline preload="auto" style={{ visibility: isVideo ? 'visible' : 'hidden' }} />
          {isImage && <img className="frame" src={asset!.url!} alt="" />}
          {!isVideo && !isImage && (
            <div className="placeholder">
              {clip ? (
                <>
                  <strong>{clip.name}</strong>
                  <span className="status" style={{ fontSize: 12 }}>
                    <span className={dotClass(status!)} />
                    {status === 'ready' ? 'Loading' : STATUS_LABEL[status!]}
                  </span>
                </>
              ) : (
                <span className="caption">{p.duration > 0 ? 'Nothing on V1 here' : 'Add media or generate a scene to begin'}</span>
              )}
            </div>
          )}
          {texts.map((t) => {
            const size = (t.size * box.h) / 1080;
            const pos = t.position === 'top' ? { top: '8%' } : t.position === 'center' ? { top: '50%', transform: 'translateY(-50%)' } : { bottom: '14%' };
            return (
              <div key={t.id} className="overlay-text" style={pos}>
                <span style={{ fontSize: size }}>{t.text}</span>
              </div>
            );
          })}
          <span className="badge">16:9 · 1080p · {p.fps} fps</span>
        </div>
        <audio ref={a1Ref} preload="auto" />
        <audio ref={a2Ref} preload="auto" />
      </div>
      <div className="transport">
        <span className="timecode">{timecode(p.playhead, p.fps)}</span>
        <span className="caption tabular">/ {timecode(p.duration, p.fps)}</span>
        <div className="spacer row" style={{ justifyContent: 'center', gap: 4 }}>
          <button
            className="icon-btn"
            aria-label="Previous clip"
            onClick={() => p.onSeek([...starts].reverse().find((s) => s < p.playhead - 0.05) ?? 0)}
          >
            <IconPrev />
          </button>
          <button className="play-btn" aria-label={p.playing ? 'Pause' : 'Play'} onClick={p.onTogglePlay} disabled={p.duration <= 0}>
            {p.playing ? <IconPause /> : <IconPlay />}
          </button>
          <button
            className="icon-btn"
            aria-label="Next clip"
            onClick={() => p.onSeek(starts.find((s) => s > p.playhead + 0.01) ?? p.duration)}
          >
            <IconNext />
          </button>
        </div>
        <span className="caption">Space to play · S to split</span>
      </div>
    </main>
  );
});
