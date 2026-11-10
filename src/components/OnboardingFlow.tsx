import { useId, useLayoutEffect, useRef, useState } from 'react';
import {
  CANCEL_SETUP_LABEL,
  STEP_HEADINGS,
  practiceCountAnnouncement,
  type OnboardingAction,
  type OnboardingState,
} from '@/lib/onboarding';
import { usePanelPlacement } from '@/hooks/usePanelPlacement';
import { InputStep } from './InputStep';
import { LegendStep } from './LegendStep';
import { PracticeStep } from './PracticeStep';

export interface OnboardingFlowProps {
  readonly state: OnboardingState;
  readonly dispatch: (action: OnboardingAction) => void;
  /** Settings_Record Starting_WPM, for the Practice_Step's default speed text. */
  readonly startingWpm: number;
  /** The dialog's id, so the host can find the selected tile inside it. */
  readonly id?: string;
}

type ShownStep = keyof typeof STEP_HEADINGS;

/** Smallest band the Practice_Step accepts beside the Keying_Surface before it scrolls the page. */
const PRACTICE_MIN = { width: 300, height: 260 } as const;

const shownStep = (state: OnboardingState): ShownStep | null => (state.step === 'cancelled' ? null : state.step);

interface Live {
  readonly step: ShownStep | null;
  readonly count: number;
  readonly text: string;
}

/**
 * The Onboarding_Flow container (onboarding-and-safety Requirements 11.8, 14.2 and 18): one
 * <dialog> for the whole flow. The Input_Step, Legend_Step and Done are modal (showModal), so the
 * Partner's focus stays in the flow; the Practice_Step reopens it with show() as a panel in the
 * largest band beside the Keying_Surface, which stays uncovered and pressable. Each step has one
 * h2, and one polite live region, kept for the life of the flow, says the new heading on a step
 * change and "N of 5" when the practice count changes, never anything per press. Escape never
 * closes a first-run flow; for "Run setup again" it is "Cancel setup".
 */
export function OnboardingFlow({ state, dispatch, startingWpm, id }: OnboardingFlowProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  /** close() calls made here when switching between modal and non-modal; not a close request. */
  const ownCloses = useRef(0);
  const step = shownStep(state);
  const practice = step === 'practice';
  const rect = usePanelPlacement(practice, PRACTICE_MIN);
  const rerun = state.origin === 'rerun';

  // The live text follows the step and the practice count (18.3), adjusted while rendering.
  const count = practice ? state.durations.length : 0;
  const [live, setLive] = useState<Live>(() => ({ step, count, text: step === null ? '' : STEP_HEADINGS[step] }));
  if (live.step !== step || live.count !== count) {
    const text = live.step !== step ? (step === null ? '' : STEP_HEADINGS[step]) : practiceCountAnnouncement(count);
    setLive({ step, count, text });
  }

  // Open the dialog the way the step needs, before paint.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null || step === null) return;
    const wantModal = step !== 'practice';
    if (dialog.open && dialog.matches(':modal') === wantModal) return;
    if (dialog.open) {
      ownCloses.current += 1;
      dialog.close();
    }
    if (wantModal) dialog.showModal();
    else dialog.show();
  }, [step]);

  if (step === null) return null;

  const placed =
    practice && rect !== null ? { top: rect.top, left: rect.left, width: rect.width, maxHeight: rect.height } : undefined;

  return (
    <dialog
      ref={dialogRef}
      id={id}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // A first-run flow never closes on Escape; a rerun cancels (11.8, 11.9).
        event.preventDefault();
        if (rerun) dispatch({ type: 'cancel' });
      }}
      onClose={() => {
        if (ownCloses.current > 0) {
          ownCloses.current -= 1;
          return;
        }
        // The browser closed it by itself (a close request it did not let us cancel).
        if (rerun) {
          dispatch({ type: 'cancel' });
          return;
        }
        const dialog = dialogRef.current;
        if (dialog === null || dialog.open) return;
        if (practice) dialog.show();
        else dialog.showModal();
      }}
      style={placed}
      className={
        practice
          ? 'pointer-events-none fixed m-0 max-w-none overflow-hidden bg-transparent p-4 text-text'
          : 'm-auto max-h-dvh w-[min(100%,42rem)] max-w-none overflow-y-auto bg-transparent p-4 text-text backdrop:bg-bg/85'
      }
    >
      <div
        className={`pointer-events-auto mx-auto flex w-full max-w-[40rem] flex-col gap-7 rounded-3xl bg-surface p-6 sm:p-8 ${
          practice ? 'max-h-full overflow-y-auto border border-border' : ''
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <h2 id={titleId} className="text-2xl font-semibold text-text">
            {STEP_HEADINGS[step]}
          </h2>
          {rerun && step !== 'done' ? (
            <button
              type="button"
              onClick={() => dispatch({ type: 'cancel' })}
              className="min-h-(--size-target) min-w-(--size-target) rounded-xl border border-border bg-raised px-5 text-lg font-medium text-text"
            >
              {CANCEL_SETUP_LABEL}
            </button>
          ) : null}
        </div>
        {step === 'input' ? <InputStep state={state} dispatch={dispatch} /> : null}
        {step === 'practice' ? <PracticeStep state={state} dispatch={dispatch} startingWpm={startingWpm} /> : null}
        {step === 'legend' ? <LegendStep dispatch={dispatch} /> : null}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {live.text}
        </div>
      </div>
    </dialog>
  );
}
