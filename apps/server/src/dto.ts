import type { AssetDTO, ExportDTO, GenerationDTO } from '@mitome/shared';
import type { Asset, ExportRow, Generation } from './db/schema.js';
import { storage } from './storage/index.js';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function assetDTO(a: Asset): Promise<AssetDTO> {
  const hasFile = a.status === 'ready' || a.status === 'processing';
  return {
    id: a.id,
    kind: a.kind,
    source: a.source,
    status: a.status,
    name: a.name,
    mime: a.mime,
    sizeBytes: a.sizeBytes,
    durationSec: a.durationMs == null ? null : a.durationMs / 1000,
    width: a.width,
    height: a.height,
    error: a.error,
    url: hasFile && a.status === 'ready' ? await storage.presignGet(a.storageKey) : null,
    thumbUrl: a.thumbKey ? await storage.presignGet(a.thumbKey) : null,
    createdAt: a.createdAt.toISOString(),
  };
}

export function generationDTO(g: Generation): GenerationDTO {
  return {
    id: g.id,
    assetId: g.assetId,
    provider: g.provider,
    model: g.model,
    prompt: g.prompt,
    status: g.status,
    error: g.error,
    createdAt: g.createdAt.toISOString(),
    completedAt: iso(g.completedAt),
  };
}

export async function exportDTO(e: ExportRow, output: Asset | null, projectTitle: string): Promise<ExportDTO> {
  const ext = e.settings.format;
  const fileName = `${slug(projectTitle) || 'export'}-r${e.revision}.${ext}`;
  return {
    id: e.id,
    revision: e.revision,
    format: e.settings.format,
    resolution: e.settings.resolution,
    fps: e.settings.fps,
    status: e.status,
    progress: e.progress,
    error: e.error,
    downloadUrl:
      e.status === 'succeeded' && output ? await storage.presignGet(output.storageKey, { downloadName: fileName }) : null,
    fileName: e.status === 'succeeded' ? fileName : null,
    sizeBytes: output?.sizeBytes ?? null,
    createdAt: e.createdAt.toISOString(),
    completedAt: iso(e.completedAt),
  };
}

export function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
