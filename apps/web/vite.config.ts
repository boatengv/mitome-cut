import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  // Read the shared repo-root .env (only VITE_-prefixed values reach the browser).
  envDir: '../..',
  server: {
    port: 5173,
    // Same-origin in development, as in production.
    proxy: {
      '/api': api,
      '/storage': api,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
