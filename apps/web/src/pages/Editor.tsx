import { useCallback, useEffect, useRef, useState } from 'react';
import { clipAt, splitClip, timelineDuration, type AnyClip, type Timeline as TL } from '@mitome/shared';
import { api } from '../api';
import { navigate } from '../router';
import { IconAudio, IconChevronLeft, IconMedia, IconRedo, IconSpark, IconText, IconUndo } from '../icons';
import { useProject, type SaveState } from '../editor/useProject';
import { Timeline } from '../editor/Timeline';
import { Viewer } from '../editor/Viewer';
import { Inspector } from '../editor/Inspector';
import { LeftPanel, type PanelTab } from '../editor/LeftPanel';
import { ExportDialog } from '../editor/ExportDialog';
import { getClip, removeClip, type Selection } from '../editor/model';
import { newId } from '../editor/status';

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  conflict: 'Not saved',
  error: 'Save failed, retrying',
};

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

export function Editor({ projectId }: { projectId: string }) {
  const store = useProject(projectId);
  const { project, timeline } = store;
  const [tab, setTab] = useState<PanelTab>('media');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const duration = timeline ? timelineDuration(timeline) : 0;
  const clock = useRef({ base: 0, startedAt: 0 });

  useEffect(() => {
    if (project) setTitle(project.title);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(id);
  }, [toast]);

  /* ---------- Playback clock ---------- */
  useEffect(() => {
    if (!playing) return;
    clock.current = { base: playhead >= duration ? 0 : playhead, startedAt: performance.now() };
    let raf = 0;
    const tick = () => {
      const t = clock.current.base + (performance.now() - clock.current.startedAt) / 1000;
      if (t >= duration) {
        setPlayhead(duration);
        setPlaying(false);
        return;
      }
      setPlayhead(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(t, Math.max(duration, 0)));
      clock.current = { base: clamped, startedAt: performance.now() };
      setPlayhead(clamped);
    },
    [duration],
  );

  const togglePlay = useCallback(() => {
    if (duration <= 0) return;
    setPlaying((p) => !p);
  }, [duration]);

  /* ---------- Editing commands ---------- */
  const split = useCallback(() => {
    if (!timeline) return;
    const target: Selection | null =
      selection ?? (clipAt(timeline.video, playhead) ? { track: 'video', id: clipAt(timeline.video, playhead)!.id } : null);
    const clip = getClip(timeline, target);
    if (!target || !clip) return;
    const halves = splitClip(clip, playhead, newId());
    if (!halves) return;
    store.commit((t: TL) => {
      const list = t[target.track] as AnyClip[];
      return { ...t, [target.track]: list.flatMap((c) => (c.id === clip.id ? halves : [c])) } as TL;
    });
    setSelection({ track: target.track, id: halves[1].id });
  }, [timeline, selection, playhead, store]);

  const deleteSelected = useCallback(() => {
    if (!selection) return;
    store.commit((t) => removeClip(t, selection.track, selection.id));
    setSelection(null);
  }, [selection, store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || exportOpen) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if (!mod && e.key.toLowerCase() === 's') {
        split();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
      } else if (e.key === 'Home') {
        seek(0);
      } else if (e.key === 'End') {
        seek(duration);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, split, deleteSelected, seek, duration, store, exportOpen]);

  async function rename() {
    const next = title.trim() || 'Untitled project';
    setTitle(next);
    if (!project || next === project.title) return;
    await api.renameProject(project.id, next).catch(() => setToast('Could not rename the project.'));
    store.setProject((p) => (p ? { ...p, title: next } : p));
  }

  if (store.loadError) {
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>Can’t open this project</h1>
          <p className="muted" style={{ margin: 0 }}>
            {store.loadError}
          </p>
          <button className="btn" onClick={() => navigate('/')}>
            Back to projects
          </button>
        </div>
      </div>
    );
  }
  if (!project || !timeline) return <div className="auth caption">Loading project…</div>;

  const rail: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'media', label: 'Media', icon: <IconMedia /> },
    { id: 'text', label: 'Text', icon: <IconText /> },
    { id: 'audio', label: 'Audio', icon: <IconAudio /> },
    { id: 'generate', label: 'Generate', icon: <IconSpark /> },
  ];

  return (
    <div className="editor">
      <header className="editor-top">
        <a
          className="logo"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            void store.flush().then(() => navigate('/'));
          }}
          aria-label="Back to projects"
        >
          <IconChevronLeft size={14} />
          <b>MITOME</b>
          <span>CUT</span>
        </a>
        <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <label>
          <span className="sr-only">Project title</span>
          <input
            className="title-input"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
        <span className="status" aria-live="polite">
          {store.saveState !== 'saved' && <span className={`dot ${store.saveState === 'saving' ? 'dot-processing' : store.saveState === 'unsaved' ? 'dot-none' : 'dot-failed'}`} />}
          {SAVE_LABEL[store.saveState]}
        </span>
        <div className="spacer" />
        <button className="icon-btn" aria-label="Undo" title="Undo (Ctrl/⌘+Z)" onClick={store.undo} disabled={!store.canUndo}>
          <IconUndo />
        </button>
        <button className="icon-btn" aria-label="Redo" title="Redo (Ctrl/⌘+Shift+Z)" onClick={store.redo} disabled={!store.canRedo}>
          <IconRedo />
        </button>
        <button className="btn btn-primary" onClick={() => setExportOpen(true)} disabled={duration <= 0}>
          Export
        </button>
      </header>

      {store.saveState === 'conflict' && (
        <div className="banner" role="alert">
          <span className="dot dot-failed" />
          This project was changed in another tab or device, so your latest edits were not saved.
          <span className="spacer" />
          <button className="btn" onClick={() => void store.reload()}>
            Load the latest version
          </button>
        </div>
      )}

      <div className="workspace">
        <nav className="rail" aria-label="Panels">
          {rail.map((r) => (
            <button key={r.id} aria-pressed={tab === r.id} onClick={() => setTab(r.id)}>
              {r.icon}
              {r.label}
            </button>
          ))}
        </nav>
        <LeftPanel tab={tab} store={store} projectId={projectId} playhead={playhead} onSelect={setSelection} notify={setToast} />
        <Viewer
          timeline={timeline}
          assets={store.assets}
          playhead={playhead}
          playing={playing}
          duration={duration}
          fps={project.settings.fps}
          onTogglePlay={togglePlay}
          onSeek={seek}
        />
        <Inspector store={store} projectId={projectId} selection={selection} onSelect={setSelection} notify={setToast} />
      </div>

      <Timeline
        timeline={timeline}
        assets={store.assets}
        playhead={playhead}
        duration={duration}
        selection={selection}
        onSelect={setSelection}
        onSeek={seek}
        preview={store.preview}
        commit={store.commit}
        onSplit={split}
        onDelete={deleteSelected}
      />

      {exportOpen && <ExportDialog store={store} projectId={projectId} duration={duration} onClose={() => setExportOpen(false)} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
