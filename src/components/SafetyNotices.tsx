import { useEffect, useSyncExternalStore } from 'react';
import { SETUP_SAVE_FAILED_TEXT, TURN_ON_BLINK_CAMERA_LABEL, type OnboardingController } from '@/lib/onboarding';

export interface SafetyNoticesProps {
  readonly onboarding: OnboardingController;
}

/**
 * Notes below the Command_Legend (onboarding-and-safety Requirements 11.12 to 11.14 and 16.6):
 * "Turn on camera for blink input" when Blink is the saved choice and the camera is off or failed
 * (the click starts the camera inside the Partner's action), the plain-words reason for a camera
 * failure, and the save-failure note, which stays until a later save succeeds or the page
 * unloads. Not a live region: the conversation keeps the page's only one.
 */
export function SafetyNotices({ onboarding }: SafetyNoticesProps) {
  const { blinkResume, saveFailed } = useSyncExternalStore(onboarding.subscribe, onboarding.getView, onboarding.getView);
  useEffect(() => {
    let cancelled = false;
    const view = onboarding.getView();
    if (view.inputChoiceInEffect !== 'blink' || !view.blinkResume.visible || view.blinkResume.reason !== null) return;
    const resumeGrantedCamera = async (): Promise<void> => {
      try {
        const permission = await navigator.permissions?.query({ name: 'camera' });
        const current = onboarding.getView();
        if (
          !cancelled && permission?.state === 'granted' && current.inputChoiceInEffect === 'blink' &&
          current.blinkResume.visible && current.blinkResume.reason === null && !onboarding.isOpen()
        ) onboarding.turnOnBlinkCamera();
      } catch {
        // Unsupported permission queries retain the explicit camera action.
      }
    };
    void resumeGrantedCamera();
    return () => { cancelled = true; };
  }, [onboarding]);
  if (!blinkResume.visible && blinkResume.reason === null && !saveFailed) return null;

  return (
    <div className="mt-5 flex flex-col items-start gap-3">
      {blinkResume.reason !== null ? <p className="text-lg text-text">{blinkResume.reason}</p> : null}
      {blinkResume.visible ? (
        <button
          type="button"
          onClick={() => onboarding.turnOnBlinkCamera()}
          className="min-h-(--size-target) min-w-(--size-target) rounded-xl border border-border bg-raised px-5 text-lg font-medium text-text"
        >
          {TURN_ON_BLINK_CAMERA_LABEL}
        </button>
      ) : null}
      {saveFailed ? <p className="text-lg text-text">{SETUP_SAVE_FAILED_TEXT}</p> : null}
    </div>
  );
}
