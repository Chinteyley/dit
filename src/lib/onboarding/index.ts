// Public API of the onboarding core (task 14.7). fakes.ts and test-support.ts stay private to tests.
export * from './strings';
export { PUNCTUATION_NAMES, characterName, speedText, spokenCode } from './spoken';
export { COMMAND_ORDER, buildLegendModel, legendAccessibleText } from './legend-model';
export type { LegendEntry } from './legend-model';
export { buildCheatSheetModel, entryAccessibleText } from './cheat-sheet-model';
export type { CheatSheetEntry, CheatSheetGroup, CheatSheetGroupName } from './cheat-sheet-model';
export { CLOSED_SHEET, cheatSheetStep } from './cheat-sheet-state';
export type { CheatSheetAction, CheatSheetContext, CheatSheetState, OpenReason } from './cheat-sheet-state';
export { createCheatSheetStore, createUnknownPatternHandler } from './cheat-sheet-store';
export type { CheatSheetStore } from './cheat-sheet-store';
export { GUARD_PENDING_RETRY_MS, createOnboardingController } from './controller';
export type {
  BlinkResume,
  OnboardingController,
  OnboardingControllerDeps,
  OnboardingSessionApi,
  OnboardingView,
} from './controller';
export { PANEL_GAP_PX, freeBands, placePanel } from './placement';
export type { Placement, Rect } from './placement';
export {
  PRACTICE_PRESSES,
  closePressesShown,
  continueEnabled,
  heldIndicatorShown,
  initialFirstRun,
  initialRerun,
  isOpenStep,
  onboardingEffects,
  onboardingStep,
  practicePrompt,
} from './flow';
export type {
  BlinkPhase,
  InputChoice,
  OnboardingAction,
  OnboardingEffect,
  OnboardingReport,
  OnboardingState,
  Origin,
  PracticeResult,
  Step,
  SwitchLearnResult,
  SwitchPhase,
} from './types';
export {
  EstimatesSchema,
  ONBOARDING_KEY,
  OnboardingRecordSchema,
  parseOnboardingRecord,
  readOnboardingRecord,
  serializeOnboardingRecord,
  writeOnboardingRecord,
} from './record';
export type { OnboardingRecord, ReadOutcome } from './record';
