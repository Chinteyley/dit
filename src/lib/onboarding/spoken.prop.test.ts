import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHARACTER_TABLE, COMMAND_TABLE, type CommandName } from '@/lib/morse';
import { buildCheatSheetModel, entryAccessibleText } from './cheat-sheet-model';
import { buildLegendModel, legendAccessibleText } from './legend-model';
import { characterName, spokenCode } from './spoken';
import { PROP_RUNS, arbCharTable, arbCode, arbCommandTable } from './test-support';

const wordsFor = (code: string): string[] => [...code].map((symbol) => (symbol === '.' ? 'dot' : 'dash'));

const caseArb = fc
  .oneof(fc.constant(COMMAND_TABLE), arbCommandTable())
  .chain((commands: Readonly<Record<string, CommandName>>) =>
    fc.record({
      code: arbCode({ minLength: 1, maxLength: 10 }),
      commands: fc.constant(commands),
      chars: fc.oneof(fc.constant(CHARACTER_TABLE), arbCharTable(commands)),
    }),
  );

describe('Spoken_Code properties', () => {
  // Feature: onboarding-and-safety, Property 15: Spoken_Code and accessible texts follow the code exactly
  it('P15 spoken code and accessible texts follow the code exactly', () => {
    fc.assert(
      fc.property(caseArb, ({ code, commands, chars }) => {
        expect(spokenCode(code).split(' ')).toEqual(wordsFor(code));

        for (const entry of buildLegendModel(commands)) {
          expect(legendAccessibleText(entry)).toBe(`${entry.label}: ${wordsFor(entry.code).join(' ')}`);
        }
        for (const entry of buildCheatSheetModel(chars, commands).flatMap((group) => group.entries)) {
          const name = entry.kind === 'char' ? characterName(entry.char) : entry.label;
          expect(entryAccessibleText(entry)).toBe(`${name} ${wordsFor(entry.code).join(' ')}`);
          if (entry.kind === 'char' && /^[a-z0-9]$/.test(entry.char)) expect(name).toBe(entry.label);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
