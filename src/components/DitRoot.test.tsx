// @vitest-environment jsdom
/**
 * DitRoot end to end in jsdom (onboarding-and-safety task 21.3): the real input layer, Engine,
 * Press_Router, Alarm_Handler, Onboarding controller and localStorage. Fake timers drive
 * setTimeout, requestAnimationFrame and performance.now, so every press has an exact length.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, type SettingsRecord } from '@/lib/conversation';
import { ONBOARDING_KEY, type OnboardingRecord } from '@/lib/onboarding';
import { DitRoot } from './DitRoot';

/** 20 WPM, the fastest starting speed: one unit is 60 ms. */
const UNIT = 60;
const FAST: SettingsRecord = { ...DEFAULT_SETTINGS, startingWpm: 20, adaptive: false };
const COMPLETE: OnboardingRecord = { v: 1, complete: true, inputChoice: 'key-tap', estimates: null };

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  });
  vi.advanceTimersByTime(1000);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

function store(settings: SettingsRecord, record?: OnboardingRecord): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (record !== undefined) localStorage.setItem(ONBOARDING_KEY, JSON.stringify(record));
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function renderRoot(): void {
  render(<DitRoot />);
  advance(50); // the session controller, the first frame and focus on the Keying_Surface
}

function space(type: 'keyDown' | 'keyUp'): void {
  fireEvent[type](document.activeElement ?? document.body, { key: ' ', code: 'Space' });
}

/**
 * Space on a focused button, as a browser does it: keydown, keyup, then the button's click. jsdom
 * has no activation behaviour, and user-event's waits hang under these fake timers.
 */
function spaceOnFocusedButton(): void {
  const target = document.activeElement;
  if (!(target instanceof HTMLButtonElement)) throw new Error('a button should have focus');
  space('keyDown');
  space('keyUp');
  fireEvent.click(target);
}

/** Keys a pattern with Space at Morse timing, then waits out the letter gap. */
function key(pattern: string, unit = UNIT): void {
  for (const symbol of pattern) {
    space('keyDown');
    advance(symbol === '.' ? unit : 3 * unit);
    space('keyUp');
    advance(unit);
  }
  advance(4 * unit);
}

/** Current_Text as the Partner_Display shows it, without its "Typing" heading. */
function typing(): string {
  const region = screen.getByRole('region', { name: 'Typing' });
  const heading = within(region).getByRole('heading', { name: 'Typing' }).textContent ?? '';
  return (region.textContent ?? '').slice(heading.length);
}
const surface = (): HTMLElement => screen.getByRole('button', { name: 'Keying surface' });
const alarm = (): HTMLElement | null => screen.queryByRole('alertdialog', { name: 'I need help' });

describe('DitRoot', () => {
  it('opens setup before the first press on a first visit, and presses during setup never type', () => {
    store(FAST);
    renderRoot();
    expect(screen.getByRole('dialog', { name: 'Choose an input' })).toBeDefined();
    expect(document.activeElement).toBe(surface());
    key('.');
    key('-.-.');
    expect(typing()).toBe('Nothing typed yet');
    expect(screen.getByRole('dialog', { name: 'Choose an input' })).toBeDefined();
  });

  it('applies the stored estimates before the first press when setup is complete', () => {
    // Stored estimates of 150 and 450 ms put the dot/dash threshold at 300 ms; the 6 WPM defaults put it at 400.
    store({ ...DEFAULT_SETTINGS, adaptive: false }, { ...COMPLETE, estimates: { dotEstimate: 150, dashEstimate: 450 } });
    renderRoot();
    expect(screen.queryByRole('dialog')).toBeNull();
    space('keyDown');
    advance(350);
    space('keyUp');
    advance(400);
    expect(typing()).toBe('t');
  });

  it('SOS keyed with Space raises "I need help", the next Space dismisses it, and the text is unchanged', () => {
    store(FAST, COMPLETE);
    renderRoot();
    key('..');
    advance(10 * UNIT);
    const before = typing();
    expect(before).toBe('i '); // the pause after "i" was a word gap
    expect(alarm()).toBeNull();
    key('...---...');
    expect(alarm()).not.toBeNull();
    expect(screen.getByText('Sound is unavailable on this device right now.')).toBeDefined();
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    expect(document.activeElement).toBe(dismiss);
    spaceOnFocusedButton();
    expect(alarm()).toBeNull();
    advance(50);
    expect(document.activeElement).toBe(surface());
    expect(typing()).toBe(before);
    // Keying goes on as before.
    key('.');
    expect(typing().trimEnd()).toBe('i e');
  });

  it('SOS keyed during setup raises the alarm and leaves the setup step as it was', () => {
    store(FAST);
    renderRoot();
    fireEvent.click(screen.getByRole('button', { name: 'Key or tap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    advance(50);
    expect(screen.getByRole('heading', { level: 2, name: 'Practice' })).toBeDefined();
    expect(document.activeElement).toBe(surface());
    key('...---...');
    expect(alarm()).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Practice' })).toBeDefined();
    spaceOnFocusedButton();
    expect(alarm()).toBeNull();
    advance(50);
    expect(screen.getByRole('heading', { level: 2, name: 'Practice' })).toBeDefined();
    expect(typing()).toBe('Nothing typed yet');
  });
});
