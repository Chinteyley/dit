import { useContext, useId, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import type { OnboardingController, OnboardingSessionApi } from '@/lib/onboarding';
import { OnboardingFlow } from './OnboardingFlow';
import { SessionApiContext } from './session-api-context';

export interface OnboardingHostProps {
  readonly controller: OnboardingController;
}

/**
 * Connects the Onboarding controller to the session (onboarding-and-safety design "Wiring in
 * DitRoot"): it builds the OnboardingSessionApi from SessionApiContext and attaches it in a layout
 * effect, which runs before the input sources start in their passive effects, so the first
 * Press_Event always meets a decided flow (Requirements 11.2 to 11.4). It renders the flow while
 * the controller has one open.
 */
export function OnboardingHost({ controller }: OnboardingHostProps) {
  const session = useContext(SessionApiContext);
  const dialogId = useId();

  const api = useMemo<OnboardingSessionApi>(
    () => ({
      setInitialEstimates: session.setInitialEstimates,
      focusKeyingSurface: session.focusKeyingSurface,
      // "Run setup again" (11.7): the selected tile, once the flow has rendered.
      focusSelectedChoice: () => {
        requestAnimationFrame(() => {
          document.getElementById(dialogId)?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
        });
      },
      settings: () => session.controller.getSnapshot().settings,
      sources: session.sources,
      learner: session.learner,
      pendingSince: session.pendingSince,
    }),
    [session, dialogId],
  );

  useLayoutEffect(() => controller.attach(api), [controller, api]);

  const view = useSyncExternalStore(controller.subscribe, controller.getView, controller.getView);
  const readWpm = (): number => session.controller.getSnapshot().settings.startingWpm;
  const startingWpm = useSyncExternalStore(session.controller.subscribe, readWpm, readWpm);

  if (view.state === null) return null;
  return <OnboardingFlow id={dialogId} state={view.state} dispatch={controller.dispatch} startingWpm={startingWpm} />;
}
