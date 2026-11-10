/**
 * Browser adapters for the safety runtime (design "lib/safety/browser.ts"): the Web Audio port
 * behind the Chime_Player, the gesture listeners that unlock audio, and page visibility. This is
 * the only file in src/lib/safety that reads browser globals, and nothing runs at import time.
 *
 * Web Audio notes (MDN): currentTime does not advance while a context is suspended; resume()
 * returns a promise that rejects for a closed context; calling stop() again replaces an earlier
 * stop time that has not passed, and a stop time before the start time means the node never plays.
 */
import type { Unsubscribe } from '@/lib/input';
import { CHIME_END_MS, PEAK_GAIN, RAMP_MS, TONES } from './chime-schedule';
import type { AudioPort, AudioState, ChimeVoice, PageVisibility } from './chime-player';

type AudioContextCtor = new () => AudioContext;

/** The parts of `window` the audio port uses; the real window satisfies it. */
export interface AudioWindow {
  readonly AudioContext?: AudioContextCtor;
  /** Safari before 14.1. */
  readonly webkitAudioContext?: AudioContextCtor;
}

export type UnlockTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
export type VisibilityDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

export interface WebAudioPort extends AudioPort {
  /** Creates or resumes the context inside a user gesture with a silent 1-sample buffer (Requirements 6.1, 6.7). */
  unlockSilently(): void;
}

/** silence() ramps a sounding tone to 0 this fast (RAMP_MS + 5 ms; Requirement 4.6 allows 100 ms). */
export const SILENCE_RAMP_MS = RAMP_MS + 5;
/** … and stops its oscillator this long after the silence time, once the gain is 0. */
export const SILENCE_STOP_MS = 20;

interface Tone {
  readonly osc: OscillatorNode;
  readonly gain: GainNode;
  /** Start and length in seconds. */
  readonly t0: number;
  readonly d: number;
  /** The oscillator's stop time in seconds. */
  readonly end: number;
}

/** The tone's scheduled gain at `at` (seconds): attack, hold and release of the Chime envelope. */
function envelopeAt(tone: Tone, at: number): number {
  const x = at - tone.t0;
  const ramp = RAMP_MS / 1000;
  if (x <= 0 || x >= tone.d) return 0;
  if (x < ramp) return (PEAK_GAIN * x) / ramp;
  if (x > tone.d - ramp) return (PEAK_GAIN * (tone.d - x)) / ramp;
  return PEAK_GAIN;
}

function silence(tones: readonly Tone[], at: number): void {
  for (const tone of tones) {
    try {
      const param = tone.gain.gain;
      param.cancelScheduledValues(at);
      if (tone.t0 < at) {
        // Hold the current envelope value, then ramp to 0 so the cut does not click.
        param.setValueAtTime(envelopeAt(tone, at), at);
        param.linearRampToValueAtTime(0, at + SILENCE_RAMP_MS / 1000);
        tone.osc.stop(Math.min(tone.end, at + SILENCE_STOP_MS / 1000));
      } else {
        // Not started yet: stopping at or before its start means it never sounds.
        param.setValueAtTime(0, at);
        tone.osc.stop(at);
      }
    } catch {
      // A node that cannot be changed any more is already silent.
    }
  }
}

export function webAudioPort(win: AudioWindow): WebAudioPort {
  let ctx: AudioContext | null = null;
  let unlocked = false;
  const listeners = new Set<(state: AudioState) => void>();

  const stateOf = (c: AudioContext | null): AudioState => {
    if (c === null) return 'none';
    const raw: string = c.state;
    // 'interrupted' is the iOS Safari value for a context paused by the system.
    return raw === 'running' || raw === 'suspended' || raw === 'interrupted' || raw === 'closed' ? raw : 'suspended';
  };

  const onStateChange = (): void => {
    const state = stateOf(ctx);
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // One listener must not stop the others.
      }
    }
  };

  const port: WebAudioPort = {
    ensureContext() {
      if (ctx !== null) return true; // at most one AudioContext per page load (Requirement 6.3)
      try {
        const Ctor = win.AudioContext ?? win.webkitAudioContext;
        if (Ctor === undefined) return false;
        ctx = new Ctor();
      } catch {
        return false;
      }
      try {
        ctx.addEventListener('statechange', onStateChange);
      } catch {
        // Without state events the Chime_Player still refills on its timer.
      }
      return true;
    },
    state: () => stateOf(ctx),
    now: () => (ctx === null ? null : ctx.currentTime * 1000),
    resume() {
      const c = ctx;
      if (c === null) return;
      try {
        // Not awaited; a rejection (closed context) is handled here (Requirement 6.8).
        Promise.resolve(c.resume()).catch(() => undefined);
      } catch {
        // resume() threw synchronously.
      }
    },
    onStateChange(listener) {
      const wrapped = (state: AudioState): void => listener(state);
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
    playChime(atMs): ChimeVoice {
      const c = ctx;
      if (c === null) throw new Error('No AudioContext');
      const start = atMs / 1000;
      const end = start + CHIME_END_MS / 1000;
      const ramp = RAMP_MS / 1000;
      const tones: Tone[] = [];
      try {
        for (const spec of TONES) {
          const t0 = start + spec.offsetMs / 1000;
          const d = spec.durationMs / 1000;
          const osc = c.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = spec.hz;
          const gain = c.createGain();
          gain.gain.setValueAtTime(0, t0);
          gain.gain.linearRampToValueAtTime(PEAK_GAIN, t0 + ramp);
          gain.gain.setValueAtTime(PEAK_GAIN, t0 + d - ramp);
          gain.gain.linearRampToValueAtTime(0, t0 + d);
          osc.connect(gain).connect(c.destination);
          // Drop the finished nodes from the audio graph.
          osc.onended = () => {
            try {
              osc.disconnect();
              gain.disconnect();
            } catch {
              // Already disconnected.
            }
          };
          osc.start(t0);
          tones.push({ osc, gain, t0, d, end });
          osc.stop(end);
        }
      } catch (error) {
        for (const tone of tones) {
          try {
            tone.osc.stop();
          } catch {
            // Never started.
          }
        }
        throw error;
      }
      return { silence: (at) => silence(tones, at / 1000) };
    },
    unlockSilently() {
      if (!port.ensureContext()) return;
      const c = ctx;
      if (c === null) return;
      if (stateOf(c) !== 'running') port.resume(); // Requirement 6.2
      if (unlocked) return;
      try {
        // A 1-sample buffer of zeros, straight to the destination, with no gain node (Requirement 6.7).
        const buffer = c.createBuffer(1, 1, c.sampleRate);
        const source = c.createBufferSource();
        source.buffer = buffer;
        source.connect(c.destination);
        source.start();
        unlocked = true;
      } catch {
        // The next gesture tries again.
      }
    },
  };
  return port;
}

const GESTURES = ['keydown', 'pointerdown', 'click'] as const;
const GESTURE_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };

/**
 * Permanent capture listeners that unlock audio inside every User_Gesture until the context runs
 * (Requirements 6.1, 6.2). They never call preventDefault or stopPropagation, so the gesture's own
 * handling, including Press_Event delivery, carries on (Requirement 6.8).
 */
export function installAudioUnlock(win: UnlockTarget, port: Pick<AudioPort, 'state'> & { unlockSilently(): void }): Unsubscribe {
  const onGesture = (): void => {
    try {
      if (port.state() !== 'running') port.unlockSilently();
    } catch {
      // The gesture continues to the input sources.
    }
  };
  for (const type of GESTURES) win.addEventListener(type, onGesture, GESTURE_OPTIONS);
  return () => {
    for (const type of GESTURES) win.removeEventListener(type, onGesture, GESTURE_OPTIONS);
  };
}

/** document.visibilityState and its change event. */
export function browserPageVisibility(doc: VisibilityDocument): PageVisibility {
  return {
    hidden: () => doc.visibilityState === 'hidden',
    onChange(listener) {
      const handler = (): void => listener();
      doc.addEventListener('visibilitychange', handler);
      return () => doc.removeEventListener('visibilitychange', handler);
    },
  };
}
