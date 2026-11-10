import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbiterStep, createArbiter, safeTickTime, type ArbiterInput } from './arbiter';
import { createManualClock } from './clock';
import {
  PROP_RUNS,
  alternates,
  arbiterModel,
  createFakePressSource,
  interleavedArbiterInputsArb,
  nonDecreasing,
  nonFiniteArb,
  pressKindArb,
  randomArbiterInputsArb,
  runArbiter,
  sourceKindArb,
  wellFormedStreamArb,
} from './test-support';
import { SOURCE_KINDS, pressEvent, type SourceKind } from './types';

const anyInputsArb = fc.oneof(randomArbiterInputsArb, interleavedArbiterInputsArb);

describe('Input_Arbiter properties', () => {
  it('alternates and matches the reference model for any input sequence', () => {
    // Feature: input-sources, Property 1: Arbiter alternation and model conformance
    fc.assert(
      fc.property(anyInputsArb, (inputs) => {
        const { out, state } = runArbiter(inputs);
        expect(alternates(out)).toBe(true);
        expect(nonDecreasing(out)).toBe(true);
        out.forEach((event, i) => {
          expect(Object.keys(event).sort()).toStrictEqual(['kind', 'source', 't']);
          if (event.kind === 'up') expect(event.source).toBe(out[i - 1]?.source);
        });
        const model = arbiterModel(inputs);
        expect(out).toHaveLength(model.out.length);
        out.forEach((event, i) => expect(event).toStrictEqual(model.out[i]));
        expect(state).toStrictEqual(model.state);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('passes a single well-formed source through unchanged', () => {
    // Feature: input-sources, Property 2: Single-source pass-through
    const streamArb = sourceKindArb.chain((kind) => wellFormedStreamArb(kind, { maxGap: 2000, maxLength: 120 }));
    fc.assert(
      fc.property(streamArb, (events) => {
        const { out } = runArbiter(events.map((event): ArbiterInput => ({ type: 'event', event })));
        expect(out).toHaveLength(events.length);
        out.forEach((event, i) => {
          expect(event).toBe(events[i]);
          expect(event).toStrictEqual(events[i]);
        });
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('leaves the state unchanged for every input the rules discard', () => {
    // Feature: input-sources, Property 3: Discarded arbiter inputs change nothing
    const scenarioArb = anyInputsArb.chain((prefix) => {
      const { state } = runArbiter(prefix);
      const unmarkedOthers = SOURCE_KINDS.filter((kind) => kind !== state.holder && !state.marks.includes(kind));
      const cases: fc.Arbitrary<ArbiterInput>[] = [
        // Any event with a non-finite t.
        fc
          .tuple(pressKindArb, nonFiniteArb, sourceKindArb)
          .map(([kind, t, source]) => ({ type: 'event', event: pressEvent(kind, t, source) })),
      ];
      if (state.lastT !== null) {
        // A down earlier than the last output.
        const lastT = state.lastT;
        cases.push(
          fc
            .tuple(fc.integer({ min: 1, max: 1000 }), sourceKindArb)
            .map(([delta, source]) => ({ type: 'event', event: pressEvent('down', lastT - delta, source) })),
        );
      }
      if (unmarkedOthers.length > 0) {
        // An up from an unmarked source that is not the Holder (covers "any up while not Held").
        cases.push(
          fc
            .tuple(fc.integer({ min: -1000, max: 1000 }), fc.constantFrom(...unmarkedOthers))
            .map(([delta, source]) => ({
              type: 'event',
              event: pressEvent('up', (state.lastT ?? 0) + delta, source),
            })),
        );
      }
      return fc.tuple(fc.constant(state), fc.oneof(...cases));
    });

    fc.assert(
      fc.property(scenarioArb, ([state, input]) => {
        const before = structuredClone(state);
        const step = arbiterStep(state, input);
        expect(step.out).toBeNull();
        expect(step.state).toStrictEqual(before);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('reports the earliest pending Raw_Down across connected sources', () => {
    // Feature: input-sources, Property 4: Pending signal is the earliest pending Raw_Down
    const changesArb = fc.array(
      fc.record({
        kind: sourceKindArb,
        since: fc.option(fc.integer({ min: 0, max: 1e6 }), { nil: null }),
      }),
      { maxLength: 60, size: 'max' },
    );
    fc.assert(
      fc.property(
        fc.subarray([...SOURCE_KINDS], { minLength: 1 }),
        changesArb,
        fc.integer({ min: -1e6, max: 2e6 }),
        (kinds, changes, now) => {
          const arbiter = createArbiter(createManualClock(0).now);
          const sources = new Map(kinds.map((kind) => [kind, createFakePressSource(kind)] as const));
          for (const source of sources.values()) {
            expect(arbiter.connect(source).ok).toBe(true);
          }
          const notified: (number | null)[] = [];
          arbiter.onPendingChange((since) => notified.push(since));
          const current = new Map<SourceKind, number | null>();
          let expectedLast: number | null = null;
          const expectedNotifications: (number | null)[] = [];

          for (const { kind, since } of changes) {
            const source = sources.get(kind);
            if (source === undefined) continue;
            source.setPending(since);
            current.set(kind, since);
            const values = [...current.values()].filter((value): value is number => value !== null);
            const earliest = values.length === 0 ? null : Math.min(...values);
            expect(arbiter.pendingSince()).toBe(earliest);
            const safe = safeTickTime(now, arbiter.pendingSince());
            if (earliest !== null) expect(safe).toBeLessThanOrEqual(earliest);
            else expect(safe).toBe(now);
            if (earliest !== expectedLast) {
              expectedNotifications.push(earliest);
              expectedLast = earliest;
            }
          }
          expect(notified).toStrictEqual(expectedNotifications);
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });
});
