import { describe, expect, it } from 'vitest';
import {
  ANNOUNCE_INTERVAL_MS,
  INITIAL_LIVE_QUEUE,
  announcementsFor,
  enqueue,
  flush,
  joinItems,
  suggestionsItemText,
} from './live-queue';
import { INITIAL_SESSION, reduce } from './session';
import type { SessionAction, SessionState } from './types';

const char = (text: string) => ({ kind: 'char', text }) as const;

describe('suggestionsItemText', () => {
  it('states the count, and the highlighted sentence when there is one', () => {
    expect(suggestionsItemText(['I am thirsty.'], null)).toBe('1 suggestion');
    expect(suggestionsItemText(['I am thirsty.'], 0)).toBe('1 suggestion. Highlighted: I am thirsty.');
    expect(suggestionsItemText(['A.', 'B.', 'C.'], 1)).toBe('3 suggestions. Highlighted: B.');
  });
});

describe('enqueue and flush', () => {
  it('announces at once when nothing was announced in the last second', () => {
    const step = enqueue(INITIAL_LIVE_QUEUE, char('h'), 5_000);
    expect(step.announce).toBe('h');
    expect(step.nextDueAt).toBeNull();
    expect(step.state.lastAnnouncedAt).toBe(5_000);
    expect(enqueue(step.state, char('i'), 6_000).announce).toBe('i');
  });

  it('holds three characters typed inside one second and announces them as "h, i, space"', () => {
    const first = enqueue(INITIAL_LIVE_QUEUE, char('x'), 0);
    const h = enqueue(first.state, char('h'), 100);
    const i = enqueue(h.state, char('i'), 300);
    const space = enqueue(i.state, char('space'), 500);
    expect([h.announce, i.announce, space.announce]).toEqual([null, null, null]);
    expect(space.nextDueAt).toBe(ANNOUNCE_INTERVAL_MS);
    expect(flush(space.state, 999).announce).toBeNull();
    const flushed = flush(space.state, 1_000);
    expect(flushed.announce).toBe('h, i, space');
    expect(flushed.state).toEqual({ lastAnnouncedAt: 1_000, heldChars: [], heldSuggestions: null });
  });

  it('keeps only the newest held suggestions item, after the held characters', () => {
    const first = enqueue(INITIAL_LIVE_QUEUE, char('a'), 0);
    let s = enqueue(first.state, { kind: 'suggestions', text: '2 suggestions' }, 100).state;
    s = enqueue(s, char('b'), 200).state;
    s = enqueue(s, { kind: 'suggestions', text: '1 suggestion' }, 300).state;
    expect(flush(s, 1_000).announce).toBe('b, 1 suggestion');
    expect(joinItems([], 'x')).toBe('x');
  });

  it('flush with nothing held does nothing', () => {
    expect(flush(INITIAL_LIVE_QUEUE, 10)).toEqual({ state: INITIAL_LIVE_QUEUE, announce: null, nextDueAt: null });
  });
});

describe('announcementsFor', () => {
  const after = (prev: SessionState, action: SessionAction) =>
    announcementsFor(prev, reduce(prev, action).state, action);

  it('announces a typed character, or "space"', () => {
    expect(after(INITIAL_SESSION, { type: 'engine', event: { type: 'char', char: 'h' } })).toEqual([char('h')]);
    const hi = { ...INITIAL_SESSION, currentText: 'hi' };
    expect(after(hi, { type: 'engine', event: { type: 'space' } })).toEqual([char('space')]);
  });

  it('announces a new list but nothing for an emptied list', () => {
    const typed = { ...INITIAL_SESSION, currentText: 'iwtgo' };
    const result = { text: 'iwtgo', suggestions: ['I want to go outside.', 'I want to go home.'], source: 'ai' } as const;
    expect(after(typed, { type: 'suggestions', result })).toEqual([
      { kind: 'suggestions', text: '2 suggestions. Highlighted: I want to go outside.' },
    ]);
    const shown = reduce(typed, { type: 'suggestions', result }).state;
    expect(after(shown, { type: 'suggestions', result: { ...result, suggestions: [] } })).toEqual([]);
  });

  it('announces nothing for symbols, unknown patterns and Hydrate', () => {
    expect(after(INITIAL_SESSION, { type: 'engine', event: { type: 'symbol', symbol: '.' } })).toEqual([]);
    expect(after(INITIAL_SESSION, { type: 'engine', event: { type: 'unknown', pattern: '......' } })).toEqual([]);
    expect(after(INITIAL_SESSION, { type: 'hydrate', turns: [{ role: 'speaker', text: 'hi' }] })).toEqual([]);
  });
});
