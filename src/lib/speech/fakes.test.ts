import { describe, expect, it } from 'vitest';
import { FAKE_VOICES, createFakeSpeechInput, createFakeSpeechOutput } from './fakes';
import type { UtteranceOutcome } from './types';

describe('createFakeSpeechOutput', () => {
  it('records calls in order and ends a cut-off utterance as cancelled', () => {
    const fake = createFakeSpeechOutput();
    const outcomes: [string, UtteranceOutcome][] = [];
    fake.speak('one', { voiceURI: null, rate: 1 }, (o) => outcomes.push(['one', o]));
    expect(fake.isSpeaking()).toBe(true);
    fake.speak('two', { voiceURI: 'fake-voice-b', rate: 2 }, (o) => outcomes.push(['two', o]));
    fake.finish('done');
    fake.finish('error');
    fake.cancel();
    expect(fake.calls).toEqual([
      { kind: 'speak', sentence: 'one', voiceURI: null, rate: 1 },
      { kind: 'speak', sentence: 'two', voiceURI: 'fake-voice-b', rate: 2 },
      { kind: 'cancel' },
    ]);
    expect(outcomes).toEqual([
      ['one', 'cancelled'],
      ['two', 'done'],
    ]);
    expect(fake.isSpeaking()).toBe(false);
  });

  it('has settable support and voices that notify listeners', () => {
    const fake = createFakeSpeechOutput({ supported: false, voices: [] });
    expect(fake.isSupported()).toBe(false);
    const seen: number[] = [];
    const unsubscribe = fake.onVoicesChanged((voices) => seen.push(voices.length));
    fake.setVoices(FAKE_VOICES);
    unsubscribe();
    fake.setVoices([]);
    expect(seen).toEqual([2]);
    expect(fake.listenerCount()).toBe(0);
  });
});

describe('createFakeSpeechInput', () => {
  it('returns the scripted start Result and emits events to subscribers', () => {
    const fake = createFakeSpeechInput();
    const events: string[] = [];
    const stops = [
      fake.onInterim((t) => events.push(`interim:${t}`)),
      fake.onFinal((t) => events.push(`final:${t}`)),
      fake.onError((e) => events.push(`error:${e}`)),
      fake.onEnd(() => events.push('end')),
    ];
    expect(fake.start()).toEqual({ ok: true, value: undefined });
    fake.nextStart = { ok: false, error: 'other' };
    expect(fake.start()).toEqual({ ok: false, error: 'other' });
    fake.emitInterim('are');
    fake.emitFinal('are you');
    fake.emitError('no-speech');
    fake.emitEnd();
    fake.stop();
    expect(events).toEqual(['interim:are', 'final:are you', 'error:no-speech', 'end']);
    expect(fake.calls).toEqual(['start', 'start', 'stop']);
    for (const stop of stops) stop();
    expect(fake.listenerCount()).toBe(0);
  });
});
