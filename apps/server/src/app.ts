import Fastify, { type FastifyError } from 'fastify';
import { clerkPlugin } from '@clerk/fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { config } from './config.js';
import { db } from './db/client.js';
import { loadUser } from './auth.js';
import { HttpError } from './http.js';
import { authRoutes } from './routes/auth.js';
import { libraryRoutes } from './routes/library.js';
import { aiRoutes } from './routes/ai.js';
import { exportRoutes } from './routes/exports.js';
import { localStorageRoutes } from './routes/storage.js';

export async function buildApp() {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  // Treat an empty JSON body as {} so action endpoints (POST …/complete) need no body.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (!text.trim()) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error('Body is not valid JSON') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  fs.mkdirSync(config.localStorageDir, { recursive: true });
  // Decorates reply.sendFile (Range support) for local storage and the SPA.
  await app.register(fastifyStatic, { root: config.localStorageDir, serve: false });

  // Verifies the Clerk session token on every request; must be registered before loadUser runs.
  await app.register(clerkPlugin, {
    hookName: 'onRequest',
    publishableKey: config.CLERK_PUBLISHABLE_KEY,
    secretKey: config.CLERK_SECRET_KEY,
  });

  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/')) await loadUser(req);
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
  });

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({
      error: status === 429 ? 'rate_limited' : status >= 500 ? 'internal_error' : 'bad_request',
      message: status >= 500 ? 'Something went wrong on our side.' : err.message,
    });
  });

  app.get('/api/health', async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });

  await app.register(authRoutes);
  await app.register(libraryRoutes);
  await app.register(aiRoutes);
  await app.register(exportRoutes);
  await app.register(localStorageRoutes);

  // Optionally serve the built web app (single-container deploys).
  const webDist = config.WEB_DIST_DIR ? path.resolve(config.WEB_DIST_DIR) : null;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      decorateReply: false,
      wildcard: false,
      maxAge: '1h',
    });
  }

  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url.startsWith('/api/') || req.url.startsWith('/storage/');
    if (!isApi && webDist && req.method === 'GET') {
      return reply.type('text/html').sendFile('index.html', webDist);
    }
    return reply.code(404).send({ error: 'not_found', message: 'Not found' });
  });

  return app;
}
