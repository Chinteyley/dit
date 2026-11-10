/** A plain description of the focused element, built by browser.ts (describeElement). */
export interface FocusDescription {
  readonly isBodyOrNull: boolean;
  readonly isKeyingSurface: boolean;
  /** Lowercase; '' when isBodyOrNull. */
  readonly tagName: string;
  /** Lowercase input type; null when absent. */
  readonly inputType: string | null;
  readonly hasHref: boolean;
  /** Own or inherited true contenteditable state (isContentEditable). */
  readonly contentEditable: boolean;
  /** Lowercase, trimmed, first token only; null when absent. */
  readonly role: string | null;
  readonly inOpenDialog: boolean;
}

export type FocusClass = 'keying' | 'editable' | 'interactive';

/** Input types that accept text entry; an input with no type is a text input too (Editable_Target). */
export const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
]);

/** The 17 ARIA roles that make an element an Interactive_Target (Req 4.1). */
export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
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
]);

const FORM_FIELD_TAGS: ReadonlySet<string> = new Set(['input', 'select', 'textarea']);

function isEditable(d: FocusDescription): boolean {
  if (d.contentEditable || d.tagName === 'textarea' || d.tagName === 'select') return true;
  if (d.tagName === 'input' && (d.inputType === null || d.inputType === '' || TEXT_INPUT_TYPES.has(d.inputType))) {
    return true;
  }
  return d.inOpenDialog && FORM_FIELD_TAGS.has(d.tagName);
}

function isInteractive(d: FocusDescription): boolean {
  switch (d.tagName) {
    case 'button':
    case 'summary':
      return true;
    case 'a':
    case 'area':
      if (d.hasHref) return true;
      break;
    case 'input':
      if (d.inputType !== 'hidden') return true;
      break;
  }
  return d.role !== null && INTERACTIVE_ROLES.has(d.role);
}

/**
 * Classifies the focused element (Req 4.1, 4.8): the Keying_Surface first, then Editable_Target,
 * then the body or no element, then Interactive_Target; anything else keys Morse.
 */
export function classifyFocus(d: FocusDescription): FocusClass {
  if (d.isKeyingSurface) return 'keying';
  if (isEditable(d)) return 'editable';
  if (d.isBodyOrNull) return 'keying';
  if (isInteractive(d)) return 'interactive';
  return 'keying';
}
