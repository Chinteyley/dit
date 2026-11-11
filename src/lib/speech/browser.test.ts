import { describe, expect, it } from 'vitest';
import { createManualClock, createManualScheduler } from '@/lib/input';
import {
  VOICES_POLL_MS,
  recognitionErrorOf,
  webSpeechInput,
  webSpeechOutput,
  type RecognitionLike,
  type RecognitionResultEventLike,
  type RecognitionWindow,
  type SynthesisWindow,
} from './browser';
import type { RecognitionError, UtteranceOutcome } from './types';

interface Voice {
  readonly voiceURI: string;
  readonly name: string;
  readonly lang: string;
  readonly default: boolean;
}

class FakeUtterance {
  rate = 1;
  voice: Voice | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { readonly error: string }) => void) | null = null;
  constructor(readonly text: string) {}
}

/** A fake speechSynthesis that, like Chrome, reports a cut-off utterance as "interrupted". */
function fakeSynthesis(voices: Voice[]) {
  const log: string[] = [];
  const listeners = new Set<() => void>();
  let current: FakeUtterance | null = null;
  const synth = {
    speaking: false,
    log,
    spoken: [] as FakeUtterance[],
    getVoices: () => voices,
    speak(utterance: FakeUtterance) {
      log.push(`speak:${utterance.text}`);
      synth.spoken.push(utterance);
      current = utterance;
      synth.speaking = true;
    },
    cancel() {
      log.push('cancel');
      const utterance = current;
      current = null;
      synth.speaking = false;
      utterance?.onerror?.({ error: 'interrupted' });
    },
    addEventListener(_type: string, listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      listeners.delete(listener);
    },
    fireVoicesChanged() {
      for (const listener of [...listeners]) listener();
    },
    end() {
      const utterance = current;
      current = null;
      synth.speaking = false;
      utterance?.onend?.();
    },
    fail(error: string) {
      const utterance = current;
      current = null;
      synth.speaking = false;
      utterance?.onerror?.({ error });
    },
    listenerCount: () => listeners.size,
  };
  return synth;
}

const VOICES: Voice[] = [
  { voiceURI: 'voice-a', name: 'A', lang: 'en-GB', default: true },
  { voiceURI: 'voice-b', name: 'B', lang: 'en-US', default: false },
];

function synthesisRig(voices: Voice[] = [...VOICES]) {
  const clock = createManualClock(0);
  const scheduler = createManualScheduler(clock.now);
  const cancels = new Map<number, () => void>();
  let nextId = 1;
  const synth = fakeSynthesis(voices);
  const win = {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      cancels.set(id, scheduler.schedule(ms, fn));
      return id;
    },
    clearTimeout: (id: number | undefined) => {
      if (id !== undefined) cancels.get(id)?.();
    },
  };
  const advance = (ms: number) => {
    clock.advance(ms);
    scheduler.runDue(clock.now());
  };
  return { synth, voices, scheduler, advance, output: webSpeechOutput(win as unknown as SynthesisWindow) };
}

describe('webSpeechOutput', () => {
  it('cancels before every speak, and the cut-off utterance ends once as cancelled', () => {
    const { synth, output } = synthesisRig();
    const outcomes: [string, UtteranceOutcome][] = [];
    output.speak('one', { voiceURI: null, rate: 1 }, (outcome) => outcomes.push(['one', outcome]));
    output.speak('two', { voiceURI: null, rate: 1.5 }, (outcome) => outcomes.push(['two', outcome]));
    expect(synth.log).toEqual(['cancel', 'speak:one', 'cancel', 'speak:two']);
    expect(outcomes).toEqual([['one', 'cancelled']]);
    expect(synth.spoken[1]?.rate).toBe(1.5);
    synth.end();
    expect(outcomes).toEqual([
      ['one', 'cancelled'],
      ['two', 'done'],
    ]);
  });

  it('uses the selected voice when it exists and the browser default otherwise', () => {
    const { synth, output } = synthesisRig();
    output.speak('a', { voiceURI: 'voice-b', rate: 1 }, () => undefined);
    output.speak('b', { voiceURI: 'missing-voice', rate: 1 }, () => undefined);
    output.speak('c', { voiceURI: null, rate: 1 }, () => undefined);
    expect(synth.spoken.map((u) => u.voice?.voiceURI ?? null)).toEqual(['voice-b', null, null]);
  });

  it('maps interrupted and canceled to cancelled, other errors to error, and end to done', () => {
    for (const [code, expected] of [
      ['interrupted', 'cancelled'],
      ['canceled', 'cancelled'],
      ['synthesis-failed', 'error'],
      ['audio-busy', 'error'],
    ] as const) {
      const { synth, output } = synthesisRig();
      const outcomes: UtteranceOutcome[] = [];
      output.speak('x', { voiceURI: null, rate: 1 }, (outcome) => outcomes.push(outcome));
      synth.fail(code);
      synth.end();
      expect(outcomes).toEqual([expected]);
    }
  });

  it('reports speaking and cancels on request', () => {
    const { synth, output } = synthesisRig();
    const outcomes: UtteranceOutcome[] = [];
    output.speak('x', { voiceURI: null, rate: 1 }, (outcome) => outcomes.push(outcome));
    expect(output.isSpeaking()).toBe(true);
    output.cancel();
    expect(output.isSpeaking()).toBe(false);
    expect(outcomes).toEqual(['cancelled']);
    expect(synth.log.at(-1)).toBe('cancel');
  });

  it('maps the voice list and sees a list filled without voiceschanged within 1 second', () => {
    const { output, voices, advance, synth } = synthesisRig([]);
    expect(output.voices()).toEqual([]);
    const seen: string[][] = [];
    const unsubscribe = output.onVoicesChanged((list) => seen.push(list.map((voice) => voice.uri)));
    voices.push(...VOICES);
    advance(VOICES_POLL_MS);
    expect(seen).toEqual([['voice-a', 'voice-b']]);
    expect(output.voices()[0]).toEqual({ uri: 'voice-a', name: 'A', lang: 'en-GB', isDefault: true });
    voices.pop();
    synth.fireVoicesChanged();
    synth.fireVoicesChanged();
    expect(seen).toEqual([['voice-a', 'voice-b'], ['voice-a']]);
    unsubscribe();
    expect(synth.listenerCount()).toBe(0);
  });

  it('unsubscribing before the poll cancels it', () => {
    const { output, voices, advance, scheduler } = synthesisRig([]);
    const seen: unknown[] = [];
    const unsubscribe = output.onVoicesChanged((list) => seen.push(list));
    expect(scheduler.pending()).toBe(1);
    unsubscribe();
    expect(scheduler.pending()).toBe(0);
    voices.push(...VOICES);
    advance(1_000);
    expect(seen).toEqual([]);
  });

  it('is unsupported without speechSynthesis, and speak then ends with an error', () => {
    const output = webSpeechOutput({ setTimeout, clearTimeout } as unknown as SynthesisWindow);
    expect(output.isSupported()).toBe(false);
    expect(output.voices()).toEqual([]);
    const outcomes: UtteranceOutcome[] = [];
    output.speak('x', { voiceURI: null, rate: 1 }, (outcome) => outcomes.push(outcome));
    expect(outcomes).toEqual(['error']);
  });
});

class FakeRecognition implements RecognitionLike {
  static instances: FakeRecognition[] = [];
  static failStart = false;
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((event: RecognitionResultEventLike) => void) | null = null;
  onerror: ((event: { readonly error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  stops = 0;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    if (FakeRecognition.failStart) throw new DOMException('recognition has already started', 'InvalidStateError');
    this.starts++;
  }
  stop() {
    this.stops++;
  }
  result(resultIndex: number, results: readonly (readonly [string, boolean])[]) {
    const list = results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
    this.onresult?.({ resultIndex, results: list });
  }
}

function recognitionRig(win: RecognitionWindow = { SpeechRecognition: FakeRecognition }) {
  FakeRecognition.instances = [];
  FakeRecognition.failStart = false;
  const input = webSpeechInput(win);
  const events: string[] = [];
  input.onInterim((text) => events.push(`interim:${text}`));
  input.onFinal((text) => events.push(`final:${text}`));
  input.onError((error) => events.push(`error:${error}`));
  input.onEnd(() => events.push('end'));
  return { input, events };
}

describe('webSpeechInput', () => {
  it('starts continuous recognition with interim results in the page language', () => {
    const { input } = recognitionRig({
      SpeechRecognition: FakeRecognition,
      document: { documentElement: { lang: 'en-GB' } },
    });
    expect(input.isSupported()).toBe(true);
    expect(input.start()).toEqual({ ok: true, value: undefined });
    const rec = FakeRecognition.instances[0];
    expect(rec).toMatchObject({ continuous: true, interimResults: true, lang: 'en-GB', starts: 1 });
    input.stop();
    expect(rec?.stops).toBe(1);
    input.start();
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it('falls back to webkitSpeechRecognition and to the language "en"', () => {
    const { input } = recognitionRig({ webkitSpeechRecognition: FakeRecognition });
    input.start();
    expect(FakeRecognition.instances[0]?.lang).toBe('en');
  });

  it('is unsupported without a recognition constructor', () => {
    const { input } = recognitionRig({});
    expect(input.isSupported()).toBe(false);
    expect(input.start()).toEqual({ ok: false, error: 'other' });
  });

  it('returns a failed Result when start() throws', () => {
    const { input } = recognitionRig();
    FakeRecognition.failStart = true;
    expect(input.start()).toEqual({ ok: false, error: 'other' });
  });

  it('maps results to interim and final transcripts, and forwards end', () => {
    const { input, events } = recognitionRig();
    input.start();
    const rec = FakeRecognition.instances[0];
    rec?.result(0, [['are', false]]);
    rec?.result(0, [['are you', false]]);
    rec?.result(0, [
      ['are you thirsty', true],
      [' now', false],
    ]);
    rec?.onend?.();
    expect(events).toEqual(['interim:are', 'interim:are you', 'final:are you thirsty', 'interim: now', 'end']);
  });

  it('maps recognition error codes', () => {
    const { input, events } = recognitionRig();
    input.start();
    const rec = FakeRecognition.instances[0];
    for (const code of ['not-allowed', 'service-not-allowed', 'audio-capture', 'no-speech', 'aborted', 'network']) {
      rec?.onerror?.({ error: code });
    }
    expect(events).toEqual([
      'error:permission-denied',
      'error:permission-denied',
      'error:no-microphone',
      'error:no-speech',
      'error:aborted',
      'error:other',
    ]);
    const others: RecognitionError[] = ['language-not-supported', 'bad-grammar', ''].map(recognitionErrorOf);
    expect(others).toEqual(['other', 'other', 'other']);
  });
});
