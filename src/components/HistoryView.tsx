import { useId, useLayoutEffect, useRef } from 'react';
import type { SessionTurn } from '@/lib/conversation';

export interface HistoryViewProps {
  /** Oldest first, at most 200. */
  readonly turns: readonly SessionTurn[];
  /** False until the stored history is loaded; the render that turns it true scrolls instantly. */
  readonly hydrated: boolean;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Scrolls the list itself, not the page: scrollIntoView would also scroll every ancestor, and the
 * page jumping away from the Keying_Surface on every new Turn is worse than useless.
 */
function scrollToNewest(list: HTMLElement, behavior: ScrollBehavior): void {
  if (typeof list.scrollTo === 'function') list.scrollTo({ top: list.scrollHeight, behavior });
  else list.scrollTop = list.scrollHeight;
}

/**
 * The History_View (Requirement 15): one bubble per Turn, oldest first, keyed by Turn ID so
 * dropped Turns unmount, each with a visible "Speaker" or "Partner" label so the role never
 * relies on colour. A new last Turn scrolls the list to the end: smoothly, or instantly under
 * reduced motion and for the history loaded at start.
 */
export function HistoryView({ turns, hydrated }: HistoryViewProps) {
  const headingId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const seen = useRef<{ readonly lastId: number | undefined; readonly hydrated: boolean }>({
    lastId: undefined,
    hydrated: false,
  });
  const lastId = turns.at(-1)?.id;

  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { lastId, hydrated };
    const list = listRef.current;
    if (list === null || lastId === undefined || lastId === before.lastId) return;
    const instant = (hydrated && !before.hydrated) || prefersReducedMotion();
    scrollToNewest(list, instant ? 'auto' : 'smooth');
  }, [lastId, hydrated]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <h2 id={headingId} className="section-label">
        Conversation history
      </h2>
      {turns.length === 0 ? <p className="text-lg text-muted">No conversation yet.</p> : null}
      <ul
        ref={listRef}
        aria-labelledby={headingId}
        className="flex max-h-[min(28rem,60vh)] min-h-0 flex-col gap-4 overflow-y-auto pr-1 wide:max-h-none wide:flex-1"
      >
        {turns.map((turn) => {
          const speaker = turn.role === 'speaker';
          return (
            <li key={turn.id} className={`flex max-w-[85%] flex-col gap-1 ${speaker ? 'self-start' : 'items-end self-end'}`}>
              <span className="section-label">{speaker ? 'Speaker' : 'Partner'}</span>
              <p
                className={`rounded-2xl px-4 py-3 text-lg whitespace-pre-wrap text-text wrap-anywhere ${
                  speaker ? 'bg-raised' : 'bg-partner'
                }`}
              >
                {turn.text}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
