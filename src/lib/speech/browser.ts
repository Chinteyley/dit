/**
 * Speech adapters (design "lib/speech/browser.ts"). Browser APIs are passed in;
 * recorder.ts provides capture when the native recognizer has no usable backend.
 *
 * Checked against MDN (SpeechSynthesis, SpeechSynthesisErrorEvent.error, SpeechRecognition,
 * SpeechRecognitionErrorEvent.error): cancel() makes the cut-off utterance end with the error
 * "interrupted" (started) or "canceled" (still queued); some engines fill getVoices() without a
 * voiceschanged event; recognition ends on its own after silence even when continuous; start()
 * throws InvalidStateError when recognition cannot start.
 *
 * Privacy: transcripts and sentences are handed to the caller only; nothing is logged or stored.
 */
import { err, ok, type Unsubscribe } from '@/lib/input';
import { adaptiveSpeechInput } from './adaptive';
import { recorderSpeechInput, type CaptureWindow } from './recorder';
import type { RecognitionError, SpeechInput, SpeechOutput, UtteranceOutcome, VoiceInfo } from './types';

/** How long after subscribing the voice list is read once more (Req 17.7 asks for 1 s). */
export const VOICES_POLL_MS = 250;

/** The parts of `window` the synthesis adapter uses; tests pass a fake with the same shape. */
export type SynthesisWindow = Pick<Window, 'setTimeout' | 'clearTimeout'> & {
  readonly speechSynthesis?: SpeechSynthesis;
  readonly SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
};

function mapVoices(synth: SpeechSynthesis): readonly VoiceInfo[] {
  try {
    return synth
      .getVoices()
      .map((voice) => ({ uri: voice.voiceURI, name: voice.name, lang: voice.lang, isDefault: voice.default }));
  } catch {
    return [];
  }
}

const voicesKey = (voices: readonly VoiceInfo[]): string => voices.map((voice) => voice.uri).join('\n');

export function webSpeechOutput(win: SynthesisWindow): SpeechOutput {
  /** Ends the utterance in progress; each utterance's onEnd runs once. */
  let finishCurrent: ((outcome: UtteranceOutcome) => void) | null = null;

  const synthesis = (): SpeechSynthesis | undefined => {
    try {
      return win.speechSynthesis;
    } catch {
      return undefined;
    }
  };

  const cancelCurrent = (synth: SpeechSynthesis): void => {
    const finish = finishCurrent;
    finishCurrent = null;
    try {
      synth.cancel();
    } catch {
      // Nothing was playing that we could stop.
    }
    // Some engines report a cut-off utterance as "end"; the guard makes it count as cancelled.
    finish?.('cancelled');
  };

  return {
    isSupported: () => synthesis() !== undefined && typeof win.SpeechSynthesisUtterance === 'function',
    voices: () => {
      const synth = synthesis();
      return synth === undefined ? [] : mapVoices(synth);
    },
    onVoicesChanged(listener): Unsubscribe {
      const synth = synthesis();
      if (synth === undefined) return () => undefined;
      let last = voicesKey(mapVoices(synth));
      const deliver = (): void => {
        const voices = mapVoices(synth);
        const key = voicesKey(voices);
        if (key === last) return;
        last = key;
        listener(voices);
      };
      // Engines without addEventListener on speechSynthesis still get the one-off poll.
      synth.addEventListener?.('voiceschanged', deliver);
      const poll = win.setTimeout(deliver, VOICES_POLL_MS);
      return () => {
        synth.removeEventListener?.('voiceschanged', deliver);
        win.clearTimeout(poll);
      };
    },
    speak(sentence, opts, onEnd) {
      const synth = synthesis();
      const Utterance = win.SpeechSynthesisUtterance;
      let ended = false;
      const finish = (outcome: UtteranceOutcome): void => {
        if (ended) return;
        ended = true;
        if (finishCurrent === finish) finishCurrent = null;
        try {
          onEnd(outcome);
        } catch {
          // A failing callback must not break the next utterance.
        }
      };
      if (synth === undefined || typeof Utterance !== 'function') {
        finish('error');
        return;
      }
      cancelCurrent(synth);
      try {
        const utterance = new Utterance(sentence);
        utterance.rate = opts.rate;
        const voice =
          opts.voiceURI === null ? undefined : synth.getVoices().find((candidate) => candidate.voiceURI === opts.voiceURI);
        // An unknown voice speaks with the browser default (Req 17.2).
        if (voice !== undefined) utterance.voice = voice;
        utterance.onend = () => finish('done');
        utterance.onerror = (event) =>
          finish(event.error === 'interrupted' || event.error === 'canceled' ? 'cancelled' : 'error');
        finishCurrent = finish;
        synth.speak(utterance);
      } catch {
        finish('error');
      }
    },
    isSpeaking: () => {
      try {
        return synthesis()?.speaking === true;
      } catch {
        return false;
      }
    },
    cancel() {
      const synth = synthesis();
      if (synth !== undefined) cancelCurrent(synth);
    },
  };
}

interface RecognitionAlternativeLike {
  readonly transcript: string;
}

interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternativeLike | undefined;
}

export interface RecognitionResultEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResultLike | undefined };
}

export interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionResultEventLike) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/** The parts of `window` the recognition adapter uses. */
export interface RecognitionWindow {
  readonly SpeechRecognition?: new () => RecognitionLike;
  readonly webkitSpeechRecognition?: new () => RecognitionLike;
  readonly document?: { readonly documentElement?: { readonly lang?: string } };
}

/** SpeechRecognitionErrorEvent.error codes mapped to the app's RecognitionError (Req 18.8 to 18.11). */
export function recognitionErrorOf(code: string): RecognitionError {
  switch (code) {
    case 'not-allowed':
      return 'permission-denied';
    case 'service-not-allowed':
      return 'service-unavailable';
    case 'network':
      return 'network';
    case 'audio-capture':
      return 'no-microphone';
    case 'no-speech':
      return 'no-speech';
    case 'aborted':
      return 'aborted';
    default:
      return 'other';
  }
}

const unavailableRecognition = new WeakSet<RecognitionWindow>();

export function webSpeechInput(win: RecognitionWindow & CaptureWindow): SpeechInput {
  return adaptiveSpeechInput(browserRecognitionInput(win), recorderSpeechInput(win), {
    get: () => unavailableRecognition.has(win),
    set: () => { unavailableRecognition.add(win); },
  });
}

export function browserRecognitionInput(win: RecognitionWindow): SpeechInput {
  const interim = new Set<(text: string) => void>();
  const final = new Set<(text: string) => void>();
  const errors = new Set<(error: RecognitionError) => void>();
  const ends = new Set<() => void>();
  let recognition: RecognitionLike | null = null;

  const ctor = (): (new () => RecognitionLike) | undefined => {
    try {
      return win.SpeechRecognition ?? win.webkitSpeechRecognition;
    } catch {
      return undefined;
    }
  };

  const emit = <T>(set: Set<(value: T) => void>, value: T): void => {
    for (const listener of [...set]) {
      try {
        listener(value);
      } catch {
        // One failing listener must not stop the others.
      }
    }
  };

  const create = (Recognition: new () => RecognitionLike): RecognitionLike => {
    const rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = win.document?.documentElement?.lang || 'en';
    rec.onresult = (event) => {
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript ?? '';
        if (result?.isFinal === true) emit(final, transcript);
        else pending += transcript;
      }
      if (pending !== '') emit(interim, pending);
    };
    rec.onerror = (event) => emit(errors, recognitionErrorOf(event.error));
    rec.onend = () => {
      for (const listener of [...ends]) {
        try {
          listener();
        } catch {
          // ignore
        }
      }
    };
    return rec;
  };

  const subscribe =
    <T>(set: Set<T>) =>
    (listener: T): Unsubscribe => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    };

  return {
    isSupported: () => typeof ctor() === 'function',
    start() {
      const Recognition = ctor();
      if (typeof Recognition !== 'function') return err('other');
      try {
        recognition ??= create(Recognition);
        recognition.start();
        return ok(undefined);
      } catch {
        return err('other');
      }
    },
    stop() {
      try {
        const rec = recognition;
        recognition = null;
        if (rec) {
          rec.onresult = null;
          rec.onerror = null;
          rec.onend = null;
          rec.stop();
        }
      } catch {
        // Already stopped.
      }
    },
    onInterim: subscribe(interim),
    onFinal: subscribe(final),
    onError: subscribe(errors),
    onEnd: subscribe(ends),
  };
}
