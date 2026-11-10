import { useContext, useId } from 'react';
import { LISTEN_MESSAGE_TEXT, type ListenState } from '@/lib/speech';
import { SessionApiContext } from './session-api-context';
import { SwitchControl } from './SwitchControl';

export interface ListenToggleProps {
  readonly listen: ListenState;
  readonly onToggle: (on: boolean) => void;
  /**
   * Return focus to the Keying_Surface after a toggle (Req 21.1). True on the main screen; the
   * Settings_Panel passes false, because focus stays in the dialog there.
   */
  readonly returnFocus?: boolean;
}

/**
 * The Listen_Toggle (Requirement 18): a switch named "Listen" that turns partner speech
 * recognition on and off, disabled with an explanation when the browser has none. It shows the
 * latest interim transcript and any message about why listening stopped.
 */
export function ListenToggle({ listen, onToggle, returnFocus = true }: ListenToggleProps) {
  const { focusKeyingSurface } = useContext(SessionApiContext);
  const messageId = useId();
  const message = listen.message === null ? null : LISTEN_MESSAGE_TEXT[listen.message];

  return (
    <div className="flex flex-col gap-2">
      <SwitchControl
        label="Listen"
        checked={listen.supported && listen.on}
        disabled={!listen.supported}
        describedBy={message === null ? undefined : messageId}
        onChange={(on) => {
          onToggle(on);
          if (returnFocus) focusKeyingSurface();
        }}
      />
      {listen.interim === '' ? null : <p className="text-lg text-text italic">{listen.interim}</p>}
      {message === null ? null : (
        <p id={messageId} className="text-base text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
