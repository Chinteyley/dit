import { useContext } from 'react';
import type { SuggestionSource } from '@/lib/conversation';
import { SessionApiContext } from './session-api-context';

export interface SuggestionListProps {
  readonly suggestions: readonly string[];
  readonly source: SuggestionSource | null;
  /** null: the raw Current_Text is selected. */
  readonly highlight: number | null;
  readonly currentText: string;
  /** Partner_Pick with the button's index (Req 13.7). */
  readonly onPick: (index: number) => void;
}

const SOURCE_LABEL: Readonly<Record<SuggestionSource, string>> = { ai: 'AI', 'on-device': 'On-device' };

/**
 * The Suggestion_List (Requirement 13): one button per suggestion, named by its text. The
 * highlighted one has aria-current, a 3 px accent ring and a "Will be spoken" marker outside the
 * button, so its name stays the suggestion text and the highlight never relies on colour alone.
 * The source is a text label. A pick returns focus to the Keying_Surface (Req 21.1).
 */
export function SuggestionList({ suggestions, source, highlight, currentText, onPick }: SuggestionListProps) {
  const { focusKeyingSurface } = useContext(SessionApiContext);
  const hasSuggestions = suggestions.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {hasSuggestions && source !== null ? <p className="section-label">Source: {SOURCE_LABEL[source]}</p> : null}
      <ul aria-label="Suggestions" className="flex flex-col gap-2.5">
        {suggestions.map((text, index) => {
          const current = highlight === index;
          return (
            <li key={`${index}:${text}`} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                onClick={() => {
                  onPick(index);
                  focusKeyingSurface();
                }}
                className={`min-h-(--size-target) min-w-0 flex-1 rounded-2xl border border-border bg-raised px-5 py-2.5 text-left text-xl font-medium text-text wrap-anywhere ${
                  current ? 'ring-(length:--outline-highlight) ring-accent' : ''
                }`}
              >
                {text}
              </button>
              {current ? (
                <span aria-hidden="true" className="text-lg font-semibold text-accent">
                  Will be spoken
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {highlight === null && currentText !== '' ? (
        <p className="text-lg text-muted">Your typed text will be spoken</p>
      ) : null}
      {!hasSuggestions && currentText === '' ? <p className="text-lg text-muted">Tap a suggestion to speak it</p> : null}
    </div>
  );
}
