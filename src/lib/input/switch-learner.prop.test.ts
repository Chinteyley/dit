import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isReservedKey } from './switch';
import { PROP_RUNS, createKeyRig, keyScriptArb, type KeyRig, type KeyScriptEvent } from './test-support';

function play(rig: KeyRig, events: readonly KeyScriptEvent[]): void {
  for (const event of events) {
    rig.focus = event.focus;
    rig.clock.advance(7);
    rig.scheduler.runDue(rig.clock.now());
    if (event.type === 'down') rig.target.down(event.code, event.repeat);
    else rig.target.up(event.code);
  }
}

const scenarioArb = fc
  .oneof(fc.constantFrom('KeyJ', 'F13', 'KeyA', 'ShiftLeft'), fc.string({ minLength: 1, maxLength: 8 }))
  .filter((code) => !isReservedKey(code))
  .chain((code) =>
    fc.record({
      code: fc.constant(code),
      storedKey: fc.constantFrom<unknown>(undefined, 'KeyJ', code),
      min: fc.constantFrom(0, 30),
      before: keyScriptArb(code, { maxLength: 30 }),
      after: keyScriptArb(code, { maxLength: 30 }),
      keyupAt: fc.nat(),
      learnFocus: fc.constantFrom<'keying' | 'editable' | 'interactive'>('keying', 'editable', 'interactive'),
    }),
  );

describe('Switch_Learner properties', () => {
  it('learns the key from one press that keys no Morse at all', async () => {
    // Feature: input-sources, Property 15: The learning press never keys Morse
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ code, storedKey, min, before, after, keyupAt, learnFocus }) => {
        const rig = createKeyRig({ storedKey, min });
        rig.keyboard.start();
        rig.switchSource.start();
        play(rig, before);

        const learning = rig.learner.arm();
        rig.focus = learnFocus;
        const seen = rig.presses.length;
        rig.target.down(code);
        // The learning keydown starts nothing; at most it ends the old switch press (Req 5.13).
        const duringDown = rig.presses.slice(seen);
        expect(duringDown.every((event) => event.kind === 'up' && event.source === 'switch')).toBe(true);
        expect(duringDown.length).toBeLessThanOrEqual(1);

        expect(await learning).toStrictEqual({ ok: true, value: code });
        expect(rig.store.value).toBe(code);
        expect(rig.switchSource.learnedKey()).toBe(code);

        // The matching keyup arrives at any later point, before or after other events. While the
        // learning key is still down, the only events it can produce itself are auto-repeats.
        const split = keyupAt % (after.length + 1);
        const whileHeld = after
          .slice(0, split)
          .filter((event) => event.code !== code || (event.type === 'down' && event.repeat));
        play(rig, whileHeld);
        const beforeUp = rig.presses.length;
        rig.target.up(code);
        expect(rig.presses.length).toBe(beforeUp);
        play(rig, after.slice(split));

        // The Switch_Source keys Morse with the learned code from now on.
        rig.page.blur();
        rig.focus = 'keying';
        const start = rig.presses.length;
        rig.clock.advance(100);
        rig.target.down(code);
        rig.clock.advance(100);
        rig.scheduler.runDue(rig.clock.now());
        rig.target.up(code);
        expect(rig.presses.slice(start).map((event) => `${event.kind}:${event.source}`)).toStrictEqual([
          'down:switch',
          'up:switch',
        ]);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
