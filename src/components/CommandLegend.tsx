import { useContext, useMemo } from 'react';
import {
  ALL_CODES_LABEL,
  COMMAND_LEGEND_LABEL,
  buildLegendModel,
  legendAccessibleText,
  type CheatSheetStore,
} from '@/lib/onboarding';
import { CodeGlyphs } from './CodeGlyphs';
import { SessionApiContext } from './session-api-context';

export interface CommandLegendProps {
  readonly store: CheatSheetStore;
}

/**
 * The Command_Legend (onboarding-and-safety Requirement 8), in the "Commands" panel of the main
 * screen: the four command codes built from the Command_Table at run time, each with its label
 * and Glyphs in a compact row of its own. Screen readers hear each entry once, as "Speak: dot dash
 * dot dash dot". Entries sit in one column in the rail and on phones and in two columns where
 * they fit, while every code stays on one line. "All codes" is a quiet secondary button inside the
 * legend: it opens the Cheat_Sheet for the Partner and hands focus back to the Keying_Surface; it
 * never makes a Press_Event. The content is the same in every alarm and onboarding state.
 */
export function CommandLegend({ store }: CommandLegendProps) {
  const { focusKeyingSurface } = useContext(SessionApiContext);
  const entries = useMemo(() => buildLegendModel(), []);

  return (
    // "All codes" sits beside two columns of codes when they fit (a tablet in portrait) and below them otherwise.
    <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
      <ul
        aria-label={COMMAND_LEGEND_LABEL}
        className="grid min-w-0 flex-[1_1_29rem] grid-cols-[repeat(auto-fit,minmax(min(100%,13.5rem),1fr))] gap-x-8 gap-y-3"
      >
        {entries.map((entry) => (
          <li key={entry.command} className="@container min-w-0">
            <span aria-hidden="true" className="flex flex-col gap-1.5">
              <span className="text-base leading-snug font-medium text-text">{entry.label}</span>
              <CodeGlyphs code={entry.code} size="legend" />
            </span>
            <span className="sr-only">{legendAccessibleText(entry)}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          store.dispatch({ type: 'partner-open' });
          focusKeyingSurface();
        }}
        className="min-h-(--size-target) min-w-(--size-target) shrink-0 rounded-xl border border-border px-4 text-base font-medium text-text"
      >
        {ALL_CODES_LABEL}
      </button>
    </div>
  );
}
