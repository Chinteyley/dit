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

/** Places in the Suggestion_List: the most suggestions it shows (expansion SUGGESTIONS_MAX). */
const PLACES = 3;

/**
 * The Suggestion_List (Requirements 13 and 27) as numbered Suggestion_Cards in an ordered list.
 * Each card holds its Ordinal, then a button whose only content is the suggestion text, so the
 * button's name stays exactly that text; the Ordinal and the "Will be spoken" marker sit outside
 * it and are hidden from assistive technology. The button's empty ::after covers the card, so a
 * press anywhere on the card picks it, and its focus ring is drawn around the whole card.
 *
 * The highlighted card has the Selected_Fill, a 3 px accent ring, a filled accent Ordinal, the
 * marker and aria-current, so it never relies on colour alone. A Highlight move changes these in
 * place, at once; a new list fades in over 150 ms, opacity only and not under reduced motion.
 * The source label, the typed-text marker and the hint share one header row. Every place a card
 * does not fill shows an Empty_Slot: a quiet panel as high as a one-line card with the Ordinal
 * that card would have, hidden from assistive technology and outside the list. So the area always
 * shows three numbered places and keeps the height of three one-line cards, and nothing below
 * moves when suggestions arrive or clear (Req 24.9, 27.12). Below 40rem the marker sits under the
 * text and every card is a little taller, so a one-line card keeps its height with or without the
 * marker. A pick returns focus to the Keying_Surface (Req 21.1).
 */
export function SuggestionList({ suggestions, source, highlight, currentText, onPick }: SuggestionListProps) {
  const { focusKeyingSurface } = useContext(SessionApiContext);
  const hasSuggestions = suggestions.length > 0;
  const emptyOrdinals = Array.from({ length: Math.max(0, PLACES - suggestions.length) }, (_, i) => suggestions.length + i + 1);

  return (
    <div className="flex flex-col gap-3 wide:short:gap-2">
      {/* One text-lg line high whatever it shows (1lh at text-lg), so the cards never move. */}
      <div className="flex min-h-[1lh] flex-wrap items-center justify-between gap-x-6 gap-y-1 text-lg">
        {hasSuggestions && source !== null ? <p className="section-label">Source: {SOURCE_LABEL[source]}</p> : null}
        {highlight === null && currentText !== '' ? (
          <p className="flex items-center gap-2.5 text-lg text-text">
            <span aria-hidden="true" className="size-2.5 flex-none rounded-full bg-accent" />
            Your typed text will be spoken
          </p>
        ) : null}
        {!hasSuggestions && currentText === '' ? <p className="text-lg text-muted">Tap a suggestion to speak it</p> : null}
      </div>
      {/* The three places: the cards, then an Empty_Slot for each place they leave (the reserve of Req 24.9). */}
      <div className="flex min-h-[16.5rem] flex-col sm:min-h-[13.5rem] wide:short:min-h-[11.5rem]">
        <ol
          // Keyed by the list: a new list mounts and fades in, while a Highlight move keeps it in place.
          key={suggestions.join('\n')}
          aria-label="Suggestions"
          className="flex flex-col gap-3 motion-safe:animate-fade-in wide:short:gap-2"
        >
          {suggestions.map((text, index) => {
            const current = highlight === index;
            return (
              <li
                key={`${index}:${text}`}
                className={`relative grid min-h-20 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 rounded-2xl border px-5 py-2 sm:min-h-16 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:py-2.5 wide:short:min-h-14 wide:short:py-1.5 has-[:focus]:outline-(length:--ring-width) has-[:focus]:outline-offset-(--ring-offset) has-[:focus]:outline-dashed has-[:focus]:outline-focus ${
                  current ? 'border-transparent bg-selected ring-(length:--outline-highlight) ring-accent' : 'border-border bg-raised'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex size-9 items-center justify-center rounded-full border-2 text-lg leading-none font-semibold ${
                    current ? 'row-span-2 border-accent bg-accent text-on-accent sm:row-span-1' : 'border-border text-text'
                  }`}
                >
                  {index + 1}
                </span>
                <button
                  type="button"
                  aria-current={current ? 'true' : undefined}
                  onClick={() => {
                    onPick(index);
                    focusKeyingSurface();
                  }}
                  className="min-w-0 text-left text-suggestion font-medium text-text wrap-anywhere after:absolute after:inset-0 after:rounded-2xl focus:outline-none"
                >
                  {text}
                </button>
                {current ? (
                  <span aria-hidden="true" className="col-start-2 text-lg font-semibold text-accent sm:col-start-auto">
                    Will be spoken
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        {emptyOrdinals.length > 0 ? (
          // Empty_Slots: the panel fill, a faint ring and a muted Ordinal, and no border or text, so
          // the reserve reads as places waiting for sentences while the cards stay the brightest.
          <div aria-hidden="true" className={`flex flex-col gap-3 wide:short:gap-2 ${hasSuggestions ? 'mt-3 wide:short:mt-2' : ''}`}>
            {emptyOrdinals.map((ordinal) => (
              <div
                key={ordinal}
                className="flex min-h-20 items-center rounded-2xl border border-transparent bg-surface px-5 sm:min-h-16 wide:short:min-h-14"
              >
                <span className="flex size-9 items-center justify-center rounded-full border-2 border-raised text-lg leading-none font-semibold text-muted">
                  {ordinal}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
