import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  RATE_MAX,
  RATE_MIN,
  WPM_MAX,
  WPM_MIN,
  WPM_RANGE_MESSAGE,
  type PatchError,
  type SettingsPatch,
  type SettingsRecord,
} from '@/lib/conversation';
import type { Result } from '@/lib/input';
import type { ListenState, VoiceInfo } from '@/lib/speech';
import { ListenToggle } from './ListenToggle';
import { SwitchControl } from './SwitchControl';

export interface SettingsFormProps {
  readonly settings: SettingsRecord;
  readonly voices: readonly VoiceInfo[];
  readonly listen: ListenState;
  /** Validates and applies a change; a failed Result changes nothing (Req 17.9, 20.6). */
  readonly onPatch: (patch: SettingsPatch) => Result<SettingsRecord, readonly PatchError[]>;
  readonly onListen: (on: boolean) => void;
  readonly onClearHistory: () => void;
  /** Closes the Settings_Panel and returns focus to the Keying_Surface. */
  readonly onClose: () => void;
  /** Rendered right after "Clear history" (onboarding-and-safety puts "Run setup again" here). */
  readonly extraActions?: ReactNode;
}

const fieldClass = 'min-h-(--size-target) w-full rounded-xl border border-border bg-raised px-4 text-lg text-text';
const buttonClass =
  'min-h-(--size-target) rounded-xl border border-border bg-raised px-5 text-lg font-medium text-text';

/**
 * The controls inside the Settings_Panel (Requirement 20.3), each with a visible label that is
 * also its accessible name. It mounts each time the panel opens, so a rejected Starting_WPM,
 * its message and the clear-history prompt never carry over to the next opening. "Clear history"
 * swaps the controls for a confirmation; either answer closes the panel (Req 15.4 to 15.6).
 */
export function SettingsForm(props: SettingsFormProps) {
  const { settings, voices, listen, onPatch, onListen, onClearHistory, onClose, extraActions } = props;
  const voiceId = useId();
  const rateId = useId();
  const wpmId = useId();
  const wpmErrorId = useId();
  const confirmTitleId = useId();
  const confirmTextId = useId();
  const [confirming, setConfirming] = useState(false);
  /** What the partner typed in the Starting_WPM field since the last commit, or null. */
  const [wpmDraft, setWpmDraft] = useState<string | null>(null);
  const [wpmRejected, setWpmRejected] = useState(false);
  const wpmRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const commitWpm = useCallback(
    (raw: string) => {
      const value = raw.trim() === '' ? Number.NaN : Number(raw);
      const result = onPatch({ startingWpm: value });
      // Either way the field shows the value in effect: the new one, or the previous one kept (Req 20.6).
      setWpmDraft(null);
      setWpmRejected(!result.ok && result.error.some((error) => error.field === 'startingWpm'));
    },
    [onPatch],
  );

  // Commit on the native change event (blur after typing, the spin buttons, arrow keys) and on Enter.
  useEffect(() => {
    const input = wpmRef.current;
    if (input === null) return;
    const onChange = (): void => commitWpm(input.value);
    input.addEventListener('change', onChange);
    return () => input.removeEventListener('change', onChange);
  }, [commitWpm, confirming]);

  // The safe answer gets focus when the prompt appears.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  if (confirming) {
    return (
      <div role="alertdialog" aria-labelledby={confirmTitleId} aria-describedby={confirmTextId} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h3 id={confirmTitleId} className="text-2xl font-semibold text-text">
            Clear the whole conversation?
          </h3>
          <p id={confirmTextId} className="text-lg text-muted">
            Every line in the history is removed from this device.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button ref={cancelRef} type="button" onClick={onClose} className={buttonClass}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onClearHistory();
              onClose();
            }}
            className={`${buttonClass} border-error text-error`}
          >
            Clear history
          </button>
        </div>
      </div>
    );
  }

  const selectedVoice =
    settings.voiceURI !== null && voices.some((voice) => voice.uri === settings.voiceURI) ? settings.voiceURI : '';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor={voiceId} className="text-lg font-medium text-text">
          Voice
        </label>
        <select
          id={voiceId}
          value={selectedVoice}
          onChange={(event) => onPatch({ voiceURI: event.target.value === '' ? null : event.target.value })}
          className={fieldClass}
        >
          <option value="">Browser default</option>
          {voices.map((voice) => (
            <option key={voice.uri} value={voice.uri}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor={rateId} className="text-lg font-medium text-text">
            Speech rate
          </label>
          <span aria-hidden="true" className="text-lg text-muted tabular-nums">
            {settings.speechRate.toFixed(1)}×
          </span>
        </div>
        <input
          id={rateId}
          type="range"
          min={RATE_MIN}
          max={RATE_MAX}
          step={0.1}
          value={settings.speechRate}
          onChange={(event) => onPatch({ speechRate: Number(event.target.value) })}
          className="h-(--size-target) w-full accent-accent"
        />
      </div>

      <ListenToggle listen={listen} onToggle={onListen} returnFocus={false} />

      <SwitchControl label="Flip partner display" checked={settings.flip} onChange={(flip) => onPatch({ flip })} />

      <div className="flex flex-col gap-2">
        <label htmlFor={wpmId} className="text-lg font-medium text-text">
          Starting speed (WPM)
        </label>
        <input
          ref={wpmRef}
          id={wpmId}
          type="number"
          inputMode="decimal"
          min={WPM_MIN}
          max={WPM_MAX}
          step="any"
          value={wpmDraft ?? String(settings.startingWpm)}
          aria-invalid={wpmRejected ? true : undefined}
          aria-describedby={wpmRejected ? wpmErrorId : undefined}
          onChange={(event) => setWpmDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commitWpm(event.currentTarget.value);
          }}
          className={fieldClass}
        />
        {wpmRejected ? (
          <p id={wpmErrorId} className="text-lg text-error">
            {WPM_RANGE_MESSAGE}
          </p>
        ) : null}
      </div>

      <SwitchControl
        label="Adapt to my speed"
        checked={settings.adaptive}
        onChange={(adaptive) => onPatch({ adaptive })}
      />

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => setConfirming(true)} className={buttonClass}>
          Clear history
        </button>
        {extraActions}
      </div>

      <div className="flex justify-end">
        <button type="button" aria-label="Close settings" onClick={onClose} className={buttonClass}>
          Close
        </button>
      </div>
    </div>
  );
}
