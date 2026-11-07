import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { config } from '../config.js';
import { localStorage, safeKey, verifyLocal } from '../storage/index.js';

/**
 * Serves signed upload/download URLs for the local disk driver, standing in
 * for R2/MinIO during development. Not registered when STORAGE_DRIVER=s3.
 */
export async function localStorageRoutes(app: FastifyInstance) {
  if (!localStorage) return;
  const store = localStorage;

  // Uploads are raw bodies of any type: hand the stream to the handler untouched.
  app.addContentTypeParser('*', (_req, _payload, done) => done(null));

  const check = (method: 'GET' | 'PUT', key: string, q: Record<string, string | undefined>) => {
    const exp = Number(q.exp);
    if (q.m !== method || !q.sig || !Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    return verifyLocal([method, key, String(q.exp), q.ct ?? '', q.dl ?? ''], q.sig);
  };

  app.put<{ Params: { '*': string }; Querystring: Record<string, string | undefined> }>(
    '/storage/*',
    { bodyLimit: config.maxUploadBytes },
    async (req, reply) => {
      let key: string;
      try {
        key = safeKey(req.params['*']);
      } catch {
        return reply.code(400).send({ error: 'invalid_key', message: 'Invalid key' });
      }
      if (!check('PUT', key, req.query)) return reply.code(403).send({ error: 'forbidden', message: 'Bad signature' });
      if ((req.headers['content-type'] ?? '') !== (req.query.ct ?? '')) {
        return reply.code(400).send({ error: 'content_type', message: 'Content-Type does not match the signed URL' });
      }
      try {
        await store.putStream(key, req.raw, config.maxUploadBytes);
      } catch (err) {
        return reply.code(413).send({ error: 'too_large', message: (err as Error).message });
      }
      return reply.code(200).send();
    },
  );

  app.get<{ Params: { '*': string }; Querystring: Record<string, string | undefined> }>('/storage/*', async (req, reply) => {
    let key: string;
    try {
      key = safeKey(req.params['*']);
    } catch {
      return reply.code(400).send({ error: 'invalid_key', message: 'Invalid key' });
    }
    if (!check('GET', key, req.query)) return reply.code(403).send({ error: 'forbidden', message: 'Bad signature' });
    if (req.query.dl) {
      reply.header('Content-Disposition', `attachment; filename="${req.query.dl.replace(/"/g, '')}"`);
    }
    reply.header('Cache-Control', 'private, max-age=3600');
    // @fastify/static handles Range requests, which video seeking needs.
    return reply.sendFile(key, path.resolve(config.localStorageDir));
  });
}
