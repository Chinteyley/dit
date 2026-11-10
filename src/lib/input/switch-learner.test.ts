import { describe, expect, it } from 'vitest';
import { createKeyRig, plain } from './test-support';

describe('Switch_Learner', () => {
  it('learns a non-reserved key, saves it, uses it and keys no dot with it (Req 5.1, 5.5)', async () => {
    const rig = createKeyRig({ min: 0 });
    rig.keyboard.start();
    rig.switchSource.start();
    const learning = rig.learner.arm();
    expect(rig.learner.isArmed()).toBe(true);

    rig.focus = 'editable';
    const down = rig.target.down('KeyJ');
    expect(down.prevented).toBe(true);
    expect(await learning).toStrictEqual({ ok: true, value: 'KeyJ' });
    expect(rig.learner.isArmed()).toBe(false);
    expect(rig.store.value).toBe('KeyJ');
    expect(rig.switchSource.learnedKey()).toBe('KeyJ');

    rig.target.up('KeyJ');
    expect(rig.presses).toStrictEqual([]);

    rig.focus = 'keying';
    rig.target.down('KeyJ');
    expect(plain(rig.presses)).toStrictEqual([{ kind: 'down', t: 1000, source: 'switch' }]);
  });

  it.each(['Space', 'Enter', 'NumpadEnter'])('%s fails with reserved-input and leaves everything unchanged (Req 5.2)', async (code) => {
    const rig = createKeyRig({ storedKey: 'KeyJ' });
    rig.switchSource.start();
    const learning = rig.learner.arm();
    const down = rig.target.down(code);
    expect(down.prevented).toBe(true);
    const result = await learning;
    expect(result).toMatchObject({ ok: false, error: { reason: 'reserved-input', code } });
    if (!result.ok) expect(result.error.message).toBe('This key already works as an input.');
    expect(rig.store.calls.writes).toStrictEqual([]);
    expect(rig.switchSource.learnedKey()).toBe('KeyJ');
    expect(rig.learner.isArmed()).toBe(false);
  });

  it('Tab, Escape and repeats stay armed without preventDefault (Req 5.3)', () => {
    const rig = createKeyRig();
    void rig.learner.arm();
    expect(rig.target.down('Tab').prevented).toBe(false);
    expect(rig.target.down('Escape').prevented).toBe(false);
    expect(rig.target.down('KeyJ', true).prevented).toBe(false);
    expect(rig.learner.isArmed()).toBe(true);
    expect(rig.store.calls.writes).toStrictEqual([]);
  });

  it('cancel resolves cancelled and leaves the key and store unchanged (Req 5.4)', async () => {
    const rig = createKeyRig({ storedKey: 'KeyJ' });
    rig.switchSource.start();
    const learning = rig.learner.arm();
    rig.learner.cancel();
    expect(await learning).toMatchObject({ ok: false, error: { reason: 'cancelled' } });
    expect(rig.store.value).toBe('KeyJ');
    expect(rig.switchSource.learnedKey()).toBe('KeyJ');
    expect(rig.learner.isArmed()).toBe(false);
    rig.learner.cancel();
  });

  it('re-arming resolves the earlier promise as cancelled', async () => {
    const rig = createKeyRig();
    const first = rig.learner.arm();
    const second = rig.learner.arm();
    expect(await first).toMatchObject({ ok: false, error: { reason: 'cancelled' } });
    rig.target.down('KeyQ');
    expect(await second).toStrictEqual({ ok: true, value: 'KeyQ' });
  });

  it('a store write failure keeps the previous key in use and stored (Req 5.12)', async () => {
    const rig = createKeyRig({ storedKey: 'KeyJ' });
    rig.switchSource.start();
    rig.store.failWrites = true;
    const learning = rig.learner.arm();
    rig.target.down('KeyK');
    expect(await learning).toMatchObject({
      ok: false,
      error: { reason: 'save-failed', message: 'The switch key could not be saved.' },
    });
    expect(rig.store.value).toBe('KeyJ');
    expect(rig.switchSource.learnedKey()).toBe('KeyJ');
    expect(rig.learner.isArmed()).toBe(false);
  });

  it('clear removes the key from use and from the store (Req 5.6)', () => {
    const rig = createKeyRig({ storedKey: 'KeyJ' });
    rig.switchSource.start();
    expect(rig.learner.clear()).toStrictEqual({ ok: true, value: undefined });
    expect(rig.store.value).toBeUndefined();
    expect(rig.switchSource.learnedKey()).toBeNull();
  });

  it('clear still clears the key in use when the store fails', () => {
    const rig = createKeyRig({ storedKey: 'KeyJ' });
    rig.switchSource.start();
    rig.store.failClears = true;
    expect(rig.learner.clear()).toMatchObject({ ok: false, error: { reason: 'save-failed' } });
    expect(rig.switchSource.learnedKey()).toBeNull();
  });

  it('waits with no time limit and listens only while armed', async () => {
    const rig = createKeyRig();
    expect(rig.target.listenerCount()).toBe(0);
    const learning = rig.learner.arm();
    expect(rig.target.listenerCount()).toBe(1);
    rig.clock.advance(10 * 60 * 1000);
    rig.scheduler.runDue(rig.clock.now());
    expect(rig.learner.isArmed()).toBe(true);
    rig.target.down('F13');
    expect(await learning).toStrictEqual({ ok: true, value: 'F13' });
    expect(rig.target.listenerCount()).toBe(0);
  });
});
