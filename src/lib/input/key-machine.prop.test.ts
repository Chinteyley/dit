import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FocusClass } from './focus';
import { INITIAL_KEY_MACHINE_STATE, keyDown, keyUp, type FocusRule } from './key-machine';
import { PROP_RUNS, keyScriptArb } from './test-support';

/** Req 4.1 and 4.9, restated: the keyboard keys only on Keying_Targets, a learned switch anywhere but editable fields. */
const allowedBy = (rule: FocusRule, focus: FocusClass): boolean =>
  rule === 'keyboard' ? focus === 'keying' : focus !== 'editable';

const KEYBOARD_CODES: ReadonlySet<string> = new Set(['Space', 'Enter', 'NumpadEnter']);

const scenarioArb = fc
  .oneof(fc.constantFrom('KeyJ', 'F13', 'KeyA'), fc.string({ minLength: 1, maxLength: 6 }))
  .filter((code) => !['Space', 'Enter', 'NumpadEnter', 'Tab', 'Escape'].includes(code))
  .chain((learned) => fc.tuple(fc.constant(learned), keyScriptArb(learned)));

describe('KeyMachine properties', () => {
  it('respects the focus rule and alternates raw inputs for the keyboard and switch rules', () => {
    // Feature: input-sources, Property 13: Key routing respects focus and alternates raw inputs
    fc.assert(
      fc.property(scenarioArb, ([learned, script]) => {
        const runs: readonly { readonly rule: FocusRule; readonly codes: ReadonlySet<string> }[] = [
          { rule: 'keyboard', codes: KEYBOARD_CODES },
          { rule: 'switch', codes: new Set([learned]) },
        ];
        for (const { rule, codes } of runs) {
          let state = INITIAL_KEY_MACHINE_STATE;
          let open: string | null = null;
          /** Codes whose latest non-repeat keydown was blocked by the rule (and not the held key). */
          const blocked = new Set<string>();
          const raws: ('down' | 'up')[] = [];

          for (const event of script) {
            const activeBefore = state.active;
            if (event.type === 'down') {
              const decision = keyDown(state, event, codes, rule, event.focus);
              state = decision.state;
              const allowed = allowedBy(rule, event.focus);
              if (decision.raw === 'down') {
                expect(allowed).toBe(true);
                expect(event.repeat).toBe(false);
                expect(activeBefore).toBeNull();
                expect(codes.has(event.code)).toBe(true);
                expect(open).toBeNull();
                open = event.code;
                raws.push('down');
              } else {
                expect(decision.raw).toBeNull();
              }
              const heldKey = event.code === activeBefore;
              if (!allowed && !heldKey) {
                // Req 4.6, 5.11: a blocked keydown keeps its native behaviour. Only a repeat of
                // the key holding the press is prevented whatever the focus (Req 4.3).
                expect(decision.preventDefault).toBe(false);
              }
              if (!event.repeat && !heldKey && codes.has(event.code)) {
                if (allowed) blocked.delete(event.code);
                else blocked.add(event.code);
              }
            } else {
              const decision = keyUp(state, event);
              state = decision.state;
              if (decision.raw === 'up') {
                expect(event.code).toBe(open);
                open = null;
                raws.push('up');
              } else {
                expect(decision.raw).toBeNull();
              }
              if (blocked.has(event.code) && activeBefore !== event.code) {
                expect(decision.preventDefault).toBe(false);
              }
              blocked.delete(event.code);
            }
            // The machine's active key is exactly the open raw press.
            expect(state.active).toBe(open);
          }
          raws.forEach((raw, i) => expect(raw).toBe(i % 2 === 0 ? 'down' : 'up'));
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
