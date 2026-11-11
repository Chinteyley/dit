import { useContext, useEffect, useId, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  CHEAT_SHEET_GROUP_HEADINGS,
  CLOSE_CODES_LABEL,
  NOT_A_CODE_LABEL,
  buildCheatSheetModel,
  entryAccessibleText,
  spokenCode,
  type CheatSheetStore,
  type CheatSheetGroup,
} from '@/lib/onboarding';
import { usePanelPlacement } from '@/hooks/usePanelPlacement';
import { CodeGlyphs } from './CodeGlyphs';
import { SessionApiContext } from './session-api-context';

export interface CheatSheetProps {
  readonly store: CheatSheetStore;
}

/** Smallest band the sheet accepts beside the Keying_Surface before it scrolls the page. */
const SHEET_MIN = { width: 280, height: 360 } as const;

/**
 * The Cheat_Sheet (onboarding-and-safety Requirements 9 and 10): a non-modal panel with every
 * Supported_Character and command code, fixed in the largest free band beside the Keying_Surface,
 * so keying goes on while it is open. It opens by itself on a pattern that is not a code (and
 * shows that pattern) or from "All codes", and closes on any committed character or command. Six dots pages through every code. Opening never moves focus; there is no focus trap and nothing else turns inert.
 * "Close codes" and Escape (with no modal dialog open) close it and focus the Keying_Surface.
 */
export function CheatSheet({ store }: CheatSheetProps) {
  const { controller, focusKeyingSurface } = useContext(SessionApiContext);
  const sheet = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const titleId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const rect = usePanelPlacement(sheet.open, SHEET_MIN);
  // Rebuilt from the engine tables each time the sheet opens (Req 9.1).
  const allGroups = useMemo(() => (sheet.open ? buildCheatSheetModel() : []), [sheet.open]);
  const columns = Math.max(2, Math.floor(((rect?.width ?? 432) - 24) / 200));
  const pageGroups = useMemo(() => {
    // Reserve the unknown-pattern row even when empty so six-dot paging cannot resize pages.
    const height = Math.max(92, (rect?.height ?? 480) - 292);
    const result: CheatSheetGroup[][] = [];
    let current: CheatSheetGroup[] = [];
    let remaining = height;
    for (const group of allGroups) {
      const rowHeight = group.name === 'Commands' ? 60 : 36;
      let offset = 0;
      while (offset < group.entries.length) {
        if (remaining < 32 + rowHeight && current.length > 0) {
          result.push(current);
          current = [];
          remaining = height;
        }
        const rows = Math.max(1, Math.floor((remaining - 32) / rowHeight));
        const entries = group.entries.slice(offset, offset + rows * columns);
        current.push({ ...group, entries });
        remaining -= 32 + Math.ceil(entries.length / columns) * rowHeight;
        offset += entries.length;
      }
    }
    if (current.length > 0) result.push(current);
    return result;
  }, [allGroups, columns, rect?.height]);
  const pages = Math.max(1, pageGroups.length);
  const page = (sheet.page ?? 0) % pages;
  const groups = pageGroups[page] ?? [];

  // Review 24.1: any committed character or command closes the sheet; focus follows only from inside it.
  useEffect(
    () =>
      controller.onCodeCommitted(() => {
        const active = document.activeElement;
        const hadFocus = active !== null && sectionRef.current?.contains(active) === true;
        const before = store.getState();
        store.dispatch({ type: 'char-committed' });
        if (hadFocus && store.getState() !== before) focusKeyingSurface();
      }),
    [controller, store, focusKeyingSurface],
  );

  // 10.7: Escape in the bubble phase, after any modal dialog had its turn; the Alarm_Card's capture
  // listener stops an Escape during an alarm before it gets here (10.14).
  useEffect(() => {
    if (!sheet.open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('dialog:modal') !== null) return;
      const before = store.getState();
      store.dispatch({ type: 'close' });
      if (store.getState() !== before) focusKeyingSurface();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sheet.open, store, focusKeyingSurface]);

  if (!sheet.open) return null;

  const close = (): void => {
    const before = store.getState();
    store.dispatch({ type: 'close' });
    if (store.getState() !== before) focusKeyingSurface();
  };

  return (
    <section
      ref={sectionRef}
      aria-labelledby={titleId}
      style={rect === null ? undefined : { top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      className="fixed z-20 flex flex-col overflow-hidden rounded-3xl border border-border bg-surface text-text"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 pt-2 pb-1">
        <h2 id={titleId} className="text-2xl font-semibold">
          All codes
        </h2>
        <button
          type="button"
          onClick={close}
          className="min-h-(--size-target) min-w-(--size-target) rounded-xl border border-border bg-raised px-5 text-lg font-medium"
        >
          {CLOSE_CODES_LABEL}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
        <p className="text-lg">Six dots (......): next page. Letter or command: close.</p>
        {sheet.pattern !== null ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-raised px-2 py-1 text-lg font-medium">
            {NOT_A_CODE_LABEL}
            <span className="@container inline-flex min-w-0 flex-1">
              <CodeGlyphs code={sheet.pattern} size="legend" />
            </span>
            <span className="sr-only">{spokenCode(sheet.pattern)}</span>
          </p>
        ) : null}
        {groups.map((group) => (
          <div key={group.name} className="flex flex-col gap-1">
            <h3 className="section-label">{CHEAT_SHEET_GROUP_HEADINGS[group.name]}</h3>
            {/* Glyphs scale to each cell; paging keeps the keying surface uncovered. */}
            <ul className="grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {group.entries.map((entry) => (
                <li key={entry.code} className="min-w-0">
                  {/* Characters: the letter beside its code. Commands: the label above it. */}
                  <span
                    aria-hidden="true"
                    className={`flex min-w-0 ${entry.kind === 'char' ? 'items-center gap-3' : 'flex-col gap-0.5'}`}
                  >
                    <span className={`shrink-0 font-semibold ${entry.kind === 'char' ? 'w-[1.25em] text-xl' : 'text-lg'}`}>
                      {entry.label}
                    </span>
                    <span className="@container flex min-w-0 flex-1">
                      <CodeGlyphs code={entry.code} size="sheet" />
                    </span>
                  </span>
                  <span className="sr-only">{entryAccessibleText(entry)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pb-3">
        <button
          type="button"
          disabled={pages === 1}
          onClick={() => store.dispatch({ type: 'page', page: (page + pages - 1) % pages })}
          className="min-h-(--size-target) min-w-(--size-target) rounded-xl border border-border bg-raised px-3 text-lg disabled:opacity-50"
        >
          Previous
        </button>
        <p aria-live="polite" aria-atomic="true" className="text-lg tabular-nums">Page {page + 1} of {pages}</p>
        <button
          type="button"
          disabled={pages === 1}
          onClick={() => store.dispatch({ type: 'page', page: (page + 1) % pages })}
          className="min-h-(--size-target) min-w-(--size-target) rounded-xl border border-border bg-raised px-3 text-lg disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </section>
  );
}
