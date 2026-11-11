import fc from 'fast-check';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createExpansionClient, type ExpansionResult, type Timers } from '@/lib/expansion';
import { createFakeFetch } from '@/lib/expansion/test-support/fake-fetch';
import { createControllerRig } from './session-controller.test-support';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const timers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
const settle = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(0); };
const answer = (suggestions: readonly string[]): string => JSON.stringify({ suggestions });
const PROP_RUNS = 200;

// Feature: conversation-ui / expansion, review 26.3 / 20.2: deleted history never survives a debounce.
it('immediately removes cleared history from pending and debounced session expansions', async () => {
  await fc.assert(fc.asyncProperty(fc.boolean(), async (inFlight) => {
    const fake = createFakeFetch();
    const results: ExpansionResult[] = [];
    const r = createControllerRig({ createClient: (onResult) => createExpansionClient({ fetch: fake.fetch, timers, isOnline: () => true, expandOnDevice: () => [] }, (result) => { results.push(result); onResult(result); }) });
    r.controller.partnerLine('Private history to delete');
    r.script({ type: 'char', char: 'it' }); r.down(); r.up();
    await vi.advanceTimersByTimeAsync(inFlight ? 300 : 100);
    r.controller.clearHistory();
    if (inFlight) fake.calls[0]?.resolve(200, answer(['An obsolete answer.']));
    await settle();
    expect(results).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(fake.calls.at(-1)?.body).toEqual({ text: 'it', context: [] });
    expect(fake.calls).toHaveLength(inFlight ? 2 : 1);
    r.controller.dispose();
  }), { numRuns: PROP_RUNS });
});
