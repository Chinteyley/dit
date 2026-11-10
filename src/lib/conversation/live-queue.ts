/**
 * Live_Region announcement throttle (design "lib/conversation/live-queue.ts", Requirement 12).
 * Pure: the controller passes the Clock time in and schedules flush() at nextDueAt.
 */
import type { SessionAction, SessionState } from './types';

/** At most one announcement per second (Req 12.2). */
export const ANNOUNCE_INTERVAL_MS = 1_000;

export type LiveItem =
  /** The committed character, or "space" for U+0020. */
  | { readonly kind: 'char'; readonly text: string }
  /** For example "2 suggestions. Highlighted: I am thirsty." */
  | { readonly kind: 'suggestions'; readonly text: string };

export interface LiveQueueState {
  /** Clock time of the last announcement start. */
  readonly lastAnnouncedAt: number | null;
  /** In commit order. */
  readonly heldChars: readonly string[];
  /** At most one; the newest replaces it (Req 12.6). */
  readonly heldSuggestions: string | null;
}

export const INITIAL_LIVE_QUEUE: LiveQueueState = Object.freeze({
  lastAnnouncedAt: null,
  heldChars: Object.freeze([]),
  heldSuggestions: null,
});

export interface LiveStep {
  readonly state: LiveQueueState;
  /** Text to put in the Live_Region now, or null. */
  readonly announce: string | null;
  /** When to call flush(), or null when nothing is held. */
  readonly nextDueAt: number | null;
}

/** Held characters first, comma-separated, then the suggestions item. */
export function joinItems(chars: readonly string[], suggestions: string | null): string {
  return (suggestions === null ? chars : [...chars, suggestions]).join(', ');
}

function isDue(s: LiveQueueState, now: number): boolean {
  return s.lastAnnouncedAt === null || now - s.lastAnnouncedAt >= ANNOUNCE_INTERVAL_MS;
}

function announceHeld(s: LiveQueueState, now: number): LiveStep {
  return {
    state: { lastAnnouncedAt: now, heldChars: INITIAL_LIVE_QUEUE.heldChars, heldSuggestions: null },
    announce: joinItems(s.heldChars, s.heldSuggestions),
    nextDueAt: null,
  };
}

function hasHeld(s: LiveQueueState): boolean {
  return s.heldChars.length > 0 || s.heldSuggestions !== null;
}

/**
 * Queues an item at `now`. It is announced at once, together with anything still held, when no
 * announcement started in the last 1,000 ms (Req 12.3); otherwise it is held until
 * lastAnnouncedAt + 1,000 (Req 12.4).
 */
export function enqueue(s: LiveQueueState, item: LiveItem, now: number): LiveStep {
  const held: LiveQueueState =
    item.kind === 'char'
      ? { ...s, heldChars: [...s.heldChars, item.text] }
      : { ...s, heldSuggestions: item.text };
  if (isDue(s, now)) return announceHeld(held, now);
  return { state: held, announce: null, nextDueAt: (s.lastAnnouncedAt ?? now) + ANNOUNCE_INTERVAL_MS };
}

/** Called by the controller timer at or after nextDueAt. Announces all held items as one string. */
export function flush(s: LiveQueueState, now: number): LiveStep {
  if (!hasHeld(s)) return { state: s, announce: null, nextDueAt: null };
  if (!isDue(s, now)) {
    return { state: s, announce: null, nextDueAt: (s.lastAnnouncedAt ?? now) + ANNOUNCE_INTERVAL_MS };
  }
  return announceHeld(s, now);
}

/** "1 suggestion" or "N suggestions", plus ". Highlighted: <text>" when Highlight is an index (Req 12.5). */
export function suggestionsItemText(suggestions: readonly string[], highlight: number | null): string {
  const count = suggestions.length === 1 ? '1 suggestion' : `${suggestions.length} suggestions`;
  const highlighted = highlight === null ? undefined : suggestions[highlight];
  return highlighted === undefined ? count : `${count}. Highlighted: ${highlighted}`;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((sentence, i) => sentence === b[i]);
}

/** What one action adds to the queue: a typed character and/or a new Suggestions list (Req 12.1, 12.5, 12.7). */
export function announcementsFor(prev: SessionState, next: SessionState, action: SessionAction): readonly LiveItem[] {
  if (action.type === 'hydrate') return [];
  if (action.type === 'engine' && (action.event.type === 'symbol' || action.event.type === 'unknown')) return [];
  const items: LiveItem[] = [];
  const grew =
    next.currentText.length === prev.currentText.length + 1 && next.currentText.startsWith(prev.currentText);
  if (grew) {
    const added = next.currentText.slice(-1);
    items.push({ kind: 'char', text: added === ' ' ? 'space' : added });
  }
  const setList =
    action.type === 'suggestions' &&
    next.suggestions.length > 0 &&
    (!sameList(next.suggestions, prev.suggestions) ||
      next.suggestionSource !== prev.suggestionSource ||
      next.highlight !== prev.highlight);
  if (setList) items.push({ kind: 'suggestions', text: suggestionsItemText(next.suggestions, next.highlight) });
  return items;
}
