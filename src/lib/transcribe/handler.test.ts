import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeSpeechWav } from './audio';
import { createRateLimiter } from '@/lib/expansion/rate-limit';
import type { ExpandDeps } from '@/lib/expansion/handler';
import { AUDIO_LIMIT_BYTES, handleTranscribe, TRANSCRIBE_BASE_URL, TRANSCRIBE_MODEL, TRANSCRIBE_TIMEOUT_MS } from './handler';

function rig(overrides: Partial<ExpandDeps['env']> = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ text: ' Do you need anything? ' }));
  const log = vi.fn();
  const deps: ExpandDeps = {
    env: { apiKey: 'private-test-key', baseUrl: undefined, model: undefined, ...overrides },
    fetch, log, now: () => 1000,
    rateLimiter: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) },
  };
  return { deps, fetch, log };
}
const CLIP = encodeSpeechWav([new Float32Array(160)], 16_000);
function post(body: BodyInit = CLIP, headers: Record<string, string> = {}) {
  return new Request('https://dit.test/api/transcribe', {
    method: 'POST', body, headers: { origin: 'https://dit.test', 'content-type': 'audio/wav', ...headers },
    ...{ duplex: 'half' },
  });
}
afterEach(() => vi.useRealTimers());

describe('transcription route trust boundary', () => {
  it.each([null, 'https://foreign.test', 'null'])('rejects missing or foreign Origin %s before reading or calling upstream', async (origin) => {
    const { deps, fetch, log } = rig();
    const request = post(new ReadableStream({ pull() { throw new Error('must not read'); } }));
    if (origin === null) request.headers.delete('origin'); else request.headers.set('origin', origin);
    const response = await handleTranscribe(request, deps);
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith({ status: 403, latencyMs: 0 });
  });

  it('reuses the LAN Host origin check and returns 503 with no key', async () => {
    const { deps, fetch } = rig({ apiKey: '' });
    const request = new Request('http://localhost:3125/api/transcribe', {
      method: 'POST', body: CLIP, headers: { host: '192.168.1.10:3125', origin: 'http://192.168.1.10:3125', 'content-type': 'audio/wav' },
    });
    const response = await handleTranscribe(request, deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'not_configured' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('limits each IP separately, with Retry-After on the 31st request', async () => {
    const { deps } = rig({ apiKey: '' });
    for (let i = 0; i < 30; i++) expect((await handleTranscribe(post(), deps)).status).toBe(503);
    const response = await handleTranscribe(post(), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect((await handleTranscribe(post(CLIP, { 'x-real-ip': '198.51.100.2' }), deps)).status).toBe(503);
  });

  it.each(['declared', 'streamed'])('caps %s audio at 1 MiB before calling upstream', async (kind) => {
    const { deps, fetch } = rig();
    const request = kind === 'declared'
      ? post('x', { 'content-length': String(AUDIO_LIMIT_BYTES + 1) })
      : post(new Uint8Array(AUDIO_LIMIT_BYTES + 1));
    expect((await handleTranscribe(request, deps)).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([['', 'audio/webm'], ['text', 'text/plain']])('rejects empty or unsupported audio', async (body, type) => {
    const { deps, fetch } = rig();
    expect((await handleTranscribe(post(body, { 'content-type': type! }), deps)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects audio over 30 seconds even below the byte cap', async () => {
    const { deps, fetch } = rig();
    const long = encodeSpeechWav([new Float32Array(31 * 16_000)], 16_000);
    expect(long.byteLength).toBeLessThan(AUDIO_LIMIT_BYTES);
    expect((await handleTranscribe(post(long), deps)).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts multipart to the audio host, returns only text, and logs only status and latency', async () => {
    const { deps, fetch, log } = rig();
    const response = await handleTranscribe(post(), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: 'Do you need anything?' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${TRANSCRIBE_BASE_URL}/audio/transcriptions`);
    expect(init?.headers).toEqual({ Authorization: 'Bearer private-test-key' });
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get('model')).toBe(TRANSCRIBE_MODEL);
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(form.get('response_format')).toBe('json');
    expect(log).toHaveBeenCalledExactlyOnceWith({ status: 200, latencyMs: 0 });
  });

  it('supports an explicit transcription endpoint and model independent of chat', async () => {
    const { deps, fetch } = rig({ baseUrl: 'https://speech.test/v1/', model: 'whisper-test' });
    await handleTranscribe(post(), deps);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://speech.test/v1/audio/transcriptions');
    expect((fetch.mock.calls[0]?.[1]?.body as FormData).get('model')).toBe('whisper-test');
  });

  it.each([401, 503])('hides upstream status %s and its body', async (status) => {
    const { deps, fetch } = rig();
    fetch.mockResolvedValue(new Response('private upstream failure', { status }));
    const response = await handleTranscribe(post(), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'upstream_failed' });
  });

  it.each([{}, { text: 123 }])('rejects malformed upstream output', async (reply) => {
    const { deps, fetch } = rig();
    fetch.mockResolvedValue(Response.json(reply));
    expect((await handleTranscribe(post(), deps)).status).toBe(502);
  });

  it('bounds the complete upstream response, aborting at the deadline', async () => {
    vi.useFakeTimers();
    const { deps, fetch } = rig();
    let signal: AbortSignal | null | undefined;
    fetch.mockImplementation(async (_url, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream());
    });
    const pending = handleTranscribe(post(), deps);
    await vi.advanceTimersByTimeAsync(TRANSCRIBE_TIMEOUT_MS);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(signal?.aborted).toBe(true);
    expect(await response.json()).toEqual({ error: 'upstream_timeout' });
  });
});
