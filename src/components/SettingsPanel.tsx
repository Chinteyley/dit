import { useContext, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { PatchError, SettingsPatch, SettingsRecord } from '@/lib/conversation';
import type { Result } from '@/lib/input';
import type { ListenState, VoiceInfo } from '@/lib/speech';
import { SessionApiContext } from './session-api-context';
import { SettingsForm } from './SettingsForm';

export interface SettingsPanelProps {
  readonly open: boolean;
  readonly settings: SettingsRecord;
  readonly voices: readonly VoiceInfo[];
  readonly listen: ListenState;
  /** Called when the panel closes itself (Escape, "Close settings", the backdrop, the prompt). */
  readonly onClose: () => void;
  readonly onPatch: (patch: SettingsPatch) => Result<SettingsRecord, readonly PatchError[]>;
  readonly onListen: (on: boolean) => void;
  readonly onClearHistory: () => void;
  /** Rendered right after "Clear history", inside the Tab wrap (onboarding-and-safety "Run setup again"). */
  readonly extraActions?: ReactNode;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function focusables(dialog: HTMLDialogElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

/**
 * The Settings_Panel (Requirement 20): a native modal <dialog> opened with showModal(), named by
 * its "Settings" heading. Focus starts on the first control and Tab wraps inside (Req 20.7).
 * Escape, "Close settings", a press on the backdrop and both answers of the clear-history prompt
 * close it and return focus to the Keying_Surface, never to the opener (Req 20.8, 21.4, 21.5).
 * When the parent closes it (open turns false), it closes without moving focus.
 */
export function SettingsPanel({ open, onClose, extraActions, ...form }: SettingsPanelProps) {
  const { focusKeyingSurface } = useContext(SessionApiContext);
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  /** close() calls made here; their close events are not a new request to close. */
  const ownCloses = useRef(0);
  /** The current press started on the backdrop (a drag that ends there does not count). */
  const backdropPress = useRef(false);

  const closeDialog = (): void => {
    const dialog = dialogRef.current;
    if (dialog === null || !dialog.open) return;
    ownCloses.current += 1;
    dialog.close();
  };

  const requestClose = (): void => {
    closeDialog();
    onClose();
    focusKeyingSurface();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      focusables(dialog)[0]?.focus();
    } else if (!open && dialog.open) {
      ownCloses.current += 1;
      dialog.close();
    }
  }, [open]);

  const wrapTab = (event: KeyboardEvent<HTMLDialogElement>): void => {
    const dialog = dialogRef.current;
    if (event.key !== 'Tab' || dialog === null) return;
    const all = focusables(dialog);
    const first = all[0];
    const last = all.at(-1);
    if (first === undefined || last === undefined) return;
    const active = document.activeElement;
    const inside = active !== null && active !== dialog && dialog.contains(active);
    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: close through the same path as the close button.
        event.preventDefault();
        requestClose();
      }}
      onClose={() => {
        if (ownCloses.current > 0) {
          ownCloses.current -= 1;
          return;
        }
        // The browser closed it by itself (a close request it did not let us cancel).
        onClose();
        focusKeyingSurface();
      }}
      onKeyDown={wrapTab}
      onPointerDown={(event) => {
        backdropPress.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const fromBackdrop = backdropPress.current && event.target === event.currentTarget;
        backdropPress.current = false;
        if (fromBackdrop) requestClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(calc(100%-2rem),34rem)] overflow-y-auto rounded-3xl bg-surface p-0 text-text backdrop:bg-bg/80 motion-safe:animate-fade-in"
    >
      {open ? (
        // Fills the dialog, so only a press outside this box lands on the dialog element (the backdrop).
        <div className="flex flex-col gap-8 p-6 sm:p-8">
          <h2 id={titleId} className="text-2xl font-semibold text-text">
            Settings
          </h2>
          <SettingsForm {...form} onClose={requestClose} extraActions={extraActions} />
        </div>
      ) : null}
    </dialog>
  );
}
