import { z } from 'zod';
import { timelineSchema, type Timeline } from './timeline.js';

/* ---------- Enumerations shared by the database, API and UI ---------- */

export const ASSET_KINDS = ['video', 'audio', 'image'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_SOURCES = ['upload', 'generation', 'render'] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];

/** pending_upload → processing → ready | failed */
export const ASSET_STATUSES = ['pending_upload', 'processing', 'ready', 'failed'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const EXPORT_FORMATS = ['mp4', 'mov', 'gif'] as const;
export const EXPORT_RESOLUTIONS = ['720p', '1080p', '4k'] as const;
export const EXPORT_FPS = [24, 30, 60] as const;

export const RESOLUTION_SIZE: Record<(typeof EXPORT_RESOLUTIONS)[number], { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
};

/* ---------- Request bodies ---------- */

export const credentialsBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});

export const createProjectBody = z.object({
  title: z.string().trim().min(1).max(120).default('Untitled project'),
});

export const updateProjectBody = z.object({
  title: z.string().trim().min(1).max(120),
});

export const saveTimelineBody = z.object({
  /** The revision the client last saw. A mismatch returns 409. */
  revision: z.number().int().min(0),
  timeline: timelineSchema,
});

export const createUploadBody = z.object({
  name: z.string().trim().min(1).max(200),
  mime: z.string().trim().min(3).max(120),
  size: z.number().int().positive(),
});

export const createGenerationBody = z.object({
  prompt: z.string().trim().min(1).max(4000),
  model: z.string().trim().min(1).max(80).default('demo'),
  durationSec: z.number().min(1).max(20).default(5),
  resolution: z.enum(['720p', '1080p']).default('720p'),
});

export const createExportBody = z.object({
  format: z.enum(EXPORT_FORMATS).default('mp4'),
  resolution: z.enum(EXPORT_RESOLUTIONS).default('1080p'),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(24),
});

export type CreateExportBody = z.infer<typeof createExportBody>;

/* ---------- Response shapes ---------- */

export interface UserDTO {
  id: string;
  email: string;
}

export interface ProjectSummaryDTO {
  id: string;
  title: string;
  revision: number;
  durationSec: number;
  sceneCount: number;
  thumbUrl: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface AssetDTO {
  id: string;
  kind: AssetKind;
  source: AssetSource;
  status: AssetStatus;
  name: string;
  mime: string;
  sizeBytes: number | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
  /** Short-lived signed URL; null until the file exists. */
  url: string | null;
  thumbUrl: string | null;
  createdAt: string;
}

export interface GenerationDTO {
  id: string;
  assetId: string;
  provider: string;
  model: string;
  prompt: string;
  status: JobStatus;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ExportDTO {
  id: string;
  revision: number;
  format: string;
  resolution: string;
  fps: number;
  status: JobStatus;
  progress: number;
  error: string | null;
  downloadUrl: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ProjectDTO {
  id: string;
  title: string;
  revision: number;
  timeline: Timeline;
  settings: { width: number; height: number; fps: number };
  assets: AssetDTO[];
  generations: GenerationDTO[];
  exports: ExportDTO[];
  updatedAt: string;
}

export interface UploadTicketDTO {
  asset: AssetDTO;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}
