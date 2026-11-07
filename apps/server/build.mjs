// Bundles the API and worker (and the shared package) into dist/ for production.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/api.ts', 'src/worker.ts', 'src/migrate-cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Keep node_modules external; the runtime image installs production deps.
  packages: 'external',
  // ...except our own workspace package, which ships as TypeScript source.
  alias: { '@mitome/shared': '../../packages/shared/src/index.ts' },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
