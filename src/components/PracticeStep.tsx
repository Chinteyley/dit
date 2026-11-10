import {
  CLOSE_PRESSES_TEXT,
  CONTINUE_LABEL,
  HOLDING_TEXT,
  PRACTICE_AGAIN_LABEL,
  PRACTICE_PRESSES,
  USE_DEFAULT_SPEED_LABEL,
  USE_THIS_SPEED_LABEL,
  closePressesShown,
  continueEnabled,
  defaultSpeedText,
  heldIndicatorShown,
  practicePrompt,
  speedText,
  type OnboardingAction,
  type OnboardingState,
} from '@/lib/onboarding';
import { CodeGlyphs } from './CodeGlyphs';

export interface PracticeStepProps {
  readonly state: OnboardingState;
  readonly dispatch: (action: OnboardingAction) => void;
  /** Settings_Record Starting_WPM, for the default speed text (Requirement 14.11). */
  readonly startingWpm: number;
}

/** Glyph types by position: three dots, then two dashes, whatever the press lengths (Requirement 14.4). */
const PRACTICE_PATTERN = '...--';

const secondaryButton =
  'min-h-(--size-target) min-w-(--size-target) rounded-xl border border-border bg-raised px-5 text-lg font-medium text-text';
const primaryButton =
  'min-h-(--size-target) min-w-(--size-target) rounded-xl bg-text px-7 text-lg font-semibold text-on-accent disabled:cursor-not-allowed disabled:border disabled:border-border disabled:bg-raised disabled:text-muted';

/**
 * The Practice_Step (Requirements 14 and 15): "Press short" three times and "Press long" twice on
 * the Keying_Surface, which stays uncovered and focused. Each press adds one Glyph, "Holding…"
 * shows while a press is down, and after the fifth press the measured speed appears in plain
 * words. "Use default speed" is there the whole time. Nothing here moves or fades.
 */
export function PracticeStep({ state, dispatch, startingWpm }: PracticeStepProps) {
  const prompt = practicePrompt(state);
  const collected = Math.min(state.durations.length, PRACTICE_PRESSES);
  const result = state.result;

  return (
    <div className="flex flex-col gap-6">
      {prompt !== null ? (
        <div className="flex flex-col gap-1">
          <p className="text-[2.5rem] leading-tight font-semibold tracking-tight text-text">{prompt.prompt}</p>
          <p className="text-lg text-muted">{prompt.count}</p>
        </div>
      ) : null}

      <div className="flex min-h-11 flex-wrap items-center gap-x-6 gap-y-2">
        <span className="@container flex min-w-0 flex-1">
          <CodeGlyphs code={PRACTICE_PATTERN.slice(0, collected)} size="practice" />
        </span>
        {heldIndicatorShown(state) ? <p className="text-lg text-muted">{HOLDING_TEXT}</p> : null}
      </div>

      {result.kind === 'measured' ? (
        <div className="flex flex-col gap-4">
          <p className="text-2xl font-semibold text-text">{speedText(result.calibration.dotEstimate)}</p>
          {closePressesShown(state) ? <p className="max-w-[48ch] text-lg text-text">{CLOSE_PRESSES_TEXT}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => dispatch({ type: 'use-this-speed' })} className={primaryButton}>
              {USE_THIS_SPEED_LABEL}
            </button>
            <button type="button" onClick={() => dispatch({ type: 'practice-again' })} className={secondaryButton}>
              {PRACTICE_AGAIN_LABEL}
            </button>
          </div>
        </div>
      ) : null}

      {result.kind === 'default' ? (
        <div className="flex flex-col gap-4">
          <p className="text-2xl font-semibold text-text">{defaultSpeedText(startingWpm)}</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!continueEnabled(state)}
              onClick={() => dispatch({ type: 'continue' })}
              className={primaryButton}
            >
              {CONTINUE_LABEL}
            </button>
            {result.calibration !== null ? (
              <button type="button" onClick={() => dispatch({ type: 'practice-again' })} className={secondaryButton}>
                {PRACTICE_AGAIN_LABEL}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <button type="button" onClick={() => dispatch({ type: 'use-default' })} className={`${secondaryButton} self-start`}>
        {USE_DEFAULT_SPEED_LABEL}
      </button>
    </div>
  );
}
