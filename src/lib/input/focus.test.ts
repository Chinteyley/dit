import { describe, expect, it } from 'vitest';
import { INTERACTIVE_ROLES, TEXT_INPUT_TYPES, classifyFocus, type FocusDescription } from './focus';

const base: FocusDescription = {
  isBodyOrNull: false,
  isKeyingSurface: false,
  tagName: 'div',
  inputType: null,
  hasHref: false,
  contentEditable: false,
  role: null,
  inOpenDialog: false,
};

const focusOn = (overrides: Partial<FocusDescription>): FocusDescription => ({ ...base, ...overrides });

describe('classifyFocus', () => {
  it('treats the body and no focused element as keying', () => {
    expect(classifyFocus(focusOn({ isBodyOrNull: true, tagName: '' }))).toBe('keying');
  });

  it('treats the Keying_Surface as keying even with role="button" and a tabindex', () => {
    expect(classifyFocus(focusOn({ isKeyingSurface: true, role: 'button' }))).toBe('keying');
    expect(classifyFocus(focusOn({ isKeyingSurface: true, tagName: 'button' }))).toBe('keying');
    expect(classifyFocus(focusOn({ isKeyingSurface: true, contentEditable: true }))).toBe('keying');
  });

  it.each([...TEXT_INPUT_TYPES, null, ''])('input type %s is editable', (inputType) => {
    expect(classifyFocus(focusOn({ tagName: 'input', inputType }))).toBe('editable');
  });

  it('textarea, select and contenteditable content are editable', () => {
    expect(classifyFocus(focusOn({ tagName: 'textarea' }))).toBe('editable');
    expect(classifyFocus(focusOn({ tagName: 'select' }))).toBe('editable');
    expect(classifyFocus(focusOn({ tagName: 'p', contentEditable: true }))).toBe('editable');
    expect(classifyFocus(focusOn({ tagName: 'button', contentEditable: true }))).toBe('editable');
  });

  it('any input, select or textarea inside an open dialog is editable', () => {
    for (const inputType of ['checkbox', 'range', 'radio', 'hidden', 'submit']) {
      expect(classifyFocus(focusOn({ tagName: 'input', inputType, inOpenDialog: true }))).toBe('editable');
    }
    expect(classifyFocus(focusOn({ tagName: 'button', inOpenDialog: true }))).toBe('interactive');
  });

  it.each(['checkbox', 'radio', 'range', 'submit', 'button', 'color', 'file', 'date'])(
    'input type %s is interactive',
    (inputType) => {
      expect(classifyFocus(focusOn({ tagName: 'input', inputType }))).toBe('interactive');
    },
  );

  it('input type="hidden" is keying', () => {
    expect(classifyFocus(focusOn({ tagName: 'input', inputType: 'hidden' }))).toBe('keying');
  });

  it('buttons, summaries and links with an href are interactive', () => {
    expect(classifyFocus(focusOn({ tagName: 'button' }))).toBe('interactive');
    expect(classifyFocus(focusOn({ tagName: 'summary' }))).toBe('interactive');
    expect(classifyFocus(focusOn({ tagName: 'a', hasHref: true }))).toBe('interactive');
    expect(classifyFocus(focusOn({ tagName: 'area', hasHref: true }))).toBe('interactive');
  });

  it('links and areas without an href are keying', () => {
    expect(classifyFocus(focusOn({ tagName: 'a' }))).toBe('keying');
    expect(classifyFocus(focusOn({ tagName: 'area' }))).toBe('keying');
  });

  it.each([...INTERACTIVE_ROLES])('role %s is interactive', (role) => {
    expect(classifyFocus(focusOn({ tagName: 'div', role }))).toBe('interactive');
  });

  it('lists exactly 17 interactive roles', () => {
    expect(INTERACTIVE_ROLES.size).toBe(17);
  });

  it('other elements and roles key Morse', () => {
    expect(classifyFocus(focusOn({ tagName: 'div' }))).toBe('keying');
    expect(classifyFocus(focusOn({ tagName: 'main', role: 'region' }))).toBe('keying');
    expect(classifyFocus(focusOn({ tagName: 'section', role: 'dialog' }))).toBe('keying');
  });
});
