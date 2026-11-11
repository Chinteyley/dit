import { describe, expect, it } from 'vitest';
import { RESERVED_KEYS, isReservedKey, validateSwitchKey } from './switch';
import { createKeyRig, plain } from './test-support';

describe('validateSwitchKey', () => {
  it('keeps non-empty, non-reserved strings only', () => {
    expect(validateSwitchKey('KeyJ')).toBe('KeyJ');
    expect(validateSwitchKey('F13')).toBe('F13');
    for (const bad of ['', 'Space', 'Enter', 'NumpadEnter', 'Tab', 'Escape', 42, null, undefined, {}, ['KeyJ']]) {
      expect(validateSwitchKey(bad)).toBeNull();
    }
    expect([...RESERVED_KEYS]).toStrictEqual(['Space', 'Enter', 'NumpadEnter', 'Tab', 'Escape']);
    expect(isReservedKey('Tab')).toBe(true);
    expect(isReservedKey('KeyJ')).toBe(false);
  });
});

describe('Switch_Source', () => {
  it('reads the store once on start and never writes (Req 5.7)', () => {
    const rig = createKeyRig({ storedKey: 'KeyJ' });
    expect(rig.switchSource.learnedKey()).toBeNull();
    rig.switchSource.start();
    expect(rig.store.calls.reads).toBe(1);
    expect(rig.switchSource.learnedKey()).toBe('KeyJ');
    rig.target.down('KeyJ');
    rig.target.up('KeyJ');
    expect(rig.store.calls.reads).toBe(1);
    expect(rig.store.calls.writes).toStrictEqual([]);
    expect(rig.store.calls.clears).toBe(0);
  });

  it('keys nothing without a learned key (Req 5.10)', () => {
    const rig = createKeyRig();
    rig.switchSource.start();
    rig.clock.set(1000);
    const down = rig.target.down('KeyJ');
    rig.clock.set(1200);
    rig.target.up('KeyJ');
    rig.scheduler.runDue(5000);
    expect(down.prevented).toBe(false);
    expect(rig.presses).toStrictEqual([]);
  });

  it('treats a failed or invalid read as no key (Req 5.8)', () => {
    const rig = createKeyRig({ storedKey: 'Space' });
    rig.switchSource.start();
    expect(rig.switchSource.learnedKey()).toBeNull();
    rig.switchSource.stop();
    rig.store.readResult = { ok: false, error: { message: 'unavailable' } };
    rig.switchSource.start();
    expect(rig.switchSource.learnedKey()).toBeNull();
  });

  it('a learned key on a button keys Morse with preventDefault (Req 4.9, 5.9)', () => {
    const rig = createKeyRig({ storedKey: 'KeyJ', min: 0 });
    rig.switchSource.start();
    rig.keyboard.start();
    rig.focus = 'interactive';
    const down = rig.target.down('KeyJ');
    expect(down.prevented).toBe(true);
    rig.clock.set(1100);
    expect(rig.target.up('KeyJ').prevented).toBe(true);
    expect(plain(rig.presses)).toStrictEqual([
      { kind: 'down', t: 1000, source: 'switch' },
      { kind: 'up', t: 1100, source: 'switch' },
    ]);
    // Space on the same button keeps its native behaviour.
    expect(rig.target.down('Space').prevented).toBe(false);
  });

  it('a learned key in a text field is left native (Req 5.11)', () => {
    const rig = createKeyRig({ storedKey: 'KeyJ', min: 0 });
    rig.switchSource.start();
    rig.focus = 'editable';
    expect(rig.target.down('KeyJ').prevented).toBe(false);
    expect(rig.target.up('KeyJ').prevented).toBe(false);
    expect(rig.presses).toStrictEqual([]);
  });

  it('a key change while Held ends the press at the clock and swallows the old keyup (Req 5.13)', () => {
    const rig = createKeyRig({ storedKey: 'KeyJ', min: 0 });
    rig.switchSource.start();
    rig.target.down('KeyJ');
    rig.clock.set(1300);
    rig.switchSource.setLearnedKey('KeyK');
    rig.clock.set(1400);
    rig.target.up('KeyJ');
    expect(plain(rig.presses)).toStrictEqual([
      { kind: 'down', t: 1000, source: 'switch' },
      { kind: 'up', t: 1300, source: 'switch' },
    ]);
    rig.target.down('KeyK');
    expect(plain(rig.presses).at(-1)).toStrictEqual({ kind: 'down', t: 1400, source: 'switch' });
  });

  it('clearing the key while Held ends the press the same way (Req 5.13)', () => {
    const rig = createKeyRig({ storedKey: 'KeyJ', min: 0 });
    rig.switchSource.start();
    rig.target.down('KeyJ');
    rig.clock.set(1250);
    expect(rig.learner.clear()).toStrictEqual({ ok: true, value: undefined });
    rig.target.up('KeyJ');
    rig.target.down('KeyJ');
    expect(plain(rig.presses)).toStrictEqual([
      { kind: 'down', t: 1000, source: 'switch' },
      { kind: 'up', t: 1250, source: 'switch' },
    ]);
    expect(rig.switchSource.learnedKey()).toBeNull();
  });

  it('blur and hide end a held switch press once', () => {
    const rig = createKeyRig({ storedKey: 'F13', min: 0 });
    rig.switchSource.start();
    rig.target.down('F13');
    rig.clock.set(1100);
    rig.page.hide();
    rig.page.blur();
    rig.target.up('F13');
    expect(plain(rig.presses)).toStrictEqual([
      { kind: 'down', t: 1000, source: 'switch' },
      { kind: 'up', t: 1100, source: 'switch' },
    ]);
  });
});
