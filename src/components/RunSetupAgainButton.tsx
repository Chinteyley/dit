import { RUN_SETUP_AGAIN_LABEL, type OnboardingController } from '@/lib/onboarding';
import type { SettingsActionsApi } from './DitApp';

export interface RunSetupAgainButtonProps {
  readonly controller: OnboardingController;
  readonly closeSettings: SettingsActionsApi['closeSettings'];
}

/**
 * "Run setup again" in the Settings_Panel (onboarding-and-safety Requirements 11.6 and 11.7): it
 * closes Settings without moving focus, then opens the flow with the current choice selected; the
 * controller focuses that choice.
 */
export function RunSetupAgainButton({ controller, closeSettings }: RunSetupAgainButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        closeSettings({ focusKeyingSurface: false });
        controller.runSetupAgain();
      }}
      className="min-h-(--size-target) min-w-(--size-target) rounded-xl border border-border bg-raised px-5 text-lg font-medium text-text"
    >
      {RUN_SETUP_AGAIN_LABEL}
    </button>
  );
}
