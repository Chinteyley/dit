/**
 * The Chime_Player (design "lib/safety/chime-player.ts", Requirements 4 to 6): plays the
 * Chime_Schedule on an injected audio port. Time comes only from the port's audio clock and
 * refills run only through the injected scheduler (Requirement 5.8), so tests drive it with
 * fakes. It never touches speech synthesis (Requirement 4.8).
 */
import type { Scheduler, Unsubscribe } from '@/lib/input';
import { CHIME_END_MS, chimeSchedule } from './chime-schedule';

export type AudioState = 'running' | 'suspended' | 'interrupted' | 'closed' | 'none';

/** Web Audio seam. Times are audio-clock milliseconds (AudioContext.currentTime × 1000). */
export interface AudioPort {
  /** Creates the single AudioContext if none exists. Returns false when unavailable or creation throws. Never throws. */
  ensureContext(): boolean;
  state(): AudioState;
  /** Audio clock in ms; null when no context exists. */
  now(): number | null;
  /** Calls resume() without awaiting; catches a throw and a rejected promise. Never throws. */
  resume(): void;
  onStateChange(listener: (state: AudioState) => void): Unsubscribe;
  /** Schedules one two-tone Chime at audio time `atMs`. Throws if Web Audio throws. */
  playChime(atMs: number): ChimeVoice;
}

export interface ChimeVoice {
  /** Ramps any sounding tone to 0 within RAMP_MS + 5 ms of `atMs`, and stops tones that start after `atMs` before they start. */
  silence(atMs: number): void;
}

export interface PageVisibility {
  hidden(): boolean;
  onChange(listener: () => void): Unsubscribe;
}

/** Chimes are scheduled this far ahead of the audio clock while the page is visible. */
export const LOOKAHEAD_VISIBLE_MS = 1500;
/** … and while it is hidden, which outlasts one-per-minute timer throttling (Requirement 4.5). */
export const LOOKAHEAD_HIDDEN_MS = 70_000;
export const REFILL_EVERY_MS = 250;
/** The sound-unavailable decision after start, on the scheduler (Requirement 6.5). */
export const SOUND_CHECK_MS = 1000;
/** A Chime due less than this far in the past still starts at once (Requirement 4.5). */
export const LATE_LIMIT_MS = 50;

export interface ChimePlayer {
  start(): void;
  stop(): void;
  /** The "Sound is unavailable on this device right now." note (Requirement 6.5). */
  soundUnavailable(): boolean;
  onSoundChange(listener: () => void): Unsubscribe;
}

interface Voice {
  readonly t: number;
  readonly voice: ChimeVoice;
}

/** One Alarm_Episode, from start() to stop(). */
interface Episode {
  readonly port: AudioPort | null;
  /** The alarm start time on the audio clock (Requirement 1.1). */
  s: number | null;
  /** Every Chime before this audio time has been requested. */
  filledTo: number | null;
  voices: Voice[];
  errored: boolean;
  refill: (() => void) | null;
  check: (() => void) | null;
  readonly unsubscribers: Unsubscribe[];
}

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function createChimePlayer(deps: {
  /** null until DitRoot attaches the browser port. */
  readonly audio: () => AudioPort | null;
  readonly scheduler: () => Scheduler | null;
  readonly page: () => PageVisibility | null;
}): ChimePlayer {
  /** The playing episode, or null while the alarm is idle or closing. */
  let episode: Episode | null = null;
  let note = false;
  const soundListeners = new Set<() => void>();

  const setNote = (value: boolean): void => {
    if (note === value) return;
    note = value;
    for (const listener of [...soundListeners]) {
      try {
        listener();
      } catch {
        // One listener must not stop the others.
      }
    }
  };

  const cancelTimers = (e: Episode): void => {
    e.refill?.();
    e.check?.();
    e.refill = null;
    e.check = null;
  };

  /** Requests every Chime from the last filled time up to the lookahead (design "fill()"). */
  const fill = (e: Episode): void => {
    const { port, s } = e;
    if (episode !== e || port === null || s === null || e.errored) return;
    if (attempt(() => port.state(), 'none') !== 'running') return;
    const now = attempt(() => port.now(), null);
    if (now === null) return;
    let from = e.filledTo ?? s;
    // Suspended or late: start from the first schedule time at or after now (Requirement 6.6).
    if (from < now - LATE_LIMIT_MS) from = now;
    const hidden = attempt(() => deps.page()?.hidden() ?? false, false);
    const to = now + (hidden ? LOOKAHEAD_HIDDEN_MS : LOOKAHEAD_VISIBLE_MS);
    // Becoming visible after a hidden fill: the far horizon already covers this window.
    if (to <= from) return;
    // Release Chimes that have finished, so a long alarm holds only the voices that can still sound.
    e.voices = e.voices.filter((v) => v.t + CHIME_END_MS > now);
    for (const t of chimeSchedule(s, from, to)) {
      try {
        e.voices.push({ t, voice: port.playChime(t) });
      } catch {
        // Requirement 4.7: no more Chimes this episode; the card stays.
        e.errored = true;
        cancelTimers(e);
        setNote(true);
        return;
      }
    }
    e.filledTo = to;
  };

  return {
    start() {
      if (episode !== null) return; // Requirement 4.9: one series per episode
      setNote(false); // Requirements 4.11, 6.9
      const port = deps.audio();
      const e: Episode = {
        port,
        s: null,
        filledTo: null,
        voices: [],
        errored: false,
        refill: null,
        check: null,
        unsubscribers: [],
      };
      episode = e;
      if (port === null || !attempt(() => port.ensureContext(), false)) {
        setNote(true); // Requirement 6.5: no AudioContext
        return;
      }
      const s = attempt(() => port.now(), null);
      if (s === null) {
        setNote(true);
        return;
      }
      e.s = s;
      e.unsubscribers.push(
        port.onStateChange((state) => {
          // Requirement 6.10: nothing plays while idle or closing; 6.6: running again removes the note.
          if (episode !== e || e.errored || state !== 'running') return;
          setNote(false);
          fill(e);
        }),
      );
      const page = deps.page();
      if (page !== null) e.unsubscribers.push(page.onChange(() => fill(e)));
      if (attempt(() => port.state(), 'none') !== 'running') attempt(() => port.resume(), undefined); // 6.4
      fill(e);
      if (e.errored) return;

      const scheduler = deps.scheduler();
      if (scheduler === null) {
        if (attempt(() => port.state(), 'none') !== 'running') setNote(true);
        return;
      }
      const loop = (): void => {
        e.refill = scheduler.schedule(REFILL_EVERY_MS, () => {
          e.refill = null;
          if (episode !== e || e.errored) return;
          fill(e);
          if (episode === e && !e.errored) loop();
        });
      };
      loop();
      e.check = scheduler.schedule(SOUND_CHECK_MS, () => {
        e.check = null;
        if (episode !== e) return;
        if (attempt(() => port.state(), 'none') !== 'running') setNote(true);
      });
    },

    stop() {
      const e = episode;
      if (e === null) return;
      episode = null;
      cancelTimers(e);
      for (const unsubscribe of e.unsubscribers.splice(0)) attempt(unsubscribe, undefined);
      const { port } = e;
      const stopAt = port === null ? null : attempt(() => port.now(), null);
      if (stopAt !== null) {
        // Requirement 4.6: silence what sounds, and cancel what has not started, at the stop time.
        for (const { voice } of e.voices) attempt(() => voice.silence(stopAt), undefined);
      }
      e.voices = [];
      setNote(false);
    },

    soundUnavailable: () => note,

    onSoundChange(listener) {
      const wrapped = (): void => listener();
      soundListeners.add(wrapped);
      return () => {
        soundListeners.delete(wrapped);
      };
    },
  };
}
