import { useMemo } from 'react';
import {
  COMMAND_SENTENCES,
  LEGEND_STEP_HINT,
  START_LABEL,
  buildLegendModel,
  spokenCode,
  type OnboardingAction,
} from '@/lib/onboarding';
import { CodeGlyphs } from './CodeGlyphs';

export interface LegendStepProps {
  readonly dispatch: (action: OnboardingAction) => void;
}

/**
 * The Legend_Step (Requirement 16): the four commands from the Command_Table in legend order, each
 * with its Glyphs (read as its Spoken_Code), its label and one sentence, then the hint about
 * "All codes" and Start.
 */
export function LegendStep({ dispatch }: LegendStepProps) {
  const entries = useMemo(() => buildLegendModel(), []);

  return (
    <div className="flex flex-col gap-7">
      <ul className="flex flex-col gap-5">
        {entries.map((entry) => (
          <li key={entry.command} className="@container flex min-w-0 flex-col gap-2">
            <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="text-xl font-semibold text-text">{entry.label}</span>
              <CodeGlyphs code={entry.code} size="legend" />
              <span className="sr-only">{spokenCode(entry.code)}</span>
            </span>
            <span className="text-lg text-muted">{COMMAND_SENTENCES[entry.command]}</span>
          </li>
        ))}
      </ul>
      <p className="max-w-[52ch] text-lg text-text">{LEGEND_STEP_HINT}</p>
      <button
        type="button"
        onClick={() => dispatch({ type: 'start' })}
        className="min-h-(--size-target) min-w-(--size-target) self-start rounded-xl bg-text px-8 text-lg font-semibold text-on-accent"
      >
        {START_LABEL}
      </button>
    </div>
  );
}
