// Public API of the input layer. The browser adapters (browser.ts, blink/browser.ts) are imported
// from their own files by src/hooks/useInputSources.ts, and test-support.ts stays private, so lib
// code and tests that use this barrel never load DOM or MediaPipe code.
export { INITIAL_ARBITER_STATE, arbiterStep, createArbiter, safeTickTime } from './arbiter';
export type { Arbiter, ArbiterInput, ArbiterState, ArbiterStep, ConnectError } from './arbiter';
export {
  DEFAULT_DETECTOR_CONFIG,
  createBlinkDetector,
  normalizeFrame,
  validateThresholds,
} from './blink/detector';
export type {
  BlinkDetector,
  BlinkFrame,
  DetectorConfig,
  DetectorOutput,
  DetectorState,
  EyeState,
  FaceStatus,
  RawBlinkFrame,
  ThresholdError,
} from './blink/detector';
export { LANDMARKER_READY_LIMIT_MS, cameraFailureStatus, createBlinkSource } from './blink/source';
export type {
  BlinkDevices,
  BlinkSource,
  BlinkSourceDeps,
  CameraStream,
  CameraTrack,
  FrameLoop,
  Landmarker,
} from './blink/source';
export { createManualClock, createManualScheduler } from './clock';
export type { Clock, ManualClock, ManualScheduler, Scheduler } from './clock';
export {
  DEFAULT_MIN_PRESS,
  MIN_PRESS_RANGES,
  createDebouncer,
  debounceStep,
  validateMinPressDuration,
} from './debounce';
export type { DebounceInput, DebounceState, DebounceStep, Debouncer } from './debounce';
export { INTERACTIVE_ROLES, TEXT_INPUT_TYPES, classifyFocus } from './focus';
export type { FocusClass, FocusDescription } from './focus';
export { createKeyRouter } from './key-router';
export type { KeyEventLike, KeyEventTarget, KeyHandler, KeyRouter, LearnerHook } from './key-router';
export { KEYBOARD_CODES, createKeyboardSource } from './keyboard';
export type { KeySource, KeySourceDeps } from './keyboard';
export { createPointerSource } from './pointer';
export type {
  DocumentPointerTarget,
  PointerEventLike,
  PointerSource,
  PointerSourceDeps,
  PointerState,
  SurfaceElement,
  SurfaceEventType,
} from './pointer';
export { DEFAULT_INPUT_SETTINGS, validateInputSettings } from './settings';
export type { InputSettings, SettingsStore, StoreError } from './settings';
export type { PageLifecycle } from './source-base';
export { RESERVED_KEYS, createSwitchSource, isReservedKey, validateSwitchKey } from './switch';
export type { SwitchSource } from './switch';
export { createSwitchLearner } from './switch-learner';
export type { LearnError, SwitchKeySnapshot, SwitchLearner } from './switch-learner';
export { FAILURE_STATUSES, SOURCE_KINDS, err, isFailureStatus, ok, pressEvent } from './types';
export type {
  FailureStatus,
  PressEvent,
  PressKind,
  PressSource,
  Result,
  SettingError,
  SourceKind,
  SourceStatus,
  Unsubscribe,
} from './types';
