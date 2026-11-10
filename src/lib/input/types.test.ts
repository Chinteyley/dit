import { describe, expect, it } from 'vitest';
import { FAILURE_STATUSES, SOURCE_KINDS, err, isFailureStatus, ok, pressEvent } from './types';

describe('pressEvent', () => {
  it('returns a frozen object with exactly kind, t and source', () => {
    const event = pressEvent('down', 120, 'pointer');
    expect(event).toStrictEqual({ kind: 'down', t: 120, source: 'pointer' });
    expect(Object.keys(event).sort()).toStrictEqual(['kind', 'source', 't']);
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('returns a new object per call', () => {
    expect(pressEvent('up', 5, 'blink')).not.toBe(pressEvent('up', 5, 'blink'));
  });
});

describe('shared constants', () => {
  it('lists the four source kinds in a frozen array', () => {
    expect(SOURCE_KINDS).toStrictEqual(['keyboard', 'switch', 'pointer', 'blink']);
    expect(Object.isFrozen(SOURCE_KINDS)).toBe(true);
  });

  it('recognises exactly the four failure statuses', () => {
    expect(FAILURE_STATUSES).toStrictEqual(['unsupported', 'permission-denied', 'no-camera', 'error']);
    expect(isFailureStatus('error')).toBe(true);
    expect(isFailureStatus('no-camera')).toBe(true);
    expect(isFailureStatus('off')).toBe(false);
    expect(isFailureStatus('starting')).toBe(false);
    expect(isFailureStatus('face-lost')).toBe(false);
  });
});

describe('ok and err', () => {
  it('build the two Result shapes', () => {
    expect(ok(3)).toStrictEqual({ ok: true, value: 3 });
    expect(err('nope')).toStrictEqual({ ok: false, error: 'nope' });
  });
});
