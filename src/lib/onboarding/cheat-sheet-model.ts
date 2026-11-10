/**
 * The Cheat_Sheet_Model (design "lib/onboarding/cheat-sheet-model.ts", Requirement 9): every
 * Supported_Character and Command_Code, grouped, built from the engine tables at run time.
 */
import { CHARACTER_TABLE, COMMAND_TABLE, type CommandName } from '@/lib/morse';
import { buildLegendModel } from './legend-model';
import { characterName, spokenCode } from './spoken';

export type CheatSheetGroupName = 'Letters' | 'Digits' | 'Punctuation' | 'Commands';

export type CheatSheetEntry =
  /** label: 'A', '7', '.' */
  | { readonly kind: 'char'; readonly char: string; readonly code: string; readonly label: string }
  | { readonly kind: 'command'; readonly command: CommandName; readonly code: string; readonly label: string };

export interface CheatSheetGroup {
  readonly name: CheatSheetGroupName;
  readonly entries: readonly CheatSheetEntry[];
}

const isLetter = (ch: string): boolean => /^[a-z]$/.test(ch);
const isDigit = (ch: string): boolean => /^[0-9]$/.test(ch);
const byCodePoint = (a: CheatSheetEntry, b: CheatSheetEntry): number =>
  a.kind === 'char' && b.kind === 'char' ? (a.char < b.char ? -1 : a.char > b.char ? 1 : 0) : 0;

/**
 * Walks the given Character_Table in table order: a–z into Letters by code point, 0–9 into Digits
 * ascending, every other key into Punctuation in table order. Skips `+` and any character whose
 * code is a Command_Code, so Requirement 9.8 holds even for a changed table. Commands come from
 * buildLegendModel(commands).
 */
export function buildCheatSheetModel(
  chars: Readonly<Record<string, string>> = CHARACTER_TABLE,
  commands: Readonly<Record<string, CommandName>> = COMMAND_TABLE,
): readonly CheatSheetGroup[] {
  const commandCodes = new Set(Object.keys(commands));
  const letters: CheatSheetEntry[] = [];
  const digits: CheatSheetEntry[] = [];
  const punctuation: CheatSheetEntry[] = [];
  for (const [char, code] of Object.entries(chars)) {
    if (char === '+' || commandCodes.has(code)) continue;
    if (isLetter(char)) letters.push({ kind: 'char', char, code, label: char.toUpperCase() });
    else if (isDigit(char)) digits.push({ kind: 'char', char, code, label: char });
    else punctuation.push({ kind: 'char', char, code, label: char });
  }
  const commandEntries: CheatSheetEntry[] = buildLegendModel(commands).map((entry) => ({
    kind: 'command',
    command: entry.command,
    code: entry.code,
    label: entry.label,
  }));
  return [
    { name: 'Letters', entries: letters.sort(byCodePoint) },
    { name: 'Digits', entries: digits.sort(byCodePoint) },
    { name: 'Punctuation', entries: punctuation },
    { name: 'Commands', entries: commandEntries },
  ];
}

/** The character name (or command label), a space, then the Spoken_Code (Requirements 9.6, 9.7). */
export function entryAccessibleText(e: CheatSheetEntry): string {
  const name = e.kind === 'char' ? characterName(e.char) : e.label;
  return `${name} ${spokenCode(e.code)}`;
}
