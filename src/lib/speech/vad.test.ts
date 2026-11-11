import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MAX_UTTERANCE_MS, SILENCE_MS, SPEECH_RMS, rms, vadStep, type VadState } from './vad';

describe('utterance segmentation', () => {
  it('starts on speech, preserves short pauses, and ends after 800 ms silence', () => {
    expect(vadStep(null, 0, 0).action).toBeNull();
    let step = vadStep(null, SPEECH_RMS, 0);
    expect(step.action).toBe('start');
    step = vadStep(step.state, 0.1, 200);
    expect(vadStep(step.state, 0, 999).action).toBeNull();
    expect(vadStep(step.state, 0, 1000)).toEqual({ state: null, action: 'finish' });
  });

  it('discards a click and bounds continuous speech at 15 seconds', () => {
    const start = vadStep(null, 0.2, 0).state;
    expect(vadStep(start, 0, SILENCE_MS).action).toBe('discard');
    expect(vadStep(start, 0.2, MAX_UTTERANCE_MS).action).toBe('finish');
  });

  it('never starts from silence, and every active segment has bounded duration', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 1, max: 1000 }), fc.boolean()), { maxLength: 300 }), (frames) => {
      let now = 0;
      let state: VadState | null = null;
      for (const [elapsed, speech] of frames) {
        now += elapsed;
        const step = vadStep(state, speech ? 0.1 : 0, now);
        if (step.action === 'start') expect(speech).toBe(true);
        if (step.state !== null) {
          expect(now - step.state.startedAt).toBeLessThan(MAX_UTTERANCE_MS);
          expect(now - step.state.lastSpeechAt).toBeLessThan(SILENCE_MS);
        }
        if (step.action === 'finish' || step.action === 'discard') expect(step.state).toBeNull();
        state = step.state;
      }
    }));
  });

  it('computes finite, sign-independent RMS within the sample amplitudes', () => {
    fc.assert(fc.property(fc.array(fc.float({ min: -1, max: 1, noNaN: true }), { maxLength: 2048 }), (values) => {
      const energy = rms(new Float32Array(values));
      expect(energy).toBeGreaterThanOrEqual(0);
      expect(energy).toBeLessThanOrEqual(1);
      expect(rms(new Float32Array(values.map((v) => -v)))).toBe(energy);
    }));
  });
});
