import { describe, expect, it } from 'vitest';
import { plain } from '../test-support';
import {
  DEFAULT_DETECTOR_CONFIG,
  createBlinkDetector,
  normalizeFrame,
  validateThresholds,
  type BlinkDetector,
  type DetectorConfig,
  type RawBlinkFrame,
} from './detector';

function detector(config: Partial<DetectorConfig> = {}): BlinkDetector {
  const result = createBlinkDetector(config);
  if (!result.ok) throw new Error('invalid test config');
  return result.value;
}

const eyes = (t: number, score: number): RawBlinkFrame => ({ t, left: score, right: score });
const lost = (t: number): RawBlinkFrame => ({ t, face: 'lost' });

/** Pushes frames and returns every event and face report in order. */
function feed(d: BlinkDetector, frames: readonly RawBlinkFrame[]) {
  const events = frames.flatMap((f) => [...d.push(f).events]);
  return plain(events);
}

describe('Blink_Detector defaults', () => {
  it('uses 0.5 close, 0.35 open and a 200 ms minimum closure', () => {
    expect(DEFAULT_DETECTOR_CONFIG).toStrictEqual({ closeThreshold: 0.5, openThreshold: 0.35, minPressDuration: 200 });
    const d = detector();
    expect(d.eyeState()).toBe('open');
    expect(d.debouncer.minPressDuration()).toBe(200);
    expect(d.state()).toMatchObject({ close: 0.5, open: 0.35, lastFace: 'active', lastT: null });
  });

  it('rejects an invalid configuration and names every problem', () => {
    const result = createBlinkDetector({ minPressDuration: 10, closeThreshold: 0.2, openThreshold: 0.4 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveLength(2);
    expect(result.error[0]).toMatchObject({ source: 'blink', setting: 'minPressDuration' });
    expect(result.error[1]).toMatchObject({ invalid: ['closeThreshold', 'openThreshold'] });
  });
});

describe('Blink_Detector closures', () => {
  it('rejects a 150 ms natural blink', () => {
    const d = detector();
    expect(feed(d, [eyes(0, 0.1), eyes(33, 0.9), eyes(100, 0.9), eyes(183, 0.1)])).toStrictEqual([]);
    expect(d.eyeState()).toBe('open');
  });

  it('turns a 250 ms closure into down at its start and up at its end', () => {
    const d = detector();
    const events = feed(d, [eyes(0, 0.1), eyes(1000, 0.8), eyes(1100, 0.8), eyes(1200, 0.8), eyes(1250, 0.2)]);
    expect(events).toStrictEqual([
      { kind: 'down', t: 1000, source: 'blink' },
      { kind: 'up', t: 1250, source: 'blink' },
    ]);
  });

  it('emits down on the first frame that reaches the minimum while the eyes stay closed', () => {
    const d = detector();
    expect(d.push(eyes(0, 0.7)).events).toStrictEqual([]);
    expect(d.push(eyes(199, 0.7)).events).toStrictEqual([]);
    expect(plain(d.push(eyes(200, 0.7)).events)).toStrictEqual([{ kind: 'down', t: 0, source: 'blink' }]);
    expect(d.debouncer.isHeld()).toBe(true);
  });

  it('keeps the eyes closed while scores stay between the thresholds (hysteresis)', () => {
    const d = detector();
    d.push(eyes(0, 0.6));
    for (const t of [33, 66, 99]) d.push(eyes(t, 0.4));
    expect(d.eyeState()).toBe('closed');
    d.push(eyes(132, 0.34));
    expect(d.eyeState()).toBe('open');
    d.push(eyes(165, 0.49));
    expect(d.eyeState()).toBe('open');
  });

  it('needs both eyes past the threshold', () => {
    const d = detector();
    d.push({ t: 0, left: 0.9, right: 0.3 });
    expect(d.eyeState()).toBe('open');
    d.push({ t: 10, left: 0.9, right: 0.9 });
    d.push({ t: 20, left: 0.1, right: 0.4 });
    expect(d.eyeState()).toBe('closed');
  });

  it('a threshold change mid-Closure keeps the Closure and applies from the next frame', () => {
    const d = detector();
    d.push(eyes(0, 0.9));
    expect(d.setThresholds(0.95, 0.2)).toStrictEqual({ ok: true, value: { close: 0.95, open: 0.2 } });
    expect(d.eyeState()).toBe('closed');
    d.push(eyes(100, 0.3));
    expect(d.eyeState()).toBe('closed');
    expect(feed(d, [eyes(300, 0.1)])).toStrictEqual([
      { kind: 'down', t: 0, source: 'blink' },
      { kind: 'up', t: 300, source: 'blink' },
    ]);
  });

  it('a minimum change mid-Closure applies from the next Closure', () => {
    const d = detector();
    d.push(eyes(0, 0.9));
    expect(d.setMinPressDuration(1000).ok).toBe(true);
    expect(feed(d, [eyes(250, 0.1)])).toHaveLength(2);
    expect(feed(d, [eyes(1000, 0.9), eyes(1500, 0.1)])).toStrictEqual([]);
  });

  it('reset discards a Closure and sets the eyes open', () => {
    const d = detector();
    d.push(eyes(0, 0.9));
    d.push(eyes(100, 0.9));
    d.reset();
    expect(d.eyeState()).toBe('open');
    expect(d.debouncer.pendingSince()).toBeNull();
    expect(feed(d, [eyes(400, 0.1)])).toStrictEqual([]);
  });
});

describe('Blink_Detector face status', () => {
  it('reports face-lost once per loss and active on the next valid frame', () => {
    const d = detector();
    expect(d.push(eyes(0, 0.1)).face).toBeNull();
    expect(d.push(lost(33)).face).toBe('face-lost');
    expect(d.push(lost(66)).face).toBeNull();
    expect(d.push(eyes(99, 0.1)).face).toBe('active');
    expect(d.push(eyes(132, 0.1)).face).toBeNull();
  });

  it('a face lost during a long Closure ends it with an up at that frame', () => {
    const d = detector();
    d.push(eyes(0, 0.9));
    const out = d.push(lost(400));
    expect(plain(out.events)).toStrictEqual([
      { kind: 'down', t: 0, source: 'blink' },
      { kind: 'up', t: 400, source: 'blink' },
    ]);
    expect(out.face).toBe('face-lost');
    expect(d.eyeState()).toBe('open');
  });

  it('a face lost during a short Closure drops it', () => {
    const d = detector();
    d.push(eyes(0, 0.9));
    expect(d.push(lost(100)).events).toStrictEqual([]);
  });

  it('the frame that reports active is processed from open, so closed eyes start a Closure', () => {
    const d = detector();
    d.push(lost(0));
    const out = d.push(eyes(33, 0.9));
    expect(out.face).toBe('active');
    expect(d.eyeState()).toBe('closed');
  });

  it('reset expects the next start to report active again', () => {
    const d = detector();
    d.push(lost(0));
    d.reset();
    expect(d.push(lost(100)).face).toBe('face-lost');
  });
});

describe('Blink_Detector frame validation', () => {
  it('treats missing, non-finite or out-of-range scores as face lost', () => {
    expect(normalizeFrame({ t: 1, left: 0.2, right: 0.3 })).toStrictEqual({ t: 1, left: 0.2, right: 0.3 });
    expect(normalizeFrame({ t: 1, left: 0, right: 1 })).toStrictEqual({ t: 1, left: 0, right: 1 });
    for (const bad of [undefined, Number.NaN, Infinity, -0.01, 1.01, '0.5', null]) {
      expect(normalizeFrame({ t: 1, left: bad, right: 0.5 })).toStrictEqual({ t: 1, face: 'lost' });
      expect(normalizeFrame({ t: 1, left: 0.5, right: bad })).toStrictEqual({ t: 1, face: 'lost' });
    }
    expect(normalizeFrame({ t: 1, face: 'lost', left: 0.2, right: 0.2 })).toStrictEqual({ t: 1, face: 'lost' });
  });

  it('ignores stale and non-finite frames and accepts an equal timestamp', () => {
    const d = detector();
    d.push(eyes(100, 0.9));
    expect(d.push(eyes(99, 0.1))).toStrictEqual({ events: [], face: null });
    expect(d.push(eyes(Number.NaN, 0.1))).toStrictEqual({ events: [], face: null });
    expect(d.eyeState()).toBe('closed');
    d.push(eyes(100, 0.1));
    expect(d.eyeState()).toBe('open');
  });
});

describe('validateThresholds', () => {
  it('accepts 0 < open < close ≤ 1', () => {
    expect(validateThresholds(1, 0.99)).toStrictEqual({ ok: true, value: { close: 1, open: 0.99 } });
  });

  it('names each invalid threshold', () => {
    expect(validateThresholds(1.2, 0.3)).toMatchObject({ ok: false, error: { invalid: ['closeThreshold'] } });
    expect(validateThresholds(0.5, 0)).toMatchObject({ ok: false, error: { invalid: ['openThreshold'] } });
    expect(validateThresholds('x', Number.NaN)).toMatchObject({
      ok: false,
      error: { invalid: ['closeThreshold', 'openThreshold'] },
    });
    const pair = validateThresholds(0.4, 0.4);
    expect(pair).toStrictEqual({
      ok: false,
      error: { invalid: ['closeThreshold', 'openThreshold'], message: 'The open threshold must be below the close threshold.' },
    });
  });

  it('keeps both previous values when a pair is rejected', () => {
    const d = detector();
    expect(d.setThresholds(0.3, 0.6).ok).toBe(false);
    expect(d.state()).toMatchObject({ close: 0.5, open: 0.35 });
  });
});
