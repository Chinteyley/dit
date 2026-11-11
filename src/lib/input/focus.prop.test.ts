import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyFocus, type FocusClass, type FocusDescription } from './focus';
import { PROP_RUNS } from './test-support';

const ROLES = [
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'textbox',
  'searchbox',
  'combobox',
  'slider',
  'spinbutton',
  'listbox',
  'treeitem',
];
const TEXT_TYPES = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];

/** The Editable_Target and Interactive_Target definitions from the glossary and Req 4.1, as a table. */
function referenceClass(d: FocusDescription): FocusClass {
  const rows: readonly { readonly when: boolean; readonly then: FocusClass }[] = [
    { when: d.isKeyingSurface, then: 'keying' },
    { when: d.contentEditable, then: 'editable' },
    { when: d.tagName === 'textarea', then: 'editable' },
    { when: d.tagName === 'select', then: 'editable' },
    { when: d.tagName === 'input' && (d.inputType === null || d.inputType === ''), then: 'editable' },
    { when: d.tagName === 'input' && d.inputType !== null && TEXT_TYPES.includes(d.inputType), then: 'editable' },
    { when: d.inOpenDialog && ['input', 'select', 'textarea'].includes(d.tagName), then: 'editable' },
    { when: d.isBodyOrNull, then: 'keying' },
    { when: d.tagName === 'button', then: 'interactive' },
    { when: (d.tagName === 'a' || d.tagName === 'area') && d.hasHref, then: 'interactive' },
    { when: d.tagName === 'input' && d.inputType !== 'hidden', then: 'interactive' },
    { when: d.tagName === 'summary', then: 'interactive' },
    { when: d.role !== null && ROLES.includes(d.role), then: 'interactive' },
  ];
  return rows.find((row) => row.when)?.then ?? 'keying';
}

const descriptionArb: fc.Arbitrary<FocusDescription> = fc.record({
  isBodyOrNull: fc.boolean(),
  isKeyingSurface: fc.boolean(),
  tagName: fc.oneof(
    fc.constantFrom('input', 'textarea', 'select', 'button', 'a', 'area', 'summary', 'div', 'span', 'body', ''),
    fc.string(),
  ),
  inputType: fc.oneof(
    fc.constantFrom<string | null>(...TEXT_TYPES, 'hidden', 'checkbox', 'range', '', null),
    fc.string(),
  ),
  hasHref: fc.boolean(),
  contentEditable: fc.boolean(),
  role: fc.oneof(fc.constantFrom<string | null>(...ROLES, null), fc.string()),
  inOpenDialog: fc.boolean(),
});

describe('focus classification properties', () => {
  it('is total, pure and keying-first, and agrees with the reference table', () => {
    // Feature: input-sources, Property 12: Focus classification is total, pure and keying-first
    fc.assert(
      fc.property(descriptionArb, (description) => {
        const copy = structuredClone(description);
        const result = classifyFocus(Object.freeze(description));
        expect(['keying', 'editable', 'interactive']).toContain(result);
        expect(classifyFocus(copy)).toBe(result);
        expect(classifyFocus(description)).toBe(result);
        // fast-check builds null-prototype records, so compare fields, not prototypes.
        expect(description).toEqual(copy);
        if (description.isKeyingSurface) expect(result).toBe('keying');
        expect(result).toBe(referenceClass(description));
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
