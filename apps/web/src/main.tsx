import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import { App } from './App';
import { navigate } from './router';
import './styles.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
if (!publishableKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY (see .env.example).');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={publishableKey}
      afterSignOutUrl="/"
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, true)}
      localization={{
        signIn: {
          start: { title: 'Sign in to Mitome Cut', subtitle: 'Welcome back. Sign in to keep editing.' },
        },
        signUp: {
          start: { title: 'Create your Mitome Cut account', subtitle: 'Start cutting your first episode.' },
        },
      }}
    >
      <App />
    </ClerkProvider>
  </StrictMode>,
);
