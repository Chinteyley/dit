import type { ReactNode } from 'react';
import { isFailureStatus } from '@/lib/input';
import {
  BLINK_FAILURE_TEXT,
  BLINK_STATUS_TEXT,
  CAMERA_EXPLANATION,
  CONTINUE_LABEL,
  INPUT_CHOICE_LABELS,
  INPUT_STEP_QUESTION,
  SELECTED_MARKER,
  SWITCH_PRESS_NOW,
  TRY_AGAIN_LABEL,
  TURN_ON_CAMERA_LABEL,
  USE_KEY_OR_TAP_LABEL,
  continueEnabled,
  switchLearnedText,
  type InputChoice,
  type OnboardingAction,
  type OnboardingState,
} from '@/lib/onboarding';

export interface InputStepProps {
  readonly state: OnboardingState;
  readonly dispatch: (action: OnboardingAction) => void;
}

const CHOICES: readonly InputChoice[] = ['key-tap', 'switch', 'blink'];

const secondaryButton =
  'min-h-(--size-target) min-w-(--size-target) rounded-xl border border-border bg-raised px-5 text-lg font-medium text-text';
const primaryButton =
  'min-h-(--size-target) min-w-(--size-target) self-start rounded-xl bg-text px-7 text-lg font-semibold text-on-accent disabled:cursor-not-allowed disabled:border disabled:border-border disabled:bg-raised disabled:text-muted';

/** The Switch area under the tiles (Requirements 13.4 to 13.6). */
function switchArea(state: OnboardingState, dispatch: InputStepProps['dispatch']): ReactNode {
  const phase = state.switchPhase;
  switch (phase.kind) {
    case 'idle':
      return null;
    case 'armed':
      return <p className="text-xl font-medium text-text">{SWITCH_PRESS_NOW}</p>;
    case 'learned':
      return <p className="text-xl font-medium text-text">{switchLearnedText(phase.code)}</p>;
    case 'failed':
      return (
        <>
          <p className="text-lg text-text">{phase.message}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => dispatch({ type: 'switch-retry' })} className={secondaryButton}>
              {TRY_AGAIN_LABEL}
            </button>
            <button type="button" onClick={() => dispatch({ type: 'use-key-tap' })} className={secondaryButton}>
              {USE_KEY_OR_TAP_LABEL}
            </button>
          </div>
        </>
      );
  }
}

/** The Blink area under the tiles (Requirements 13.7 to 13.10). No camera request before "Turn on camera". */
function blinkArea(state: OnboardingState, dispatch: InputStepProps['dispatch']): ReactNode {
  const phase = state.blinkPhase;
  if (phase.kind === 'idle') return null;
  // The click itself starts the camera, inside the Partner's action (input-sources Req 9.1).
  const cameraOn = (): void => dispatch({ type: 'camera-on' });
  if (phase.kind === 'explained' || phase.status === 'off') {
    return (
      <>
        <p className="max-w-[48ch] text-lg text-text">{CAMERA_EXPLANATION}</p>
        {phase.kind === 'explained' ? (
          <button type="button" onClick={cameraOn} className={`${secondaryButton} self-start`}>
            {TURN_ON_CAMERA_LABEL}
          </button>
        ) : null}
      </>
    );
  }
  const status = phase.status;
  if (!isFailureStatus(status)) return <p className="text-xl font-medium text-text">{BLINK_STATUS_TEXT[status]}</p>;
  return (
    <>
      <p className="max-w-[48ch] text-lg text-text">{BLINK_FAILURE_TEXT[status]}</p>
      <div className="flex flex-wrap gap-3">
        {status === 'unsupported' ? null : (
          <button type="button" onClick={cameraOn} className={secondaryButton}>
            {TRY_AGAIN_LABEL}
          </button>
        )}
        <button type="button" onClick={() => dispatch({ type: 'use-key-tap' })} className={secondaryButton}>
          {USE_KEY_OR_TAP_LABEL}
        </button>
      </div>
    </>
  );
}

/**
 * The Input_Step (Requirement 13): three toggle tiles, "Key or tap", "Switch" and "Blink", with
 * the selected one marked by aria-pressed, its outline and a visible "Selected" (never colour
 * alone), then the Switch or Blink area and Continue, which stays disabled until a choice is
 * confirmed.
 */
export function InputStep({ state, dispatch }: InputStepProps) {
  const extra = state.selected === 'switch' ? switchArea(state, dispatch) : state.selected === 'blink' ? blinkArea(state, dispatch) : null;

  return (
    <div className="flex flex-col gap-7">
      <fieldset className="min-w-0">
        <legend className="mb-4 text-xl font-medium text-text">{INPUT_STEP_QUESTION}</legend>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3">
          {CHOICES.map((choice) => {
            const selected = state.selected === choice;
            return (
              <button
                key={choice}
                type="button"
                aria-pressed={selected}
                onClick={() => dispatch({ type: 'choose', choice })}
                className={`flex min-h-24 flex-col items-start justify-between gap-3 rounded-2xl border-2 bg-raised px-5 py-4 text-left text-xl font-semibold text-text ${
                  selected ? 'border-accent' : 'border-border'
                }`}
              >
                {INPUT_CHOICE_LABELS[choice]}
                {selected ? (
                  <span aria-hidden="true" className="flex items-center gap-2 text-base font-semibold text-accent">
                    <span className="block size-2.5 rounded-full bg-accent" />
                    {SELECTED_MARKER}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </fieldset>
      {extra === null ? null : <div className="flex flex-col gap-4">{extra}</div>}
      <button
        type="button"
        disabled={!continueEnabled(state)}
        onClick={() => dispatch({ type: 'continue' })}
        className={primaryButton}
      >
        {CONTINUE_LABEL}
      </button>
    </div>
  );
}
