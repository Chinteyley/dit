import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMAND_TABLE } from './codes';
import {
  PROP_RUNS,
  encodeOrThrow,
  engineFor,
  feed,
  inputSequenceArb,
  modeArb,
  wordArb,
} from './test-support';
import { thresholds } from './timing';

const caseArb = fc
  .tuple(modeArb, fc.double({ min: 60, max: 600, noNaN: true }))
  .chain(([mode, unit]) =>
    fc.record({
      config: fc.constant({ mode, startingWpm: 20, initialDotEstimate: unit, initialDashEstimate: 3 * unit }),
      unit: fc.constant(unit),
      inputs: inputSequenceArb({ durationScale: unit }),
      word: wordArb,
      commandCode: fc.constantFrom(...Object.keys(COMMAND_TABLE)),
    }),
  );

describe('space properties', () => {
  it('emits at most one space per word gap, only after a committed character', () => {
    // Feature: morse-engine, Property 9: Space rules hold for every input stream
    fc.assert(
      fc.property(caseArb, ({ config, unit, inputs, word, commandCode }) => {
        const engine = engineFor(config);
        let charSinceReset = false;
        let charSinceSpace = false;
        let lastCommit: 'char' | 'command' | 'unknown' | null = null;
        let spacesSinceRelease = 0;

        feed(engine, inputs, ({ input, events, before }) => {
          if (input.type === 'reset') {
            charSinceReset = false;
            lastCommit = null;
            return;
          }
          if (events.some((event) => event.type === 'symbol')) {
            spacesSinceRelease = 0; // an accepted release starts a new silence period
          }
          events.forEach((event, index) => {
            if (event.type === 'char') {
              charSinceReset = true;
              charSinceSpace = true;
              lastCommit = 'char';
            } else if (event.type === 'command' || event.type === 'unknown') {
              lastCommit = event.type;
            } else if (event.type === 'space') {
              expect(charSinceReset).toBe(true);
              expect(charSinceSpace).toBe(true);
              expect(lastCommit).toBe('char');
              spacesSinceRelease += 1;
              expect(spacesSinceRelease).toBe(1);
              expect(input.type === 'press' || input.type === 'tick').toBe(true);
              expect(before.lastRelease).not.toBeNull();
              const wordGap = thresholds(before.estimates, before.startingUnit).wordGapThreshold;
              expect(input.t >= (before.lastRelease ?? Infinity) + wordGap).toBe(true);
              expect(index).toBe(events.length - 1);
              charSinceSpace = false;
            }
          });
        });

        // A word followed by a word-gap tick gets its space; a command followed by the same tick does not.
        const wordEngine = engineFor(config);
        feed(wordEngine, encodeOrThrow(word, unit).inputs);
        const afterWord = wordEngine.snapshot();
        const wordEvents = wordEngine.tick(
          (afterWord.lastRelease ?? 0) + wordEngine.estimates().wordGapThreshold,
        );
        expect(wordEvents[0]?.type).toBe('char');
        expect(wordEvents.at(-1)).toStrictEqual({ type: 'space' });

        const commandEngine = engineFor(config);
        let t = 0;
        [...commandCode].forEach((symbol, index) => {
          if (index > 0) t += unit;
          commandEngine.press(t);
          t += symbol === '.' ? unit : 3 * unit;
          commandEngine.release(t);
        });
        expect(commandEngine.tick(t + commandEngine.estimates().wordGapThreshold)).toStrictEqual([
          { type: 'command', command: COMMAND_TABLE[commandCode] },
        ]);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
