import { describe, expect, it } from 'vitest';
import { memoryBackend, type KeyValueBackend } from '@/lib/conversation';
import { throwingBackend } from '@/lib/conversation/test-support';
import {
  ONBOARDING_KEY,
  parseOnboardingRecord,
  readOnboardingRecord,
  serializeOnboardingRecord,
  writeOnboardingRecord,
  type OnboardingRecord,
} from './record';

const RECORD: OnboardingRecord = {
  v: 1,
  complete: true,
  inputChoice: 'switch',
  estimates: { dotEstimate: 180, dashEstimate: 560 },
};

/** A backend that accepts writes but keeps returning what it held before. */
function staleBackend(held: string | null): KeyValueBackend & { readonly writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    getItem: () => held,
    setItem: (_key, value) => {
      writes.push(value);
    },
    removeItem: () => undefined,
  };
}

describe('parse and serialize', () => {
  it('writes exactly the four fields and reads them back', () => {
    const json = serializeOnboardingRecord(RECORD);
    expect(Object.keys(JSON.parse(json) as object)).toEqual(['v', 'complete', 'inputChoice', 'estimates']);
    expect(parseOnboardingRecord(json)).toEqual(RECORD);
    const skipped: OnboardingRecord = { v: 1, complete: true, inputChoice: 'key-tap', estimates: null };
    expect(parseOnboardingRecord(serializeOnboardingRecord(skipped))).toEqual(skipped);
  });

  it('drops extra fields of the estimates when writing', () => {
    const extra = { ...RECORD, estimates: { ...RECORD.estimates, reason: null } } as unknown as OnboardingRecord;
    expect(JSON.parse(serializeOnboardingRecord(extra))).toEqual(RECORD);
  });

  it('rejects missing, non-JSON and invalid values (Requirement 11.1)', () => {
    expect(parseOnboardingRecord(null)).toBeNull();
    expect(parseOnboardingRecord('{')).toBeNull();
    expect(parseOnboardingRecord('null')).toBeNull();
    expect(parseOnboardingRecord(JSON.stringify({ ...RECORD, v: 2 }))).toBeNull();
    expect(parseOnboardingRecord(JSON.stringify({ ...RECORD, extra: true }))).toBeNull();
    expect(parseOnboardingRecord(JSON.stringify({ ...RECORD, estimates: { dotEstimate: 0, dashEstimate: 1 } }))).toBeNull();
    expect(parseOnboardingRecord('{"v":1,"complete":true,"inputChoice":"blink","estimates":{"dotEstimate":1e999,"dashEstimate":1}}')).toBeNull();
  });
});

describe('readOnboardingRecord', () => {
  it('reads a valid record, and reports a missing or invalid one as absent', () => {
    expect(readOnboardingRecord(memoryBackend({ [ONBOARDING_KEY]: serializeOnboardingRecord(RECORD) }))).toEqual({
      kind: 'valid',
      record: RECORD,
    });
    expect(readOnboardingRecord(memoryBackend())).toEqual({ kind: 'absent' });
    expect(readOnboardingRecord(memoryBackend({ [ONBOARDING_KEY]: 'not json' }))).toEqual({ kind: 'absent' });
  });

  it('reports a read error when getItem throws or there is no backend (Requirement 11.5)', () => {
    expect(readOnboardingRecord(throwingBackend({ get: true }))).toEqual({ kind: 'read-error' });
    expect(readOnboardingRecord(null)).toEqual({ kind: 'read-error' });
  });

  it('never writes while reading (Requirement 11.2)', () => {
    const backend = throwingBackend({ initial: { [ONBOARDING_KEY]: '{"v":1,"complete":false}' } });
    readOnboardingRecord(backend);
    expect(backend.writes).toEqual([]);
    expect(backend.getItem(ONBOARDING_KEY)).toBe('{"v":1,"complete":false}');
  });
});

describe('writeOnboardingRecord', () => {
  it('writes the record once and confirms it by reading it back', () => {
    const backend = throwingBackend();
    expect(writeOnboardingRecord(backend, RECORD)).toEqual({ ok: true, value: undefined });
    expect(backend.writes).toEqual([[ONBOARDING_KEY, serializeOnboardingRecord(RECORD)]]);
  });

  it('fails when setItem throws and leaves the earlier value unchanged (Requirement 16.6)', () => {
    const earlier = serializeOnboardingRecord({ ...RECORD, inputChoice: 'blink' });
    const backend = throwingBackend({ set: true, initial: { [ONBOARDING_KEY]: earlier } });
    expect(writeOnboardingRecord(backend, RECORD)).toEqual({ ok: false, error: 'write-failed' });
    expect(backend.getItem(ONBOARDING_KEY)).toBe(earlier);
  });

  it('fails when the value read back differs or cannot be read', () => {
    expect(writeOnboardingRecord(staleBackend(null), RECORD)).toEqual({ ok: false, error: 'write-failed' });
    const other = serializeOnboardingRecord({ ...RECORD, complete: false });
    expect(writeOnboardingRecord(staleBackend(other), RECORD)).toEqual({ ok: false, error: 'write-failed' });
    const unreadable: KeyValueBackend = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(writeOnboardingRecord(unreadable, RECORD)).toEqual({ ok: false, error: 'write-failed' });
    expect(writeOnboardingRecord(null, RECORD)).toEqual({ ok: false, error: 'write-failed' });
  });
});
