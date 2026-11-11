import { describe, expect, it } from 'vitest';
import { COMMAND_TABLE } from '@/lib/morse';
import { COMMAND_ORDER, COMMAND_SENTENCES, buildLegendModel, legendAccessibleText } from './legend-model';

describe('buildLegendModel', () => {
  it('gives the 4 real commands in the order speak, next, backspace, sos with their labels', () => {
    expect(buildLegendModel()).toEqual([
      { command: 'speak', code: '.-.-.', label: 'Speak' },
      { command: 'next', code: '..--', label: 'Next suggestion' },
      { command: 'backspace', code: '----', label: 'Delete last letter' },
      { command: 'sos', code: '...---...', label: 'Help alarm' },
    ]);
    expect(buildLegendModel(COMMAND_TABLE)).toEqual(buildLegendModel());
    expect(COMMAND_ORDER).toEqual(['speak', 'next', 'backspace', 'sos']);
  });

  it('reads codes from the table it is given, never from a copy', () => {
    const table = { '.': 'sos', '-': 'speak', '..': 'next', '--': 'backspace' } as const;
    expect(buildLegendModel(table).map((entry) => [entry.command, entry.code])).toEqual([
      ['speak', '-'],
      ['next', '..'],
      ['backspace', '--'],
      ['sos', '.'],
    ]);
  });

  it('has one Legend_Step sentence per command (Requirement 16.1)', () => {
    expect(COMMAND_SENTENCES).toEqual({
      speak: 'Says the highlighted suggestion, or the typed text when nothing is highlighted.',
      next: 'Moves the highlight to the next suggestion.',
      backspace: 'Deletes the last letter.',
      sos: 'Sounds an alarm and shows I need help until any press.',
    });
  });
});

describe('legendAccessibleText', () => {
  it('is the label, a colon, a space and the Spoken_Code (Requirement 8.4)', () => {
    const texts = buildLegendModel().map(legendAccessibleText);
    expect(texts).toEqual([
      'Speak: dot dash dot dash dot',
      'Next suggestion: dot dot dash dash',
      'Delete last letter: dash dash dash dash',
      'Help alarm: dot dot dot dash dash dash dot dot dot',
    ]);
  });
});
