import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MIN_PRESS_RANGES, createDebouncer } from './debounce';
import {
  PROP_RUNS,
  alternates,
  applyDebounceOp,
  debounceModel,
  debounceOpsArb,
  pairsOf,
  plain,
  sourceKindArb,
  validMinArb,
  type DebounceOp,
} from './test-support';
import type { PressEvent, SourceKind } from './types';

const scriptArb = sourceKindArb.chain((kind) =>
  validMinArb(kind).chain((min) => fc.tuple(fc.constant(kind), fc.constant(min), debounceOpsArb([min]))),
);

function run(kind: SourceKind, min: number, ops: readonly DebounceOp[]): readonly (readonly PressEvent[])[] {
  const debouncer = createDebouncer(kind, min);
  return ops.map((op) => applyDebounceOp(debouncer, op));
}

describe('Debouncer properties', () => {
  it('emits exactly the presses the reference model accepts, alternating, each at least min long', () => {
    // Feature: input-sources, Property 5: Debounce property
    fc.assert(
      fc.property(scriptArb, ([kind, min, ops]) => {
        const perCall = run(kind, min, ops);
        const model = debounceModel(kind, min, ops);
        expect(perCall.map(plain)).toStrictEqual(model.perOp.map(plain));

        const events = perCall.flat();
        expect(alternates(events)).toBe(true);
        expect(events.every((event) => event.source === kind)).toBe(true);
        const rawDownTimes = new Set(ops.flatMap((op) => (op.type === 'rawDown' ? [op.t] : [])));
        pairsOf(events).pairs.forEach(([down, up], i) => {
          expect(rawDownTimes.has(down.t)).toBe(true);
          // A Raw_Up stamped before the advance that confirmed the press can only come from a clock
          // running backwards; its down was already out, so the pair is kept as the table says.
          if (!model.staleUps.has(2 * i + 1)) {
            expect(up.t - down.t).toBeGreaterThanOrEqual(min);
          }
        });
        if (min === 0) {
          // Every accepted Raw_Down emits its down in the same call (Req 3.7).
          let held = false;
          ops.forEach((op, i) => {
            const out = perCall[i] ?? [];
            if (op.type === 'rawDown' && Number.isFinite(op.t) && !held) {
              expect(plain(out)).toStrictEqual([{ kind: 'down', t: op.t, source: kind }]);
            }
            if (out.length > 0) held = out.at(-1)?.kind === 'down';
          });
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('keeps Debouncers independent and captures the setting per press', () => {
    // Feature: input-sources, Property 6: Debouncers are independent and capture their setting per press
    const scenarioArb = fc
      .tuple(sourceKindArb, sourceKindArb)
      .filter(([a, b]) => a !== b)
      .chain(([kindA, kindB]) =>
        fc.tuple(validMinArb(kindA), validMinArb(kindA), validMinArb(kindB)).chain(([minA, newMinA, minB]) =>
          fc.record({
            kindA: fc.constant(kindA),
            kindB: fc.constant(kindB),
            minA: fc.constant(minA),
            newMinA: fc.constant(newMinA),
            minB: fc.constant(minB),
            opsA: debounceOpsArb([minA, newMinA]),
            opsB: debounceOpsArb([minB]),
            mask: fc.array(fc.boolean(), { maxLength: 240, size: 'max' }),
            changeAt: fc.nat(),
          }),
        ),
      );

    fc.assert(
      fc.property(scenarioArb, ({ kindA, kindB, minA, newMinA, minB, opsA, opsB, mask, changeAt }) => {
        const k = changeAt % (opsA.length + 1);
        const opsAChanged: DebounceOp[] = [...opsA.slice(0, k), { type: 'setMin', value: newMinA }, ...opsA.slice(k)];

        // Interleave A and B in one call order; the mask picks the next source when both have ops left.
        const interleave = (a: readonly DebounceOp[]) => {
          const order: ('A' | 'B')[] = [];
          let i = 0;
          let j = 0;
          let m = 0;
          while (i < a.length || j < opsB.length) {
            const pickA = j >= opsB.length || (i < a.length && (mask[m++ % Math.max(mask.length, 1)] ?? true));
            order.push(pickA ? 'A' : 'B');
            if (pickA) i++;
            else j++;
          }
          return order;
        };
        const runPair = (a: readonly DebounceOp[]) => {
          const debA = createDebouncer(kindA, minA);
          const debB = createDebouncer(kindB, minB);
          const outA: PressEvent[] = [];
          const outB: PressEvent[] = [];
          let i = 0;
          let j = 0;
          for (const who of interleave(a)) {
            if (who === 'A') {
              const op = a[i++];
              if (op !== undefined) outA.push(...applyDebounceOp(debA, op));
            } else {
              const op = opsB[j++];
              if (op !== undefined) outB.push(...applyDebounceOp(debB, op));
            }
          }
          return { outA, outB };
        };

        const plainRun = runPair(opsA);
        const changedRun = runPair(opsAChanged);
        const aloneB = run(kindB, minB, opsB).flat();

        // Changing A's setting, or interleaving with A at all, leaves B's output unchanged.
        expect(plain(changedRun.outB)).toStrictEqual(plain(plainRun.outB));
        expect(plain(plainRun.outB)).toStrictEqual(plain(aloneB));

        // A's output with the change equals the model that captures min at each Raw_Down.
        expect(plain(changedRun.outA)).toStrictEqual(plain(debounceModel(kindA, minA, opsAChanged).perOp.flat()));

        // Until the next Raw_Down that starts a press, the output is the same as without the change,
        // so a pending or confirmed press at the change ends exactly as it would have.
        const replay = createDebouncer(kindA, minA);
        const before: (readonly PressEvent[])[] = [];
        let nextPress = opsA.length;
        opsA.forEach((op, index) => {
          if (
            nextPress === opsA.length &&
            index >= k &&
            op.type === 'rawDown' &&
            Number.isFinite(op.t) &&
            replay.state().phase === 'idle'
          ) {
            nextPress = index;
          }
          before.push(applyDebounceOp(replay, op));
        });
        const after = run(kindA, minA, opsAChanged).filter((_, index) => index !== k);
        expect(after.slice(0, nextPress).map(plain)).toStrictEqual(before.slice(0, nextPress).map(plain));
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('rejects invalid Min_Press_Duration values and keeps the previous value', () => {
    // Feature: input-sources, Property 7: Invalid settings are rejected and leave the previous values in effect
    const isValid = (kind: SourceKind, value: unknown): boolean =>
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= MIN_PRESS_RANGES[kind].min &&
      value <= MIN_PRESS_RANGES[kind].max;
    const scenarioArb = sourceKindArb.chain((kind) =>
      fc.record({
        kind: fc.constant(kind),
        previous: validMinArb(kind),
        invalid: fc
          .oneof(
            fc.anything(),
            fc.double(),
            fc.constantFrom(Number.NaN, Infinity, -Infinity, -1, 501, 2001, 49, -0.001, 500.5),
          )
          .filter((value) => !isValid(kind, value)),
      }),
    );

    fc.assert(
      fc.property(scenarioArb, ({ kind, previous, invalid }) => {
        const debouncer = createDebouncer(kind);
        expect(debouncer.setMinPressDuration(previous)).toStrictEqual({ ok: true, value: previous === 0 ? 0 : previous });

        const result = debouncer.setMinPressDuration(invalid);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.source).toBe(kind);
        expect(result.error.setting).toBe('minPressDuration');
        expect(Object.is(result.error.value, invalid)).toBe(true);
        expect(result.error.message).toContain(kind);
        expect(result.error.message).toContain(String(MIN_PRESS_RANGES[kind].max));
        expect(debouncer.minPressDuration()).toBe(previous === 0 ? 0 : previous);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
