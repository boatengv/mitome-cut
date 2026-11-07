import { useEffect, useRef, useState } from 'react';
import { EXPORT_FORMATS, EXPORT_RESOLUTIONS, shortTime, type CreateExportBody, type ExportDTO } from '@mitome/shared';
import { api, ApiError } from '../api';
import { IconClose } from '../icons';
import { formatBytes, videoClipStatus } from './status';
import type { ProjectStore } from './useProject';

interface Props {
  store: ProjectStore;
  projectId: string;
  duration: number;
  onClose: () => void;
}

const LABEL: Record<string, string> = { mp4: 'MP4', mov: 'MOV', gif: 'GIF', '720p': '720p', '1080p': '1080p', '4k': '4K' };

export function ExportDialog({ store, projectId, duration, onClose }: Props) {
  const [settings, setSettings] = useState<CreateExportBody>({ format: 'mp4', resolution: '1080p', fps: 24 });
  const [job, setJob] = useState<ExportDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const t = store.timeline;
  const notReady = (t?.video ?? []).filter((c) => videoClipStatus(c, store.assets) !== 'ready');

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Poll the running export.
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return;
    const id = window.setInterval(async () => {
      try {
        const { export: fresh } = await api.getExport(job.id);
        setJob(fresh);
        if (fresh.status === 'succeeded') void store.refresh();
      } catch {
        /* retry on next tick */
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [job, store]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      // Make sure the server renders exactly what is on screen.
      await store.flush();
      const { export: created } = await api.createExport(projectId, settings);
      setJob(created);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the export.');
    } finally {
      setStarting(false);
    }
  }

  const summary = `${LABEL[settings.format]} · ${LABEL[settings.resolution]}`;
  const segmented = <K extends keyof CreateExportBody>(key: K, label: string, values: readonly CreateExportBody[K][], fmt: (v: CreateExportBody[K]) => string) => (
    <div className="field">
      <span>{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {values.map((v) => (
          <button key={String(v)} type="button" role="radio" aria-checked={settings[key] === v} onClick={() => setSettings({ ...settings, [key]: v })}>
            {fmt(v)}
          </button>
        ))}
      </div>
    </div>
  );

  const running = job && (job.status === 'queued' || job.status === 'running');
  const previous = (store.project?.exports ?? []).filter((e) => e.status === 'succeeded' && e.id !== job?.id).slice(0, 3);

  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="dialog-head">
          <h2 id="export-title">Export · {store.project?.title}</h2>
          <button ref={closeRef} className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        {!job || job.status === 'failed' || job.status === 'canceled' ? (
          <>
            <div className="dialog-body">
              {segmented('format', 'Format', EXPORT_FORMATS, (v) => LABEL[v]!)}
              {segmented('resolution', 'Resolution', EXPORT_RESOLUTIONS, (v) => LABEL[v]!)}
              {segmented('fps', 'Frame rate', [24, 30, 60] as const, (v) => `${v} fps`)}
              {notReady.length > 0 && (
                <div className="alert">
                  <span className="dot dot-failed" style={{ marginTop: 6 }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 500 }}>
                      {notReady.length} {notReady.length === 1 ? 'scene isn’t' : 'scenes aren’t'} ready
                    </span>
                    <span className="caption" style={{ fontSize: 12 }}>
                      {notReady.map((c) => c.name).join(', ')} will export as black frames.
                    </span>
                  </span>
                </div>
              )}
              {job?.status === 'failed' && (
                <div className="alert alert-error" role="alert">
                  Export failed: {job.error}
                </div>
              )}
              {error && (
                <div className="alert alert-error" role="alert">
                  {error}
                </div>
              )}
              <div className="row caption">
                <span>Length {shortTime(duration)}</span>
                <span className="spacer" />
                {settings.format === 'gif' && <span>GIFs are silent and capped at 640px wide</span>}
              </div>
              {previous.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="caption">Recent exports</span>
                  {previous.map((e) => (
                    <a key={e.id} href={e.downloadUrl ?? '#'} className="row" style={{ fontSize: 12 }}>
                      {e.fileName} <span className="caption">· {formatBytes(e.sizeBytes)}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="dialog-foot">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={start} disabled={starting || duration <= 0}>
                {starting ? 'Starting…' : `Export ${summary}`}
              </button>
            </div>
          </>
        ) : running ? (
          <>
            <div className="dialog-body" style={{ padding: '32px 20px' }}>
              <div className="row">
                <span className="status" style={{ fontSize: 13, color: 'var(--text)' }}>
                  <span className="dot dot-generating" />
                  {job.status === 'queued' ? 'Waiting for a renderer' : `Rendering ${summary}`}
                </span>
                <span className="spacer" />
                <span className="caption tabular">{job.progress}%</span>
              </div>
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress} aria-label="Export progress" style={{ height: 6 }}>
                <div style={{ width: `${job.progress}%` }} />
              </div>
              <span className="caption">You can keep editing. Changes after this point are not in this export.</span>
            </div>
            <div className="dialog-foot">
              <button className="btn" onClick={() => api.cancelExport(job.id).then(() => setJob({ ...job, status: 'canceled' }))}>
                Cancel export
              </button>
              <button className="btn" onClick={onClose}>
                Hide
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="dialog-body" style={{ padding: '32px 20px', gap: 6 }}>
              <span className="status" style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
                <span className="dot dot-ready" />
                Export ready
              </span>
              <span className="muted">
                {job.fileName} · {formatBytes(job.sizeBytes)}
              </span>
            </div>
            <div className="dialog-foot">
              <button className="btn" onClick={() => setJob(null)}>
                Export again
              </button>
              <a className="btn btn-primary" href={job.downloadUrl ?? '#'} download={job.fileName ?? undefined}>
                Download
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
