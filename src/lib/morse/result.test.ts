import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from './result';

describe('Result', () => {
  it('ok() wraps a value in the success shape', () => {
    expect(ok(42)).toStrictEqual({ ok: true, value: 42 });
  });

  it('err() wraps an error in the failure shape', () => {
    expect(err('bad')).toStrictEqual({ ok: false, error: 'bad' });
  });

  it('narrows on the ok flag', () => {
    const results: readonly Result<number, string>[] = [ok(1), err('nope')];
    const seen = results.map((result) => (result.ok ? `value ${result.value}` : `error ${result.error}`));
    expect(seen).toStrictEqual(['value 1', 'error nope']);
  });
});
