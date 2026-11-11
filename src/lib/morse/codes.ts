import type { CommandName } from './types';

/** ITU-R M.1677-1 codes, in table order: letters, digits, punctuation. `+` is absent: its code is the speak command. */
const CHARACTER_ENTRIES: readonly (readonly [string, string])[] = [
  ['a', '.-'],
  ['b', '-...'],
  ['c', '-.-.'],
  ['d', '-..'],
  ['e', '.'],
  ['f', '..-.'],
  ['g', '--.'],
  ['h', '....'],
  ['i', '..'],
  ['j', '.---'],
  ['k', '-.-'],
  ['l', '.-..'],
  ['m', '--'],
  ['n', '-.'],
  ['o', '---'],
  ['p', '.--.'],
  ['q', '--.-'],
  ['r', '.-.'],
  ['s', '...'],
  ['t', '-'],
  ['u', '..-'],
  ['v', '...-'],
  ['w', '.--'],
  ['x', '-..-'],
  ['y', '-.--'],
  ['z', '--..'],
  ['0', '-----'],
  ['1', '.----'],
  ['2', '..---'],
  ['3', '...--'],
  ['4', '....-'],
  ['5', '.....'],
  ['6', '-....'],
  ['7', '--...'],
  ['8', '---..'],
  ['9', '----.'],
  ['.', '.-.-.-'],
  [',', '--..--'],
  ['?', '..--..'],
  ["'", '.----.'],
  ['!', '-.-.--'],
  ['/', '-..-.'],
  ['-', '-....-'],
  ['(', '-.--.'],
  [')', '-.--.-'],
  [':', '---...'],
  ['=', '-...-'],
  ['@', '.--.-.'],
  ['"', '.-..-.'],
];

const COMMAND_ENTRIES: readonly (readonly [string, CommandName])[] = [
  ['.-.-.', 'speak'],
  ['..--', 'next'],
  ['----', 'backspace'],
  ['...---...', 'sos'],
];

/** Supported_Character → ITU code (49 entries). */
export const CHARACTER_TABLE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(CHARACTER_ENTRIES),
);

/** Command_Code → command name (4 entries). */
export const COMMAND_TABLE: Readonly<Record<string, CommandName>> = Object.freeze(
  Object.fromEntries(COMMAND_ENTRIES),
);

/** ITU code → Supported_Character. Its size is 49 exactly when the character table is injective. */
export const CODE_TO_CHAR: ReadonlyMap<string, string> = new Map(
  CHARACTER_ENTRIES.map(([char, code]) => [code, char] as const),
);

/** The 49 Supported_Characters in table order. */
export const SUPPORTED_CHARACTERS: readonly string[] = Object.freeze(
  CHARACTER_ENTRIES.map(([char]) => char),
);

const CODE_TO_COMMAND: ReadonlyMap<string, CommandName> = new Map(COMMAND_ENTRIES);

export type Lookup =
  | { readonly kind: 'command'; readonly command: CommandName }
  | { readonly kind: 'char'; readonly char: string }
  | { readonly kind: 'unknown'; readonly pattern: string };

/** Command_Table first, then Character_Table, else unknown (Req 3.8, 5.5). */
export function lookupPattern(pattern: string): Lookup {
  const command = CODE_TO_COMMAND.get(pattern);
  if (command !== undefined) {
    return { kind: 'command', command };
  }
  const char = CODE_TO_CHAR.get(pattern);
  if (char !== undefined) {
    return { kind: 'char', char };
  }
  return { kind: 'unknown', pattern };
}

/** The code of a Supported_Character, or undefined. Own keys only, so inherited names never match. */
export function codeOf(char: string): string | undefined {
  return Object.hasOwn(CHARACTER_TABLE, char) ? CHARACTER_TABLE[char] : undefined;
}
