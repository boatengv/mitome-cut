import { z } from 'zod';

/**
 * The timeline is stored as one versioned JSON document per project.
 * Clips reference assets by id; asset status (ready, processing, failed)
 * lives on the asset row, so workers never need to rewrite the timeline.
 *
 * All times are in seconds (floats). Frame accuracy is applied at render time.
 */

export const TIMELINE_SCHEMA_VERSION = 1;

const seconds = z.number().finite().min(0).max(60 * 60 * 4);

export const videoClipSchema = z.object({
  id: z.string().min(1).max(64),
  /** null = a placeholder scene that has not been generated yet */
  assetId: z.string().uuid().nullable(),
  name: z.string().max(200),
  start: seconds,
  duration: seconds.min(0.04),
  /** Offset into the source media, in seconds */
  trimIn: seconds.default(0),
  /** The prompt used (or to be used) to generate this scene */
  prompt: z.string().max(4000).optional(),
});

export const textClipSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().max(500),
  start: seconds,
  duration: seconds.min(0.04),
  position: z.enum(['top', 'center', 'bottom']).default('bottom'),
  /** Font size in output pixels at 1080p; scaled for other resolutions */
  size: z.number().int().min(8).max(400).default(56),
});

export const audioClipSchema = z.object({
  id: z.string().min(1).max(64),
  assetId: z.string().uuid(),
  name: z.string().max(200),
  start: seconds,
  duration: seconds.min(0.04),
  trimIn: seconds.default(0),
  /** 0–2, where 1 is unchanged */
  volume: z.number().min(0).max(2).default(1),
  fade: z.boolean().default(false),
});

export const timelineSchema = z.object({
  schemaVersion: z.literal(TIMELINE_SCHEMA_VERSION),
  video: z.array(videoClipSchema).max(500),
  text: z.array(textClipSchema).max(500),
  audio: z.array(audioClipSchema).max(500),
  music: z.array(audioClipSchema).max(500),
});

export type VideoClip = z.infer<typeof videoClipSchema>;
export type TextClip = z.infer<typeof textClipSchema>;
export type AudioClip = z.infer<typeof audioClipSchema>;
export type Timeline = z.infer<typeof timelineSchema>;
export type TrackKey = 'video' | 'text' | 'audio' | 'music';
export type AnyClip = VideoClip | TextClip | AudioClip;

/** Display labels used across the app and in the design: V1, T1, A1, A2 */
export const TRACK_LABELS: Record<TrackKey, string> = {
  video: 'V1',
  text: 'T1',
  audio: 'A1',
  music: 'A2',
};

export function emptyTimeline(): Timeline {
  return { schemaVersion: TIMELINE_SCHEMA_VERSION, video: [], text: [], audio: [], music: [] };
}

export const clipEnd = (c: { start: number; duration: number }) => c.start + c.duration;

/** End of the last clip on any track, in seconds. */
export function timelineDuration(t: Timeline): number {
  let end = 0;
  for (const track of [t.video, t.text, t.audio, t.music]) {
    for (const c of track) end = Math.max(end, clipEnd(c));
  }
  return end;
}

/** The clip on a track that covers time `t`, preferring the latest-starting one. */
export function clipAt<T extends { start: number; duration: number }>(clips: T[], t: number): T | undefined {
  let found: T | undefined;
  for (const c of clips) {
    if (t >= c.start && t < clipEnd(c) && (!found || c.start >= found.start)) found = c;
  }
  return found;
}

/** End of the last clip on one track: where an appended clip should start. */
export function trackEnd(clips: { start: number; duration: number }[]): number {
  return clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

/** Every asset id the timeline references (for render input and cleanup). */
export function referencedAssetIds(t: Timeline): string[] {
  const ids = new Set<string>();
  for (const c of t.video) if (c.assetId) ids.add(c.assetId);
  for (const c of [...t.audio, ...t.music]) ids.add(c.assetId);
  return [...ids];
}

/**
 * Splits a clip at absolute time `at`. Returns the two halves, or null when
 * `at` is not strictly inside the clip. The second half gets `newId`.
 */
export function splitClip<T extends { id: string; start: number; duration: number; trimIn?: number }>(
  clip: T,
  at: number,
  newId: string,
): [T, T] | null {
  const minLen = 0.04;
  if (at <= clip.start + minLen || at >= clipEnd(clip) - minLen) return null;
  const firstLen = at - clip.start;
  const first = { ...clip, duration: firstLen };
  const second = { ...clip, id: newId, start: at, duration: clip.duration - firstLen };
  if (typeof clip.trimIn === 'number') second.trimIn = clip.trimIn + firstLen;
  return [first, second];
}

/** Formats seconds as HH:MM:SS:FF timecode. */
export function timecode(t: number, fps = 24): string {
  const safe = Math.max(0, t);
  const whole = Math.floor(safe + 1e-9);
  const frames = Math.min(fps - 1, Math.floor((safe - whole) * fps + 1e-6));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor(whole / 60) % 60)}:${pad(whole % 60)}:${pad(frames)}`;
}

/** Formats seconds as M:SS. */
export function shortTime(t: number): string {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
