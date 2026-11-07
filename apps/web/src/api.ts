import type {
  ApiErrorBody,
  AssetDTO,
  CreateExportBody,
  ExportDTO,
  ProjectDTO,
  ProjectSummaryDTO,
  Timeline,
  UploadTicketDTO,
  UserDTO,
} from '@mitome/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Can’t reach the server. Check your connection.');
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const e = json as Partial<ApiErrorBody>;
    throw new ApiError(res.status, e.error ?? 'error', e.message ?? `Request failed (${res.status})`, e.details);
  }
  return json as T;
}

export const api = {
  authConfig: () => request<{ allowSignup: boolean }>('GET', '/api/auth/config'),
  me: () => request<{ user: UserDTO }>('GET', '/api/auth/me'),
  login: (email: string, password: string) => request<{ user: UserDTO }>('POST', '/api/auth/login', { email, password }),
  signup: (email: string, password: string) => request<{ user: UserDTO }>('POST', '/api/auth/signup', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),

  listProjects: () => request<{ projects: ProjectSummaryDTO[] }>('GET', '/api/projects'),
  createProject: (title: string) => request<{ project: ProjectDTO }>('POST', '/api/projects', { title }),
  getProject: (id: string) => request<{ project: ProjectDTO }>('GET', `/api/projects/${id}`),
  renameProject: (id: string, title: string) => request<{ ok: true }>('PATCH', `/api/projects/${id}`, { title }),
  deleteProject: (id: string) => request<{ ok: true }>('DELETE', `/api/projects/${id}`),
  saveTimeline: (id: string, revision: number, timeline: Timeline) =>
    request<{ revision: number; updatedAt: string }>('PUT', `/api/projects/${id}/timeline`, { revision, timeline }),

  createUpload: (projectId: string, file: File) =>
    request<UploadTicketDTO>('POST', `/api/projects/${projectId}/uploads`, {
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
    }),
  completeUpload: (assetId: string) => request<{ asset: AssetDTO }>('POST', `/api/assets/${assetId}/complete`),
  deleteAsset: (assetId: string) => request<{ ok: true }>('DELETE', `/api/assets/${assetId}`),

  models: () => request<{ models: { id: string; provider: string; label: string }[] }>('GET', '/api/models'),
  generate: (projectId: string, body: { prompt: string; model: string; durationSec: number; resolution: '720p' | '1080p' }) =>
    request<{ asset: AssetDTO; generationId: string }>('POST', `/api/projects/${projectId}/generations`, body),

  createExport: (projectId: string, body: CreateExportBody) =>
    request<{ export: ExportDTO }>('POST', `/api/projects/${projectId}/exports`, body),
  getExport: (id: string) => request<{ export: ExportDTO }>('GET', `/api/exports/${id}`),
  cancelExport: (id: string) => request<{ ok: true }>('POST', `/api/exports/${id}/cancel`),

  usage: () =>
    request<{ storageBytes: number; storageQuotaBytes: number; maxUploadBytes: number; generationsToday: number; generationsPerDay: number }>(
      'GET',
      '/api/usage',
    ),
};

/** PUTs a file to a signed URL with progress (fetch has no upload progress). */
export function putWithProgress(ticket: UploadTicketDTO, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.method, ticket.uploadUrl);
    for (const [k, v] of Object.entries(ticket.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed: network error'));
    xhr.send(file);
  });
}
