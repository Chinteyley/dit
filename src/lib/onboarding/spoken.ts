/**
 * Text alternatives for codes and speeds (design "lib/onboarding/spoken.ts"): the Spoken_Code of
 * a pattern, the spoken name of a character, and the Speed_Text. Pure.
 */
import { unitToWpm } from '@/lib/morse';

/** '.-.' → 'dot dash dot' (Requirements 8.4, 9.6, 18.7). Characters other than '.' and '-' are skipped. */
export function spokenCode(code: string): string {
  const words: string[] = [];
  for (const symbol of code) {
    if (symbol === '.') words.push('dot');
    else if (symbol === '-') words.push('dash');
  }
  return words.join(' ');
}

/** Spoken names of the 13 punctuation characters of the Character_Table (Requirement 9.6). */
export const PUNCTUATION_NAMES: Readonly<Record<string, string>> = Object.freeze({
  '.': 'period',
  ',': 'comma',
  '?': 'question mark',
  "'": 'apostrophe',
  '!': 'exclamation mark',
  '/': 'slash',
  '-': 'hyphen',
  '(': 'open parenthesis',
  ')': 'close parenthesis',
  ':': 'colon',
  '=': 'equals sign',
  '@': 'at sign',
  '"': 'quotation mark',
});

/** Letters as their uppercase letter, digits as they are, punctuation by name; anything else unchanged. */
export function characterName(ch: string): string {
  if (/^[a-z]$/.test(ch)) return ch.toUpperCase();
  if (/^[0-9]$/.test(ch)) return ch;
  return Object.hasOwn(PUNCTUATION_NAMES, ch) ? (PUNCTUATION_NAMES[ch] ?? ch) : ch;
}

/** Speed_Text: "about N words per minute", N = unitToWpm(dot) rounded, at least 1 (Requirement 15.2). */
export function speedText(dotEstimate: number): string {
  return `about ${Math.max(1, Math.round(unitToWpm(dotEstimate)))} words per minute`;
}
