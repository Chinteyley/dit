/**
 * Test fakes for SpeechOutput and SpeechInput (Requirement 23.6, 23.7). They follow the
 * interface contracts in types.ts without touching any browser API. Never re-exported from
 * index.ts.
 */
import { err, ok, type Result, type Unsubscribe } from '@/lib/input';
import type { RecognitionError, SpeechInput, SpeechOutput, UtteranceOutcome, VoiceInfo } from './types';

export type SpeechCall =
  | { readonly kind: 'cancel' }
  | { readonly kind: 'speak'; readonly sentence: string; readonly voiceURI: string | null; readonly rate: number };

export interface FakeSpeechOutput extends SpeechOutput {
  /** Whether isSupported() reports true. */
  supported: boolean;
  /** What isSpeaking() reports; speak() sets it and finish() and cancel() clear it. */
  speaking: boolean;
  /** cancel() and speak() calls, in order. */
  readonly calls: readonly SpeechCall[];
  /** Replaces the voice list and notifies onVoicesChanged listeners. */
  setVoices(voices: readonly VoiceInfo[]): void;
  /** Ends the utterance in progress with the given outcome (its onEnd fires once). */
  finish(outcome: UtteranceOutcome): void;
  /** Number of onVoicesChanged listeners still subscribed. */
  listenerCount(): number;
}

export const FAKE_VOICES: readonly VoiceInfo[] = Object.freeze([
  Object.freeze({ uri: 'fake-voice-a', name: 'Voice A', lang: 'en-GB', isDefault: true }),
  Object.freeze({ uri: 'fake-voice-b', name: 'Voice B', lang: 'en-US', isDefault: false }),
]);

export function createFakeSpeechOutput(
  opts: { readonly supported?: boolean; readonly voices?: readonly VoiceInfo[] } = {},
): FakeSpeechOutput {
  let voiceList = opts.voices ?? FAKE_VOICES;
  const calls: SpeechCall[] = [];
  const listeners = new Set<(voices: readonly VoiceInfo[]) => void>();
  let current: ((outcome: UtteranceOutcome) => void) | null = null;

  const end = (outcome: UtteranceOutcome): void => {
    const onEnd = current;
    current = null;
    fake.speaking = false;
    onEnd?.(outcome);
  };

  const fake: FakeSpeechOutput = {
    supported: opts.supported ?? true,
    speaking: false,
    calls,
    isSupported: () => fake.supported,
    voices: () => voiceList,
    onVoicesChanged(listener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    speak(sentence, { voiceURI, rate }, onEnd) {
      // Like the real adapter: an utterance still in progress ends as cancelled first.
      if (current !== null) end('cancelled');
      calls.push({ kind: 'speak', sentence, voiceURI, rate });
      let ended = false;
      current = (outcome) => {
        if (ended) return;
        ended = true;
        onEnd(outcome);
      };
      fake.speaking = true;
    },
    isSpeaking: () => fake.speaking,
    cancel() {
      calls.push({ kind: 'cancel' });
      if (current !== null) end('cancelled');
    },
    setVoices(voices) {
      voiceList = voices;
      for (const listener of [...listeners]) listener(voices);
    },
    finish(outcome) {
      end(outcome);
    },
    listenerCount: () => listeners.size,
  };
  return fake;
}

export interface FakeSpeechInput extends SpeechInput {
  supported: boolean;
  /** What the next start() returns. */
  nextStart: Result<void, RecognitionError>;
  /** start() and stop() calls, in order. */
  readonly calls: readonly ('start' | 'stop')[];
  emitInterim(text: string): void;
  emitFinal(text: string): void;
  emitError(error: RecognitionError): void;
  emitEnd(): void;
  /** Number of listeners still subscribed, over all four events. */
  listenerCount(): number;
}

export function createFakeSpeechInput(opts: { readonly supported?: boolean } = {}): FakeSpeechInput {
  const calls: ('start' | 'stop')[] = [];
  const interim = new Set<(text: string) => void>();
  const final = new Set<(text: string) => void>();
  const errors = new Set<(error: RecognitionError) => void>();
  const ends = new Set<() => void>();

  const subscribe =
    <T>(set: Set<T>) =>
    (listener: T): Unsubscribe => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    };

  const fake: FakeSpeechInput = {
    supported: opts.supported ?? true,
    nextStart: ok(undefined),
    calls,
    isSupported: () => fake.supported,
    start() {
      calls.push('start');
      return fake.supported ? fake.nextStart : err('other');
    },
    stop() {
      calls.push('stop');
    },
    onInterim: subscribe(interim),
    onFinal: subscribe(final),
    onError: subscribe(errors),
    onEnd: subscribe(ends),
    emitInterim: (text) => [...interim].forEach((listener) => listener(text)),
    emitFinal: (text) => [...final].forEach((listener) => listener(text)),
    emitError: (error) => [...errors].forEach((listener) => listener(error)),
    emitEnd: () => [...ends].forEach((listener) => listener()),
    listenerCount: () => interim.size + final.size + errors.size + ends.size,
  };
  return fake;
}
