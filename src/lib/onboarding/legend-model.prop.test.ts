import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMAND_TABLE, type CommandName } from '@/lib/morse';
import { buildLegendModel } from './legend-model';
import { PROP_RUNS, arbCommandTable } from './test-support';

describe('Legend_Model properties', () => {
  // Feature: onboarding-and-safety, Property 13: The Legend_Model equals the Command_Table
  it('P13 the legend model equals the command table', () => {
    const tables = fc.oneof(fc.constant(COMMAND_TABLE), arbCommandTable());
    fc.assert(
      fc.property(tables, (table: Readonly<Record<string, CommandName>>) => {
        const model = buildLegendModel(table);
        expect(model.map((entry) => entry.command)).toEqual(['speak', 'next', 'backspace', 'sos']);
        for (const entry of model) expect(table[entry.code]).toBe(entry.command);
        for (const [code, command] of Object.entries(table)) {
          expect(model.filter((entry) => entry.code === code && entry.command === command)).toHaveLength(1);
        }
        expect(model).toHaveLength(Object.keys(table).length);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
