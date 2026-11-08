// Bundles the API and worker (and the shared package) into dist/ for production.
// `node build.mjs --stub` builds a TEST-ONLY copy into dist-stub/ with Clerk replaced by
// scripts/clerk-stub (see README → Checks). Production images only ever copy dist/.
import { build } from 'esbuild';

const stub = process.argv.includes('--stub');

await build({
  entryPoints: ['src/api.ts', 'src/worker.ts', 'src/migrate-cli.ts'],
  outdir: stub ? 'dist-stub' : 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Keep node_modules external; the runtime image installs production deps.
  packages: 'external',
  // ...except our own workspace package, which ships as TypeScript source.
  alias: {
    '@mitome/shared': '../../packages/shared/src/index.ts',
    ...(stub ? { '@clerk/fastify': '../../scripts/clerk-stub/fastify.mjs' } : {}),
  },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
