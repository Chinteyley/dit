/**
 * SessionApiContext (design "Components", "Integration points for onboarding-and-safety" 2 and 5,
 * tasks 11.1 and 11.16): what DitApp offers to the components inside it, including the plug-ins
 * of onboarding-and-safety. The default value is inert, so a component renders alone in tests
 * and nothing throws when no DitApp is mounted.
 */
import { createContext } from 'react';
import {
  DEFAULT_ENABLED_SOURCES,
  unavailableLearner,
  type SourceControl,
} from '@/lib/conversation';
import { err, type SourceKind, type SourceStatus, type SwitchLearner } from '@/lib/input';
import type { Estimates } from '@/lib/morse';
import type { SessionController } from '@/hooks/session-controller';
import { INITIAL_SNAPSHOT } from '@/hooks/useMorseSession';

export interface SessionApiContextValue {
  /** SessionController.setInitialEstimates: the only way to apply calibrated estimates. */
  setInitialEstimates(estimates: Estimates | null): void;
  /** Moves focus to the Keying_Surface on the next animation frame (Req 21). */
  focusKeyingSurface(): void;
  readonly controller: SessionController;
  readonly sources: SourceControl;
  /** useInputSources().learner: the input-sources Switch_Learner and its Results. */
  readonly learner: SwitchLearner;
  /** useInputSources().pendingSince: the arbiter's earliest pending Raw_Down, or null. Read it at timer time. */
  pendingSince(): number | null;
}

const ALL_OFF: Readonly<Record<SourceKind, SourceStatus>> = Object.freeze({
  keyboard: 'off',
  switch: 'off',
  pointer: 'off',
  blink: 'off',
});

const noop = (): void => undefined;
const noUnsubscribe = (): (() => void) => noop;

const inertSources: SourceControl = Object.freeze({
  enabled: () => DEFAULT_ENABLED_SOURCES,
  statuses: () => ALL_OFF,
  setEnabled: noop,
  startBlink: noop,
  stopBlink: noop,
  restore: noop,
  onChange: noUnsubscribe,
});

const inertController: SessionController = Object.freeze({
  handlePress: noop,
  partnerPick: noop,
  partnerLine: noop,
  clearHistory: noop,
  updateSettings: () => err([]),
  updateInputSettings: noop,
  setInitialEstimates: noop,
  setListen: noop,
  setSourceStatuses: noop,
  dismissMessage: noop,
  discardInput: noop,
  onCharCommitted: noUnsubscribe,
  getSnapshot: () => INITIAL_SNAPSHOT,
  subscribe: noUnsubscribe,
  dispose: noop,
});

/** The value when no DitApp is mounted: every method does nothing, blink is off, learning is unavailable. */
export const INERT_SESSION_API: SessionApiContextValue = Object.freeze({
  setInitialEstimates: noop,
  focusKeyingSurface: noop,
  controller: inertController,
  sources: inertSources,
  learner: unavailableLearner(),
  pendingSince: () => null,
});

export const SessionApiContext = createContext<SessionApiContextValue>(INERT_SESSION_API);
