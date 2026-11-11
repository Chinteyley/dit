import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FocusClass } from './focus';
import {
  CHILD_TARGET,
  OUTSIDE_TARGET,
  PROP_RUNS,
  SURFACE_TARGET,
  alternates,
  createKeyRig,
  createPointerRig,
  focusClassArb,
  nonDecreasing,
  validMinArb,
  type DomSourceKind,
} from './test-support';
import type { PressEvent, PressSource, SourceStatus } from './types';

type EndVia = 'surface-up' | 'surface-cancel' | 'lost' | 'doc-up' | 'doc-cancel';

type Op =
  | { readonly type: 'start' | 'stop' | 'blur' | 'hide' | 'show' }
  | { readonly type: 'advance'; readonly dt: number }
  | { readonly type: 'key'; readonly edge: 'down' | 'up'; readonly code: string; readonly repeat: boolean; readonly focus: FocusClass }
  | {
      readonly type: 'pointerdown';
      readonly pointerId: number;
      readonly isPrimary: boolean;
      readonly pointerType: string;
      readonly button: number;
      readonly where: 'surface' | 'child' | 'outside';
      readonly captureFails: boolean;
    }
  | { readonly type: 'pointerend'; readonly via: EndVia; readonly pointerId: number };

const lifecycleArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: fc.constant({ type: 'start' } as const) },
  { weight: 1, arbitrary: fc.constant({ type: 'stop' } as const) },
  { weight: 2, arbitrary: fc.constantFrom<Op>({ type: 'blur' }, { type: 'hide' }, { type: 'show' }) },
  { weight: 5, arbitrary: fc.record({ type: fc.constant('advance' as const), dt: fc.integer({ min: 0, max: 120 }) }) },
);

const keyOpArb: fc.Arbitrary<Op> = fc.record({
  type: fc.constant('key' as const),
  edge: fc.constantFrom<'down' | 'up'>('down', 'up'),
  code: fc.constantFrom('Space', 'Enter', 'NumpadEnter', 'KeyJ', 'KeyA', 'Tab'),
  repeat: fc.oneof({ weight: 4, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }),
  focus: focusClassArb,
});

const pointerIdArb = fc.constantFrom(1, 2, 3);
const pointerOpArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    type: fc.constant('pointerdown' as const),
    pointerId: pointerIdArb,
    isPrimary: fc.oneof({ weight: 4, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) }),
    pointerType: fc.constantFrom('mouse', 'touch', 'pen'),
    button: fc.constantFrom(0, 0, 1, 2),
    where: fc.constantFrom<'surface' | 'child' | 'outside'>('surface', 'surface', 'child', 'outside'),
    captureFails: fc.oneof({ weight: 3, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }),
  }),
  fc.record({
    type: fc.constant('pointerend' as const),
    via: fc.constantFrom<EndVia>('surface-up', 'surface-up', 'surface-cancel', 'lost', 'doc-up', 'doc-cancel'),
    pointerId: pointerIdArb,
  }),
);

/** About half the releases target the most recent press, so presses complete. */
function withMatchingReleases(ops: readonly Op[], recent: readonly boolean[]): Op[] {
  let lastCode = 'Space';
  let lastPointer = 1;
  return ops.map((op, i) => {
    if (op.type === 'key') {
      if (op.edge === 'down') lastCode = op.code;
      else if (recent[i] === true) return { ...op, code: lastCode };
    }
    if (op.type === 'pointerdown') lastPointer = op.pointerId;
    if (op.type === 'pointerend' && recent[i] === true) return { ...op, pointerId: lastPointer };
    return op;
  });
}

const scenarioArb = fc.constantFrom<DomSourceKind>('keyboard', 'switch', 'pointer').chain((kind) =>
  fc.tuple(
    fc.constant(kind),
    validMinArb(kind),
    fc.array(fc.oneof({ weight: 1, arbitrary: lifecycleArb }, { weight: 1, arbitrary: kind === 'pointer' ? pointerOpArb : keyOpArb }), {
      maxLength: 150,
      size: 'max',
    }),
    fc.array(fc.boolean(), { minLength: 150, maxLength: 150 }),
  ),
);

interface Harness {
  readonly source: PressSource;
  readonly now: () => number;
  readonly advance: (dt: number) => void;
  readonly page: { blur(): void; hide(): void; show(): void };
  readonly raw: (op: Op) => void;
  /** Listeners, timers, pointer captures and applied gesture styles the source holds. */
  readonly held: () => { readonly listeners: number; readonly timers: number; readonly captures: number; readonly style: boolean };
}

function harness(kind: DomSourceKind, min: number): Harness {
  if (kind === 'pointer') {
    const rig = createPointerRig({ min });
    const targets = { surface: SURFACE_TARGET, child: CHILD_TARGET, outside: OUTSIDE_TARGET } as const;
    return {
      source: rig.pointer,
      now: rig.clock.now,
      advance(dt) {
        rig.clock.advance(dt);
        rig.scheduler.runDue(rig.clock.now());
      },
      page: rig.page,
      raw(op) {
        if (op.type === 'pointerdown') {
          rig.surface.captureFails = op.captureFails;
          rig.surface.dispatch('pointerdown', { ...op, target: targets[op.where] });
        } else if (op.type === 'pointerend') {
          const init = { pointerId: op.pointerId };
          if (op.via === 'surface-up') rig.surface.dispatch('pointerup', init);
          else if (op.via === 'surface-cancel') rig.surface.dispatch('pointercancel', init);
          else if (op.via === 'lost') rig.surface.dispatch('lostpointercapture', init);
          else rig.doc.dispatch(op.via === 'doc-up' ? 'pointerup' : 'pointercancel', init);
        }
      },
      held: () => ({
        listeners: rig.surface.listenerCount() + rig.doc.listenerCount() + rig.page.listenerCount(),
        timers: rig.scheduler.pending(),
        captures: rig.surface.captured.size,
        style: rig.surface.styleApplied(),
      }),
    };
  }
  const rig = createKeyRig({ storedKey: 'KeyJ', min });
  return {
    source: kind === 'keyboard' ? rig.keyboard : rig.switchSource,
    now: rig.clock.now,
    advance(dt) {
      rig.clock.advance(dt);
      rig.scheduler.runDue(rig.clock.now());
    },
    page: rig.page,
    raw(op) {
      if (op.type !== 'key') return;
      rig.focus = op.focus;
      if (op.edge === 'down') rig.target.down(op.code, op.repeat);
      else rig.target.up(op.code);
    },
    held: () => ({
      listeners: rig.target.listenerCount() + rig.page.listenerCount(),
      timers: rig.scheduler.pending(),
      captures: 0,
      style: false,
    }),
  };
}

describe('source lifecycle properties', () => {
  it('keeps the Press_Source contract for the keyboard, switch and pointer sources', () => {
    // Feature: input-sources, Property 14: Source lifecycle contract
    fc.assert(
      fc.property(scenarioArb, ([kind, min, rawOps, recent]) => {
        const ops = withMatchingReleases(rawOps, recent);
        const h = harness(kind, min);
        const events: PressEvent[] = [];
        const statuses: SourceStatus[] = [];
        h.source.onPress((event) => {
          // No Press_Event while the status is 'off' (Req 1.4).
          expect(h.source.status()).not.toBe('off');
          events.push(event);
        });
        h.source.onStatus((status) => statuses.push(status));
        const isHeld = (): boolean => events.at(-1)?.kind === 'down';

        for (const op of ops) {
          const status = h.source.status();
          const heldBefore = isHeld();
          const pendingBefore = h.source.pendingSince();
          const eventCount = events.length;
          const statusCount = statuses.length;
          const resources = h.held();

          switch (op.type) {
            case 'start':
              h.source.start();
              expect(events.length).toBe(eventCount);
              if (status === 'off') {
                // 'active' is reported before start() returns (Req 1.3).
                expect(statuses.slice(statusCount)).toStrictEqual(['active']);
              } else {
                // Redundant start (Req 1.6).
                expect(statuses.length).toBe(statusCount);
                expect(h.held()).toStrictEqual(resources);
              }
              break;
            case 'stop':
              h.source.stop();
              if (status === 'off') {
                expect(events.length).toBe(eventCount);
                expect(statuses.length).toBe(statusCount);
                expect(h.held()).toStrictEqual(resources);
                break;
              }
              expect(statuses.slice(statusCount)).toStrictEqual(['off']);
              if (heldBefore) {
                // Exactly one up at the clock, before 'off' (Req 1.5, 6.10).
                expect(events.slice(eventCount).map((e) => [e.kind, e.t])).toStrictEqual([['up', h.now()]]);
              } else {
                // A pending press is discarded (Req 1.4).
                expect(events.length).toBe(eventCount);
              }
              expect(h.source.pendingSince()).toBeNull();
              expect(h.held()).toStrictEqual({ listeners: 0, timers: 0, captures: 0, style: false });
              break;
            case 'blur':
            case 'hide':
              if (op.type === 'blur') h.page.blur();
              else h.page.hide();
              expect(statuses.length).toBe(statusCount);
              if (status !== 'off' && heldBefore) {
                expect(events.slice(eventCount).map((e) => [e.kind, e.t])).toStrictEqual([['up', h.now()]]);
              } else {
                // Pending presses are discarded, idle sources emit nothing (Req 7.3, 7.8).
                expect(events.length).toBe(eventCount);
              }
              if (status !== 'off' && pendingBefore !== null) {
                expect(h.source.pendingSince()).toBeNull();
              }
              break;
            case 'show':
              h.page.show();
              expect(events.length).toBe(eventCount);
              expect(statuses.length).toBe(statusCount);
              break;
            case 'advance':
              h.advance(op.dt);
              break;
            default:
              h.raw(op);
              if (status === 'off') expect(events.length).toBe(eventCount);
          }
        }

        expect(alternates(events)).toBe(true);
        expect(nonDecreasing(events)).toBe(true);
        expect(events.every((event) => event.source === kind)).toBe(true);
        // Consecutive status deliveries are never equal (Req 1.7).
        statuses.forEach((status, i) => expect(status).not.toBe(statuses[i - 1]));
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
