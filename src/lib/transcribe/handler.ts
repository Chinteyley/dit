/** Same trust boundary as expansion; audio and transcripts live only for this request. */
import { z } from 'zod';
import { MAX_AUDIO_MS, wavDurationMs } from './audio';
import { runWithDeadline } from '@/lib/expansion/deadline';
import { checkOrigin, clientKey, jsonResponse, readBodyCapped, type ExpandDeps } from '@/lib/expansion/handler';

export const AUDIO_LIMIT_BYTES = 1_048_576;
export const TRANSCRIBE_TIMEOUT_MS = 15_000;
// Groq's OpenAI-compatible speech API; Fireworks retired audio inference on 2026-06-10.
export const TRANSCRIBE_BASE_URL = 'https://api.groq.com/openai/v1';
export const TRANSCRIBE_MODEL = 'whisper-large-v3-turbo';
const Reply = z.object({ text: z.string().max(16_384) });
const AUDIO_TYPES: Readonly<Record<string, string>> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

async function respond(request: Request, deps: ExpandDeps): Promise<Response> {
  const error = (status: number, code: string, headers?: Record<string, string>) =>
    jsonResponse(status, { error: code }, headers);
  if (!checkOrigin(request.headers.get('origin'), request.url, request.headers)) return error(403, 'forbidden_origin');
  const decision = deps.rateLimiter.check(clientKey(request.headers), deps.now());
  if (!decision.allowed) return error(429, 'rate_limited', { 'Retry-After': String(decision.retryAfterSeconds) });
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > AUDIO_LIMIT_BYTES) {
    return error(413, 'payload_too_large');
  }
  // Raw audio avoids multipart overhead and a second unbounded body parser.
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  const extension = AUDIO_TYPES[type];
  if (extension === undefined) return error(400, 'invalid_request');
  const body = await readBodyCapped(request, AUDIO_LIMIT_BYTES);
  if (!body.ok) return error(413, 'payload_too_large');
  const duration = wavDurationMs(body.bytes);
  if (duration === null) return error(400, 'invalid_request');
  if (duration > MAX_AUDIO_MS) return error(413, 'payload_too_large');
  const key = deps.env.apiKey;
  if (!key) return error(503, 'not_configured');
  const outcome = await runWithDeadline(async (signal) => {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(body.bytes)], { type }), `utterance.${extension}`);
    form.set('model', deps.env.model || TRANSCRIBE_MODEL);
    form.set('response_format', 'json');
    const base = (deps.env.baseUrl || TRANSCRIBE_BASE_URL).replace(/\/+$/, '');
    const response = await deps.fetch(`${base}/audio/transcriptions`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const reply = await readBodyCapped(new Request('https://transcribe.invalid', {
      method: 'POST', body: response.body, ...{ duplex: 'half' },
    }), 65_536);
    if (!reply.ok) return undefined;
    const parsed = Reply.safeParse(JSON.parse(new TextDecoder().decode(reply.bytes)));
    return parsed.success ? parsed.data.text.trim() : undefined;
  }, { ms: TRANSCRIBE_TIMEOUT_MS, timers: deps.timers, signal: request.signal });
  if (outcome.kind === 'timeout') return error(504, 'upstream_timeout');
  if (outcome.kind !== 'ok' || outcome.value === undefined) return error(502, 'upstream_failed');
  return jsonResponse(200, { text: outcome.value });
}

export async function handleTranscribe(request: Request, deps: ExpandDeps): Promise<Response> {
  const started = deps.now();
  let response: Response;
  try {
    response = await respond(request, deps);
  } catch {
    response = jsonResponse(502, { error: 'upstream_failed' });
  }
  deps.log({ status: response.status, latencyMs: Math.max(0, Math.round(deps.now() - started)) });
  return response;
}
