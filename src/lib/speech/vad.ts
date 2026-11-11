/** Pure utterance boundaries. Time and energy come from the capture adapter. */
export const SILENCE_MS = 800;
export const MAX_UTTERANCE_MS = 15_000;
export const SPEECH_RMS = 0.015;
export const MIN_SPEECH_MS = 120;
export interface VadState {
  readonly startedAt: number;
  readonly lastSpeechAt: number;
}
export interface VadStep {
  readonly state: VadState | null;
  readonly action: 'start' | 'finish' | 'discard' | null;
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
}

export function vadStep(state: VadState | null, energy: number, now: number): VadStep {
  const speaking = energy >= SPEECH_RMS;
  if (state === null) return speaking
    ? { state: { startedAt: now, lastSpeechAt: now }, action: 'start' }
    : { state: null, action: null };
  const next = speaking ? { ...state, lastSpeechAt: now } : state;
  if (now - state.startedAt >= MAX_UTTERANCE_MS || now - next.lastSpeechAt >= SILENCE_MS) {
    return { state: null, action: next.lastSpeechAt - state.startedAt >= MIN_SPEECH_MS ? 'finish' : 'discard' };
  }
  return { state: next, action: null };
}
