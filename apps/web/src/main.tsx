import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-react';
import { navigate, usePath } from './router';
import { Login } from './pages/Login';

/*
 * Clerk owns sign-in. Signed out, this renders the sign-in page. Signed in, it hands
 * Backend (public/backend.js) a token getter and the editor (public/app.js) starts.
 */

declare global {
  interface Window {
    Backend: {
      start(auth: { getToken: () => Promise<string | null>; signOut: () => Promise<void>; email: string }): void;
    };
  }
}

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
if (!publishableKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY (see .env.example).');

let started = false;

function Gate() {
  const path = usePath();
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const { user } = useUser();
  const shell = document.getElementById('shell');

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn && /^\/sign-(in|up)/.test(path)) navigate('/', true);
    if (isSignedIn && user && !started) {
      started = true;
      window.Backend.start({
        getToken: () => getToken(),
        signOut: () => signOut({ redirectUrl: '/sign-in' }),
        email: user.primaryEmailAddress?.emailAddress ?? '',
      });
    }
    if (shell) shell.hidden = !isSignedIn;
  }, [isLoaded, isSignedIn, user, path, getToken, signOut, shell]);

  if (!isLoaded || isSignedIn) return null;
  return <Login />;
}

createRoot(document.getElementById('auth-root')!).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={publishableKey}
      afterSignOutUrl="/sign-in"
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, true)}
      localization={{
        signIn: { start: { title: 'Sign in to Mitome Cut', subtitle: 'Welcome back. Sign in to keep editing.' } },
        signUp: { start: { title: 'Create your Mitome Cut account', subtitle: 'Start cutting your first episode.' } },
      }}
    >
      <Gate />
    </ClerkProvider>
  </StrictMode>,
);
