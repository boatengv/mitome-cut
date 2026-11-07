import { useEffect, useState, type MouseEvent } from 'react';
import { shortTime, type ProjectSummaryDTO, type UserDTO } from '@mitome/shared';
import { api, ApiError } from '../api';
import { navigate } from '../router';
import { IconPlus, IconTrash } from '../icons';

function relative(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function Projects({ user, onSignOut }: { user: UserDTO; onSignOut: () => void }) {
  const [projects, setProjects] = useState<ProjectSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .listProjects()
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load projects.'));
  }, []);

  async function create() {
    setCreating(true);
    try {
      const { project } = await api.createProject('Untitled project');
      navigate(`/p/${project.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create a project.');
      setCreating(false);
    }
  }

  async function remove(e: MouseEvent, p: ProjectSummaryDTO) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete “${p.title}”? This can’t be undone from the app.`)) return;
    await api.deleteProject(p.id);
    setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
  }

  const shown = (projects ?? []).filter((p) => p.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <header className="topbar">
        <span className="logo">
          <b>MITOME</b>
          <span>CUT</span>
        </span>
        <div className="spacer" />
        <label className="row input" style={{ width: 260, maxWidth: '100%' }}>
          <span className="sr-only">Search projects</span>
          <input
            type="search"
            placeholder="Search projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ border: 0, background: 'transparent', flex: 1, minWidth: 0, outlineOffset: 6 }}
          />
        </label>
        <span className="caption">{user.email}</span>
        <button className="btn btn-ghost" onClick={onSignOut}>
          Sign out
        </button>
      </header>
      <main className="projects">
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1>Projects</h1>
            <p className="muted" style={{ margin: 0 }}>
              Pick up where you left off, or start a new edit.
            </p>
          </div>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={create} disabled={creating}>
            <IconPlus size={14} /> New project
          </button>
        </div>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="project-grid">
          <button className="new-card" onClick={create} disabled={creating}>
            <span className="icon-btn" style={{ background: 'var(--surface-raised)', color: 'var(--text)' }}>
              <IconPlus />
            </span>
            <span style={{ color: 'var(--text)', fontWeight: 500 }}>Start a blank project</span>
            <span className="caption">16:9 · 1080p · 24 fps</span>
          </button>
          {projects === null && !error && <span className="caption">Loading…</span>}
          {shown.map((p) => (
            <a
              key={p.id}
              className="project-card"
              href={`/p/${p.id}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/p/${p.id}`);
              }}
            >
              <span className="project-thumb" style={p.thumbUrl ? { backgroundImage: `url("${p.thumbUrl}")` } : undefined}>
                {!p.thumbUrl && (
                  <span className="caption" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                    No scenes yet
                  </span>
                )}
                <span className="len tabular">{shortTime(p.durationSec)}</span>
              </span>
              <span className="project-meta">
                <span style={{ fontWeight: 600 }}>{p.title}</span>
                <span className="caption">
                  {p.sceneCount} {p.sceneCount === 1 ? 'scene' : 'scenes'} · Edited {relative(p.updatedAt)}
                </span>
              </span>
              <button className="icon-btn card-delete" aria-label={`Delete ${p.title}`} onClick={(e) => remove(e, p)}>
                <IconTrash size={14} />
              </button>
            </a>
          ))}
        </div>
      </main>
    </>
  );
}
