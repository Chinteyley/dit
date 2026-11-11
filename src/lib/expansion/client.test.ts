import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_MAX,
  CLIENT_TIMEOUT_MS,
  DEBOUNCE_MS,
  EXPAND_ENDPOINT,
  createExpansionClient,
  prepareContext,
  type ClientDeps,
  type ExpansionResult,
} from './client';
import type { Timers } from './deadline';
import type { Turn } from './schema';
import { createFakeFetch, type FakeFetch } from './test-support/fake-fetch';

const throwing = (name: string) => () => {
  throw new Error(`global ${name} must not be used`);
};

interface Setup {
  readonly fake: FakeFetch;
  readonly results: ExpansionResult[];
  readonly onDevice: ReturnType<typeof vi.fn<(text: string, context: readonly Turn[]) => readonly string[]>>;
  readonly client: ReturnType<typeof createExpansionClient>;
  online: boolean;
}

let timers: Timers;

beforeEach(() => {
  vi.useFakeTimers();
  const fakeSetTimeout = globalThis.setTimeout;
  const fakeClearTimeout = globalThis.clearTimeout;
  timers = {
    setTimeout: (fn, ms) => fakeSetTimeout(fn, ms),
    clearTimeout: (handle) => fakeClearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  vi.stubGlobal('fetch', throwing('fetch'));
  vi.stubGlobal('setTimeout', throwing('setTimeout'));
  vi.stubGlobal('clearTimeout', throwing('clearTimeout'));
  vi.stubGlobal('navigator', new Proxy({}, { get: throwing('navigator') }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup(): Setup {
  const fake = createFakeFetch();
  const results: ExpansionResult[] = [];
  const onDevice = vi.fn((text: string, context: readonly Turn[]): readonly string[] => [`on-device ${text} ${context.length}`]);
  const state = { online: true };
  const deps: ClientDeps = { fetch: fake.fetch, timers, isOnline: () => state.online, expandOnDevice: onDevice };
  const client = createExpansionClient(deps, (result) => results.push(result));
  return {
    fake,
    results,
    onDevice,
    client,
    get online() {
      return state.online;
    },
    set online(value: boolean) {
      state.online = value;
    },
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) await vi.advanceTimersByTimeAsync(0);
};

const ok = (suggestions: readonly string[]): string => JSON.stringify({ suggestions });

describe('expansion client', () => {
  it('sends one request for a burst of changes, carrying the latest text', async () => {
    const s = setup();
    s.client.update('i', []);
    await vi.advanceTimersByTimeAsync(299);
    s.client.update('iw', []);
    await vi.advanceTimersByTimeAsync(150);
    s.client.update(' iwtgo ', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(s.fake.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.fake.calls).toHaveLength(1);
    expect(s.fake.calls[0]?.url).toBe(EXPAND_ENDPOINT);
    expect(s.fake.calls[0]?.init?.method).toBe('POST');
    expect(s.fake.calls[0]?.body).toStrictEqual({ text: 'iwtgo', context: [] });
    s.fake.calls[0]?.resolve(200, ok(['I want to go outside.']));
    await settle();
    expect(s.results).toStrictEqual([{ text: 'iwtgo', suggestions: ['I want to go outside.'], source: 'ai' }]);
  });

  it('restarts the debounce when a partner line changes the context of unchanged text', async () => {
    const s = setup();
    s.client.update('iwtgo', []);
    await vi.advanceTimersByTimeAsync(200);
    s.client.update('iwtgo', [{ role: 'partner', text: 'Do you need anything?' }]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(s.fake.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.fake.calls).toHaveLength(1);
    expect(s.fake.calls[0]?.body).toStrictEqual({ text: 'iwtgo', context: [{ role: 'partner', text: 'Do you need anything?' }] });
  });

  it('refreshes finished suggestions when a partner line arrives (conversation-ui Requirement 9.3)', async () => {
    const s = setup();
    s.client.update('y', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    s.fake.calls[0]?.resolve(200, ok(['Yes.']));
    await settle();
    const asked: Turn[] = [{ role: 'partner', text: 'Do you want some water?' }];
    s.client.update('y', asked);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(s.fake.calls).toHaveLength(2);
    expect(s.fake.calls[1]?.body).toStrictEqual({ text: 'y', context: asked });
    s.fake.calls[1]?.resolve(200, ok(['Yes, some water please.']));
    await settle();
    expect(s.results.map((result) => result.suggestions)).toStrictEqual([['Yes.'], ['Yes, some water please.']]);
  });

  it('starts nothing for the same text with the same prepared context, or for empty text', async () => {
    const s = setup();
    const context: Turn[] = [{ role: 'partner', text: 'Hello' }];
    s.client.update('', [{ role: 'partner', text: 'Are you cold?' }]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(s.results).toStrictEqual([]);
    s.client.update('iwtgo', context);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    s.fake.calls[0]?.resolve(200, ok(['I want to go outside.']));
    await settle();
    // A new array with the same Turns, and a blank Turn that prepareContext drops, change nothing.
    s.client.update('iwtgo', [...context]);
    s.client.update('iwtgo', [...context, { role: 'partner', text: '   ' }]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(s.fake.calls).toHaveLength(1);
    expect(s.results).toHaveLength(1);
  });

  it('aborts the earlier request when a newer expansion starts and never delivers its result', async () => {
    const s = setup();
    s.client.update('iwt', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    const first = s.fake.calls[0];
    s.client.update('iwtgo', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(first?.signal?.aborted).toBe(true);
    first?.resolve(200, ok(['Old answer.']));
    s.fake.calls[1]?.resolve(200, ok(['I want to go outside.']));
    await settle();
    expect(s.results).toStrictEqual([{ text: 'iwtgo', suggestions: ['I want to go outside.'], source: 'ai' }]);
    expect(s.onDevice).not.toHaveBeenCalled();
  });

  it('discards an outcome for text that changed while the request was out', async () => {
    const s = setup();
    s.client.update('iwt', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    s.client.update('iwtg', []);
    s.fake.calls[0]?.resolve(200, ok(['Stale.']));
    await settle();
    expect(s.results).toStrictEqual([]);
    s.client.update('iwt', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(s.fake.calls).toHaveLength(2);
  });

  it('answers a repeat of the same trimmed text and context from the cache', async () => {
    const s = setup();
    const context: Turn[] = [{ role: 'partner', text: 'Hello' }];
    s.client.update('iwtgo', context);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    s.fake.calls[0]?.resolve(200, ok(['I want to go outside.']));
    await settle();
    s.client.update('', context);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    s.client.update('  iwtgo', [{ role: 'partner', text: 'Hello' }]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(s.fake.calls).toHaveLength(1);
    expect(s.results.at(-1)).toStrictEqual({ text: 'iwtgo', suggestions: ['I want to go outside.'], source: 'ai' });
    expect(CACHE_MAX).toBe(20);
  });

  it.each([
    ['status 503', (s: Setup) => s.fake.calls[0]?.resolve(503, '{"error":"not_configured"}')],
    ['a fetch that rejects', (s: Setup) => s.fake.calls[0]?.reject(new TypeError('Failed to fetch'))],
    ['an empty suggestions list', (s: Setup) => s.fake.calls[0]?.resolve(200, ok([]))],
    ['a body that is not JSON', (s: Setup) => s.fake.calls[0]?.resolve(200, '<html>')],
    ['a schema-invalid body', (s: Setup) => s.fake.calls[0]?.resolve(200, ok(['Yes', 'yes']))],
  ])('falls back on-device for %s', async (_name, settleRoute) => {
    const s = setup();
    s.client.update('iwtgo', [{ role: 'partner', text: ' ' }]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    settleRoute(s);
    await settle();
    expect(s.results).toStrictEqual([{ text: 'iwtgo', suggestions: ['on-device iwtgo 0'], source: 'on-device' }]);
    expect(s.onDevice).toHaveBeenCalledWith('iwtgo', []);
  });

  it('falls back on-device when the route does not answer within 5,000 ms', async () => {
    const s = setup();
    s.client.update('iwtgo', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + CLIENT_TIMEOUT_MS - 1);
    expect(s.results).toStrictEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.fake.calls[0]?.signal?.aborted).toBe(true);
    expect(s.results).toStrictEqual([{ text: 'iwtgo', suggestions: ['on-device iwtgo 0'], source: 'on-device' }]);
  });

  it('answers on-device without a request when offline or when the text is over 200 characters', async () => {
    const s = setup();
    s.online = false;
    s.client.update('iwtgo', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    s.online = true;
    s.client.update('a'.repeat(201), []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(s.fake.calls).toHaveLength(0);
    expect(s.results.map((r) => r.source)).toStrictEqual(['on-device', 'on-device']);
    s.client.update('a'.repeat(200), []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(s.fake.calls).toHaveLength(1);
  });

  it('answers empty text with an empty on-device result and aborts the pending request', async () => {
    const s = setup();
    s.client.update('iwtgo', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    s.client.update(' \t', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(s.fake.calls[0]?.signal?.aborted).toBe(true);
    expect(s.results).toStrictEqual([{ text: '', suggestions: [], source: 'on-device' }]);
    expect(s.onDevice).not.toHaveBeenCalled();
  });

  it('delivers an empty list when the on-device expander throws', async () => {
    const s = setup();
    s.onDevice.mockImplementation(() => {
      throw new Error('broken');
    });
    s.online = false;
    s.client.update('iwtgo', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(s.results).toStrictEqual([{ text: 'iwtgo', suggestions: [], source: 'on-device' }]);
  });

  it('survives a throwing result callback and stops after dispose', async () => {
    const fake = createFakeFetch();
    const onResult = vi.fn(() => {
      throw new Error('ui broke');
    });
    const client = createExpansionClient({ fetch: fake.fetch, timers, isOnline: () => true, expandOnDevice: () => [] }, onResult);
    client.update('', []);
    client.update(' ', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(onResult).toHaveBeenCalledTimes(1);
    client.update('iwtgo', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    client.dispose();
    expect(fake.calls[0]?.signal?.aborted).toBe(true);
    client.update('more', []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + CLIENT_TIMEOUT_MS);
    expect(fake.calls).toHaveLength(1);
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});

describe('prepareContext', () => {
  it('drops blank Turns, keeps the latest 10 and cuts texts to 500 units', () => {
    const turns: Turn[] = [
      { role: 'partner', text: 'first' },
      { role: 'speaker', text: ' \t\n' },
      ...Array.from({ length: 10 }, (_, i): Turn => ({ role: i % 2 === 0 ? 'partner' : 'speaker', text: `line ${i}` })),
      { role: 'partner', text: 'x'.repeat(600) },
    ];
    const prepared = prepareContext(turns);
    expect(prepared).toHaveLength(10);
    expect(prepared[0]).toStrictEqual({ role: 'speaker', text: 'line 1' });
    expect(prepared[9]).toStrictEqual({ role: 'partner', text: 'x'.repeat(500) });
  });
});
