import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Timers } from './deadline';
import type { ChatMessage } from './prompt';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_MODEL_REASONING_EFFORT,
  MAX_OUTPUT_TOKENS,
  SERVER_TIMEOUT_MS,
  callProvider,
  providerRequestBody,
  providerUrl,
  resolveModel,
} from './provider';
import { createFakeFetch, providerReply } from './test-support/fake-fetch';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const messages: readonly [ChatMessage, ChatMessage] = [
  { role: 'system', content: 'system prompt' },
  { role: 'user', content: 'user message' },
];

const timers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('constants', () => {
  it('uses DeepSeek V4.1 Flash on Fireworks serverless with thinking off, 200 tokens and 4 s', () => {
    expect(DEFAULT_MODEL).toMatch(/^accounts\/fireworks\/models\/deepseek-v4p1-flash-\d+$/);
    expect(DEFAULT_MODEL_REASONING_EFFORT).toBe('none');
    expect(DEFAULT_BASE_URL).toBe('https://api.fireworks.ai/inference/v1');
    expect(MAX_OUTPUT_TOKENS).toBe(200);
    expect(SERVER_TIMEOUT_MS).toBe(4_000);
  });

  it('spells the default model ID out in provider.ts only', () => {
    const files = listFiles(srcDir).filter((path) => readFileSync(path, 'utf8').includes(DEFAULT_MODEL));
    expect(files.map((path) => relative(srcDir, path).split('\\').join('/'))).toStrictEqual(['lib/expansion/provider.ts']);
  });
});

describe('providerUrl', () => {
  it('uses the Fireworks default for an unset or empty base URL', () => {
    expect(providerUrl(undefined)).toBe('https://api.fireworks.ai/inference/v1/chat/completions');
    expect(providerUrl('')).toBe('https://api.fireworks.ai/inference/v1/chat/completions');
  });

  it('removes 0 to 3 trailing slashes', () => {
    for (const slashes of ['', '/', '//', '///']) {
      expect(providerUrl(`https://llm.test/v1${slashes}`)).toBe('https://llm.test/v1/chat/completions');
    }
  });
});

describe('resolveModel and providerRequestBody', () => {
  it('falls back to DEFAULT_MODEL for an unset or empty DIT_MODEL', () => {
    expect(resolveModel(undefined)).toBe(DEFAULT_MODEL);
    expect(resolveModel('')).toBe(DEFAULT_MODEL);
    expect(resolveModel('accounts/acme/models/tiny')).toBe('accounts/acme/models/tiny');
  });

  it('switches thinking off for the default model only', () => {
    expect(providerRequestBody(messages, DEFAULT_MODEL)).toStrictEqual({
      model: DEFAULT_MODEL,
      messages,
      max_tokens: 200,
      reasoning_effort: 'none',
    });
    const override = providerRequestBody(messages, 'accounts/acme/models/tiny');
    expect(Object.keys(override)).toStrictEqual(['model', 'messages', 'max_tokens']);
    expect(override).toStrictEqual({ model: 'accounts/acme/models/tiny', messages, max_tokens: 200 });
  });
});

describe('callProvider', () => {
  const config = { apiKey: 'test-key', baseUrl: undefined, model: undefined };

  it('sends one POST with only the bearer and JSON headers and returns the content', async () => {
    const fake = createFakeFetch();
    const outcome = callProvider(messages, config, { fetch: fake.fetch, timers });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call?.url).toBe('https://api.fireworks.ai/inference/v1/chat/completions');
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.headers).toStrictEqual({ Authorization: 'Bearer test-key', 'Content-Type': 'application/json' });
    expect(call?.body).toStrictEqual({ model: DEFAULT_MODEL, messages, max_tokens: 200, reasoning_effort: 'none' });
    call?.resolve(200, providerReply('{"suggestions": ["Hi."]}'));
    await expect(outcome).resolves.toStrictEqual({ ok: true, content: '{"suggestions": ["Hi."]}' });
  });

  it('sends exactly model, messages and max_tokens for a DIT_MODEL override', async () => {
    const fake = createFakeFetch();
    const outcome = callProvider(messages, { ...config, model: 'accounts/acme/models/tiny' }, { fetch: fake.fetch, timers });
    expect(fake.calls[0]?.body).toStrictEqual({ model: 'accounts/acme/models/tiny', messages, max_tokens: 200 });
    fake.calls[0]?.resolve(200, providerReply('x'));
    await expect(outcome).resolves.toStrictEqual({ ok: true, content: 'x' });
  });

  it.each([
    ['a non-2xx status', 500, providerReply('x')],
    ['a 1xx status', 101, providerReply('x')],
    ['a body that is not JSON', 200, 'not json'],
    ['no choices', 200, '{}'],
    ['an empty choices array', 200, '{"choices": []}'],
    ['a first choice without string content', 200, '{"choices": [{"message": {"content": null}}, {"message": {"content": "x"}}]}'],
  ])('reports upstream_failed for %s', async (_name, status, body) => {
    const fake = createFakeFetch();
    const outcome = callProvider(messages, config, { fetch: fake.fetch, timers });
    fake.calls[0]?.resolve(status, body);
    await expect(outcome).resolves.toStrictEqual({ ok: false, error: 'upstream_failed' });
  });

  it('reports upstream_failed for a network error, without a retry', async () => {
    const fake = createFakeFetch();
    const outcome = callProvider(messages, config, { fetch: fake.fetch, timers });
    fake.calls[0]?.reject(new TypeError('fetch failed'));
    await expect(outcome).resolves.toStrictEqual({ ok: false, error: 'upstream_failed' });
    expect(fake.calls).toHaveLength(1);
  });

  it('times out at 4,000 ms, aborts the request and ignores a late body', async () => {
    const fake = createFakeFetch();
    const outcome = callProvider(messages, config, { fetch: fake.fetch, timers });
    await vi.advanceTimersByTimeAsync(3_999);
    expect(fake.calls[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toStrictEqual({ ok: false, error: 'upstream_timeout' });
    expect(fake.calls[0]?.signal?.aborted).toBe(true);
  });

  it('counts the time to read the full body', async () => {
    const fake = createFakeFetch();
    const outcome = callProvider(messages, config, { fetch: fake.fetch, timers });
    fake.calls[0]?.resolve(200, providerReply('late'), { bodyDelayMs: 5_000 });
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(outcome).resolves.toStrictEqual({ ok: false, error: 'upstream_timeout' });
    await vi.advanceTimersByTimeAsync(2_000);
  });
});
