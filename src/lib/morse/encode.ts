import { codeOf } from './codes';
import { err, ok, type Result } from './result';
import { MAX_UNIT, MIN_UNIT, isFiniteNumber } from './timing';

export type PressInput =
  | { readonly type: 'press'; readonly t: number }
  | { readonly type: 'release'; readonly t: number };

export interface EncodedSequence {
  readonly inputs: readonly PressInput[];
  /** 3 units after the last release: a tick here commits the last character without a word gap. */
  readonly endTime: number;
}

export interface UnsupportedOccurrence {
  /** One code point. */
  readonly char: string;
  /** UTF-16 index of the code point in the original text, so text.slice(index) starts with it. */
  readonly index: number;
}

export type EncodeTextError =
  | { readonly kind: 'empty' }
  | { readonly kind: 'unsupported'; readonly occurrences: readonly UnsupportedOccurrence[] };

/** At least one field is present. */
export interface EncodeError {
  /** Present iff the unit is invalid. */
  readonly unit?: { readonly value: unknown };
  /** Present iff the text is invalid. */
  readonly text?: EncodeTextError;
}

// Nominal element lengths in units (PARIS timing).
const DOT_UNITS = 1;
const DASH_UNITS = 3;
const SYMBOL_GAP_UNITS = 1;
const LETTER_GAP_UNITS = 3;
const WORD_GAP_UNITS = 7;

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

/** Lowercases A–Z only, so no other character changes (unlike toLowerCase). */
function lowerAscii(char: string): string {
  const code = char.charCodeAt(0);
  return char.length === 1 && code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : char;
}

/** Normalized_Text: A–Z lowercased, Whitespace trimmed, each Whitespace run collapsed to one space. */
export function normalizeText(text: string): string {
  let normalized = '';
  let pendingSpace = false;
  for (const char of text) {
    if (isWhitespace(char)) {
      pendingSpace = normalized !== '';
      continue;
    }
    if (pendingSpace) {
      normalized += ' ';
      pendingSpace = false;
    }
    normalized += lowerAscii(char);
  }
  return normalized;
}

function checkUnit(unit: unknown): boolean {
  return isFiniteNumber(unit) && unit >= MIN_UNIT && unit <= MAX_UNIT;
}

function checkText(text: string): EncodeTextError | null {
  let hasContent = false;
  const occurrences: UnsupportedOccurrence[] = [];
  let index = 0;
  for (const char of text) {
    if (!isWhitespace(char)) {
      hasContent = true;
      if (codeOf(lowerAscii(char)) === undefined) {
        occurrences.push({ char, index });
      }
    }
    index += char.length;
  }
  if (!hasContent) {
    return { kind: 'empty' };
  }
  return occurrences.length > 0 ? { kind: 'unsupported', occurrences } : null;
}

/**
 * Text → a timed press/release sequence at exact Morse timing. Every timestamp is k × unit for an
 * integer unit counter k, so nothing accumulates floating-point error. Unsupported characters,
 * including `+`, are reported with their indices rather than dropped (Req 12).
 */
export function encode(text: string, unit: number): Result<EncodedSequence, EncodeError> {
  // A non-string from an untyped caller has no text to encode.
  const source = typeof text === 'string' ? text : '';
  const unitValid = checkUnit(unit);
  const textError = checkText(source);
  if (!unitValid || textError !== null) {
    return err({
      ...(unitValid ? {} : { unit: { value: unit } }),
      ...(textError === null ? {} : { text: textError }),
    });
  }

  const inputs: PressInput[] = [];
  let k = 0;
  let gapBeforeNext: number | null = null; // null until the first press
  for (const char of normalizeText(source)) {
    if (char === ' ') {
      gapBeforeNext = WORD_GAP_UNITS;
      continue;
    }
    for (const symbol of codeOf(char) ?? '') {
      if (gapBeforeNext !== null) {
        k += gapBeforeNext;
      }
      inputs.push({ type: 'press', t: k * unit });
      k += symbol === '.' ? DOT_UNITS : DASH_UNITS;
      inputs.push({ type: 'release', t: k * unit });
      gapBeforeNext = SYMBOL_GAP_UNITS;
    }
    gapBeforeNext = LETTER_GAP_UNITS;
  }
  return ok({ inputs, endTime: (k + LETTER_GAP_UNITS) * unit });
}
