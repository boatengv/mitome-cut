import { z } from 'zod';

/* ---------------------------------------------------------------------------
 * Library documents
 *
 * The editor keeps its library as a small set of JSON documents, one per key,
 * mirroring how the original prototype used browser storage:
 *   ms_shows, ms_seasons, ms_projects      indexes
 *   ms_show_<id>, ms_season_<id>           a show / a season (+ its assets)
 *   ms_proj_<id>                           an episode or movie (scenes, assets…)
 * Each user's documents are private to them and stored in Postgres.
 * ------------------------------------------------------------------------- */

export const DOC_KEY_RE = /^(ms_projects|ms_shows|ms_seasons|ms_(proj|show|season)_[a-z0-9]{1,40})$/;

export const putDocBody = z.object({ value: z.unknown() });

/* ---------------------------------------------------------------------------
 * Media files
 *
 * Logical paths, as the editor names them:
 *   projects/<pid>/media/clips/<sceneId>.mp4
 *   seasons/<id>/media/images/<assetId>.png
 * The server maps each to a storage key that is never reused, so replacing a
 * file never overwrites bytes another device may still be reading.
 * ------------------------------------------------------------------------- */

export const FILE_KINDS = ['clips', 'voices', 'images', 'storyboard', 'refs', 'music', 'renders'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_PATH_RE = new RegExp(
  `^(projects|shows|seasons)/[a-z0-9]{1,40}/media/(${FILE_KINDS.join('|')})/[A-Za-z0-9_-]{1,64}\\.[a-z0-9]{2,5}$`,
);
export const FILE_PREFIX_RE = /^(projects|shows|seasons)\/[a-z0-9]{1,40}\/[A-Za-z0-9_.\/-]*$/;

export const uploadBody = z.object({
  path: z.string().regex(FILE_PATH_RE, 'Invalid file path'),
  mime: z.string().trim().min(3).max(120),
  size: z.number().int().positive(),
});

export const completeBody = z.object({ id: z.string().uuid() });
export const urlsBody = z.object({ paths: z.array(z.string().regex(FILE_PATH_RE)).max(500) });

export interface FileDTO {
  path: string;
  type: string;
  size: number;
  updated: number;
}

/* ---------------------------------------------------------------------------
 * AI
 * ------------------------------------------------------------------------- */

export const AI_PURPOSES = ['video', 'image', 'sketch', 'llm'] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];

export const falJobBody = z.object({
  model: z.string().regex(/^fal-ai\/[A-Za-z0-9._\/-]{2,120}$/, 'Only fal-ai/* models are allowed'),
  input: z.record(z.string(), z.unknown()),
  purpose: z.enum(AI_PURPOSES),
  projectId: z.string().regex(/^[a-z0-9]{1,40}$/).optional(),
});

export const ttsBody = z.object({
  voice: z.string().trim().regex(/^[A-Za-z0-9]{8,40}$/, 'Invalid voice ID'),
  model: z.string().trim().regex(/^[a-z0-9_]{3,60}$/, 'Invalid model'),
  text: z.string().trim().min(1).max(2500),
});

export const llmBody = z.object({
  provider: z.enum(['anthropic', 'fal']),
  model: z.string().trim().min(1).max(120),
  system: z.string().max(20_000),
  user: z.string().min(1).max(60_000),
});

export type AiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface AiJobDTO {
  id: string;
  status: AiJobStatus;
  message: string | null;
  output: unknown;
  error: string | null;
}

export interface AiConfigDTO {
  fal: boolean;
  elevenlabs: boolean;
  anthropic: boolean;
  limits: { videoPerDay: number; imagePerDay: number; ttsCharsPerDay: number; llmPerDay: number };
}

/* ---------------------------------------------------------------------------
 * Accounts
 * ------------------------------------------------------------------------- */

export const credentialsBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});

export interface UserDTO {
  id: string;
  email: string;
}

/* ---------------------------------------------------------------------------
 * Server render
 * ------------------------------------------------------------------------- */

export const EXPORT_FORMATS = ['mp4', 'mov', 'gif'] as const;
export const EXPORT_RESOLUTIONS = ['480p', '720p', '1080p'] as const;

export const exportBody = z.object({
  format: z.enum(EXPORT_FORMATS).default('mp4'),
  resolution: z.enum(EXPORT_RESOLUTIONS).default('1080p'),
  fps: z.union([z.literal(24), z.literal(30)]).default(30),
  captions: z.boolean().default(true),
  /** Include each clip's own sound (dialogue, effects) as well as voiceover and music. */
  clipAudio: z.boolean().default(true),
});
export type ExportSettings = z.infer<typeof exportBody>;

/** Output size for an aspect ratio and a resolution (the short side). */
export function frameSize(aspect: string, res: (typeof EXPORT_RESOLUTIONS)[number]) {
  const short = { '480p': 480, '720p': 720, '1080p': 1080 }[res];
  const long = Math.round((short * 16) / 9 / 2) * 2;
  return aspect === '9:16' ? { width: short, height: long } : { width: long, height: short };
}

export interface ExportDTO {
  id: string;
  status: AiJobStatus;
  progress: number;
  error: string | null;
  downloadUrl: string | null;
  fileName: string | null;
  sizeBytes: number | null;
}

/** The scene fields the server renderer reads from a project document. */
export const sceneForRender = z
  .object({
    id: z.string(),
    vo: z.string().default(''),
    label: z.string().default(''),
    prompt: z.string().default(''),
    file: z.string().nullable().optional(),
    voFile: z.string().nullable().optional(),
    kind: z.string().nullable().optional(),
    dur: z.number().default(6),
    trimIn: z.number().default(0),
    trimOut: z.number().nullable().optional(),
    transition: z.string().default('cut'),
    tdur: z.number().default(0.5),
  })
  .passthrough();
export type SceneForRender = z.infer<typeof sceneForRender>;

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}
