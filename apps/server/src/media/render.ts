import { clipEnd, timelineDuration, type Timeline } from '@mitome/shared';

export interface RenderMedia {
  path: string;
  hasVideo: boolean;
  hasAudio: boolean;
  isImage: boolean;
}

export interface RenderSettings {
  width: number;
  height: number;
  fps: number;
  format: 'mp4' | 'mov' | 'gif';
}

export interface RenderPlan {
  args: string[];
  /** Text files the caller must write before running (drawtext reads them). */
  files: { path: string; content: string }[];
  durationSec: number;
}

const r = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Turns a timeline into one ffmpeg command:
 *  - V1 is laid out end to end; gaps and unready scenes become black.
 *  - Scene audio, A1 and A2 are delayed into place and mixed.
 *  - T1 text is burned in with drawtext, enabled over each clip's time range.
 * Pure function so it can be unit-tested without ffmpeg.
 */
export function buildRenderPlan(
  timeline: Timeline,
  media: Map<string, RenderMedia>,
  s: RenderSettings,
  opts: { workDir: string; fontPath: string; outPath: string },
): RenderPlan {
  const total = r(timelineDuration(timeline));
  if (total <= 0) throw new Error('The timeline is empty.');

  const inputs: string[] = [];
  const filters: string[] = [];
  const files: { path: string; content: string }[] = [];
  const audioLabels: string[] = [];
  let inputCount = 0;
  const addInput = (args: string[]) => {
    inputs.push(...args);
    return inputCount++;
  };

  const { width: W, height: H, fps } = s;
  const wantAudio = s.format !== 'gif';

  /* ---------- Video track ---------- */
  const segments: string[] = [];
  const black = (len: number) => {
    const label = `v${segments.length}`;
    filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${r(len)},format=yuv420p,setsar=1[${label}]`);
    segments.push(`[${label}]`);
  };

  let cursor = 0;
  const videoClips = [...timeline.video].sort((a, b) => a.start - b.start);
  for (const clip of videoClips) {
    const segStart = Math.max(clip.start, cursor);
    const segEnd = clipEnd(clip);
    if (segEnd - segStart < 0.02) continue; // fully covered by an earlier clip
    if (segStart - cursor > 0.001) black(segStart - cursor);

    const len = r(segEnd - segStart);
    const m = clip.assetId ? media.get(clip.assetId) : undefined;
    if (!m || !m.hasVideo) {
      black(len); // not generated, failed or missing: hold black
    } else {
      const offset = r(clip.trimIn + (segStart - clip.start));
      const idx = m.isImage
        ? addInput(['-loop', '1', '-framerate', String(fps), '-t', String(len), '-i', m.path])
        : addInput(['-ss', String(offset), '-t', String(len), '-i', m.path]);
      const label = `v${segments.length}`;
      filters.push(
        `[${idx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p,` +
          `tpad=stop_mode=clone:stop_duration=${len},trim=duration=${len},setpts=PTS-STARTPTS[${label}]`,
      );
      segments.push(`[${label}]`);
      if (wantAudio && m.hasAudio && !m.isImage) {
        const a = `a${audioLabels.length}`;
        const delay = Math.round(segStart * 1000);
        filters.push(
          `[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${len},asetpts=PTS-STARTPTS,adelay=${delay}|${delay}[${a}]`,
        );
        audioLabels.push(`[${a}]`);
      }
    }
    cursor = segEnd;
  }
  if (total - cursor > 0.001) black(total - cursor);
  filters.push(`${segments.join('')}concat=n=${segments.length}:v=1:a=0[vcat]`);

  /* ---------- Text overlays ---------- */
  let last = 'vcat';
  timeline.text.forEach((t, i) => {
    if (!t.text.trim()) return;
    const file = `${opts.workDir}/text-${i}.txt`;
    files.push({ path: file, content: t.text });
    const size = Math.max(8, Math.round((t.size * H) / 1080));
    const y = t.position === 'top' ? `h*0.08` : t.position === 'center' ? `(h-text_h)/2` : `h*0.86-text_h`;
    const next = `vt${i}`;
    filters.push(
      `[${last}]drawtext=fontfile='${opts.fontPath}':textfile='${file}':fontcolor=white:fontsize=${size}:` +
        `box=1:boxcolor=black@0.45:boxborderw=${Math.round(size * 0.35)}:x=(w-text_w)/2:y=${y}:` +
        `enable='between(t,${r(t.start)},${r(clipEnd(t))})'[${next}]`,
    );
    last = next;
  });

  /* ---------- Audio tracks ---------- */
  if (wantAudio) {
    for (const clip of [...timeline.audio, ...timeline.music]) {
      const m = media.get(clip.assetId);
      if (!m || !m.hasAudio) continue;
      const idx = addInput(['-ss', String(r(clip.trimIn)), '-t', String(r(clip.duration)), '-i', m.path]);
      const delay = Math.round(clip.start * 1000);
      const fades = clip.fade
        ? `,afade=t=in:d=${r(Math.min(1, clip.duration / 4))},afade=t=out:st=${r(Math.max(0, clip.duration - Math.min(1, clip.duration / 4)))}:d=${r(Math.min(1, clip.duration / 4))}`
        : '';
      const a = `a${audioLabels.length}`;
      filters.push(
        `[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${r(clip.duration)},asetpts=PTS-STARTPTS,` +
          `volume=${clip.volume}${fades},adelay=${delay}|${delay}[${a}]`,
      );
      audioLabels.push(`[${a}]`);
    }
    if (audioLabels.length) {
      filters.push(
        `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,` +
          `apad=whole_dur=${total},atrim=duration=${total}[aout]`,
      );
    } else {
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${total}[aout]`);
    }
  }

  /* ---------- Output ---------- */
  let output: string[];
  if (s.format === 'gif') {
    const gw = Math.min(W, 640);
    filters.push(
      `[${last}]fps=${Math.min(fps, 15)},scale=${gw}:-2:flags=lanczos,split[g1][g2];[g1]palettegen=stats_mode=diff[pal];[g2][pal]paletteuse=dither=bayer:bayer_scale=4[gout]`,
    );
    output = ['-map', '[gout]', '-loop', '0', opts.outPath];
  } else {
    const crf = H >= 2160 ? '22' : '20';
    output = [
      '-map', `[${last}]`, '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf, '-pix_fmt', 'yuv420p', '-r', String(fps),
      '-c:a', 'aac', '-b:a', '192k',
      '-t', String(total),
      ...(s.format === 'mp4' ? ['-movflags', '+faststart'] : []),
      opts.outPath,
    ];
  }

  return {
    args: [...inputs, '-filter_complex', filters.join(';'), ...output],
    files,
    durationSec: total,
  };
}
