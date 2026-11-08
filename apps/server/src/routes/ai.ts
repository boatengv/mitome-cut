import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { falJobBody, llmBody, ttsBody, type AiConfigDTO, type AiJobDTO } from '@mitome/shared';
import { config } from '../config.js';
import { db, schema } from '../db/client.js';
import { requireUser } from '../auth.js';
import { HttpError, parse } from '../http.js';
import { enqueue, QUEUES } from '../queue.js';
import { assertDailyLimit, claude, elevenTts, falRun } from '../ai.js';

function jobDTO(j: typeof schema.aiJobs.$inferSelect): AiJobDTO {
  return { id: j.id, status: j.status, message: j.message, output: j.status === 'succeeded' ? j.output : null, error: j.error };
}

export async function aiRoutes(app: FastifyInstance) {
  app.get('/api/ai/config', async (req) => {
    requireUser(req);
    const body: AiConfigDTO = {
      fal: !!config.FAL_KEY,
      elevenlabs: !!config.ELEVENLABS_API_KEY,
      anthropic: !!config.ANTHROPIC_API_KEY,
      limits: {
        videoPerDay: config.VIDEO_JOBS_PER_DAY,
        imagePerDay: config.IMAGE_JOBS_PER_DAY,
        ttsCharsPerDay: config.TTS_CHARS_PER_DAY,
        llmPerDay: config.LLM_CALLS_PER_DAY,
      },
    };
    return body;
  });

  /**
   * Queues a fal.ai request (video, asset image or storyboard sketch). The
   * worker submits it and polls; the editor polls GET /api/ai/jobs/:id.
   * Start frames arrive as data URLs, so the body limit is generous.
   */
  app.post('/api/ai/fal', { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const user = requireUser(req);
    const body = parse(falJobBody, req.body);
    if (!config.FAL_KEY) throw new HttpError(503, 'fal_off', 'fal.ai is not configured on this server. Ask the admin to set FAL_KEY.');
    await assertDailyLimit(user.id, body.purpose);
    const [job] = await db
      .insert(schema.aiJobs)
      .values({
        ownerId: user.id,
        projectId: body.projectId ?? null,
        purpose: body.purpose,
        provider: 'fal',
        model: body.model,
        input: body.input,
        message: 'Queued',
      })
      .returning();
    await enqueue(QUEUES.aiJob, { jobId: job!.id });
    return reply.code(201).send({ job: jobDTO(job!) });
  });

  app.get<{ Params: { id: string } }>('/api/ai/jobs/:id', async (req) => {
    const user = requireUser(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new HttpError(404, 'not_found', 'Job not found.');
    const [job] = await db
      .select()
      .from(schema.aiJobs)
      .where(and(eq(schema.aiJobs.id, req.params.id), eq(schema.aiJobs.ownerId, user.id)))
      .limit(1);
    if (!job) throw new HttpError(404, 'not_found', 'Job not found.');
    return { job: jobDTO(job) };
  });

  app.post<{ Params: { id: string } }>('/api/ai/jobs/:id/cancel', async (req) => {
    const user = requireUser(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new HttpError(404, 'not_found', 'Job not found.');
    await db
      .update(schema.aiJobs)
      .set({ status: 'canceled', message: 'Stopped', completedAt: new Date() })
      .where(
        and(
          eq(schema.aiJobs.id, req.params.id),
          eq(schema.aiJobs.ownerId, user.id),
          sql`${schema.aiJobs.status} in ('queued', 'running')`,
        ),
      );
    return { ok: true };
  });

  /** Voiceover: returns MP3 bytes, which the editor stores like any other file. */
  app.post('/api/ai/tts', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(ttsBody, req.body);
    await assertDailyLimit(user.id, 'tts', body.text.length);
    const [job] = await db
      .insert(schema.aiJobs)
      .values({
        ownerId: user.id,
        purpose: 'tts',
        provider: 'elevenlabs',
        model: body.model,
        input: { voice: body.voice, chars: body.text.length },
        units: body.text.length,
        status: 'running',
      })
      .returning({ id: schema.aiJobs.id });
    try {
      const audio = await elevenTts(body.voice, body.model, body.text);
      await db.update(schema.aiJobs).set({ status: 'succeeded', completedAt: new Date() }).where(eq(schema.aiJobs.id, job!.id));
      return reply.type('audio/mpeg').send(audio);
    } catch (err) {
      await db
        .update(schema.aiJobs)
        .set({ status: 'failed', error: (err as Error).message.slice(0, 500), completedAt: new Date() })
        .where(eq(schema.aiJobs.id, job!.id));
      throw err;
    }
  });

  /** Prompt AI: finds assets in a script and writes scene prompts. */
  app.post('/api/ai/llm', { bodyLimit: 1024 * 1024 }, async (req) => {
    const user = requireUser(req);
    const body = parse(llmBody, req.body);
    await assertDailyLimit(user.id, 'llm');
    const [job] = await db
      .insert(schema.aiJobs)
      .values({ ownerId: user.id, purpose: 'llm', provider: body.provider, model: body.model, status: 'running' })
      .returning({ id: schema.aiJobs.id });
    try {
      let text: string;
      if (body.provider === 'anthropic') text = await claude(body.model, body.system, body.user);
      else {
        const out = await falRun('fal-ai/any-llm', { model: body.model, system_prompt: body.system, prompt: body.user });
        text = String(out.output ?? out.text ?? JSON.stringify(out));
      }
      await db.update(schema.aiJobs).set({ status: 'succeeded', completedAt: new Date() }).where(eq(schema.aiJobs.id, job!.id));
      return { text };
    } catch (err) {
      await db
        .update(schema.aiJobs)
        .set({ status: 'failed', error: (err as Error).message.slice(0, 500), completedAt: new Date() })
        .where(eq(schema.aiJobs.id, job!.id));
      throw err;
    }
  });
}
