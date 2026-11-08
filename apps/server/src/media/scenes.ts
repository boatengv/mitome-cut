/**
 * Planning for the server render of a scene-based project. Mirrors the
 * editor's playback rules so the export matches the preview:
 *  - scenes play back to back;
 *  - a scene lasts as long as its clip, or its voiceover + 0.25 s if longer,
 *    in which case the last frame holds with a slow push-in;
 *  - a transition plays over the start of the incoming scene, from the
 *    outgoing scene's final frame, without changing any timing;
 *  - captions reveal the scene script word by word, ten words per chunk.
 * Everything here is pure, so it is unit-tested without ffmpeg.
 */

export interface SceneInput {
  index: number;
  label: string;
  prompt: string;
  vo: string;
  /** 'video' when a clip file is available; anything else renders a slate. */
  kind: 'video' | 'slate';
  clipDur: number; // probed source duration (video only)
  trimIn: number;
  trimOut: number | null;
  dur: number; // length when there is no clip
  voDur: number; // probed voiceover duration, 0 when none
  transition: string;
  tdur: number;
}

export interface SceneTiming {
  t0: number;
  len: number;
  clipLen: number;
  holdLen: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function clipLen(s: SceneInput): number {
  if (s.kind !== 'video') return Math.max(0.2, s.dur);
  const end = s.trimOut ?? s.clipDur;
  return Math.max(0.2, Math.min(end, s.clipDur) - s.trimIn);
}

export function segLen(s: SceneInput): number {
  return Math.max(clipLen(s), s.voDur > 0 ? s.voDur + 0.25 : 0);
}

export function planTimings(scenes: SceneInput[]): SceneTiming[] {
  let t = 0;
  return scenes.map((s) => {
    const cl = r3(clipLen(s));
    const len = r3(segLen(s));
    const out = { t0: r3(t), len, clipLen: cl, holdLen: r3(Math.max(0, len - cl)) };
    t += len;
    return out;
  });
}

/** Editor transition → ffmpeg xfade transition. 'cut' means none. */
export function xfadeName(t: string): string | null {
  return ({ fade: 'fade', black: 'fadeblack', white: 'fadewhite', wipe: 'wiperight', zoom: 'zoomin' } as Record<string, string>)[t] ?? null;
}

/* ---------------- Captions (ASS) ---------------- */

const assTime = (t: number) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

const assText = (t: string) => t.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\n/g, ' ');

export interface CaptionEvent {
  start: number;
  end: number;
  text: string;
}

/** The word-by-word reveal the editor draws, as timed events. */
export function captionEvents(scenes: SceneInput[], timings: SceneTiming[]): CaptionEvent[] {
  const out: CaptionEvent[] = [];
  scenes.forEach((s, i) => {
    const words = s.vo.trim().split(/\s+/).filter(Boolean);
    const tm = timings[i]!;
    if (!words.length) return;
    const span = s.voDur > 0 ? s.voDur : tm.len;
    const starts = words.map((_, k) => Math.max(0, ((k + 1) * span) / words.length - 0.3));
    words.forEach((_, k) => {
      const n = k + 1;
      const chunkStart = Math.floor((n - 1) / 10) * 10;
      const start = tm.t0 + Math.min(starts[k]!, tm.len);
      const end = tm.t0 + (k + 1 < words.length ? Math.min(starts[k + 1]!, tm.len) : tm.len);
      if (end - start < 0.01) return;
      out.push({ start: r3(start), end: r3(end), text: words.slice(chunkStart, n).join(' ') });
    });
  });
  return out;
}

export function captionsAss(events: CaptionEvent[], width: number, height: number): string {
  const fs = Math.round(Math.min(width, height) * 0.04);
  const pad = Math.max(2, Math.round(fs * 0.3));
  const marginV = Math.round(height * 0.08 - fs * 0.6);
  const marginH = Math.round(width * 0.1);
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,DejaVu Sans,${fs},&H00FFFFFF,&H00FFFFFF,&H59000000,&H59000000,-1,0,0,0,100,100,0,0,3,${pad},0,2,${marginH},${marginH},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events.map((e) => `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},Cap,,0,0,0,,${assText(e.text)}`),
    '',
  ].join('\n');
}

/* ---------------- Audio mix ---------------- */

export interface AudioSource {
  path: string;
  /** Where it starts on the timeline, in seconds. */
  at: number;
  /** Seek into the source before playing, and how much to play. */
  seek?: number;
  len?: number;
}

export interface AudioPlan {
  args: string[];
  outLabel: string | null;
}

/**
 * ffmpeg inputs and filter graph for the soundtrack: foreground (voiceover and
 * clip sound) delayed into place, plus a looping music bed that ducks under
 * the foreground with a sidechain compressor.
 */
export function audioPlan(opts: {
  foreground: AudioSource[];
  music: { path: string; volume: number; duck: boolean } | null;
  total: number;
  /** Index of the first audio input on the ffmpeg command line (after video inputs). */
  firstInput?: number;
}): { inputs: string[]; filter: string; out: string } {
  const inputs: string[] = [];
  const parts: string[] = [];
  const fg: string[] = [];
  let n = opts.firstInput ?? 0;
  for (const src of opts.foreground) {
    inputs.push(...(src.seek ? ['-ss', String(r3(src.seek))] : []), ...(src.len ? ['-t', String(r3(src.len))] : []), '-i', src.path);
    const ms = Math.round(src.at * 1000);
    parts.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,adelay=${ms}|${ms}[f${fg.length}]`);
    fg.push(`[f${fg.length}]`);
    n++;
  }
  const total = r3(opts.total);
  let fgLabel: string | null = null;
  if (fg.length === 1) fgLabel = fg[0]!;
  else if (fg.length > 1) {
    parts.push(`${fg.join('')}amix=inputs=${fg.length}:normalize=0:duration=longest[fg]`);
    fgLabel = '[fg]';
  }

  let mix: string;
  if (opts.music) {
    inputs.push('-stream_loop', '-1', '-i', opts.music.path);
    parts.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${opts.music.volume},atrim=duration=${total}[mu]`);
    if (fgLabel && opts.music.duck) {
      parts.push(`${fgLabel}asplit=2[fga][fgb]`);
      parts.push('[mu][fgb]sidechaincompress=threshold=0.03:ratio=10:attack=15:release=350[mud]');
      parts.push('[fga][mud]amix=inputs=2:normalize=0:duration=longest[mix]');
    } else if (fgLabel) {
      parts.push(`${fgLabel}[mu]amix=inputs=2:normalize=0:duration=longest[mix]`);
    } else {
      parts.push('[mu]anull[mix]');
    }
    mix = '[mix]';
  } else if (fgLabel) {
    mix = fgLabel;
  } else {
    parts.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${total}[mix]`);
    mix = '[mix]';
  }
  parts.push(`${mix}apad=whole_dur=${total},atrim=duration=${total}[aout]`);
  return { inputs, filter: parts.join(';'), out: '[aout]' };
}
