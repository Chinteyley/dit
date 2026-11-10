'use client';

import { useLayoutEffect, useState } from 'react';
import { localStorageBackend } from '@/lib/conversation/browser';
import type { Unsubscribe } from '@/lib/input';
import { browserScheduler, performanceClock } from '@/lib/input/browser';
import { createEngine } from '@/lib/morse';
import {
  createCheatSheetStore,
  createOnboardingController,
  createUnknownPatternHandler,
  type CheatSheetStore,
  type OnboardingController,
} from '@/lib/onboarding';
import {
  createAlarmHandler,
  createChimePlayer,
  createPressRouter,
  type PageVisibility,
  type SafetyAlarmHandler,
  type SafetyPressRouter,
} from '@/lib/safety';
import { browserPageVisibility, installAudioUnlock, webAudioPort, type WebAudioPort } from '@/lib/safety/browser';
import type { UnknownPatternHandler } from '@/lib/conversation';
import { engineOrDefault } from '@/hooks/session-controller';
import { AlarmCard } from './AlarmCard';
import { CheatSheet } from './CheatSheet';
import { CommandLegend } from './CommandLegend';
import { DitApp } from './DitApp';
import { OnboardingHost } from './OnboardingHost';
import { RunSetupAgainButton } from './RunSetupAgainButton';
import { SafetyNotices } from './SafetyNotices';

interface SafetyRuntime {
  readonly alarm: SafetyAlarmHandler;
  readonly router: SafetyPressRouter;
  readonly onboarding: OnboardingController;
  readonly cheatSheet: CheatSheetStore;
  readonly unknownPattern: UnknownPatternHandler;
  /** Web Audio, page visibility and the gesture unlock; returns the unlock listeners' removal. */
  attachBrowser(win: Window & typeof globalThis): Unsubscribe;
}

/**
 * The onboarding-and-safety plug-ins, built once (design "Wiring in DitRoot"). Nothing here
 * touches a browser global, so the server can render it: storage, clock and scheduler are read
 * when called, and the audio port and page visibility arrive through attachBrowser.
 */
function createSafetyRuntime(): SafetyRuntime {
  let audio: WebAudioPort | null = null;
  let page: PageVisibility | null = null;
  const chime = createChimePlayer({ audio: () => audio, scheduler: () => browserScheduler, page: () => page });
  const alarm = createAlarmHandler({ chime });
  // The router and the controller need each other; the router reads the controller at call time.
  let controller: OnboardingController | null = null;
  const router = createPressRouter({
    alarm,
    onboarding: {
      isOpen: () => controller?.isOpen() ?? false,
      handlePress: (event) => controller?.handlePress(event),
    },
  });
  const onboarding = createOnboardingController({
    backend: () => localStorageBackend(),
    clock: () => performanceClock,
    scheduler: () => browserScheduler,
    createEngine: engineOrDefault(createEngine),
    alarm,
    router,
  });
  controller = onboarding;
  const cheatSheet = createCheatSheetStore(() => ({ onboardingOpen: onboarding.isOpen(), alarmActive: alarm.isActive() }));
  return {
    alarm,
    router,
    onboarding,
    cheatSheet,
    unknownPattern: createUnknownPatternHandler(cheatSheet),
    attachBrowser(win) {
      // One port (so one AudioContext) per page load, even when React attaches twice.
      audio ??= webAudioPort(win);
      page ??= browserPageVisibility(win.document);
      return installAudioUnlock(win, audio);
    },
  };
}

/**
 * The client root of the app (onboarding-and-safety task 21): DitApp with the SOS alarm, the
 * Press_Router, the Command_Legend, the Cheat_Sheet, first-run setup and "Run setup again"
 * plugged in. The Alarm_Card renders last so its dialog is last in the page.
 */
export function DitRoot() {
  const [runtime] = useState(createSafetyRuntime);
  useLayoutEffect(() => runtime.attachBrowser(window), [runtime]);

  return (
    <DitApp
      alarm={runtime.alarm}
      unknownPattern={runtime.unknownPattern}
      pressRouter={runtime.router}
      legend={
        <>
          <CommandLegend store={runtime.cheatSheet} />
          <SafetyNotices onboarding={runtime.onboarding} />
        </>
      }
      overlay={
        <>
          <CheatSheet store={runtime.cheatSheet} />
          <OnboardingHost controller={runtime.onboarding} />
          <AlarmCard handler={runtime.alarm} />
        </>
      }
      extraSettingsActions={({ closeSettings }) => (
        <RunSetupAgainButton controller={runtime.onboarding} closeSettings={closeSettings} />
      )}
    />
  );
}
