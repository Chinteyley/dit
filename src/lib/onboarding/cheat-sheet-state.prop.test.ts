import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CLOSED_SHEET, cheatSheetStep, type CheatSheetState } from './cheat-sheet-state';
import { PROP_RUNS, arbCheatSheetRun, referenceSheet } from './test-support';

describe('Cheat_Sheet state properties', () => {
  // Feature: onboarding-and-safety, Property 16: The Cheat_Sheet state follows its model
  it('P16 the cheat sheet state follows its model', () => {
    fc.assert(
      fc.property(arbCheatSheetRun({ max: 200 }), (steps) => {
        const expected = referenceSheet(steps);
        let state: CheatSheetState = CLOSED_SHEET;
        steps.forEach(({ action, ctx }, i) => {
          const before = state;
          state = cheatSheetStep(state, action, ctx);
          expect(state).toEqual(expected[i]);
          if (!state.open) expect(state).toEqual(CLOSED_SHEET);
          if (ctx.alarmActive && action.type !== 'char-committed') expect(state).toBe(before);
        });
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
