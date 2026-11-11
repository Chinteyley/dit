import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHARACTER_TABLE, COMMAND_TABLE, type CommandName } from '@/lib/morse';
import { buildCheatSheetModel } from './cheat-sheet-model';
import { buildLegendModel } from './legend-model';
import { PROP_RUNS, arbCharTable, arbCommandTable } from './test-support';

const LETTERS = [...'abcdefghijklmnopqrstuvwxyz'];
const DIGITS = [...'0123456789'];

const tablesArb = fc
  .oneof(fc.constant(COMMAND_TABLE), arbCommandTable())
  .chain((commands: Readonly<Record<string, CommandName>>) =>
    fc.record({
      commands: fc.constant(commands),
      chars: fc.oneof({ weight: 1, arbitrary: fc.constant(CHARACTER_TABLE) }, { weight: 4, arbitrary: arbCharTable(commands) }),
    }),
  );

describe('Cheat_Sheet_Model properties', () => {
  // Feature: onboarding-and-safety, Property 14: The Cheat_Sheet_Model equals the engine tables, grouped, with no +
  it('P14 the cheat sheet model equals the engine tables grouped with no plus', () => {
    fc.assert(
      fc.property(tablesArb, ({ chars, commands }) => {
        const model = buildCheatSheetModel(chars, commands);
        const commandCodes = new Set(Object.keys(commands));
        const kept = (ch: string): boolean =>
          Object.hasOwn(chars, ch) && ch !== '+' && !commandCodes.has(chars[ch] ?? '');

        expect(model.map((g) => g.name)).toEqual(['Commands', 'Letters', 'Digits', 'Punctuation']);
        const [commandGroup, letters, digits, punctuation] = model.map((g) => g.entries);
        const charsOf = (entries: typeof letters): string[] =>
          (entries ?? []).map((e) => (e.kind === 'char' ? e.char : `!${e.command}`));

        expect(charsOf(letters)).toEqual(LETTERS.filter(kept));
        expect(charsOf(digits)).toEqual(DIGITS.filter(kept));
        expect(charsOf(punctuation)).toEqual(
          Object.keys(chars).filter((ch) => !LETTERS.includes(ch) && !DIGITS.includes(ch) && kept(ch)),
        );

        const charEntries = [...(letters ?? []), ...(digits ?? []), ...(punctuation ?? [])];
        for (const entry of charEntries) {
          expect(entry.kind).toBe('char');
          if (entry.kind === 'char') {
            expect(entry.code).toBe(chars[entry.char]);
            expect(entry.char).not.toBe('+');
          }
          expect(commandCodes.has(entry.code)).toBe(false);
        }
        const expectedChars = Object.keys(chars).filter(kept);
        expect(charEntries).toHaveLength(expectedChars.length);
        expect(new Set(charsOf(charEntries)).size).toBe(expectedChars.length);

        expect(commandGroup).toEqual(
          buildLegendModel(commands).map((e) => ({ kind: 'command', command: e.command, code: e.code, label: e.label })),
        );
        if (chars === CHARACTER_TABLE && commands === COMMAND_TABLE) expect(charEntries).toHaveLength(49);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
