import { describe, expect, it } from 'vitest';
import { createEngine, decodedText, type Engine } from './decoder';
import type { EngineConfig, EngineEvent } from './types';

const UNIT = 200; // 6 WPM

function engineFor(config?: EngineConfig): Engine {
  const result = createEngine(config);
  if (!result.ok) throw new Error(`invalid test config: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Keys one pattern with 1-unit gaps between symbols, starting at `start`. Returns events and the last release time. */
function keyPattern(engine: Engine, pattern: string, start: number, unit = UNIT) {
  const events: EngineEvent[] = [];
  let t = start;
  for (const [index, symbol] of [...pattern].entries()) {
    if (index > 0) t += unit;
    events.push(...engine.press(t));
    t += symbol === '.' ? unit : 3 * unit;
    events.push(...engine.release(t));
  }
  return { events, lastRelease: t };
}

describe('createEngine defaults', () => {
  it('starts adaptive at 6 WPM with estimates 200 / 600', () => {
    const engine = engineFor();
    expect(engine.mode).toBe('adaptive');
    expect(engine.estimates()).toStrictEqual({
      dotEstimate: 200,
      dashEstimate: 600,
      dotDashThreshold: 400,
      letterGapThreshold: 400,
      wordGapThreshold: 900,
    });
    expect(engine.nextDeadline()).toBeNull();
  });

  it('accepts fixed mode and a starting speed', () => {
    const engine = engineFor({ mode: 'fixed', startingWpm: 20 });
    expect(engine.mode).toBe('fixed');
    expect(engine.estimates().dotEstimate).toBe(60);
    expect(engine.estimates().dashEstimate).toBe(180);
  });

  it('rejects invalid settings, names each one, and returns no engine', () => {
    const result = createEngine({ startingWpm: 25, adaptationRate: 0, initialDotEstimate: -1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toStrictEqual([
      { setting: 'startingWpm', value: 25 },
      { setting: 'adaptationRate', value: 0 },
      { setting: 'initialDotEstimate', value: -1, reason: 'invalid' },
      { setting: 'initialDashEstimate', value: undefined, reason: 'missing' },
    ]);
    expect('value' in result).toBe(false);
  });

  it('rejects non-number settings from untyped callers', () => {
    const untyped = { startingWpm: '6' } as unknown as EngineConfig;
    const result = createEngine(untyped);
    expect(result.ok).toBe(false);
  });
});

describe('decoding', () => {
  it('keys SOS as 9 symbols, then the sos command at the letter gap', () => {
    const engine = engineFor();
    const keyed = keyPattern(engine, '...---...', 0);
    expect(keyed.events.filter((event) => event.type === 'symbol')).toHaveLength(9);
    expect(keyed.events).toHaveLength(9);
    expect(engine.tick(keyed.lastRelease + 2 * UNIT)).toStrictEqual([{ type: 'command', command: 'sos' }]);
  });

  it('reads .-.-. as speak', () => {
    const engine = engineFor();
    const keyed = keyPattern(engine, '.-.-.', 0);
    expect(engine.tick(keyed.lastRelease + 3 * UNIT)).toStrictEqual([{ type: 'command', command: 'speak' }]);
  });

  it('keys "hi", then a 900 ms pause gives h, i and one space', () => {
    const engine = engineFor();
    const h = keyPattern(engine, '....', 0);
    const i = keyPattern(engine, '..', h.lastRelease + 3 * UNIT);
    const settled = engine.tick(i.lastRelease + 900);
    const events = [...h.events, ...i.events, ...settled];
    expect(settled).toStrictEqual([{ type: 'char', char: 'i' }, { type: 'space' }]);
    expect(decodedText(events)).toBe('hi ');
    expect(engine.nextDeadline()).toBeNull();
  });

  it('emits no space after the backspace code and leaves the text unchanged', () => {
    const engine = engineFor();
    const a = keyPattern(engine, '.-', 0);
    const backspace = keyPattern(engine, '----', a.lastRelease + 3 * UNIT);
    const events = [...a.events, ...backspace.events, ...engine.tick(backspace.lastRelease + 10 * UNIT)];
    expect(events.filter((event) => event.type !== 'symbol')).toStrictEqual([
      { type: 'char', char: 'a' },
      { type: 'command', command: 'backspace' },
    ]);
    expect(decodedText(events)).toBe('a');
  });

  it('ignores a release after reset() interrupts a press', () => {
    const engine = engineFor();
    engine.press(0);
    engine.reset();
    expect(engine.release(150)).toStrictEqual([]);
    expect(engine.snapshot().switchDown).toBe(false);
    expect(engine.nextDeadline()).toBeNull();
    expect(engine.estimates().dotEstimate).toBe(200);
  });

  it('accepts inputs with equal timestamps and ignores earlier ones', () => {
    const engine = engineFor();
    expect(engine.press(100)).toStrictEqual([]);
    expect(engine.tick(100)).toStrictEqual([]);
    expect(engine.release(300)).toStrictEqual([{ type: 'symbol', symbol: '.' }]);
    expect(engine.tick(300)).toStrictEqual([]);
    expect(engine.press(299)).toStrictEqual([]);
    expect(engine.snapshot().switchDown).toBe(false);
    expect(engine.press(300)).toStrictEqual([]);
    expect(engine.snapshot().switchDown).toBe(true);
  });

  it('ignores non-finite timestamps', () => {
    const engine = engineFor();
    expect(engine.press(Number.NaN)).toStrictEqual([]);
    expect(engine.press(Number.POSITIVE_INFINITY)).toStrictEqual([]);
    expect(engine.snapshot().lastT).toBeNull();
  });

  it('turns the 10th symbol into an unknown commit', () => {
    const engine = engineFor({ mode: 'fixed' });
    const keyed = keyPattern(engine, '..........', 0);
    expect(keyed.events.slice(-2)).toStrictEqual([
      { type: 'symbol', symbol: '.' },
      { type: 'unknown', pattern: '..........' },
    ]);
    expect(engine.nextDeadline()).toBeNull();
  });

  it('schedules the letter gap, then the word gap', () => {
    const engine = engineFor({ mode: 'fixed' });
    const keyed = keyPattern(engine, '.', 0);
    expect(engine.nextDeadline()).toBe(keyed.lastRelease + 400);
    expect(engine.tick(keyed.lastRelease + 399)).toStrictEqual([]);
    expect(engine.tick(keyed.lastRelease + 400)).toStrictEqual([{ type: 'char', char: 'e' }]);
    expect(engine.nextDeadline()).toBe(keyed.lastRelease + 900);
    expect(engine.tick(keyed.lastRelease + 900)).toStrictEqual([{ type: 'space' }]);
    expect(engine.nextDeadline()).toBeNull();
  });

  it('commits at a press after a letter gap before the new symbol', () => {
    const engine = engineFor({ mode: 'fixed' });
    const e = keyPattern(engine, '.', 0);
    expect(engine.press(e.lastRelease + 1000)).toStrictEqual([{ type: 'char', char: 'e' }, { type: 'space' }]);
    expect(engine.release(e.lastRelease + 1200)).toStrictEqual([{ type: 'symbol', symbol: '.' }]);
  });

  it('adapts to slower dots in adaptive mode only', () => {
    const adaptive = engineFor();
    adaptive.press(0);
    adaptive.release(300);
    expect(adaptive.estimates().dotEstimate).toBe(215);

    const fixed = engineFor({ mode: 'fixed' });
    fixed.press(0);
    fixed.release(300);
    expect(fixed.estimates().dotEstimate).toBe(200);
  });
});

describe('decodedText', () => {
  it('joins chars and spaces and skips other events', () => {
    expect(
      decodedText([
        { type: 'symbol', symbol: '.' },
        { type: 'char', char: 'h' },
        { type: 'command', command: 'next' },
        { type: 'char', char: 'i' },
        { type: 'space' },
        { type: 'unknown', pattern: '......' },
      ]),
    ).toBe('hi ');
  });
});
