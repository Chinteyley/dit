import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExpansionClient, prepareContext, type ExpansionClient, type ExpansionResult } from './client';
import type { Timers } from './deadline';
import { isWhitespace } from './normalize';
import { ExpandRequestSchema, ExpandResponseSchema, type Turn } from './schema';
import { PROP_RUNS, roleArb, textWithLenArb, wsArb, wsOnlyWithLenArb } from './test-support/arbitraries';
import { createFakeFetch, type FakeFetch } from './test-support/fake-fetch';

let timers: Timers;

beforeEach(() => {
  vi.useFakeTimers();
  timers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i += 1) await vi.advanceTimersByTimeAsync(0);
};

// ---------------------------------------------------------------------------
// Independent reference helpers

const refTrim = (s: string): string => s.replace(/^[ \t\n\r]+/, '').replace(/[ \t\n\r]+$/, '');

function refPrepare(context: readonly Turn[]): Turn[] {
  const kept = context.filter((turn) => refTrim(turn.text) !== '');
  return kept.slice(Math.max(0, kept.length - 10)).map((turn) => ({ role: turn.role, text: turn.text.substring(0, 500) }));
}

const refKey = (trimmed: string, context: readonly Turn[]): string =>
  JSON.stringify([trimmed, refPrepare(context).map((turn) => [turn.role, turn.text])]);

/** A capacity-20 LRU of keys; `touch` reports a hit and marks it most recently used. */
class RefLru<V> {
  private readonly entries = new Map<string, V>();
  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }
  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > 20) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }
}

/** Strings with no Whitespace at either end, of the given length range. */
function coreArb(min: number, max: number): fc.Arbitrary<string> {
  return textWithLenArb(min, max).map((text) => {
    const chars = text.split('');
    if (chars.length > 0 && isWhitespace(chars[0] ?? '')) chars[0] = 'x';
    if (chars.length > 0 && isWhitespace(chars[chars.length - 1] ?? '')) chars[chars.length - 1] = 'y';
    return chars.join('');
  });
}

/** Typed text whose trimmed form is `core`. */
const paddedArb = (core: fc.Arbitrary<string>): fc.Arbitrary<string> =>
  fc.tuple(wsArb, core, wsArb).map(([a, c, b]) => a + c + b);

const answer = (suggestions: readonly string[]): string => JSON.stringify({ suggestions });

interface Rig {
  readonly fake: FakeFetch;
  readonly client: ExpansionClient;
  readonly results: ExpansionResult[];
}

function rig(options: { online?: () => boolean; onDevice?: (text: string, context: readonly Turn[]) => readonly string[] } = {}): Rig {
  const fake = createFakeFetch();
  const results: ExpansionResult[] = [];
  const client = createExpansionClient(
    {
      fetch: fake.fetch,
      timers,
      isOnline: options.online ?? (() => true),
      expandOnDevice: options.onDevice ?? ((text) => [`od ${text}`]),
    },
    (result) => results.push(result),
  );
  return { fake, client, results };
}

const CONTEXTS: readonly (readonly Turn[])[] = [
  [],
  [{ role: 'partner', text: 'Hello' }],
  [
    { role: 'speaker', text: 'Hi' },
    { role: 'partner', text: 'Are you cold?' },
  ],
];

describe('expansion client properties', () => {
  it('starts one expansion per quiet period of 300 ms', async () => {
    // Feature: expansion, Property 23: The client starts one expansion per quiet period
    const texts = ['i', 'iw', 'iwt', 'iwtgo', ' iwtgo ', 'i want wa', '', '  ', 'a'.repeat(201), 'b'.repeat(200)];
    const stepArb = fc.record({
      gap: fc.oneof(fc.constantFrom(0, 299, 300, 301), fc.integer({ min: 0, max: 1_000 })),
      kind: fc.constantFrom('text', 'text', 'text', 'context'),
      text: fc.constantFrom(...texts),
      context: fc.integer({ min: 0, max: CONTEXTS.length - 1 }),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 30 }), async (steps) => {
        const { fake, client } = rig();
        let n = 0;
        fake.autoRespond(() => ({ status: 200, body: answer([`answer ${(n += 1)}`]) }));

        const expected: string[] = [];
        const lru = new RefLru<true>();
        let latest = '';
        let context: readonly Turn[] = CONTEXTS[0] ?? [];
        let due: number | null = null;
        let now = 0;
        const fire = (): void => {
          const trimmed = refTrim(latest);
          if (trimmed === '' || trimmed.length > 200) return;
          const key = refKey(trimmed, context);
          if (lru.get(key) !== undefined) return;
          expected.push(trimmed);
          lru.set(key, true);
        };

        let currentText = '';
        let currentContext: readonly Turn[] = CONTEXTS[0] ?? [];
        for (const step of steps) {
          now += step.gap;
          if (due !== null && due <= now) {
            fire();
            due = null;
          }
          await vi.advanceTimersByTimeAsync(step.gap);
          await settle();
          if (step.kind === 'text') currentText = step.text;
          else currentContext = CONTEXTS[step.context] ?? [];
          if (currentText !== latest) {
            latest = currentText;
            due = now + 300;
          }
          context = currentContext;
          client.update(currentText, currentContext);
        }
        now += 1_000;
        if (due !== null && due <= now) fire();
        await vi.advanceTimersByTimeAsync(1_000);
        await settle();
        client.dispose();

        expect(fake.calls.map((call) => (call.body as { text: string }).text)).toStrictEqual(expected);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('keeps at most one request pending and delivers exactly once per live expansion', async () => {
    // Feature: expansion, Property 24: The client has at most one pending request and delivers exactly once per live expansion
    const texts = ['', ' ', 'i', 'iw', 'iwtgo', 'i want wa', 'x'.repeat(201)];
    const bodies = [answer(['A']), answer(['B', 'C']), answer([]), 'nope', answer(['Yes', 'yes'])];
    type Step =
      | { readonly kind: 'update'; readonly text: string }
      | { readonly kind: 'advance'; readonly ms: number }
      | { readonly kind: 'resolve'; readonly status: number; readonly body: string }
      | { readonly kind: 'reject' };
    const stepArb: fc.Arbitrary<Step> = fc.oneof(
      { weight: 3, arbitrary: fc.constantFrom(...texts).map((text): Step => ({ kind: 'update', text })) },
      {
        weight: 3,
        arbitrary: fc
          .oneof(fc.constantFrom(0, 299, 300, 301, 4_999, 5_000, 5_001), fc.integer({ min: 0, max: 1_000 }), fc.integer({ min: 0, max: 6_000 }))
          .map((ms): Step => ({ kind: 'advance', ms })),
      },
      {
        weight: 2,
        arbitrary: fc
          .record({ status: fc.constantFrom(200, 200, 200, 503, 500, 101), body: fc.constantFrom(...bodies) })
          .map(({ status, body }): Step => ({ kind: 'resolve', status, body })),
      },
      { weight: 1, arbitrary: fc.constant<Step>({ kind: 'reject' }) },
    );
    const caseArb = fc.record({
      steps: fc.array(stepArb, { minLength: 1, maxLength: 40 }),
      resultThrows: fc.boolean(),
      onDeviceThrows: fc.boolean(),
    });
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ steps, resultThrows, onDeviceThrows }) => {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown): void => {
          unhandled.push(reason);
        };
        process.on('unhandledRejection', onUnhandled);
        const fake = createFakeFetch();
        const deliveries: ExpansionResult[] = [];
        const wrongText: string[] = [];
        let onDeviceCalls = 0;
        let latestRaw = '';
        const client = createExpansionClient(
          {
            fetch: fake.fetch,
            timers,
            isOnline: () => true,
            expandOnDevice: (text) => {
              onDeviceCalls += 1;
              if (onDeviceThrows) throw new Error('on-device failed');
              return [`od ${text}`];
            },
          },
          (result) => {
            deliveries.push(result);
            if (result.text !== refTrim(latestRaw)) wrongText.push(result.text);
            if (resultThrows) throw new Error('ui failed');
          },
        );

        // Reference model of the client.
        const expected: ExpansionResult[] = [];
        let expectedOnDevice = 0;
        const lru = new RefLru<ExpansionResult>();
        let now = 0;
        let latest = '';
        let due: number | null = null;
        let live: { readonly text: string; readonly trimmed: string; readonly key: string; readonly sentAt: number } | null = null;
        const onDevice = (trimmed: string): ExpansionResult => {
          expectedOnDevice += 1;
          return { text: trimmed, suggestions: onDeviceThrows ? [] : [`od ${trimmed}`], source: 'on-device' };
        };
        const start = (): void => {
          live = null;
          const trimmed = refTrim(latest);
          if (trimmed === '') {
            expected.push({ text: '', suggestions: [], source: 'on-device' });
            return;
          }
          if (trimmed.length > 200) {
            expected.push(onDevice(trimmed));
            return;
          }
          const key = refKey(trimmed, []);
          const hit = lru.get(key);
          if (hit !== undefined) {
            expected.push(hit);
            return;
          }
          live = { text: latest, trimmed, key, sentAt: now };
        };
        const outcome = (reply: { status: number; body: string } | 'failed'): void => {
          const request = live;
          live = null;
          if (request === null || request.text !== latest) return;
          if (reply !== 'failed' && reply.status === 200) {
            let parsed: ReturnType<typeof ExpandResponseSchema.safeParse> | undefined;
            try {
              parsed = ExpandResponseSchema.safeParse(JSON.parse(reply.body));
            } catch {
              parsed = undefined;
            }
            if (parsed?.success === true && parsed.data.suggestions.length > 0) {
              const result: ExpansionResult = { text: request.trimmed, suggestions: parsed.data.suggestions, source: 'ai' };
              lru.set(request.key, result);
              expected.push(result);
              return;
            }
          }
          expected.push(onDevice(request.trimmed));
        };
        const advance = (ms: number): void => {
          const end = now + ms;
          for (;;) {
            const timeoutAt: number | null = live === null ? null : (live as { sentAt: number }).sentAt + 5_000;
            const candidates = [timeoutAt, due].filter((t): t is number => t !== null && t <= end);
            if (candidates.length === 0) break;
            const next = Math.min(...candidates);
            now = next;
            // On a tie the deadline timer, created earlier, fires first.
            if (timeoutAt === next) outcome('failed');
            else {
              due = null;
              start();
            }
          }
          now = end;
        };

        try {
          for (const step of steps) {
            switch (step.kind) {
              case 'update':
                latestRaw = step.text;
                if (step.text !== latest) {
                  latest = step.text;
                  due = now + 300;
                }
                client.update(step.text, []);
                break;
              case 'advance':
                advance(step.ms);
                await vi.advanceTimersByTimeAsync(step.ms);
                break;
              case 'resolve':
                if (live !== null) outcome({ status: step.status, body: step.body });
                fake.calls.at(-1)?.resolve(step.status, step.body);
                break;
              case 'reject':
                if (live !== null) outcome('failed');
                fake.calls.at(-1)?.reject(new TypeError('network down'));
                break;
            }
            await settle();
            const pending = fake.calls.filter((call) => !call.settled && call.signal?.aborted !== true);
            expect(pending.length).toBeLessThanOrEqual(1);
          }
          for (let i = 0; i < 2; i += 1) {
            advance(6_000);
            await vi.advanceTimersByTimeAsync(6_000);
            await settle();
          }
          expect(deliveries).toStrictEqual(expected);
          expect(onDeviceCalls).toBe(expectedOnDevice);
          expect(wrongText).toStrictEqual([]);
          expect(unhandled).toStrictEqual([]);
        } finally {
          client.dispose();
          process.off('unhandledRejection', onUnhandled);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('maps every route outcome to the specified source', async () => {
    // Feature: expansion, Property 25: Client outcomes map to the specified source
    const validListArb = fc.uniqueArray(coreArb(1, 40), { minLength: 1, maxLength: 3, selector: (s) => s.toLowerCase() });
    type RouteOutcome =
      | { readonly kind: 'reply'; readonly status: number; readonly body: string }
      | { readonly kind: 'reject' }
      | { readonly kind: 'hang' };
    const outcomeArb: fc.Arbitrary<RouteOutcome> = fc.oneof(
      {
        weight: 5,
        arbitrary: fc
          .record({
            status: fc.oneof({ weight: 3, arbitrary: fc.constant(200) }, { weight: 2, arbitrary: fc.integer({ min: 100, max: 599 }) }),
            body: fc.oneof(
              validListArb.map(answer),
              fc.constant(answer([])),
              fc.constant('{"suggestions": '),
              fc.constant(answer(['a', 'b', 'c', 'd'])),
              fc.constant('{"error":"not_configured"}'),
            ),
          })
          .map(({ status, body }): RouteOutcome => ({ kind: 'reply', status, body })),
      },
      { weight: 1, arbitrary: fc.constant<RouteOutcome>({ kind: 'reject' }) },
      { weight: 1, arbitrary: fc.constant<RouteOutcome>({ kind: 'hang' }) },
    );
    const contextArb = fc.array(fc.record({ role: roleArb, text: coreArb(1, 30) }, { noNullPrototype: true }), { maxLength: 4 });
    const caseArb = fc.record({
      text: paddedArb(fc.oneof(coreArb(1, 200), coreArb(200, 200), coreArb(201, 201), coreArb(202, 230))),
      context: contextArb,
      online: fc.boolean(),
      outcome: outcomeArb,
      onDeviceThrows: fc.boolean(),
    });
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const onDeviceArgs: [string, readonly Turn[]][] = [];
        const { fake, client, results } = rig({
          online: () => c.online,
          onDevice: (text, context) => {
            onDeviceArgs.push([text, context]);
            if (c.onDeviceThrows) throw new Error('on-device failed');
            return [`od ${text} ${context.length}`];
          },
        });
        client.update(c.text, c.context);
        await vi.advanceTimersByTimeAsync(300);
        await settle();
        const call = fake.calls[0];
        if (c.outcome.kind === 'reply') call?.resolve(c.outcome.status, c.outcome.body);
        if (c.outcome.kind === 'reject') call?.reject(new TypeError('Failed to fetch'));
        await settle();
        await vi.advanceTimersByTimeAsync(5_000);
        await settle();
        client.dispose();

        const trimmed = refTrim(c.text);
        const prepared = refPrepare(c.context);
        const sent = c.online && trimmed.length <= 200;
        expect(fake.calls).toHaveLength(sent ? 1 : 0);
        let ai: readonly string[] | undefined;
        if (sent && c.outcome.kind === 'reply' && c.outcome.status === 200) {
          try {
            const parsed = ExpandResponseSchema.safeParse(JSON.parse(c.outcome.body));
            if (parsed.success && parsed.data.suggestions.length > 0) ai = parsed.data.suggestions;
          } catch {
            ai = undefined;
          }
        }
        if (ai !== undefined) {
          expect(results).toStrictEqual([{ text: trimmed, suggestions: ai, source: 'ai' }]);
          expect(onDeviceArgs).toHaveLength(0);
        } else {
          const suggestions = c.onDeviceThrows ? [] : [`od ${trimmed} ${prepared.length}`];
          expect(results).toStrictEqual([{ text: trimmed, suggestions, source: 'on-device' }]);
          expect(onDeviceArgs).toStrictEqual([[trimmed, prepared]]);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('sends the trimmed text and the prepared context', async () => {
    // Feature: expansion, Property 26: The client sends trimmed text and prepared context
    const turnTextArb = fc.oneof(
      fc.constant(''),
      wsOnlyWithLenArb(1, 20),
      textWithLenArb(1, 500),
      textWithLenArb(501, 800),
      fc.tuple(wsOnlyWithLenArb(500, 500), coreArb(1, 5)).map(([ws, tail]) => ws + tail),
    );
    const turnsArb = fc.array(fc.record({ role: roleArb, text: turnTextArb }, { noNullPrototype: true }), { maxLength: 25, size: 'max' });
    const caseArb = fc.record({ text: paddedArb(coreArb(1, 200)), turns: turnsArb });
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ text, turns }) => {
        const reference = refPrepare(turns);
        expect(prepareContext(turns)).toStrictEqual(reference);
        const { fake, client } = rig();
        client.update(text, turns);
        await vi.advanceTimersByTimeAsync(300);
        client.dispose();
        expect(fake.calls).toHaveLength(1);
        const body = fake.calls[0]?.body;
        expect(body).toStrictEqual({ text: refTrim(text), context: reference });
        expect(ExpandRequestSchema.safeParse(body).success).toBe(true);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('caches at most 20 ai results as an LRU', async () => {
    // Feature: expansion, Property 27: The Result_Cache is an LRU of at most 20 'ai' results
    const stepArb = fc.record({ pick: fc.nat(), stale: fc.integer({ min: 0, max: 7 }).map((n) => n === 0) });
    const randomCaseArb = fc.record({
      poolSize: fc.integer({ min: 1, max: 30 }),
      steps: fc.array(stepArb, { minLength: 1, maxLength: 60 }),
    });
    // Fill the cache with 19 to 23 distinct keys in order, then ask again for the oldest ones,
    // so the capacity boundary of 20 is hit in most runs.
    const sweepCaseArb = fc
      .tuple(fc.integer({ min: 19, max: 23 }), fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 6 }), fc.array(stepArb, { maxLength: 10 }))
      .map(([fill, again, tail]) => ({
        poolSize: 30,
        steps: [
          ...Array.from({ length: fill }, (_, pick) => ({ pick, stale: false })),
          ...again.map((pick) => ({ pick, stale: false })),
          ...tail,
        ],
      }));
    const caseArb = fc.oneof(randomCaseArb, sweepCaseArb);
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ poolSize, steps }) => {
        const pool = Array.from({ length: poolSize }, (_, i) => ({
          text: `w${i % 15}`,
          context: i < 15 ? [] : [{ role: 'partner' as const, text: `ctx ${i}` }],
        }));
        const { fake, client, results } = rig();
        const lru = new RefLru<readonly string[]>();
        let expectedFetches = 0;
        try {
          for (const step of steps) {
            const key = pool[step.pick % poolSize] ?? { text: 'w0', context: [] };
            const refK = refKey(key.text, key.context);
            client.update('', []);
            await vi.advanceTimersByTimeAsync(300);
            await settle();
            const stored = lru.get(refK);
            if (!step.stale || stored !== undefined) {
              fake.autoRespond(() => ({ status: 200, body: answer([`answer ${fake.calls.length}`]) }));
              client.update(key.text, key.context);
              await vi.advanceTimersByTimeAsync(300);
              await settle();
              if (stored === undefined) {
                expectedFetches += 1;
                lru.set(refK, [`answer ${expectedFetches}`]);
              } else {
                expect(results.at(-1)).toStrictEqual({ text: key.text, suggestions: stored, source: 'ai' });
              }
            } else {
              fake.autoRespond(undefined);
              client.update(key.text, key.context);
              await vi.advanceTimersByTimeAsync(300);
              await settle();
              expectedFetches += 1;
              client.update('', []);
              fake.calls.at(-1)?.resolve(200, answer([`stale ${fake.calls.length}`]));
              await settle();
              await vi.advanceTimersByTimeAsync(300);
              await settle();
            }
            expect(fake.calls).toHaveLength(expectedFetches);
          }
        } finally {
          client.dispose();
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
