import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PROP_RUNS,
  alternates,
  bandScoreArb,
  betweenScoreArb,
  blinkFramesArb,
  blinkMinArb,
  closuresFromFrames,
  detectorFor,
  expectedBlinkEvents,
  faceRunFramesArb,
  intendedClosuresArb,
  nonFiniteArb,
  plain,
  validThresholdsArb,
  type Thresholds,
} from '../test-support';
import type { PressEvent } from '../types';
import type { BlinkDetector, FaceStatus, RawBlinkFrame } from './detector';

const isScore = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** Whether the detector would accept this frame's timestamp after `lastT` (Req 8.11). */
const accepted = (frame: RawBlinkFrame, lastT: number | null): boolean =>
  Number.isFinite(frame.t) && (lastT === null || frame.t >= lastT);

const isValidFrame = (frame: RawBlinkFrame): frame is RawBlinkFrame & { left: number; right: number } =>
  frame.face !== 'lost' && isScore(frame.left) && isScore(frame.right);

function detectorWith(th: Thresholds, min = 200): BlinkDetector {
  return detectorFor({ closeThreshold: th.close, openThreshold: th.open, minPressDuration: min });
}

describe('Blink_Detector properties', () => {
  it('changes Eye_State only on threshold crossings and face-lost frames', () => {
    // Feature: input-sources, Property 8: Blink hysteresis
    const scenarioArb = validThresholdsArb.chain((th) =>
      fc.tuple(
        fc.constant(th),
        blinkFramesArb(th),
        // The band-only suffix: scores that stay at or above Open and below Close.
        blinkFramesArb(th, { lostWeight: 0, score: betweenScoreArb(th), maxLength: 40 }),
      ),
    );
    fc.assert(
      fc.property(scenarioArb, ([th, prefix, between]) => {
        const d = detectorWith(th);
        for (const frame of prefix) {
          const before = d.eyeState();
          const wasAccepted = accepted(frame, d.state().lastT);
          d.push(frame);
          const after = d.eyeState();
          if (!wasAccepted) {
            expect(after).toBe(before);
          } else if (!isValidFrame(frame)) {
            expect(after).toBe('open');
          } else if (before === 'open') {
            expect(after).toBe(Math.min(frame.left, frame.right) >= th.close ? 'closed' : 'open');
          } else {
            expect(after).toBe(Math.max(frame.left, frame.right) < th.open ? 'open' : 'closed');
          }
        }
        // Shift the suffix after the prefix so its frames are accepted, then check no toggle at all.
        const offset = Math.max(0, ...prefix.map((frame) => (Number.isFinite(frame.t) ? frame.t : 0)));
        const state = d.eyeState();
        for (const frame of between) {
          d.push({ ...frame, t: Number.isFinite(frame.t) ? frame.t + offset : frame.t });
          expect(d.eyeState()).toBe(state);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('turns exactly the Closures that last at least the minimum into one pair each', () => {
    // Feature: input-sources, Property 9: Minimum closure
    const scenarioArb = fc
      .tuple(validThresholdsArb, blinkMinArb)
      .chain(([th, min]) => fc.tuple(fc.constant(th), fc.constant(min), intendedClosuresArb(th)));
    fc.assert(
      fc.property(scenarioArb, ([th, min, ops]) => {
        const d = detectorWith(th, min);
        const events: PressEvent[] = [];
        for (const op of ops) {
          if (op.type === 'setMin') expect(d.setMinPressDuration(op.value).ok).toBe(true);
          else events.push(...d.push(op.frame).events);
        }
        expect(alternates(events)).toBe(true);
        expect(events.every((event) => event.source === 'blink')).toBe(true);
        const closures = closuresFromFrames(ops, th, min);
        expect(plain(events)).toStrictEqual(plain(expectedBlinkEvents(closures)));
        // Each pair lasts at least the minimum in effect when its Closure started.
        const ended = closures.filter((c) => c.end !== null && c.end - c.start >= c.min);
        for (let i = 0; i + 1 < events.length; i += 2) {
          const closure = ended[i / 2];
          const [down, up] = [events[i], events[i + 1]];
          expect(closure).toBeDefined();
          if (closure === undefined || down === undefined || up === undefined) continue;
          expect(up.t - down.t).toBeGreaterThanOrEqual(closure.min);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('reports face status changes once each, alternating from face-lost', () => {
    // Feature: input-sources, Property 10: Face status reports are deduplicated and correct
    const scenarioArb = validThresholdsArb.chain((th) =>
      fc.tuple(
        fc.constant(th),
        fc.oneof(
          faceRunFramesArb(th, 0.4),
          blinkFramesArb(th, { lostWeight: 40 }),
          blinkFramesArb(th, { lostWeight: 30 }),
        ),
      ),
    );
    fc.assert(
      fc.property(scenarioArb, ([th, frames]) => {
        const d = detectorWith(th);
        let modelLast: FaceStatus = 'active';
        const reports: FaceStatus[] = [];
        for (const frame of frames) {
          const wasAccepted = accepted(frame, d.state().lastT);
          const eyeBefore = d.eyeState();
          const { face } = d.push(frame);
          let expected: FaceStatus | null = null;
          if (wasAccepted) {
            const status: FaceStatus = isValidFrame(frame) ? 'active' : 'face-lost';
            if (status !== modelLast) {
              expected = status;
              modelLast = status;
            }
          }
          expect(face).toBe(expected);
          if (face === 'active') {
            // The frame that reports 'active' is processed from Eye_State open.
            expect(eyeBefore).toBe('open');
          }
          if (face !== null) reports.push(face);
        }
        reports.forEach((report, i) => expect(report).toBe(i % 2 === 0 ? 'face-lost' : 'active'));
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('ignores stale and non-finite frames and treats bad scores as face lost', () => {
    // Feature: input-sources, Property 11: Invalid and stale frames
    const badScoreArb = fc.oneof(
      fc.constant(undefined),
      fc.constantFrom(Number.NaN, Infinity, -Infinity, -0.01, 1.01),
      fc.string(),
      fc.anything(),
    ).filter((value) => !isScore(value));
    const scenarioArb = validThresholdsArb.chain((th) =>
      fc.record({
        th: fc.constant(th),
        prefix: blinkFramesArb(th),
        kind: fc.constantFrom<'stale' | 'non-finite' | 'bad-score'>('stale', 'non-finite', 'bad-score'),
        delta: fc.integer({ min: 1, max: 500 }),
        ahead: fc.nat({ max: 200 }),
        nonFinite: nonFiniteArb,
        good: bandScoreArb(th),
        bad: badScoreArb,
        which: fc.constantFrom<'left' | 'right' | 'both' | 'missing'>('left', 'right', 'both', 'missing'),
      }),
    );
    fc.assert(
      fc.property(scenarioArb, ({ th, prefix, kind, delta, ahead, nonFinite, good, bad, which }) => {
        const replay = (): BlinkDetector => {
          const d = detectorWith(th);
          prefix.forEach((frame) => d.push(frame));
          return d;
        };
        const d = replay();
        const lastT = d.state().lastT;

        if (kind === 'stale' || kind === 'non-finite') {
          if (kind === 'stale' && lastT === null) return;
          const t = kind === 'stale' ? (lastT ?? 0) - delta : nonFinite;
          const before = d.state();
          const out = d.push({ t, left: good, right: good });
          expect(out.events).toStrictEqual([]);
          expect(out.face).toBeNull();
          expect(d.state()).toStrictEqual(before);
          return;
        }

        const t = (lastT ?? 0) + ahead;
        const frame: RawBlinkFrame =
          which === 'missing'
            ? { t, left: good }
            : { t, left: which === 'right' ? good : bad, right: which === 'left' ? good : bad };
        const copy = replay();
        const out = d.push(frame);
        const lostOut = copy.push({ t, face: 'lost' });
        expect(plain(out.events)).toStrictEqual(plain(lostOut.events));
        expect(out.face).toBe(lostOut.face);
        expect(d.state()).toStrictEqual(copy.state());
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('rejects invalid thresholds and applies valid ones from the next frame', () => {
    // Feature: input-sources, Property 7: Invalid settings are rejected and leave the previous values in effect
    const anyValueArb = fc.oneof(
      fc.anything(),
      fc.double(),
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.constantFrom(Number.NaN, Infinity, -Infinity, 0, -0.1, 1, 1.5),
    );
    const scenarioArb = validThresholdsArb.chain((th) =>
      fc.record({
        th: fc.constant(th),
        prefix: blinkFramesArb(th, { maxLength: 60 }),
        pair: fc.oneof(validThresholdsArb.map(({ close, open }) => [close, open] as const), fc.tuple(anyValueArb, anyValueArb)),
        next: fc.record({ step: fc.nat({ max: 120 }), left: fc.double({ min: 0, max: 1, noNaN: true }), right: fc.double({ min: 0, max: 1, noNaN: true }) }),
      }),
    );
    fc.assert(
      fc.property(scenarioArb, ({ th, prefix, pair: [close, open], next }) => {
        const d = detectorWith(th);
        prefix.forEach((frame) => d.push(frame));
        const before = d.state();

        const closeOk = typeof close === 'number' && Number.isFinite(close) && close > 0 && close <= 1;
        const openOk = typeof open === 'number' && Number.isFinite(open) && open > 0;
        const expectedInvalid =
          closeOk && openOk
            ? (open as number) < (close as number)
              ? []
              : ['closeThreshold', 'openThreshold']
            : [...(closeOk ? [] : ['closeThreshold']), ...(openOk ? [] : ['openThreshold'])];

        const result = d.setThresholds(close, open);
        if (expectedInvalid.length > 0) {
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error.invalid).toStrictEqual(expectedInvalid);
          expect(d.state()).toStrictEqual(before);
          return;
        }
        expect(result).toStrictEqual({ ok: true, value: { close, open } });
        // Eye_State and an open Closure are untouched by the change itself.
        expect(d.state()).toStrictEqual({ ...before, close, open });

        const t = (before.lastT ?? 0) + next.step;
        d.push({ t, left: next.left, right: next.right });
        const newClose = close as number;
        const newOpen = open as number;
        if (before.eye === 'open') {
          expect(d.eyeState()).toBe(Math.min(next.left, next.right) >= newClose ? 'closed' : 'open');
        } else {
          expect(d.eyeState()).toBe(Math.max(next.left, next.right) < newOpen ? 'open' : 'closed');
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
