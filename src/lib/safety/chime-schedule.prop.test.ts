import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { chimeSchedule } from './chime-schedule';
import { PROP_RUNS, arbBadNumber, arbChimeInputs, referenceSchedule, type ChimeInputs } from './test-support';

/** A point in [from, to], biased to both ends and to Chime times inside the window. */
function pointIn({ s, from, to }: ChimeInputs): fc.Arbitrary<number> {
  const ends = [fc.constant(from), fc.constant(to), fc.double({ min: from, max: to, noNaN: true })];
  const inside = referenceSchedule(s, from, to);
  return inside.length === 0 ? fc.oneof(...ends) : fc.oneof(...ends, fc.constantFrom(...inside));
}

/** A window [a, b) where a = b counts as empty (Requirement 5.6). */
const windowOf = (inputs: ChimeInputs, a: number, b: number): readonly number[] =>
  a >= b ? [] : chimeSchedule(inputs.s, a, b, inputs.x);

describe('Chime_Schedule properties', () => {
  // Feature: onboarding-and-safety, Property 8: The Chime_Schedule matches its model inside the window
  it('P8 the chime schedule matches its model inside the window', () => {
    fc.assert(
      fc.property(arbChimeInputs({ withStop: 'never' }), ({ s, from, to }) => {
        const times = chimeSchedule(s, from, to);
        expect(times).toEqual(referenceSchedule(s, from, to));
        for (let i = 0; i < times.length; i += 1) {
          const t = times[i] ?? Number.NaN;
          expect(t).toBeGreaterThanOrEqual(s);
          expect(t).toBeGreaterThanOrEqual(from);
          expect(t).toBeLessThan(to);
          if (i > 0) expect(t).toBeGreaterThan(times[i - 1] ?? Number.NaN);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: onboarding-and-safety, Property 9: The Chime_Period is exact
  it('P9 the chime period is exact', () => {
    fc.assert(
      fc.property(arbChimeInputs(), ({ s, from, to, x }) => {
        const times = chimeSchedule(s, from, to, x);
        times.forEach((t, i) => {
          const periods = (t - s) / 1000;
          expect(Math.abs(periods - Math.round(periods))).toBeLessThanOrEqual(1e-9);
          if (i > 0) expect(Math.abs(t - (times[i - 1] ?? Number.NaN) - 1000)).toBeLessThanOrEqual(0.001);
        });
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: onboarding-and-safety, Property 10: Splitting the window never repeats or skips a Chime
  it('P10 splitting the window never repeats or skips a chime', () => {
    const splitArb = arbChimeInputs().chain((inputs) =>
      fc.record({
        inputs: fc.constant(inputs),
        b: pointIn(inputs),
        cuts: fc.array(pointIn(inputs), { maxLength: 19 }).map((points) => [...points].sort((p, q) => p - q)),
      }),
    );
    fc.assert(
      fc.property(splitArb, ({ inputs, b, cuts }) => {
        const whole = chimeSchedule(inputs.s, inputs.from, inputs.to, inputs.x);
        expect([...windowOf(inputs, inputs.from, b), ...windowOf(inputs, b, inputs.to)]).toEqual(whole);
        const edges = [inputs.from, ...cuts, inputs.to];
        const pieces: number[] = [];
        for (let i = 1; i < edges.length; i += 1) {
          pieces.push(...windowOf(inputs, edges[i - 1] ?? Number.NaN, edges[i] ?? Number.NaN));
        }
        expect(pieces).toEqual(whole);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: onboarding-and-safety, Property 11: Nothing is scheduled at or after the stop time, and invalid inputs give an empty list
  it('P11 nothing at or after the stop time and invalid inputs give an empty list', () => {
    type Case =
      | { readonly kind: 'stop'; readonly inputs: ChimeInputs & { readonly x: number } }
      | { readonly kind: 'invalid'; readonly s: number; readonly from: number; readonly to: number; readonly x: number | undefined };
    const stopCase: fc.Arbitrary<Case> = arbChimeInputs({ withStop: 'always' })
      .filter((inputs): inputs is ChimeInputs & { readonly x: number } => inputs.x !== undefined)
      .map((inputs) => ({ kind: 'stop', inputs }));
    const invalidCase: fc.Arbitrary<Case> = fc
      .tuple(arbChimeInputs(), fc.constantFrom('s', 'from', 'to', 'x', 'reversed', 'empty'), arbBadNumber())
      .map(([inputs, field, bad]) => {
        const base = { kind: 'invalid' as const, s: inputs.s, from: inputs.from, to: inputs.to, x: inputs.x };
        switch (field) {
          case 'reversed':
            return { ...base, from: inputs.to, to: inputs.from };
          case 'empty':
            return { ...base, to: inputs.from };
          default:
            return { ...base, [field]: bad };
        }
      });
    fc.assert(
      fc.property(fc.oneof(stopCase, invalidCase), (c) => {
        if (c.kind === 'stop') {
          const { s, from, to, x } = c.inputs;
          const times = chimeSchedule(s, from, to, x);
          expect(times).toEqual(chimeSchedule(s, from, to).filter((t) => t < x));
          if (x <= s || x <= from) expect(times).toEqual([]);
          for (const t of times) expect(t).toBeLessThan(x);
        } else {
          expect(() => chimeSchedule(c.s, c.from, c.to, c.x)).not.toThrow();
          expect(chimeSchedule(c.s, c.from, c.to, c.x)).toEqual([]);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
