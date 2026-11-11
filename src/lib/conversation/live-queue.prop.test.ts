import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ANNOUNCE_INTERVAL_MS, INITIAL_LIVE_QUEUE, announcementsFor, enqueue, flush, type LiveItem } from './live-queue';
import { reduce } from './session';
import { PROP_RUNS, arbAction, arbState } from './test-support';

interface Queued {
  readonly at: number;
  readonly item: LiveItem;
}

interface Announcement {
  readonly at: number;
  readonly text: string;
  /** Items queued since the previous announcement, up to and including this one. */
  readonly since: readonly LiveItem[];
}

/** Items at non-decreasing times; texts are unique tokens without commas (c0, s1, ...). */
const queuedArb: fc.Arbitrary<readonly Queued[]> = fc
  .tuple(
    fc.integer({ min: 0, max: 1_000_000 }),
    fc.array(
      fc.record({
        dt: fc.oneof(
          fc.integer({ min: 0, max: 300 }),
          fc.integer({ min: 950, max: 1_050 }),
          fc.integer({ min: 0, max: 3_000 }),
        ),
        kind: fc.constantFrom<LiveItem['kind']>('char', 'char', 'suggestions'),
      }),
      { maxLength: 60, size: 'max' },
    ),
  )
  .map(([start, steps]) => {
    let at = start;
    return steps.map(({ dt, kind }, i) => {
      at += dt;
      return { at, item: { kind, text: `${kind === 'char' ? 'c' : 's'}${i}` } };
    });
  });

/** Drives the queue like the controller: a flush timer at nextDueAt, run before any later item. */
function drive(queued: readonly Queued[]): {
  readonly announcements: readonly Announcement[];
  /** Indexes of items announced by their own enqueue call. */
  readonly immediate: ReadonlySet<number>;
  /** For each item, the start of the latest announcement made before it was queued. */
  readonly lastStartBefore: readonly (number | null)[];
} {
  let state = INITIAL_LIVE_QUEUE;
  let due: number | null = null;
  let since: LiveItem[] = [];
  const announcements: Announcement[] = [];
  const immediate = new Set<number>();
  const lastStartBefore: (number | null)[] = [];
  const record = (at: number, text: string | null): boolean => {
    if (text === null) return false;
    announcements.push({ at, text, since });
    since = [];
    return true;
  };
  const runDue = (until: number): void => {
    while (due !== null && due <= until) {
      const at = due;
      const step = flush(state, at);
      state = step.state;
      due = step.nextDueAt;
      record(at, step.announce);
    }
  };
  queued.forEach(({ at, item }, i) => {
    runDue(at);
    lastStartBefore.push(announcements.at(-1)?.at ?? null);
    since.push(item);
    const step = enqueue(state, item, at);
    state = step.state;
    if (step.nextDueAt !== null && due === null) due = step.nextDueAt;
    if (record(at, step.announce)) immediate.add(i);
  });
  runDue(Number.POSITIVE_INFINITY);
  return { announcements, immediate, lastStartBefore };
}

describe('Live_Region queue properties', () => {
  // Feature: conversation-ui, Property 16: Live_Region throttle
  it('P16 live region throttle', () => {
    fc.assert(
      fc.property(queuedArb, (queued) => {
        const { announcements, immediate, lastStartBefore } = drive(queued);
        for (let i = 1; i < announcements.length; i++) {
          const gap = (announcements[i]?.at ?? 0) - (announcements[i - 1]?.at ?? 0);
          expect(gap).toBeGreaterThanOrEqual(ANNOUNCE_INTERVAL_MS);
        }
        // An item queued with no announcement start in the preceding 1,000 ms is announced at its own time.
        queued.forEach(({ at }, i) => {
          const last = lastStartBefore[i] ?? null;
          const quiet = last === null || at - last >= ANNOUNCE_INTERVAL_MS;
          expect(immediate.has(i)).toBe(quiet);
        });
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 17: Live_Region coalescing order
  it('P17 live region coalescing order', () => {
    fc.assert(
      fc.property(queuedArb, (queued) => {
        const { announcements } = drive(queued);
        const charsQueued = queued.filter((q) => q.item.kind === 'char').map((q) => q.item.text);
        const charsAnnounced: string[] = [];
        for (const a of announcements) {
          const tokens = a.text.split(', ');
          const firstSuggestion = tokens.findIndex((token) => token.startsWith('s'));
          const suggestionTokens = tokens.filter((token) => token.startsWith('s'));
          expect(suggestionTokens.length).toBeLessThanOrEqual(1);
          if (firstSuggestion !== -1) expect(firstSuggestion).toBe(tokens.length - 1);
          const newest = a.since.filter((item) => item.kind === 'suggestions').at(-1)?.text;
          expect(suggestionTokens[0]).toBe(newest);
          charsAnnounced.push(...tokens.filter((token) => token.startsWith('c')));
        }
        expect(charsAnnounced).toEqual(charsQueued);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 18: Announcement derivation
  it('P18 announcement derivation', () => {
    fc.assert(
      fc.property(
        arbState().chain((prev) => arbAction(prev).map((action) => ({ prev, action }))),
        ({ prev, action }) => {
          const next = reduce(prev, action).state;
          const items = announcementsFor(prev, next, action);
          const silent =
            action.type === 'hydrate' ||
            (action.type === 'engine' && (action.event.type === 'symbol' || action.event.type === 'unknown'));
          if (silent) {
            expect(items).toEqual([]);
            return;
          }
          const grew =
            next.currentText.length === prev.currentText.length + 1 && next.currentText.startsWith(prev.currentText);
          const chars = items.filter((item) => item.kind === 'char');
          if (grew) {
            const added = next.currentText.slice(-1);
            expect(chars).toEqual([{ kind: 'char', text: added === ' ' ? 'space' : added }]);
          } else {
            expect(chars).toEqual([]);
          }
          const changed =
            next.suggestions.length !== prev.suggestions.length ||
            next.suggestions.some((sentence, i) => sentence !== prev.suggestions[i]) ||
            next.suggestionSource !== prev.suggestionSource ||
            next.highlight !== prev.highlight;
          const lists = items.filter((item) => item.kind === 'suggestions');
          if (action.type === 'suggestions' && next.suggestions.length > 0 && changed) {
            expect(lists).toHaveLength(1);
            const n = next.suggestions.length;
            const text = lists[0]?.text ?? '';
            expect(text.startsWith(n === 1 ? '1 suggestion' : `${n} suggestions`)).toBe(true);
            if (next.highlight === null) {
              expect(text).not.toContain('Highlighted:');
            } else {
              expect(text.endsWith(`. Highlighted: ${next.suggestions[next.highlight]}`)).toBe(true);
            }
          } else {
            expect(lists).toEqual([]);
          }
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });
});
