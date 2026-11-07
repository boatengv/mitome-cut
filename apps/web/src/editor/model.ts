import type { AnyClip, AssetDTO, AudioClip, TextClip, Timeline, TrackKey, VideoClip } from '@mitome/shared';

export interface Selection {
  track: TrackKey;
  id: string;
}

export const TRACKS: { key: TrackKey; label: string; height: number; badge: string; empty: string }[] = [
  { key: 'video', label: 'V1', height: 56, badge: 'v', empty: 'Add scenes from Media or Generate' },
  { key: 'text', label: 'T1', height: 36, badge: '', empty: 'Add titles from the Text panel' },
  { key: 'audio', label: 'A1', height: 52, badge: 'a1', empty: 'Add voiceover or sound from Audio' },
  { key: 'music', label: 'A2', height: 44, badge: '', empty: 'Drop music or sound here' },
];

export function getClip(t: Timeline, sel: Selection | null): AnyClip | undefined {
  if (!sel) return undefined;
  return (t[sel.track] as AnyClip[]).find((c) => c.id === sel.id);
}

export type ClipPatch = Partial<Omit<VideoClip, 'assetId'> & Omit<TextClip, 'id'> & Omit<AudioClip, 'assetId' | 'id'>> & {
  assetId?: string | null;
};

export function updateClip(t: Timeline, track: TrackKey, id: string, patch: ClipPatch): Timeline {
  return { ...t, [track]: (t[track] as AnyClip[]).map((c) => (c.id === id ? { ...c, ...patch } : c)) } as Timeline;
}

export function removeClip(t: Timeline, track: TrackKey, id: string): Timeline {
  return { ...t, [track]: (t[track] as AnyClip[]).filter((c) => c.id !== id) } as Timeline;
}

export function addClip(t: Timeline, track: TrackKey, clip: AnyClip): Timeline {
  return { ...t, [track]: [...(t[track] as AnyClip[]), clip] } as Timeline;
}

/** Longest a clip can be, given its source media and trim. Infinity for text and images. */
export function maxDuration(clip: AnyClip, assets: Map<string, AssetDTO>): number {
  if (!('assetId' in clip) || !clip.assetId) return Infinity;
  const a = assets.get(clip.assetId);
  if (!a || a.kind === 'image' || a.durationSec == null) return Infinity;
  return Math.max(0.1, a.durationSec - (clip.trimIn ?? 0));
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
