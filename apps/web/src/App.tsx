import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import type { UserDTO } from '@mitome/shared';
import { api, setTokenGetter } from './api';
import { navigate, usePath } from './router';
import { Login } from './pages/Login';
import { Projects } from './pages/Projects';
import { Editor } from './pages/Editor';

export function App() {
  const path = usePath();
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const [user, setUser] = useState<UserDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Signed in: leave the auth URLs behind.
  useEffect(() => {
    if (isSignedIn && /^\/sign-(in|up)/.test(path)) navigate('/', true);
  }, [isSignedIn, path]);

  useEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setUser(null);
      return;
    }
    let cancelled = false;
    setError(null);
    api
      .me()
      .then((r) => !cancelled && setUser(r.user))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) return <div className="auth caption">Loading…</div>;
  if (!isSignedIn) return <Login />;
  if (error) return <div className="auth caption">{error}</div>;
  if (!user) return <div className="auth caption">Loading…</div>;

  const editorMatch = /^\/p\/([0-9a-f-]{36})$/i.exec(path);
  if (editorMatch) return <Editor key={editorMatch[1]} projectId={editorMatch[1]!} />;
  return <Projects user={user} onSignOut={() => void signOut()} />;
}
