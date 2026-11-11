import { describe, expect, it } from 'vitest';
import { CLOSED_SHEET, cheatSheetStep, type CheatSheetContext, type CheatSheetState } from './cheat-sheet-state';

const IDLE: CheatSheetContext = { onboardingOpen: false, alarmActive: false };
const ONBOARDING: CheatSheetContext = { onboardingOpen: true, alarmActive: false };
const ALARM: CheatSheetContext = { onboardingOpen: false, alarmActive: true };
const UNKNOWN_OPEN: CheatSheetState = { open: true, reason: 'unknown', pattern: '..-.-' };
const PARTNER_OPEN: CheatSheetState = { open: true, reason: 'partner', pattern: null };

describe('cheatSheetStep', () => {
  it('opens on an unknown pattern with reason unknown (Requirement 10.1)', () => {
    expect(cheatSheetStep(CLOSED_SHEET, { type: 'unknown', pattern: '.-.-.-.' }, IDLE)).toEqual({
      open: true,
      reason: 'unknown',
      pattern: '.-.-.-.',
    });
  });

  it('keeps the reason and shows only the newest pattern while open (Requirement 10.2)', () => {
    expect(cheatSheetStep(UNKNOWN_OPEN, { type: 'unknown', pattern: '---.-' }, IDLE)).toEqual({
      ...UNKNOWN_OPEN,
      pattern: '---.-',
    });
    expect(cheatSheetStep(PARTNER_OPEN, { type: 'unknown', pattern: '---.-' }, IDLE)).toEqual({
      open: true,
      reason: 'partner',
      pattern: '---.-',
    });
  });

  it('ignores an unknown pattern during onboarding and keeps nothing (Requirement 10.11)', () => {
    expect(cheatSheetStep(CLOSED_SHEET, { type: 'unknown', pattern: '..-.-' }, ONBOARDING)).toBe(CLOSED_SHEET);
    expect(cheatSheetStep(PARTNER_OPEN, { type: 'unknown', pattern: '..-.-' }, ONBOARDING)).toBe(PARTNER_OPEN);
  });

  it('opens for the partner with no pattern, or switches the reason and keeps the pattern (8.9, 10.5, 10.12)', () => {
    expect(cheatSheetStep(CLOSED_SHEET, { type: 'partner-open' }, IDLE)).toEqual(PARTNER_OPEN);
    expect(cheatSheetStep(UNKNOWN_OPEN, { type: 'partner-open' }, IDLE)).toEqual({ ...UNKNOWN_OPEN, reason: 'partner' });
    expect(cheatSheetStep(PARTNER_OPEN, { type: 'partner-open' }, IDLE)).toBe(PARTNER_OPEN);
  });

  it('closes either opening on any committed code (Requirements 10.3, 10.4)', () => {
    expect(cheatSheetStep(UNKNOWN_OPEN, { type: 'char-committed' }, IDLE)).toBe(CLOSED_SHEET);
    expect(cheatSheetStep(PARTNER_OPEN, { type: 'char-committed' }, IDLE)).toBe(CLOSED_SHEET);
    expect(cheatSheetStep(CLOSED_SHEET, { type: 'char-committed' }, IDLE)).toBe(CLOSED_SHEET);
  });

  it('closes on close and clears the pattern (Requirements 10.7, 10.13)', () => {
    expect(cheatSheetStep(UNKNOWN_OPEN, { type: 'close' }, IDLE)).toBe(CLOSED_SHEET);
    expect(cheatSheetStep(PARTNER_OPEN, { type: 'close' }, ONBOARDING)).toBe(CLOSED_SHEET);
    expect(cheatSheetStep(CLOSED_SHEET, { type: 'close' }, IDLE)).toBe(CLOSED_SHEET);
  });

  it('ignores opening and partner actions while the alarm is active; committed SOS can close it (Requirements 7.9, 10.14)', () => {
    expect(cheatSheetStep(UNKNOWN_OPEN, { type: 'close' }, ALARM)).toBe(UNKNOWN_OPEN);
    expect(cheatSheetStep(UNKNOWN_OPEN, { type: 'char-committed' }, ALARM)).toBe(CLOSED_SHEET);
    expect(cheatSheetStep(CLOSED_SHEET, { type: 'unknown', pattern: '..-.-' }, ALARM)).toBe(CLOSED_SHEET);
    expect(cheatSheetStep(CLOSED_SHEET, { type: 'partner-open' }, ALARM)).toBe(CLOSED_SHEET);
  });
});
