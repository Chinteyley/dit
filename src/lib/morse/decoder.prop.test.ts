import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHARACTER_TABLE, COMMAND_TABLE, SUPPORTED_CHARACTERS, lookupPattern } from './codes';
import { step, type DecoderState, type Engine, type EngineInput } from './decoder';
import {
  PROP_RUNS,
  engineFor,
  guardedEstimatesArb,
  inputSequenceArb,
  modeArb,
  validConfigArb,
} from './test-support';
import type { EngineEvent, MorseSymbol } from './types';

type TimedType = Exclude<EngineInput['type'], 'reset'>;

const symbolArb = fc.constantFrom<MorseSymbol>('.', '-');

/** Keys symbols at a fixed unit with 1-unit gaps. Returns the per-release events and the last release time. */
function keySymbols(engine: Engine, symbols: readonly string[], unit: number, start = 0) {
  const releases: (readonly EngineEvent[])[] = [];
  let t = start;
  symbols.forEach((symbol, index) => {
    if (index > 0) t += unit;
    engine.press(t);
    t += symbol === '.' ? unit : 3 * unit;
    releases.push(engine.release(t));
  });
  return { releases, lastRelease: t };
}

function replay(state: DecoderState, inputs: readonly EngineInput[]): DecoderState {
  return inputs.reduce((current, input) => step(current, input).state, state);
}

const KNOWN_CODES = [
  ...SUPPORTED_CHARACTERS.map((char) => CHARACTER_TABLE[char] ?? ''),
  ...Object.keys(COMMAND_TABLE),
];

describe('decoder properties', () => {
  it('classifies each press with the thresholds held before its release', () => {
    // Feature: morse-engine, Property 5: Press classification uses pre-release thresholds
    fc.assert(
      fc.property(
        guardedEstimatesArb,
        modeArb,
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.oneof(
          fc.record({ kind: fc.constant('free' as const), d: fc.double({ min: 1e-3, max: 1e4, noNaN: true }) }),
          fc.record({ kind: fc.constant('edge' as const), offset: fc.constantFrom(-1e-6, -1e-9, 0, 1e-9, 1e-6) }),
        ),
        (estimates, mode, t0, duration) => {
          const engine = engineFor({
            mode,
            initialDotEstimate: estimates.dotEstimate,
            initialDashEstimate: estimates.dashEstimate,
          });
          const before = engine.estimates();
          const threshold = (before.dotEstimate + before.dashEstimate) / 2;
          const d = duration.kind === 'free' ? duration.d : threshold + duration.offset;
          const releaseAt = t0 + d;
          expect(engine.press(t0)).toStrictEqual([]);
          const expected: MorseSymbol = releaseAt >= t0 + threshold ? '-' : '.';
          expect(engine.release(releaseAt)).toStrictEqual([{ type: 'symbol', symbol: expected }]);
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });

  it('leaves the state untouched for ignored inputs and only lifts the switch for zero-length presses', () => {
    // Feature: morse-engine, Property 6: Ignored and zero-length inputs change nothing
    fc.assert(
      fc.property(
        validConfigArb,
        inputSequenceArb(),
        fc.constantFrom(
          'non-finite',
          'stale',
          'press-while-down',
          'release-while-up',
          'release-after-reset',
          'zero-length',
        ),
        fc.constantFrom<TimedType>('press', 'release', 'tick'),
        fc.constantFrom(Number.NaN, Infinity, -Infinity),
        fc.double({ min: 1e-6, max: 1e4, noNaN: true }),
        fc.double({ min: 0, max: 1e4, noNaN: true }),
        (config, prefix, probe, kind, badValue, delta, dt) => {
          let state = replay(engineFor(config).snapshot(), prefix);
          const now = (): number => state.lastT ?? 0;
          let input: EngineInput;
          switch (probe) {
            case 'non-finite':
              input = { type: kind, t: badValue };
              break;
            case 'stale': {
              if (state.lastT === null) state = step(state, { type: 'tick', t: 0 }).state;
              const t = now() - delta;
              fc.pre(t < now());
              input = { type: kind, t };
              break;
            }
            case 'press-while-down':
              if (!state.switchDown) state = step(state, { type: 'press', t: now() }).state;
              input = { type: 'press', t: now() + dt };
              break;
            case 'release-while-up':
              if (state.switchDown) state = step(state, { type: 'release', t: now() + 1 }).state;
              input = { type: 'release', t: now() + dt };
              break;
            case 'release-after-reset':
              state = step(state, { type: 'reset' }).state;
              input = { type: 'release', t: now() + dt };
              break;
            case 'zero-length': {
              if (state.switchDown) state = step(state, { type: 'release', t: now() + 1 }).state;
              const t = now() + dt;
              state = step(state, { type: 'press', t }).state;
              const result = step(state, { type: 'release', t });
              expect(result.events).toStrictEqual([]);
              expect(result.state.switchDown).toBe(false);
              expect({ ...result.state, lastT: state.lastT, pressStart: state.pressStart }).toStrictEqual({
                ...state,
                switchDown: false,
              });
              return;
            }
          }
          const result = step(state, input);
          expect(result.events).toStrictEqual([]);
          expect(result.state).toStrictEqual(state);
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });

  it('commits any 10th symbol as unknown at once', () => {
    // Feature: morse-engine, Property 7: The 10th symbol forces an unknown commit
    fc.assert(
      fc.property(
        fc.array(symbolArb, { minLength: 10, maxLength: 10 }),
        fc.double({ min: 60, max: 600, noNaN: true }),
        (symbols, unit) => {
          const engine = engineFor({ mode: 'fixed', startingWpm: 1200 / unit });
          const keyed = keySymbols(engine, symbols, engine.estimates().dotEstimate);
          keyed.releases.slice(0, 9).forEach((events, index) => {
            expect(events).toStrictEqual([{ type: 'symbol', symbol: symbols[index] }]);
          });
          expect(keyed.releases[9]).toStrictEqual([
            { type: 'symbol', symbol: symbols[9] },
            { type: 'unknown', pattern: symbols.join('') },
          ]);
          const state = engine.snapshot();
          expect(state.buffer).toBe('');
          expect(state.spaceEligible).toBe(false);
          expect(engine.nextDeadline()).toBeNull();
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });

  it('commits a pattern once, exactly when the silence reaches the letter gap', () => {
    // Feature: morse-engine, Property 8: Letter-gap commit happens once, exactly at the threshold
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...KNOWN_CODES),
          fc.array(symbolArb, { minLength: 1, maxLength: 9 }).map((symbols) => symbols.join('')),
        ),
        fc.double({ min: 60, max: 600, noNaN: true }),
        fc.oneof(
          fc.record({ kind: fc.constant('free' as const), units: fc.double({ min: 0, max: 10, noNaN: true }) }),
          fc.record({ kind: fc.constant('edge' as const), offset: fc.constantFrom(-1e-9, 0, 1e-9) }),
        ),
        fc.constantFrom('tick', 'press'),
        (pattern, unit, silence, trigger) => {
          const engine = engineFor({ mode: 'fixed', startingWpm: 20, initialDotEstimate: unit, initialDashEstimate: 3 * unit });
          const { letterGapThreshold: LG, wordGapThreshold: WG } = engine.estimates();
          const { lastRelease } = keySymbols(engine, [...pattern], unit);
          expect(engine.snapshot().buffer).toBe(pattern);

          const s = silence.kind === 'free' ? silence.units * unit : LG + silence.offset;
          const t = lastRelease + s;
          const commits = t >= lastRelease + LG;
          const events = trigger === 'tick' ? engine.tick(t) : engine.press(t);
          const state = engine.snapshot();

          if (!commits) {
            expect(events).toStrictEqual([]);
            expect(state.buffer).toBe(pattern);
            if (trigger === 'press') {
              const appended = engine.release(t + unit);
              const extended = `${pattern}.`;
              expect(appended).toStrictEqual(
                extended.length === 10
                  ? [{ type: 'symbol', symbol: '.' }, { type: 'unknown', pattern: extended }]
                  : [{ type: 'symbol', symbol: '.' }],
              );
              if (extended.length < 10) expect(engine.snapshot().buffer).toBe(extended);
            }
            return;
          }

          const found = lookupPattern(pattern);
          const commit: EngineEvent =
            found.kind === 'command'
              ? { type: 'command', command: found.command }
              : found.kind === 'char'
                ? { type: 'char', char: found.char }
                : { type: 'unknown', pattern: found.pattern };
          const spaced = found.kind === 'char' && t >= lastRelease + WG;
          expect(events).toStrictEqual(spaced ? [commit, { type: 'space' }] : [commit]);
          expect(state.buffer).toBe('');
          expect(state.spaceEligible).toBe(found.kind === 'char' && !spaced);
          if (trigger === 'tick') {
            const later = engine.tick(t + 100 * unit);
            expect(later.filter((event) => event.type !== 'space')).toStrictEqual([]);
          }
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });
});
