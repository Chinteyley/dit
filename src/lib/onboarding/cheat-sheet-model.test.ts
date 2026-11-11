import { describe, expect, it } from 'vitest';
import { CHARACTER_TABLE, COMMAND_TABLE } from '@/lib/morse';
import { buildCheatSheetModel, entryAccessibleText, type CheatSheetEntry } from './cheat-sheet-model';

const groups = buildCheatSheetModel();
const group = (name: string): readonly CheatSheetEntry[] => groups.find((g) => g.name === name)?.entries ?? [];

describe('buildCheatSheetModel with the real tables', () => {
  it('has 4 groups with 26 + 10 + 13 + 4 entries (Requirements 9.1, 9.2)', () => {
    expect(groups.map((g) => g.name)).toEqual(['Commands', 'Letters', 'Digits', 'Punctuation']);
    expect(groups.map((g) => g.entries.length)).toEqual([4, 26, 10, 13]);
  });

  it('shows letters in uppercase, a to z, and digits 0 to 9 (Requirement 9.5)', () => {
    expect(group('Letters').map((e) => e.label).join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(group('Digits').map((e) => e.label).join('')).toBe('0123456789');
    expect(group('Letters')[0]).toEqual({ kind: 'char', char: 'a', code: '.-', label: 'A' });
  });

  it('keeps punctuation in table order and every code from the table', () => {
    expect(group('Punctuation').map((e) => e.label).join('')).toBe('.,?\'!/-():=@"');
    for (const entry of [...group('Letters'), ...group('Digits'), ...group('Punctuation')]) {
      if (entry.kind === 'char') expect(entry.code).toBe(CHARACTER_TABLE[entry.char]);
    }
  });

  it('lists the commands like the Command_Legend', () => {
    expect(group('Commands').map((e) => [e.label, e.code])).toEqual([
      ['Speak', '.-.-.'],
      ['Next suggestion', '..--'],
      ['Delete last letter', '----'],
      ['Help alarm', '...---...'],
    ]);
    for (const entry of group('Commands')) {
      if (entry.kind === 'command') expect(COMMAND_TABLE[entry.code]).toBe(entry.command);
    }
  });

  it('names letters, digits, punctuation and commands in the accessible text (Requirements 9.6, 9.7)', () => {
    expect(entryAccessibleText(group('Letters')[0] as CheatSheetEntry)).toBe('A dot dash');
    expect(entryAccessibleText(group('Digits')[7] as CheatSheetEntry)).toBe('7 dash dash dot dot dot');
    expect(entryAccessibleText(group('Punctuation')[0] as CheatSheetEntry)).toBe('period dot dash dot dash dot dash');
    expect(entryAccessibleText(group('Commands')[0] as CheatSheetEntry)).toBe('Speak dot dash dot dash dot');
  });

  it('skips + and any character whose code is a Command_Code (Requirement 9.8)', () => {
    const model = buildCheatSheetModel({ ...CHARACTER_TABLE, '+': '.-.-.', '&': '..--' }, COMMAND_TABLE);
    const chars = model.flatMap((g) => g.entries).filter((e) => e.kind === 'char');
    expect(chars).toHaveLength(49);
    expect(chars.some((e) => e.kind === 'char' && (e.char === '+' || e.char === '&'))).toBe(false);
  });
});
