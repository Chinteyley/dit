import { describe, expect, it } from 'vitest';
import { INITIAL_KEY_MACHINE_STATE, abandonActive, keyDown, keyUp, type KeyMachineState } from './key-machine';

const KEYBOARD_CODES: ReadonlySet<string> = new Set(['Space', 'Enter', 'NumpadEnter']);
const SWITCH_CODES: ReadonlySet<string> = new Set(['KeyJ']);

const down = (code: string, repeat = false) => ({ code, repeat });
const s0 = INITIAL_KEY_MACHINE_STATE;

describe('keyDown and keyUp with the keyboard rule', () => {
  it('Space on a button is left to the button: no raw input and no preventDefault (Req 4.6)', () => {
    const d = keyDown(s0, down('Space'), KEYBOARD_CODES, 'keyboard', 'interactive');
    expect(d.raw).toBeNull();
    expect(d.preventDefault).toBe(false);
    const u = keyUp(d.state, { code: 'Space' });
    expect(u.raw).toBeNull();
    expect(u.preventDefault).toBe(false);
    expect(u.state.ignored.size).toBe(0);
  });

  it('Space in a text field types normally (Req 4.6)', () => {
    const d = keyDown(s0, down('Space'), KEYBOARD_CODES, 'keyboard', 'editable');
    expect(d).toMatchObject({ raw: null, preventDefault: false });
    expect(keyUp(d.state, { code: 'Space' })).toMatchObject({ raw: null, preventDefault: false });
  });

  it('Space on the body starts a press and prevents scrolling (Req 4.1, 4.5)', () => {
    const d = keyDown(s0, down('Space'), KEYBOARD_CODES, 'keyboard', 'keying');
    expect(d).toMatchObject({ raw: 'down', preventDefault: true });
    expect(d.state.active).toBe('Space');
  });

  it('the active key ends its press on keyup whatever the focus (Req 4.2)', () => {
    const held = keyDown(s0, down('Enter'), KEYBOARD_CODES, 'keyboard', 'keying').state;
    const u = keyUp(held, { code: 'Enter' });
    expect(u).toMatchObject({ raw: 'up', preventDefault: true });
    expect(u.state.active).toBeNull();
  });

  it('Enter then Space while held: Space passes nothing and the press stays with Enter (Req 4.4, 4.5)', () => {
    let state: KeyMachineState = keyDown(s0, down('Enter'), KEYBOARD_CODES, 'keyboard', 'keying').state;
    const space = keyDown(state, down('Space'), KEYBOARD_CODES, 'keyboard', 'keying');
    expect(space).toMatchObject({ raw: null, preventDefault: true });
    state = space.state;
    const spaceUp = keyUp(state, { code: 'Space' });
    expect(spaceUp).toMatchObject({ raw: null, preventDefault: true });
    expect(spaceUp.state.active).toBe('Enter');
    expect(keyUp(spaceUp.state, { code: 'Enter' }).raw).toBe('up');
  });

  it('a repeat of the active key is prevented and passes nothing (Req 4.3)', () => {
    const held = keyDown(s0, down('Space'), KEYBOARD_CODES, 'keyboard', 'keying').state;
    const repeat = keyDown(held, down('Space', true), KEYBOARD_CODES, 'keyboard', 'editable');
    expect(repeat).toMatchObject({ raw: null, preventDefault: true });
    expect(repeat.state).toBe(held);
  });

  it('a repeat of another key follows the focus rule for preventDefault', () => {
    expect(keyDown(s0, down('Enter', true), KEYBOARD_CODES, 'keyboard', 'keying')).toMatchObject({
      raw: null,
      preventDefault: true,
    });
    expect(keyDown(s0, down('Enter', true), KEYBOARD_CODES, 'keyboard', 'interactive')).toMatchObject({
      raw: null,
      preventDefault: false,
    });
  });

  it('ignores codes outside its set', () => {
    const d = keyDown(s0, down('KeyA'), KEYBOARD_CODES, 'keyboard', 'keying');
    expect(d).toStrictEqual({ state: s0, raw: null, preventDefault: false });
    expect(keyUp(s0, { code: 'KeyA' })).toStrictEqual({ state: s0, raw: null, preventDefault: false });
  });

  it('abandonActive swallows the later keyup (Req 7.4)', () => {
    const held = keyDown(s0, down('Space'), KEYBOARD_CODES, 'keyboard', 'keying').state;
    const abandoned = abandonActive(held);
    expect(abandoned.active).toBeNull();
    expect(keyUp(abandoned, { code: 'Space' }).raw).toBeNull();
    expect(abandonActive(s0)).toBe(s0);
  });
});

describe('keyDown with the switch rule', () => {
  it('a learned key on a button keys Morse with preventDefault (Req 4.9, 5.9)', () => {
    const d = keyDown(s0, down('KeyJ'), SWITCH_CODES, 'switch', 'interactive');
    expect(d).toMatchObject({ raw: 'down', preventDefault: true });
  });

  it('a learned key in a text field is left native (Req 5.11)', () => {
    const d = keyDown(s0, down('KeyJ'), SWITCH_CODES, 'switch', 'editable');
    expect(d).toMatchObject({ raw: null, preventDefault: false });
    expect(keyUp(d.state, { code: 'KeyJ' })).toMatchObject({ raw: null, preventDefault: false });
  });

  it('no learned key means no codes and no raw input (Req 5.10)', () => {
    expect(keyDown(s0, down('KeyJ'), new Set(), 'switch', 'keying').raw).toBeNull();
  });
});
