import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_URL ?? 'http://localhost:3000';
// TEST ONLY: CLERK_STUB=1 swaps Clerk for scripts/clerk-stub and builds into dist-stub/.
const stub = process.env.CLERK_STUB === '1';

// The sign-in page is React + Clerk (src/). The editor itself is plain HTML/CSS/JS in public/
// (app.js, backend.js, styles.css) and starts once Clerk reports a session.
export default defineConfig({
  plugins: [react()],
  resolve: stub ? { alias: { '@clerk/clerk-react': new URL('../../scripts/clerk-stub/react.tsx', import.meta.url).pathname } } : undefined,
  // Read the shared repo-root .env (only VITE_-prefixed values reach the browser).
  envDir: '../..',
  server: {
    port: 5173,
    // Same-origin in development, as in production.
    proxy: { '/api': api, '/storage': api },
  },
  build: { outDir: stub ? 'dist-stub' : 'dist', sourcemap: true },
});
