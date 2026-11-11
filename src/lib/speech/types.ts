/**
 * Interfaces around speech synthesis and browser/server recognition (design "lib/speech/types.ts"). The
 * browser adapters live in browser.ts and recorder.ts and the test fakes in fakes.ts, so the controller and its
 * tests never touch the real APIs (Req 23.6, 23.7).
 */
import type { Unsubscribe } from '@/lib/input';
import type { Result } from '@/lib/morse';

export interface VoiceInfo {
  /** SpeechSynthesisVoice.voiceURI */
  readonly uri: string;
  readonly name: string;
  readonly lang: string;
  readonly isDefault: boolean;
}

export type UtteranceOutcome = 'done' | 'error' | 'cancelled';

export interface SpeechOutput {
  isSupported(): boolean;
  voices(): readonly VoiceInfo[];
  onVoicesChanged(listener: (voices: readonly VoiceInfo[]) => void): Unsubscribe;
  /**
   * Cancels any utterance in progress, then speaks once. An unknown voiceURI speaks with the
   * browser default voice (Req 17.1, 17.2). onEnd fires once: 'cancelled' when the utterance is
   * cut off by cancel() or a newer speak().
   */
  speak(
    sentence: string,
    opts: { readonly voiceURI: string | null; readonly rate: number },
    onEnd: (outcome: UtteranceOutcome) => void,
  ): void;
  isSpeaking(): boolean;
  cancel(): void;
}

export type RecognitionError =
  | 'permission-denied' // not-allowed
  | 'network'
  | 'service-unavailable' // service-not-allowed
  | 'no-microphone' // audio-capture
  | 'no-speech'
  | 'aborted'
  | 'other'; // language-not-supported, bad-grammar, start() throwing, ...

export interface SpeechInput {
  isSupported(): boolean;
  /** Optional capabilities of the browser/server selector; fakes can omit them. */
  mode?(): 'browser' | 'server';
  onMode?(listener: (mode: 'browser' | 'server') => void): Unsubscribe;
  setPaused?(paused: boolean): void;
  /** Starts recognition (continuous, interim results). A failed Result when start() throws. */
  start(): Result<void, RecognitionError>;
  stop(): void;
  onInterim(listener: (text: string) => void): Unsubscribe;
  onFinal(listener: (text: string) => void): Unsubscribe;
  onError(listener: (error: RecognitionError) => void): Unsubscribe;
  onEnd(listener: () => void): Unsubscribe;
}
