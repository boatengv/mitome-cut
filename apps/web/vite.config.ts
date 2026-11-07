import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in development, as in production: cookies just work.
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
