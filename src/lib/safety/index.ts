// Public API of the safety core (task 14.7). browser.ts (Web Audio, gesture unlock, page
// visibility) is imported from its own file by DitRoot, and fakes.ts and test-support.ts stay
// private to tests, so lib code and tests that use this barrel never load browser code.
export { alarmStep, isAlarmActive, isDismissal } from './alarm-machine';
export type { AlarmEffect, AlarmInput, AlarmState, AlarmStepResult } from './alarm-machine';
export { createAlarmHandler } from './alarm-handler';
export type { CardView, SafetyAlarmHandler } from './alarm-handler';
export {
  CHIME_END_MS,
  CHIME_PERIOD_MS,
  MAX_CHIMES_PER_WINDOW,
  PEAK_GAIN,
  RAMP_MS,
  TONES,
  chimeSchedule,
} from './chime-schedule';
export {
  LATE_LIMIT_MS,
  LOOKAHEAD_HIDDEN_MS,
  LOOKAHEAD_VISIBLE_MS,
  REFILL_EVERY_MS,
  SOUND_CHECK_MS,
  createChimePlayer,
} from './chime-player';
export type { AudioPort, AudioState, ChimePlayer, ChimeVoice, PageVisibility } from './chime-player';
export { INITIAL_ROUTER, consumerFor, createPressRouter, routePress } from './press-router';
export type {
  Consumer,
  PressConsumer,
  RouteContext,
  RouteResult,
  RouterState,
  SafetyPressRouter,
} from './press-router';
