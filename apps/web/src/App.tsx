import { useCallback, useEffect, useState } from 'react';
import type { UserDTO } from '@mitome/shared';
import { api, ApiError } from './api';
import { usePath } from './router';
import { Login } from './pages/Login';
import { Projects } from './pages/Projects';
import { Editor } from './pages/Editor';

export function App() {
  const path = usePath();
  const [user, setUser] = useState<UserDTO | null | undefined>(undefined);

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch((e) => setUser(e instanceof ApiError && e.status === 401 ? null : null));
  }, []);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  }, []);

  if (user === undefined) return <div className="auth caption">Loading…</div>;
  if (user === null) return <Login onSignedIn={setUser} />;

  const editorMatch = /^\/p\/([0-9a-f-]{36})$/i.exec(path);
  if (editorMatch) return <Editor key={editorMatch[1]} projectId={editorMatch[1]!} />;
  return <Projects user={user} onSignOut={signOut} />;
}
