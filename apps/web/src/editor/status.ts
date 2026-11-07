import type { AssetDTO, VideoClip } from '@mitome/shared';

export type ClipStatus = 'ready' | 'generating' | 'processing' | 'failed' | 'none' | 'missing';

export const STATUS_LABEL: Record<ClipStatus, string> = {
  ready: 'Ready',
  generating: 'Generating',
  processing: 'Processing',
  failed: 'Failed',
  none: 'Not generated',
  missing: 'Missing media',
};

/** Dot class for a status, matching the design system's status rules. */
export const dotClass = (s: ClipStatus) => `dot dot-${s === 'missing' ? 'failed' : s}`;

export function assetStatus(a: AssetDTO | undefined): ClipStatus {
  if (!a) return 'missing';
  if (a.status === 'ready') return 'ready';
  if (a.status === 'failed') return 'failed';
  return a.source === 'generation' ? 'generating' : 'processing';
}

export function videoClipStatus(c: VideoClip, assets: Map<string, AssetDTO>): ClipStatus {
  if (!c.assetId) return 'none';
  return assetStatus(assets.get(c.assetId));
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return '—';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const newId = () => crypto.randomUUID().slice(0, 12);

/** Deterministic pseudo-waveform bars, so audio clips look like audio. */
export function waveBars(seed: string, count: number): number[] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Array.from({ length: count }, (_, i) => {
    const v = Math.abs(Math.sin(i * 0.71 + h) * Math.cos(i * 0.23 + h * 0.01));
    return 18 + Math.round(78 * v);
  });
}
