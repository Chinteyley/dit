/**
 * Every user-facing string of onboarding-and-safety (design "Text constants"), so components and
 * tests share one copy. Plain, short and kind; addressed to the Partner in UI chrome.
 */
import type { FailureStatus } from '@/lib/input';
import type { CommandName } from '@/lib/morse';

// ---- Alarm_Card (Requirements 1.3, 1.4, 6.5) ----

export const ALARM_TITLE = 'I need help';
export const ALARM_DISMISS_LABEL = 'Dismiss';
/** Names the 3 ways to make a Dismissal (Requirement 1.4). */
export const ALARM_DESCRIPTION = 'Press your input, select Dismiss, or press Escape to stop the alarm.';
export const SOUND_UNAVAILABLE_TEXT = 'Sound is unavailable on this device right now.';

// ---- Command_Legend, Cheat_Sheet and Legend_Step (Requirements 8.3, 9.9, 10.6, 16.1, 16.2) ----

export const COMMAND_LABELS: Readonly<Record<CommandName, string>> = Object.freeze({
  speak: 'Speak',
  next: 'Next suggestion',
  backspace: 'Delete last letter',
  sos: 'Help alarm',
});

/** One sentence per command for the Legend_Step (Requirement 16.1). */
export const COMMAND_SENTENCES: Readonly<Record<CommandName, string>> = Object.freeze({
  speak: 'Says the highlighted suggestion, or the typed text when nothing is highlighted.',
  next: 'Moves the highlight to the next suggestion.',
  backspace: 'Deletes the last letter.',
  sos: 'Sounds an alarm and shows I need help until any press.',
});

export const LEGEND_STEP_HINT = 'Tap All codes, or key a pattern that is not a code, to see every letter.';
export const ALL_CODES_LABEL = 'All codes';
export const CLOSE_CODES_LABEL = 'Close codes';
export const NOT_A_CODE_LABEL = 'Not a code:';
export const COMMAND_LEGEND_LABEL = 'Command codes';

export const CHEAT_SHEET_GROUP_HEADINGS = Object.freeze({
  Letters: 'Letters',
  Digits: 'Digits',
  Punctuation: 'Punctuation',
  Commands: 'Commands',
} as const);

// ---- Onboarding_Flow headings and shared buttons (Requirements 11.6, 11.8, 16.3, 18.2) ----

export const STEP_HEADINGS = Object.freeze({
  input: 'Choose an input',
  practice: 'Practice',
  legend: 'Commands',
  done: 'Setup done',
} as const);

export const RUN_SETUP_AGAIN_LABEL = 'Run setup again';
export const CANCEL_SETUP_LABEL = 'Cancel setup';
export const CONTINUE_LABEL = 'Continue';
export const START_LABEL = 'Start';

// ---- Input_Step (Requirements 13.1 to 13.11) ----

export const INPUT_STEP_QUESTION = 'How does the speaker press?';
export const INPUT_CHOICE_LABELS = Object.freeze({
  'key-tap': 'Key or tap',
  switch: 'Switch',
  blink: 'Blink',
} as const);
/** Visible marker next to the selected tile, so selection is not shown by colour alone (18.6). */
export const SELECTED_MARKER = 'Selected';

export const SWITCH_PRESS_NOW = 'Press the switch now.';
export const SWITCH_LEARNED = 'Switch learned.';
/** "Switch learned. Key: KeyF" (Requirement 13.5). */
export function switchLearnedText(code: string): string {
  return `${SWITCH_LEARNED} Key: ${code}`;
}
export const TRY_AGAIN_LABEL = 'Try again';
export const USE_KEY_OR_TAP_LABEL = 'Use key or tap instead';
/** Shown when the session offers no Switch_Learner (design "Camera and switch"). */
export const SWITCH_UNAVAILABLE_TEXT = 'Switch setup is not available in this build.';

export const CAMERA_EXPLANATION =
  'Dit uses the camera to see when the eyes close. Video stays on this device. It is never sent or saved.';
export const TURN_ON_CAMERA_LABEL = 'Turn on camera';

/** Blink_Source status in plain words while the camera runs (Requirement 13.8). */
export const BLINK_STATUS_TEXT = Object.freeze({
  starting: 'Starting camera…',
  active: 'Camera on. Blinks now count as presses.',
  'face-lost': "Can't see a face. Move the camera or the light.",
} as const);

/** Plain-words reason for each Blink_Source failure status (design "Text constants", 11.14, 13.10). */
export const BLINK_FAILURE_TEXT: Readonly<Record<FailureStatus, string>> = Object.freeze({
  'permission-denied':
    'Camera permission was refused. Allow the camera for this site in the browser settings, then try again.',
  'no-camera': 'No camera was found.',
  unsupported: 'This browser cannot use blink input.',
  error: 'The camera could not start.',
});

// ---- Practice_Step and calibration result (Requirements 14, 15) ----

export const PRESS_SHORT = 'Press short';
export const PRESS_LONG = 'Press long';
/** "Press 1 of 5" (Requirements 14.1, 14.5, 14.6). */
export function practiceCountText(n: number): string {
  return `Press ${n} of 5`;
}
/** Live-region text when the count changes, for example "3 of 5" (Requirement 18.3). */
export function practiceCountAnnouncement(collected: number): string {
  return `${collected} of 5`;
}
export const HOLDING_TEXT = 'Holding…';
export const USE_DEFAULT_SPEED_LABEL = 'Use default speed';
export const USE_THIS_SPEED_LABEL = 'Use this speed';
export const PRACTICE_AGAIN_LABEL = 'Practice again';
/** "Default speed: about 6 words per minute", N = Starting_WPM (Requirement 14.11). */
export function defaultSpeedText(startingWpm: number): string {
  return `Default speed: about ${startingWpm} words per minute`;
}
export const CLOSE_PRESSES_TEXT =
  'The long presses were close to the short ones, so Dit set long to 3 times short.';

// ---- Blink resume and save failure (Requirements 11.12 to 11.14, 16.6) ----

export const TURN_ON_BLINK_CAMERA_LABEL = 'Turn on camera for blink input';
export const SETUP_SAVE_FAILED_TEXT = 'Setup could not be saved on this device. It will show again next time.';
