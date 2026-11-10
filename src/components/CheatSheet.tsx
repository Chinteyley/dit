import { useContext, useEffect, useId, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  CHEAT_SHEET_GROUP_HEADINGS,
  CLOSE_CODES_LABEL,
  NOT_A_CODE_LABEL,
  buildCheatSheetModel,
  entryAccessibleText,
  spokenCode,
  type CheatSheetStore,
} from '@/lib/onboarding';
import { usePanelPlacement } from '@/hooks/usePanelPlacement';
import { CodeGlyphs } from './CodeGlyphs';
import { SessionApiContext } from './session-api-context';

export interface CheatSheetProps {
  readonly store: CheatSheetStore;
}

/** Smallest band the sheet accepts beside the Keying_Surface before it scrolls the page. */
const SHEET_MIN = { width: 280, height: 240 } as const;

/**
 * The Cheat_Sheet (onboarding-and-safety Requirements 9 and 10): a non-modal panel with every
 * Supported_Character and command code, fixed in the largest free band beside the Keying_Surface,
 * so keying goes on while it is open. It opens by itself on a pattern that is not a code (and
 * shows that pattern) or from "All codes", and an `unknown` sheet closes on the next committed
 * character. Opening never moves focus; there is no focus trap and nothing else turns inert.
 * "Close codes" and Escape (with no modal dialog open) close it and focus the Keying_Surface.
 */
export function CheatSheet({ store }: CheatSheetProps) {
  const { controller, focusKeyingSurface } = useContext(SessionApiContext);
  const sheet = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const titleId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const rect = usePanelPlacement(sheet.open, SHEET_MIN);
  // Rebuilt from the engine tables each time the sheet opens (Req 9.1).
  const groups = useMemo(() => (sheet.open ? buildCheatSheetModel() : []), [sheet.open]);

  // 10.3: the next committed character closes an `unknown` sheet; focus follows only from inside it.
  useEffect(
    () =>
      controller.onCharCommitted(() => {
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
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 pt-5 pb-4">
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
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6">
        {sheet.pattern !== null ? (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-raised px-5 py-3 text-lg font-medium">
            {NOT_A_CODE_LABEL}
            <span className="@container inline-flex min-w-0 flex-1">
              <CodeGlyphs code={sheet.pattern} size="legend" />
            </span>
            <span className="sr-only">{spokenCode(sheet.pattern)}</span>
          </p>
        ) : null}
        {groups.map((group) => (
          <div key={group.name} className="flex flex-col gap-3">
            <h3 className="section-label">{CHEAT_SHEET_GROUP_HEADINGS[group.name]}</h3>
            {/* 17.5rem cells leave the glyphs 24 units of 10 px, so every code draws at full size. */}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17.5rem),1fr))] gap-x-8 gap-y-3">
              {group.entries.map((entry) => (
                <li key={entry.code} className="min-w-0">
                  {/* Characters: the letter beside its code. Commands: the label above it. */}
                  <span
                    aria-hidden="true"
                    className={`flex min-w-0 ${entry.kind === 'char' ? 'items-center gap-3' : 'flex-col gap-1.5'}`}
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
    </section>
  );
}
