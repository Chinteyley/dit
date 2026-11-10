import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PROP_RUNS, createKeyRig } from './test-support';
import type { Result } from './types';

const RESERVED = ['Space', 'Enter', 'NumpadEnter', 'Tab', 'Escape'];

const readArb: fc.Arbitrary<Result<unknown, { readonly message: string }>> = fc.oneof(
  fc
    .oneof(fc.anything(), fc.constantFrom('', ...RESERVED), fc.string(), fc.constantFrom('KeyJ', 'F13'))
    .map((value) => ({ ok: true as const, value })),
  fc.string().map((message) => ({ ok: false as const, error: { message } })),
);

describe('Switch_Source properties', () => {
  it('validates the stored key on start without writing to the store', () => {
    // Feature: input-sources, Property 16: Stored switch keys are validated without writing
    fc.assert(
      fc.property(readArb, (read) => {
        const rig = createKeyRig();
        rig.store.readResult = read;
        rig.switchSource.start();

        const expected =
          read.ok && typeof read.value === 'string' && read.value.length > 0 && !RESERVED.includes(read.value)
            ? read.value
            : null;
        expect(rig.switchSource.learnedKey()).toBe(expected);
        expect(rig.store.calls.reads).toBe(1);
        expect(rig.store.calls.writes).toStrictEqual([]);
        expect(rig.store.calls.clears).toBe(0);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
