import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { encodeSpeechWav, wavDurationMs } from './audio';

describe('PCM WAV boundary', () => {
  it('encodes mono PCM16 at 16 kHz and downmixes stereo', () => {
    const bytes = encodeSpeechWav([new Float32Array([1, -1]), new Float32Array([-1, 1])], 16000);
    expect(wavDurationMs(bytes)).toBe(0.125);
    expect(new DataView(bytes.buffer).getInt16(44, true)).toBe(0);
    expect(new DataView(bytes.buffer).getInt16(46, true)).toBe(0);
  });

  it('bounds duration by actual samples while resampling ordinary capture rates', () => {
    fc.assert(fc.property(fc.integer({ min: 3, max: 30_000 }), fc.constantFrom(16000, 22050, 44100, 48000), (length, rate) => {
      const bytes = encodeSpeechWav([new Float32Array(length)], rate);
      const duration = wavDurationMs(bytes);
      expect(duration).not.toBeNull();
      expect(duration!).toBeLessThanOrEqual(length / rate * 1000 + 1e-9);
      expect(length / rate * 1000 - duration!).toBeLessThanOrEqual(1000 / 16000 + 1e-9);
      expect(bytes.length).toBe(44 + Math.floor(length * 16000 / rate) * 2);
    }));
  });

  it('rejects truncation, forged byte rate and unsupported compression', () => {
    const original = encodeSpeechWav([new Float32Array(160)], 16000);
    expect(wavDurationMs(original.slice(0, -1))).toBeNull();
    for (const [offset, value] of [[20, 3], [28, 1000], [32, 4], [40, 1]] as const) {
      const bytes = original.slice();
      new DataView(bytes.buffer).setUint16(offset, value, true);
      expect(wavDurationMs(bytes)).toBeNull();
    }
  });

  it('rejects arbitrary invalid containers without throwing', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 1000 }), (bytes) => {
      expect(() => wavDurationMs(bytes)).not.toThrow();
    }));
  });
});
