import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BODY_LIMIT_BYTES, checkOrigin, clientKey, handleExpand, jsonResponse, readBodyCapped } from './handler';
import { UNKNOWN_CLIENT_KEY } from './rate-limit';
import { ExpandResponseSchema } from './schema';
import { providerReply } from './test-support/fake-fetch';
import { SAME_ORIGIN, createRig, post, readResponse, streamOf, unreadableStream, type Rig } from './test-support/route-rig';

const VALID = JSON.stringify({ text: 'iwtgo', context: [{ role: 'partner', text: 'Do you need anything?' }] });
const encoder = new TextEncoder();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function expectError(rig: Rig, request: Request, status: number, error: string): Promise<void> {
  const response = await readResponse(await handleExpand(request, rig.deps));
  expect(response.status).toBe(status);
  expect(response.body).toStrictEqual({ error });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['content-type']).toBe('application/json');
  expect(rig.log).toHaveBeenCalledTimes(1);
  expect(rig.log).toHaveBeenCalledWith({ status, latencyMs: expect.any(Number) });
}

describe('handleExpand checks', () => {
  it.each([
    ['scheme', 'http://dit.test'],
    ['host', 'https://evil.test'],
    ['port', 'https://dit.test:8443'],
    ['null', 'null'],
  ])('answers 403 forbidden_origin for a different %s without counting or reading the body', async (_name, origin) => {
    const rig = createRig();
    await expectError(rig, post(unreadableStream(), { origin }), 403, 'forbidden_origin');
    expect(rig.limiter.counted()).toBe(0);
    expect(rig.fake.calls).toHaveLength(0);
  });

  it('passes a same-origin or absent Origin', async () => {
    const rig = createRig({ apiKey: undefined });
    await expectError(rig, post(VALID, { origin: SAME_ORIGIN }), 503, 'not_configured');
    const second = createRig({ apiKey: undefined });
    await expectError(second, post(VALID), 503, 'not_configured');
  });

  it('answers 429 rate_limited with Retry-After for the 31st request from one address', async () => {
    const rig = createRig({ apiKey: undefined });
    for (let i = 0; i < 30; i += 1) {
      const response = await handleExpand(post(VALID, { 'x-forwarded-for': '203.0.113.7' }), rig.deps);
      expect(response.status).not.toBe(429);
    }
    const limited = await handleExpand(post(unreadableStream(), { 'x-forwarded-for': '203.0.113.7' }), rig.deps);
    const parsed = await readResponse(limited);
    expect(parsed.status).toBe(429);
    expect(parsed.body).toStrictEqual({ error: 'rate_limited' });
    expect(parsed.headers['retry-after']).toBe('60');
    expect(rig.limiter.counted()).toBe(30);
    expect(rig.fake.calls).toHaveLength(0);
    const other = await handleExpand(post(VALID, { 'x-forwarded-for': '198.51.100.1' }), rig.deps);
    expect(other.status).toBe(503);
  });

  it('answers 413 for a Content-Length above 16,384 without reading the body', async () => {
    const rig = createRig();
    await expectError(rig, post(unreadableStream(), { 'content-length': '16385' }), 413, 'payload_too_large');
    expect(rig.limiter.counted()).toBe(1);
    expect(rig.fake.calls).toHaveLength(0);
  });

  it('answers 413 for a streamed body above 16,384 bytes without Content-Length', async () => {
    const rig = createRig();
    const padded = encoder.encode(VALID + ' '.repeat(BODY_LIMIT_BYTES + 1 - VALID.length));
    await expectError(rig, post(streamOf(padded)), 413, 'payload_too_large');
    expect(rig.fake.calls).toHaveLength(0);
  });

  it('accepts a body of exactly 16,384 bytes', async () => {
    const rig = createRig({ apiKey: undefined });
    const exact = encoder.encode(VALID + ' '.repeat(BODY_LIMIT_BYTES - VALID.length));
    expect(exact.byteLength).toBe(BODY_LIMIT_BYTES);
    await expectError(rig, post(streamOf(exact)), 503, 'not_configured');
  });

  it.each([
    ['an empty body', ''],
    ['invalid JSON', '{"text": '],
    ['empty text', JSON.stringify({ text: ' \n ', context: [] })],
    ['201 characters after trimming', JSON.stringify({ text: ` ${'a'.repeat(201)} `, context: [] })],
    ['11 Turns', JSON.stringify({ text: 'hi', context: Array.from({ length: 11 }, () => ({ role: 'partner', text: 'hi' })) })],
    ['a bad role', JSON.stringify({ text: 'hi', context: [{ role: 'system', text: 'hi' }] })],
    ['a JSON array', JSON.stringify(['hi'])],
  ])('answers 400 invalid_request for %s without echoing it', async (_name, body) => {
    const rig = createRig();
    const response = await handleExpand(post(body), rig.deps);
    const parsed = await readResponse(response);
    expect(parsed.status).toBe(400);
    expect(parsed.text).toBe('{"error":"invalid_request"}');
    expect(rig.fake.calls).toHaveLength(0);
  });

  it('answers 400 for a body that is not UTF-8', async () => {
    const rig = createRig();
    await expectError(rig, post(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])), 400, 'invalid_request');
  });

  it.each([undefined, ''])('answers 503 not_configured when the key is %j', async (apiKey) => {
    const rig = createRig({ apiKey });
    await expectError(rig, post(VALID), 503, 'not_configured');
    expect(rig.fake.calls).toHaveLength(0);
  });
});

describe('handleExpand provider outcomes', () => {
  it('answers 200 with the filtered suggestions', async () => {
    const rig = createRig();
    rig.fake.autoRespond(() => ({
      status: 200,
      body: providerReply('```json\n{"suggestions": ["I want to go outside.", "I would like to go out.", " I want to go out. "]}\n```'),
    }));
    const parsed = await readResponse(await handleExpand(post(VALID, { origin: SAME_ORIGIN }), rig.deps));
    expect(parsed.status).toBe(200);
    expect(parsed.body).toStrictEqual({ suggestions: ['I want to go outside.', 'I want to go out.'] });
    expect(ExpandResponseSchema.safeParse(parsed.body).success).toBe(true);
    expect(parsed.headers['cache-control']).toBe('no-store');
    expect(rig.fake.calls).toHaveLength(1);
    expect(rig.log).toHaveBeenCalledWith({ status: 200, latencyMs: 0 });
  });

  it('answers 200 with an empty list when nothing survives the filter', async () => {
    const rig = createRig();
    rig.fake.autoRespond(() => ({ status: 200, body: providerReply('I cannot help with that.') }));
    const parsed = await readResponse(await handleExpand(post(VALID), rig.deps));
    expect(parsed.status).toBe(200);
    expect(parsed.body).toStrictEqual({ suggestions: [] });
  });

  it.each([
    ['a non-success status', () => ({ status: 500, body: '{"error":{"message":"boom"}}' })],
    ['a missing message.content', () => ({ status: 200, body: '{"choices":[{"message":{}}]}' })],
  ])('answers 502 upstream_failed for %s', async (_name, responder) => {
    const rig = createRig();
    rig.fake.autoRespond(responder);
    const parsed = await readResponse(await handleExpand(post(VALID), rig.deps));
    expect(parsed.status).toBe(502);
    expect(parsed.text).toBe('{"error":"upstream_failed"}');
    expect(rig.fake.calls).toHaveLength(1);
  });

  it('answers 502 upstream_failed when fetch rejects', async () => {
    const rig = createRig();
    rig.fake.autoRespond((call) => {
      call.reject(new TypeError('fetch failed'));
      return undefined;
    });
    await expectError(rig, post(VALID), 502, 'upstream_failed');
    expect(rig.fake.calls).toHaveLength(1);
  });

  it('answers 504 upstream_timeout at 4,000 ms and aborts the provider request', async () => {
    const rig = createRig();
    const pending = handleExpand(post(VALID), rig.deps);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(rig.fake.calls).toHaveLength(1);
    expect(rig.fake.calls[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const parsed = await readResponse(await pending);
    expect(parsed.status).toBe(504);
    expect(parsed.body).toStrictEqual({ error: 'upstream_timeout' });
    expect(rig.fake.calls[0]?.signal?.aborted).toBe(true);
    expect(rig.log).toHaveBeenCalledWith({ status: 504, latencyMs: 4_000 });
  });

  it('answers 504 when the provider would settle at exactly 4,000 ms', async () => {
    const rig = createRig();
    rig.fake.autoRespond((call) => {
      setTimeout(() => call.resolve(200, providerReply('{"suggestions": ["I want to go outside."]}')), 4_000);
      return undefined;
    });
    const pending = handleExpand(post(VALID), rig.deps);
    await vi.advanceTimersByTimeAsync(4_000);
    expect((await pending).status).toBe(504);
  });

  it('keeps only suggestions whose initials match an initials request', async () => {
    const rig = createRig();
    rig.fake.autoRespond(() => ({ status: 200, body: providerReply('{"suggestions": ["I want to go outside.", "Please open the window."]}') }));
    const parsed = await readResponse(await handleExpand(post(VALID), rig.deps));
    expect(parsed.body).toStrictEqual({ suggestions: ['I want to go outside.'] });
  });
});

describe('request-check helpers', () => {
  it('compares origins by scheme, host and effective port', () => {
    expect(checkOrigin(null, 'https://dit.test/api/expand')).toBe(true);
    expect(checkOrigin('https://DIT.test:443', 'https://dit.test/api/expand')).toBe(true);
    expect(checkOrigin('https://dit.test/', 'https://dit.test/api/expand')).toBe(true);
    expect(checkOrigin('https://dit.test/path', 'https://dit.test/api/expand')).toBe(false);
    expect(checkOrigin('https://user@dit.test', 'https://dit.test/api/expand')).toBe(false);
    expect(checkOrigin('not a url', 'https://dit.test/api/expand')).toBe(false);
    expect(checkOrigin('file:///', 'https://dit.test/api/expand')).toBe(false);
  });

  it('keys clients by x-forwarded-for, then x-real-ip, then one shared key', () => {
    expect(clientKey(new Headers({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1', 'x-real-ip': '198.51.100.1' }))).toBe('203.0.113.7');
    expect(clientKey(new Headers({ 'x-forwarded-for': ' , 10.0.0.1', 'x-real-ip': ' 198.51.100.1 ' }))).toBe('198.51.100.1');
    expect(clientKey(new Headers({ 'x-real-ip': '198.51.100.1' }))).toBe('198.51.100.1');
    expect(clientKey(new Headers({ 'x-forwarded-for': '', 'x-real-ip': '  ' }))).toBe(UNKNOWN_CLIENT_KEY);
    expect(clientKey(new Headers())).toBe(UNKNOWN_CLIENT_KEY);
  });

  it('reads a missing body as 0 bytes and stops just past the limit', async () => {
    expect(await readBodyCapped(new Request('https://dit.test/api/expand', { method: 'POST' }), 10)).toStrictEqual({
      ok: true,
      bytes: new Uint8Array(0),
    });
    expect(await readBodyCapped(post(streamOf(new Uint8Array(11), 3)), 10)).toStrictEqual({ ok: false });
    const exact = await readBodyCapped(post(streamOf(new Uint8Array(10), 3)), 10);
    expect(exact.ok && exact.bytes.byteLength).toBe(10);
  });

  it('builds JSON responses that are never cached', async () => {
    const response = jsonResponse(429, { error: 'rate_limited' }, { 'Retry-After': '5' });
    expect(Object.fromEntries(response.headers.entries())).toStrictEqual({
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'retry-after': '5',
    });
    expect(await response.text()).toBe('{"error":"rate_limited"}');
  });
});
