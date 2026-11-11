/**
 * The pure Listen state machine (design "lib/speech/listen.ts", Requirement 18). The controller
 * feeds it toggle clicks and recognition events and carries out the returned command.
 */
import type { RecognitionError } from './types';

export type ListenMessage = 'unsupported' | 'permission-denied' | 'no-microphone' | 'stopped';

/** The text the Listen_Toggle area shows for each message (Req 18.2, 18.8, 18.11). */
export const LISTEN_MESSAGE_TEXT: Readonly<Record<ListenMessage, string>> = Object.freeze({
  unsupported: 'Listening is not supported in this browser. Type your line instead.',
  'permission-denied': 'Microphone permission was denied. Allow the microphone to use Listen, or type your line.',
  'no-microphone': 'No microphone was found. Connect one to use Listen, or type your line.',
  stopped: 'Listening stopped. Turn Listen on again or type a line.',
});

export interface ListenState {
  readonly supported: boolean;
  /** The Listen_Toggle checked state; false at load (Req 18.10). */
  readonly on: boolean;
  /** The most recent interim transcript only (Req 18.6). */
  readonly interim: string;
  readonly message: ListenMessage | null;
}

export type ListenInput =
  | { readonly type: 'toggle'; readonly on: boolean }
  | { readonly type: 'start-failed' }
  | { readonly type: 'interim'; readonly text: string }
  | { readonly type: 'final' }
  | { readonly type: 'error'; readonly error: RecognitionError }
  | { readonly type: 'end' };

export type ListenCommand = 'start' | 'stop' | 'restart-later' | null;

export interface ListenStep {
  readonly state: ListenState;
  readonly command: ListenCommand;
}

/** Off at load, whatever an earlier session did (Req 18.10). */
export function initialListen(supported: boolean): ListenState {
  return { supported, on: false, interim: '', message: supported ? null : 'unsupported' };
}

const stay = (state: ListenState): ListenStep => ({ state, command: null });

/** Switches Listen off with an optional message and stops recognition. */
function switchOff(s: ListenState, message: ListenMessage | null): ListenStep {
  return { state: { ...s, on: false, interim: '', message: message ?? s.message }, command: 'stop' };
}

export function listenStep(s: ListenState, input: ListenInput): ListenStep {
  switch (input.type) {
    case 'toggle':
      if (input.on) {
        // Ignored when unsupported (Req 18.2); starting twice would make recognition throw.
        if (!s.supported || s.on) return stay(s);
        return { state: { ...s, on: true, interim: '', message: null }, command: 'start' };
      }
      return s.on ? switchOff(s, null) : stay(s.interim === '' ? s : { ...s, interim: '' });
    case 'interim':
      return s.on ? stay({ ...s, interim: input.text }) : stay(s);
    case 'final':
      return stay(s.interim === '' ? s : { ...s, interim: '' });
    case 'start-failed':
      return s.on ? switchOff(s, 'stopped') : stay(s);
    case 'error':
      // Errors after the partner switched Listen off are stray events from the stopped session.
      if (!s.on) return stay(s);
      switch (input.error) {
        case 'permission-denied':
        case 'no-microphone':
          return switchOff(s, input.error);
        case 'no-speech':
        case 'aborted':
          // The following end restarts recognition (Req 18.9).
          return stay(s);
        default:
          return switchOff(s, 'stopped');
      }
    case 'end':
      return s.on ? { state: s, command: 'restart-later' } : stay(s);
    default:
      return stay(s);
  }
}
