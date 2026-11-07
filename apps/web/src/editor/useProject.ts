import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetDTO, ProjectDTO, Timeline } from '@mitome/shared';
import { api, ApiError } from '../api';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error';

const SAVE_DEBOUNCE_MS = 700;
const HISTORY_LIMIT = 100;

/**
 * Owns the editor's project state:
 *  - the timeline, with undo/redo history
 *  - debounced autosave with revision checks (409 → conflict banner)
 *  - polling for asset, generation and export status while anything is in flight
 */
export function useProject(projectId: string) {
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [past, setPast] = useState<Timeline[]>([]);
  const [future, setFuture] = useState<Timeline[]>([]);

  const committed = useRef<Timeline | null>(null);
  const revision = useRef(0);
  const saveTimer = useRef<number | undefined>(undefined);
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const inFlightPromise = useRef<Promise<void> | null>(null);
  const conflicted = useRef(false);

  const load = useCallback(async () => {
    try {
      const { project } = await api.getProject(projectId);
      setProject(project);
      setTimeline(project.timeline);
      committed.current = project.timeline;
      revision.current = project.revision;
      setPast([]);
      setFuture([]);
      setSaveState('saved');
      dirty.current = false;
      conflicted.current = false;
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Could not load the project.');
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Refreshes server-owned state (assets, jobs) without touching the local timeline. */
  const refresh = useCallback(async () => {
    try {
      const { project: fresh } = await api.getProject(projectId);
      setProject((prev) => (prev ? { ...fresh, timeline: prev.timeline, revision: prev.revision } : fresh));
    } catch {
      /* transient; the next poll retries */
    }
  }, [projectId]);

  /** Saves now (waiting for any save already in flight). Resolves once the server has the latest timeline. */
  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(saveTimer.current);
    while (inFlightPromise.current) await inFlightPromise.current;
    if (conflicted.current || !dirty.current || !committed.current) return;
    inFlight.current = true;
    dirty.current = false;
    setSaveState('saving');
    const body = committed.current;
    const run = (async () => {
      try {
        const res = await api.saveTimeline(projectId, revision.current, body);
        revision.current = res.revision;
        setSaveState(dirty.current ? 'unsaved' : 'saved');
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          conflicted.current = true;
          setSaveState('conflict');
          return;
        }
        dirty.current = true;
        setSaveState('error');
      }
    })();
    inFlightPromise.current = run;
    await run;
    inFlightPromise.current = null;
    inFlight.current = false;
    if (dirty.current && !conflicted.current) {
      saveTimer.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS * 3);
    }
  }, [projectId]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    setSaveState((s) => (s === 'conflict' ? s : 'unsaved'));
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [flush]);

  /** Shows a change without recording it (live drag feedback). */
  const preview = useCallback((next: Timeline) => setTimeline(next), []);

  /** Records a change: adds an undo step and schedules a save. */
  const commit = useCallback(
    (next: Timeline | ((t: Timeline) => Timeline)) => {
      const base = committed.current;
      if (!base) return;
      const value = typeof next === 'function' ? next(base) : next;
      if (value === base) return;
      setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), base]);
      setFuture([]);
      committed.current = value;
      setTimeline(value);
      scheduleSave();
    },
    [scheduleSave],
  );

  const undo = useCallback(() => {
    const prev = past[past.length - 1];
    if (!prev || !committed.current) return;
    setFuture([committed.current, ...future]);
    setPast(past.slice(0, -1));
    committed.current = prev;
    setTimeline(prev);
    scheduleSave();
  }, [past, future, scheduleSave]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next || !committed.current) return;
    setPast([...past, committed.current]);
    setFuture(future.slice(1));
    committed.current = next;
    setTimeline(next);
    scheduleSave();
  }, [past, future, scheduleSave]);

  /* Poll while anything is processing, and refresh signed URLs every 30 min. */
  const busy = useMemo(() => {
    if (!project) return false;
    return (
      project.assets.some((a) => a.status === 'processing' || a.status === 'pending_upload') ||
      project.generations.some((g) => g.status === 'queued' || g.status === 'running')
    );
  }, [project]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), busy ? 2000 : 30 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [busy, refresh]);

  /* Save before leaving; warn if that is not possible. */
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current || inFlight.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.clearTimeout(saveTimer.current);
    };
  }, [flush]);

  const assets = useMemo(() => new Map<string, AssetDTO>((project?.assets ?? []).map((a) => [a.id, a])), [project]);

  /** Adds or replaces an asset locally (after an upload or generation starts). */
  const upsertAsset = useCallback((a: AssetDTO) => {
    setProject((p) => {
      if (!p) return p;
      const exists = p.assets.some((x) => x.id === a.id);
      return { ...p, assets: exists ? p.assets.map((x) => (x.id === a.id ? a : x)) : [...p.assets, a] };
    });
  }, []);

  const removeAsset = useCallback((id: string) => {
    setProject((p) => (p ? { ...p, assets: p.assets.filter((x) => x.id !== id) } : p));
  }, []);

  return {
    project,
    setProject,
    timeline,
    assets,
    saveState,
    loadError,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    preview,
    commit,
    undo,
    redo,
    refresh,
    reload: load,
    upsertAsset,
    removeAsset,
    flush,
  };
}

export type ProjectStore = ReturnType<typeof useProject>;
