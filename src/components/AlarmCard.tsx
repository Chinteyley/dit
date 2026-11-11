import { useContext, useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { ALARM_DESCRIPTION, ALARM_DISMISS_LABEL, ALARM_TITLE, SOUND_UNAVAILABLE_TEXT } from '@/lib/onboarding';
import type { CardView, SafetyAlarmHandler } from '@/lib/safety';
import { SessionApiContext } from './session-api-context';

export interface AlarmCardProps {
  readonly handler: SafetyAlarmHandler;
}

/** The click that follows a swallowed pointerup is swallowed too, if it comes within this time (Req 2.6). */
const CLICK_WINDOW_MS = 1000;

interface SwallowedPointer {
  readonly pointerId: number;
  readonly until: number;
}

function swallow(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/**
 * The Alarm_Card (onboarding-and-safety Requirements 1, 2, 6 and 7): an always-mounted native
 * <dialog role="alertdialog"> that the Alarm_Handler opens with showModal() inside start(), so it
 * enters the top layer above Settings, the Cheat_Sheet and the onboarding dialog, and everything
 * else turns inert. Full screen, static (no animation, no flashing), "I need help" in very large
 * near-white type on the dark alarm red, and one Dismiss button that takes focus.
 *
 * Dismissal paths: any Press_Event (through the router), Dismiss by keyboard (its click), Escape
 * (a window capture listener, so no dialog or Cheat_Sheet handler sees it), and a primary
 * pointerdown anywhere on the card, whose pointerup and click are swallowed so nothing underneath
 * receives them. While ringing, Tab stays on Dismiss and any other dialog that opens is answered
 * by raising the card again.
 */
export function AlarmCard({ handler }: AlarmCardProps) {
  const { focusKeyingSurface } = useContext(SessionApiContext);
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  /** close() calls made here (hide and re-raise); their close events are not a dismissal. */
  const ownCloses = useRef(0);
  /** The pointerId of a card pointerdown, until its pointerup or pointercancel. */
  const cardPointer = useRef<number | null>(null);
  const soundUnavailable = useSyncExternalStore(handler.subscribe, handler.soundUnavailable, handler.soundUnavailable);

  // Every return to idle focuses the Keying_Surface, so the next Space or Enter keys Morse (2.10, 18.9).
  useLayoutEffect(() => {
    handler.setFocusKeyingSurface(focusKeyingSurface);
    return () => handler.setFocusKeyingSurface(null);
  }, [handler, focusKeyingSurface]);

  // The CardView. A layout effect, so it is registered before any input source starts.
  useLayoutEffect(() => {
    const view: CardView = {
      show() {
        const dialog = dialogRef.current;
        if (dialog === null) return;
        if (!dialog.open) dialog.showModal();
        dismissRef.current?.focus(); // 1.6: in the same call as start()
      },
      hide() {
        const dialog = dialogRef.current;
        if (dialog === null || !dialog.open) return;
        ownCloses.current += 1;
        dialog.close();
      },
    };
    handler.setView(view);
    // The handler does not show a card registered after start(), so the card shows itself.
    if (handler.state() === 'ringing') view.show();
    return () => handler.setView(null);
  }, [handler]);

  useEffect(() => {
    let swallowedPointer: SwallowedPointer | null = null;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!handler.isActive()) return;
      if (event.key === 'Escape') {
        // 2.5, 10.14: no dialog, Cheat_Sheet or input source sees this Escape.
        swallow(event);
        if (handler.state() === 'ringing') handler.partnerDismiss();
        return;
      }
      if (event.key === 'Tab' && handler.state() === 'ringing') {
        // 1.12: Tab and Shift+Tab keep focus on Dismiss.
        event.preventDefault();
        dismissRef.current?.focus();
      }
    };

    const onPointerEnd = (event: PointerEvent): void => {
      const id = cardPointer.current;
      if (id === null || event.pointerId !== id) return;
      cardPointer.current = null;
      swallow(event);
      swallowedPointer = { pointerId: id, until: performance.now() + CLICK_WINDOW_MS };
      handler.cardPointer('up');
    };

    const onClick = (event: MouseEvent): void => {
      const pending = swallowedPointer;
      if (pending === null) return;
      swallowedPointer = null;
      if (performance.now() > pending.until) return;
      // Matched by pointerId where the click carries one, else the first click in the window.
      const id: unknown = Reflect.get(event, 'pointerId');
      if (typeof id === 'number' && id > 0 && id !== pending.pointerId) return;
      swallow(event);
    };

    // 7.8: another dialog opening while ringing would sit above the card, so the card goes on top again.
    const onToggle = (event: Event): void => {
      const dialog = dialogRef.current;
      const target = event.target;
      if (dialog === null || target === dialog || !(target instanceof HTMLDialogElement)) return;
      if (Reflect.get(event, 'newState') !== 'open' || handler.state() !== 'ringing') return;
      if (dialog.open) {
        ownCloses.current += 1;
        dialog.close();
      }
      dialog.showModal();
      dismissRef.current?.focus();
    };

    const capture = { capture: true } as const;
    window.addEventListener('keydown', onKeyDown, capture);
    window.addEventListener('pointerup', onPointerEnd, capture);
    window.addEventListener('pointercancel', onPointerEnd, capture);
    window.addEventListener('click', onClick, capture);
    document.addEventListener('toggle', onToggle, capture);
    return () => {
      window.removeEventListener('keydown', onKeyDown, capture);
      window.removeEventListener('pointerup', onPointerEnd, capture);
      window.removeEventListener('pointercancel', onPointerEnd, capture);
      window.removeEventListener('click', onClick, capture);
      document.removeEventListener('toggle', onToggle, capture);
    };
  }, [handler]);

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (handler.state() === 'ringing') handler.partnerDismiss();
      }}
      onClose={() => {
        if (ownCloses.current > 0) {
          ownCloses.current -= 1;
          return;
        }
        // Closed by the browser itself while ringing: the alarm ends with the card (2.5).
        if (handler.state() === 'ringing') handler.partnerDismiss();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || handler.state() !== 'ringing') return;
        // 2.6: the press dismisses at once; its pointerup and click are swallowed on window.
        event.preventDefault();
        cardPointer.current = event.pointerId;
        handler.cardPointer('down');
      }}
      className="fixed inset-0 m-0 size-full max-h-none max-w-none overflow-y-auto bg-alarm p-0 text-text backdrop:bg-alarm"
    >
      <div className="flex min-h-full flex-col items-center justify-center gap-10 px-6 py-12 text-center sm:px-12">
        <div className="flex max-w-full flex-col items-center gap-6">
          <p id={titleId} className="max-w-full text-alarm-title font-bold tracking-tight text-balance wrap-anywhere">
            {ALARM_TITLE}
          </p>
          {soundUnavailable ? <p className="max-w-[36ch] text-xl font-medium">{SOUND_UNAVAILABLE_TEXT}</p> : null}
        </div>
        <p id={descriptionId} className="max-w-[40ch] text-xl text-pretty">
          {ALARM_DESCRIPTION}
        </p>
        <button
          ref={dismissRef}
          type="button"
          onClick={() => handler.partnerDismiss()}
          className="min-h-(--size-target) min-w-(--size-target) rounded-2xl bg-text px-12 py-4 text-2xl font-semibold text-on-accent"
        >
          {ALARM_DISMISS_LABEL}
        </button>
      </div>
    </dialog>
  );
}
