import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { runFfmpeg } from '../media/ffmpeg.js';
import type { GenerationProvider } from './index.js';

/**
 * A free, offline stand-in for a real video model: renders an animated test
 * pattern with the prompt written on it. It exercises the whole pipeline
 * (queue → provider → storage → processing → timeline) without an API key.
 */
export const demoProvider: GenerationProvider = {
  id: 'demo',
  label: 'Demo (test pattern, free)',
  models: ['demo'],
  async generate({ prompt, durationSec, width, height, outPath, signal }) {
    const textFile = path.join(path.dirname(outPath), 'prompt.txt');
    await fs.writeFile(textFile, wrap(prompt, 42), 'utf8');
    const fontSize = Math.round(height / 18);
    await runFfmpeg(
      [
        '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=24:duration=${durationSec}`,
        '-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=48000:duration=${durationSec}`,
        '-vf',
        [
          'eq=saturation=0.35:brightness=-0.15',
          `drawbox=x=0:y=ih*0.62:w=iw:h=ih*0.30:color=black@0.65:t=fill`,
          `drawtext=fontfile='${config.FONT_PATH}':textfile='${textFile}':fontcolor=white:fontsize=${fontSize}:line_spacing=${Math.round(fontSize / 3)}:x=(w-text_w)/2:y=h*0.66`,
        ].join(','),
        '-af', 'volume=0.08',
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '26',
        '-c:a', 'aac', '-b:a', '96k',
        '-shortest', '-movflags', '+faststart',
        outPath,
      ],
      { signal },
    );
    return { costUsd: 0, providerJobId: `demo-${Date.now()}` };
  },
};

function wrap(text: string, width: number): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      if (line) lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
    if (lines.length === 3) break;
  }
  if (line && lines.length < 3) lines.push(line);
  return lines.join('\n');
}
