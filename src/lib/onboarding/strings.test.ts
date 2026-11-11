import { describe, expect, it } from 'vitest';
import { FAILURE_STATUSES } from '@/lib/input';
import {
  ALARM_DESCRIPTION,
  ALARM_TITLE,
  BLINK_FAILURE_TEXT,
  BLINK_STATUS_TEXT,
  COMMAND_LABELS,
  COMMAND_SENTENCES,
  STEP_HEADINGS,
  defaultSpeedText,
  practiceCountAnnouncement,
  practiceCountText,
  switchLearnedText,
} from './strings';

describe('strings', () => {
  it('describes all 3 ways to dismiss the alarm (Requirement 1.4)', () => {
    expect(ALARM_TITLE).toBe('I need help');
    expect(ALARM_DESCRIPTION).toMatch(/press your input/i);
    expect(ALARM_DESCRIPTION).toMatch(/Dismiss/);
    expect(ALARM_DESCRIPTION).toMatch(/Escape/);
  });

  it('labels and explains each of the 4 commands', () => {
    expect(COMMAND_LABELS).toEqual({
      speak: 'Speak',
      next: 'Next suggestion',
      backspace: 'Delete last letter',
      sos: 'Help alarm',
    });
    expect(COMMAND_SENTENCES.sos).toBe('Sounds an alarm and shows I need help until any press.');
    expect(Object.keys(COMMAND_SENTENCES).sort()).toEqual(['backspace', 'next', 'sos', 'speak']);
  });

  it('names the 4 onboarding steps (Requirement 18.2)', () => {
    expect(STEP_HEADINGS).toEqual({
      input: 'Choose an input',
      practice: 'Practice',
      legend: 'Commands',
      done: 'Setup done',
    });
  });

  it('has plain-words texts for the blink statuses and every failure status (Requirement 13.8, 13.10)', () => {
    expect(BLINK_STATUS_TEXT.starting).toBe('Starting camera…');
    for (const status of FAILURE_STATUSES) expect(BLINK_FAILURE_TEXT[status].length).toBeGreaterThan(0);
    expect(BLINK_FAILURE_TEXT['no-camera']).toBe('No camera was found.');
  });

  it('formats the switch, count and default speed texts', () => {
    expect(switchLearnedText('KeyF')).toBe('Switch learned. Key: KeyF');
    expect(practiceCountText(1)).toBe('Press 1 of 5');
    expect(practiceCountAnnouncement(3)).toBe('3 of 5');
    expect(defaultSpeedText(6)).toBe('Default speed: about 6 words per minute');
  });
});
