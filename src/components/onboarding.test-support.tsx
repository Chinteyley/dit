/**
 * Test rig for the onboarding-and-safety components (test-only, never imported by app code): a
 * SessionApiContext value with spies, a real Onboarding controller over fakes (FakeSourceControl,
 * FakeSwitchLearner, FakeEngine, a manual clock and scheduler, in-memory storage), and a
 * Keying_Surface stand-in that the focus spy really focuses.
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi, type Mock } from 'vitest';
import { DEFAULT_SETTINGS, memoryBackend, type KeyValueBackend, type SettingsRecord } from '@/lib/conversation';
import { createManualClock, createManualScheduler, type ManualClock, type ManualScheduler } from '@/lib/input';
import {
  ONBOARDING_KEY,
  createOnboardingController,
  type OnboardingController,
  type OnboardingRecord,
} from '@/lib/onboarding';
import {
  createFakeEngineFactory,
  createFakeSourceControl,
  createFakeSwitchLearner,
  type FakeSourceControl,
  type FakeSwitchLearner,
} from '@/lib/onboarding/fakes';
import type { SessionController } from '@/hooks/session-controller';
import { OnboardingHost } from './OnboardingHost';
import { INERT_SESSION_API, SessionApiContext, type SessionApiContextValue } from './session-api-context';

export const KEYING_SURFACE = { name: 'Keying surface' } as const;

/** A focusable stand-in for the Keying_Surface, found like the real one. */
export function FakeKeyingSurface() {
  return <div role="button" tabIndex={0} aria-label="Keying surface" />;
}

function focusFakeSurface(): void {
  document.querySelector<HTMLElement>('[role="button"][aria-label="Keying surface"]')?.focus();
}

export interface SessionRig {
  readonly value: SessionApiContextValue;
  /** Focuses the fake Keying_Surface at once (the real one waits for the next frame). */
  readonly focusKeyingSurface: Mock<() => void>;
  readonly setInitialEstimates: Mock<SessionApiContextValue['setInitialEstimates']>;
  readonly handlePress: Mock<SessionController['handlePress']>;
  /** Tells every onCharCommitted listener about a `char` the session applied. */
  commitChar(char: string): void;
  /** Changes what controller.getSnapshot().settings returns and notifies subscribers. */
  setSettings(settings: SettingsRecord): void;
}

export function createSessionRig(
  extra: Partial<Pick<SessionApiContextValue, 'sources' | 'learner' | 'pendingSince'>> = {},
): SessionRig {
  const charListeners = new Set<(char: string) => void>();
  const subscribers = new Set<() => void>();
  let snapshot = { ...INERT_SESSION_API.controller.getSnapshot(), settings: DEFAULT_SETTINGS };
  const focusKeyingSurface = vi.fn(focusFakeSurface);
  const setInitialEstimates = vi.fn<SessionApiContextValue['setInitialEstimates']>();
  const handlePress = vi.fn<SessionController['handlePress']>();
  const controller: SessionController = {
    ...INERT_SESSION_API.controller,
    handlePress,
    setInitialEstimates,
    onCharCommitted(listener) {
      charListeners.add(listener);
      return () => {
        charListeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
  };
  return {
    value: { ...INERT_SESSION_API, setInitialEstimates, focusKeyingSurface, controller, ...extra },
    focusKeyingSurface,
    setInitialEstimates,
    handlePress,
    commitChar(char) {
      for (const listener of [...charListeners]) listener(char);
    },
    setSettings(settings) {
      snapshot = { ...snapshot, settings };
      for (const listener of [...subscribers]) listener();
    },
  };
}

export interface ControllerRig {
  readonly controller: OnboardingController;
  readonly session: SessionRig;
  readonly sources: FakeSourceControl;
  readonly learner: FakeSwitchLearner;
  readonly backend: KeyValueBackend;
  readonly clock: ManualClock;
  readonly scheduler: ManualScheduler;
  readonly alarmStart: Mock<() => void>;
  readonly view: ReturnType<typeof render>;
}

export interface ControllerRigOptions {
  /** Stored before the controller attaches; omit for a first run. */
  readonly record?: OnboardingRecord;
  readonly backend?: KeyValueBackend;
  /** Extra elements rendered before the host (for example a page h1). */
  readonly before?: ReactNode;
}

/** A real Onboarding controller behind OnboardingHost, with every dependency faked. */
export function renderOnboarding(opts: ControllerRigOptions = {}): ControllerRig {
  const backend =
    opts.backend ?? memoryBackend(opts.record === undefined ? {} : { [ONBOARDING_KEY]: JSON.stringify(opts.record) });
  const sources = createFakeSourceControl();
  const learner = createFakeSwitchLearner();
  const clock = createManualClock(1000);
  const scheduler = createManualScheduler(clock.now);
  const alarmStart = vi.fn<() => void>();
  const controller = createOnboardingController({
    backend: () => backend,
    clock: () => clock.now,
    scheduler: () => scheduler,
    createEngine: createFakeEngineFactory().create,
    alarm: { start: alarmStart },
    router: { onOnboardingOpenChange: () => undefined },
  });
  const session = createSessionRig({ sources, learner });
  const view = render(
    <SessionApiContext value={session.value}>
      {opts.before}
      <FakeKeyingSurface />
      <OnboardingHost controller={controller} />
    </SessionApiContext>,
  );
  return { controller, session, sources, learner, backend, clock, scheduler, alarmStart, view };
}

/** Waits for two animation frames, long enough for any focus-on-next-frame call to have run. */
export async function nextFrames(): Promise<void> {
  for (let i = 0; i < 2; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
