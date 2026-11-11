import { DEFAULT_MIN_PRESS, createDebouncer, validateMinPressDuration, type Debouncer, type DebounceState } from '../debounce';
import { err, ok, type PressEvent, type Result, type SettingError } from '../types';

export type BlinkFrame =
  | { readonly t: number; readonly left: number; readonly right: number }
  | { readonly t: number; readonly face: 'lost' };

/** Loose shape accepted at the adapter boundary; normalizeFrame applies Req 8.10. */
export interface RawBlinkFrame {
  readonly t: number;
  readonly left?: unknown;
  readonly right?: unknown;
  readonly face?: 'lost';
}

const isScore = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** A frame with a missing, non-finite or out-of-range score counts as face lost (Req 8.10). */
export function normalizeFrame(f: RawBlinkFrame): BlinkFrame {
  if (f.face === 'lost' || !isScore(f.left) || !isScore(f.right)) {
    return { t: f.t, face: 'lost' };
  }
  return { t: f.t, left: f.left, right: f.right };
}

export interface DetectorConfig {
  /** Both eyes count as closed at or above this score. Default 0.5. */
  readonly closeThreshold: number;
  /** Both eyes count as open below this score. Default 0.35. */
  readonly openThreshold: number;
  /** Shared with the Blink Debouncer. Default 200, valid 50 to 2000. */
  readonly minPressDuration: number;
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = Object.freeze({
  closeThreshold: 0.5,
  openThreshold: 0.35,
  minPressDuration: DEFAULT_MIN_PRESS.blink,
});

export type EyeState = 'open' | 'closed';
export type FaceStatus = 'active' | 'face-lost';

export interface DetectorOutput {
  /** Press_Events with source 'blink'. */
  readonly events: readonly PressEvent[];
  /** Non-null only when the face status changed (Req 8.16). */
  readonly face: FaceStatus | null;
}

export interface ThresholdError {
  readonly invalid: readonly ('closeThreshold' | 'openThreshold')[];
  readonly message: string;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Valid when both are finite and 0 < open < close ≤ 1 (Req 8.12, 8.13). `close` alone is invalid
 * when not finite or outside (0, 1]; `open` alone when not finite or ≤ 0; when each is valid alone
 * but open ≥ close, both are named.
 */
export function validateThresholds(
  close: unknown,
  open: unknown,
): Result<{ readonly close: number; readonly open: number }, ThresholdError> {
  const closeValid = isFiniteNumber(close) && close > 0 && close <= 1;
  const openValid = isFiniteNumber(open) && open > 0;
  if (closeValid && openValid) {
    return open < close
      ? ok({ close, open })
      : err({
          invalid: ['closeThreshold', 'openThreshold'],
          message: 'The open threshold must be below the close threshold.',
        });
  }
  const invalid: ('closeThreshold' | 'openThreshold')[] = [];
  const parts: string[] = [];
  if (!closeValid) {
    invalid.push('closeThreshold');
    parts.push('the close threshold must be a number above 0 and at most 1');
  }
  if (!openValid) {
    invalid.push('openThreshold');
    parts.push('the open threshold must be a number above 0 and below the close threshold');
  }
  const sentence = parts.join(', and ');
  return err({ invalid, message: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.` });
}

/** Read-only snapshot of a detector, for tests and replays. */
export interface DetectorState {
  readonly eye: EyeState;
  readonly lastT: number | null;
  readonly lastFace: FaceStatus;
  readonly close: number;
  readonly open: number;
  readonly debounce: DebounceState;
}

export interface BlinkDetector {
  push(frame: RawBlinkFrame): DetectorOutput;
  /**
   * Page hidden, stop or failure: discard any Closure, set Eye_State open and expect the next start
   * to report 'active' again. Drops a pending press; the source ends a Held press with forceUp first.
   */
  reset(): void;
  /** The single Blink Debouncer. */
  readonly debouncer: Debouncer;
  eyeState(): EyeState;
  setThresholds(close: unknown, open: unknown): Result<{ readonly close: number; readonly open: number }, ThresholdError>;
  setMinPressDuration(value: unknown): Result<number, SettingError>;
  state(): DetectorState;
}

const NOTHING: DetectorOutput = Object.freeze({ events: Object.freeze([]) as readonly PressEvent[], face: null });

/**
 * Hysteresis and face status over Blink_Frames. Minimum closure is the Blink Debouncer's job: a
 * closing frame calls rawDown(t), each accepted frame during the Closure calls advance(t), and the
 * frame that ends it (open or face lost) calls advance(t) then rawUp(t).
 */
export function createBlinkDetector(
  config: Partial<DetectorConfig> = {},
): Result<BlinkDetector, readonly (SettingError | ThresholdError)[]> {
  const wanted = { ...DEFAULT_DETECTOR_CONFIG, ...config };
  const errors: (SettingError | ThresholdError)[] = [];
  const min = validateMinPressDuration('blink', wanted.minPressDuration);
  if (!min.ok) errors.push(min.error);
  const thresholds = validateThresholds(wanted.closeThreshold, wanted.openThreshold);
  if (!thresholds.ok) errors.push(thresholds.error);
  if (!min.ok || !thresholds.ok) {
    return err(errors);
  }

  const debouncer = createDebouncer('blink', min.value);
  let { close, open } = thresholds.value;
  let eye: EyeState = 'open';
  let lastT: number | null = null;
  // The Blink_Source reports 'active' once ready, so the first valid frame must not report it again.
  let lastFace: FaceStatus = 'active';

  const push = (raw: RawBlinkFrame): DetectorOutput => {
    // Req 8.11: stale or non-finite frames change nothing; an equal t is accepted.
    if (!Number.isFinite(raw.t) || (lastT !== null && raw.t < lastT)) {
      return NOTHING;
    }
    lastT = raw.t;
    const frame = normalizeFrame(raw);
    const events: PressEvent[] = [];
    let face: FaceStatus | null = null;

    if ('face' in frame) {
      // Req 8.7: losing the face ends a Closure at this frame, by the usual duration rules.
      if (eye === 'closed') {
        events.push(...debouncer.advance(frame.t), ...debouncer.rawUp(frame.t));
        eye = 'open';
      }
      if (lastFace !== 'face-lost') {
        lastFace = 'face-lost';
        face = 'face-lost';
      }
      return { events, face };
    }

    // Req 8.9: the first valid frame after a loss reports 'active', from Eye_State open.
    if (lastFace === 'face-lost') {
      lastFace = 'active';
      face = 'active';
    }
    if (eye === 'open') {
      if (Math.min(frame.left, frame.right) >= close) {
        eye = 'closed';
        events.push(...debouncer.rawDown(frame.t));
      }
    } else {
      events.push(...debouncer.advance(frame.t));
      if (Math.max(frame.left, frame.right) < open) {
        events.push(...debouncer.rawUp(frame.t));
        eye = 'open';
      }
    }
    return { events, face };
  };

  return ok({
    push,
    reset() {
      debouncer.cancel();
      eye = 'open';
      lastFace = 'active';
    },
    debouncer,
    eyeState: () => eye,
    setThresholds(nextClose, nextOpen) {
      const result = validateThresholds(nextClose, nextOpen);
      if (result.ok) {
        ({ close, open } = result.value);
      }
      return result;
    },
    setMinPressDuration: (value) => debouncer.setMinPressDuration(value),
    state: () => ({ eye, lastT, lastFace, close, open, debounce: debouncer.state() }),
  });
}
