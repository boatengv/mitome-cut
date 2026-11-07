import { spawn } from 'node:child_process';
import { config } from '../config.js';

export interface RunOptions {
  signal?: AbortSignal;
  /** Called with seconds of output rendered so far. */
  onProgress?: (seconds: number) => void;
}

/** Runs ffmpeg, rejecting with the tail of stderr on failure. */
export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const full = ['-hide_banner', '-nostdin', '-y', ...(opts.onProgress ? ['-progress', 'pipe:1', '-nostats'] : []), ...args];
    const child = spawn(config.FFMPEG_PATH, full, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-8000);
    });
    child.stdout.on('data', (d: Buffer) => {
      if (!opts.onProgress) return;
      for (const line of d.toString().split('\n')) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m) opts.onProgress(Number(m[1]) / 1_000_000);
      }
    });
    const onAbort = () => child.kill('SIGKILL');
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) return reject(new Error('Canceled'));
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').slice(-6).join('\n')}`));
    });
  });
}

export interface ProbeResult {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  /** True for still images (single frame, no duration). */
  isImage: boolean;
}

export function ffprobe(file: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      config.FFPROBE_PATH,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Not a readable media file. ${err.trim().slice(0, 300)}`));
      try {
        const json = JSON.parse(out) as {
          format?: { duration?: string; format_name?: string };
          streams?: { codec_type?: string; width?: number; height?: number; codec_name?: string; nb_frames?: string }[];
        };
        const streams = json.streams ?? [];
        const video = streams.find((s) => s.codec_type === 'video');
        const audio = streams.find((s) => s.codec_type === 'audio');
        const dur = Number(json.format?.duration);
        const imageCodecs = ['png', 'mjpeg', 'webp', 'bmp', 'tiff'];
        const isImage =
          !!video && !audio && (imageCodecs.includes(video.codec_name ?? '') || /image2|png_pipe|jpeg_pipe|webp_pipe/.test(json.format?.format_name ?? ''));
        resolve({
          durationSec: Number.isFinite(dur) && dur > 0 && !isImage ? dur : null,
          width: video?.width ?? null,
          height: video?.height ?? null,
          hasVideo: !!video,
          hasAudio: !!audio,
          isImage,
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** Writes a 480px-wide JPEG thumbnail from a video (at `atSec`) or an image. */
export async function makeThumbnail(input: string, output: string, atSec: number, isImage: boolean) {
  await runFfmpeg([
    ...(isImage ? [] : ['-ss', String(Math.max(0, atSec))]),
    '-i', input,
    '-frames:v', '1',
    '-vf', 'scale=480:-2',
    '-q:v', '4',
    output,
  ]);
}
