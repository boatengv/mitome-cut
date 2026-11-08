import { and, count, eq, gt, sum } from 'drizzle-orm';
import { config } from './config.js';
import { db, schema } from './db/client.js';
import { HttpError } from './http.js';

/**
 * Thin clients for the AI providers. Keys come from the environment and never
 * leave the server. Base URLs are configurable so tests can point at mocks.
 */

const since24h = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

export async function assertDailyLimit(ownerId: string, purpose: 'video' | 'image' | 'sketch' | 'llm' | 'tts', addUnits = 0) {
  const where = and(eq(schema.aiJobs.ownerId, ownerId), gt(schema.aiJobs.createdAt, since24h()));
  if (purpose === 'tts') {
    const [r] = await db
      .select({ n: sum(schema.aiJobs.units) })
      .from(schema.aiJobs)
      .where(and(where, eq(schema.aiJobs.purpose, 'tts')));
    if (Number(r?.n ?? 0) + addUnits > config.TTS_CHARS_PER_DAY) {
      throw new HttpError(429, 'tts_limit', `Daily voiceover limit reached (${config.TTS_CHARS_PER_DAY} characters).`);
    }
    return;
  }
  const purposes = purpose === 'image' || purpose === 'sketch' ? (['image', 'sketch'] as const) : ([purpose] as const);
  let n = 0;
  for (const p of purposes) {
    const [r] = await db
      .select({ n: count() })
      .from(schema.aiJobs)
      .where(and(where, eq(schema.aiJobs.purpose, p)));
    n += r?.n ?? 0;
  }
  const limit = purpose === 'video' ? config.VIDEO_JOBS_PER_DAY : purpose === 'llm' ? config.LLM_CALLS_PER_DAY : config.IMAGE_JOBS_PER_DAY;
  const label = purpose === 'video' ? 'video generations' : purpose === 'llm' ? 'Prompt AI calls' : 'image generations';
  if (n >= limit) throw new HttpError(429, 'ai_limit', `Daily limit reached: ${limit} ${label} per 24 hours.`);
}

async function readError(r: Response) {
  const text = await r.text().catch(() => '');
  return text.slice(0, 400);
}

/* ---------------- fal.ai ---------------- */

interface FalSubmit {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url?: string;
}

function falHeaders() {
  if (!config.FAL_KEY) throw new HttpError(503, 'fal_off', 'fal.ai is not configured on this server.');
  return { Authorization: `Key ${config.FAL_KEY}`, 'Content-Type': 'application/json' };
}

export async function falSubmit(model: string, input: Record<string, unknown>): Promise<FalSubmit> {
  const r = await fetch(`${config.FAL_QUEUE_URL}/${model}`, { method: 'POST', headers: falHeaders(), body: JSON.stringify(input) });
  if (!r.ok) throw new Error(`fal.ai ${r.status}: ${await readError(r)}`);
  const j = (await r.json()) as FalSubmit;
  if (!j.status_url || !j.response_url) throw new Error('Unexpected fal.ai response');
  return j;
}

export async function falStatus(statusUrl: string) {
  const r = await fetch(statusUrl, { headers: falHeaders() });
  if (!r.ok) throw new Error(`fal.ai status ${r.status}: ${await readError(r)}`);
  return (await r.json()) as { status?: string; queue_position?: number; error?: string };
}

export async function falResult(responseUrl: string) {
  const r = await fetch(responseUrl, { headers: falHeaders() });
  if (!r.ok) throw new Error(`fal.ai result ${r.status}: ${await readError(r)}`);
  return (await r.json()) as unknown;
}

export async function falCancel(cancelUrl: string | undefined) {
  if (!cancelUrl || !config.FAL_KEY) return;
  await fetch(cancelUrl, { method: 'PUT', headers: falHeaders() }).catch(() => undefined);
}

/** Synchronous fal call for quick models (the any-llm text endpoint). */
export async function falRun(model: string, input: Record<string, unknown>, timeoutMs = 120_000) {
  const r = await fetch(`${config.FAL_RUN_URL}/${model}`, {
    method: 'POST',
    headers: falHeaders(),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`fal.ai ${r.status}: ${await readError(r)}`);
  return (await r.json()) as Record<string, unknown>;
}

/* ---------------- ElevenLabs ---------------- */

export async function elevenTts(voice: string, model: string, text: string): Promise<Buffer> {
  if (!config.ELEVENLABS_API_KEY) throw new HttpError(503, 'elevenlabs_off', 'ElevenLabs is not configured on this server.');
  const r = await fetch(`${config.ELEVENLABS_URL}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': config.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new HttpError(502, 'elevenlabs_error', `ElevenLabs ${r.status}: ${await readError(r)}`);
  return Buffer.from(await r.arrayBuffer());
}

/* ---------------- Anthropic ---------------- */

export async function claude(model: string, system: string, user: string): Promise<string> {
  if (!config.ANTHROPIC_API_KEY) throw new HttpError(503, 'anthropic_off', 'The Claude API is not configured on this server.');
  const r = await fetch(`${config.ANTHROPIC_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': config.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4000, system, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new HttpError(502, 'anthropic_error', `Claude API ${r.status}: ${await readError(r)}`);
  const j = (await r.json()) as { content?: { text?: string }[] };
  return (j.content ?? []).map((c) => c.text ?? '').join('');
}
