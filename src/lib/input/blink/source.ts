import type { Clock, Scheduler } from '../clock';
import { createSourceCore, type PageLifecycle } from '../source-base';
import {
  isFailureStatus,
  type FailureStatus,
  type PressSource,
  type Result,
  type SettingError,
  type Unsubscribe,
} from '../types';
import {
  DEFAULT_DETECTOR_CONFIG,
  createBlinkDetector,
  type BlinkDetector,
  type DetectorConfig,
  type RawBlinkFrame,
  type ThresholdError,
} from './detector';

export interface CameraTrack {
  stop(): void;
  onEnded(fn: () => void): Unsubscribe;
  readonly readyState: 'live' | 'ended';
}

export interface CameraStream {
  readonly tracks: readonly CameraTrack[];
}

export interface FrameLoop {
  stop(): void;
}

export interface Landmarker {
  /** Blendshape scores of the first face, or null when no face (Req 9.4). Throws on internal failure. */
  detect(frameT: number): { readonly left: number | undefined; readonly right: number | undefined } | null;
  close(): void;
}

export interface BlinkDevices {
  /** getUserMedia is a function and WebAssembly exists (Req 10.1). */
  isSupported(): boolean;
  /** Rejects with an error that has a `name` (getUserMedia error names). */
  openCamera(): Promise<CameraStream>;
  /** Dynamic import of MediaPipe plus the self-hosted assets. */
  loadLandmarker(): Promise<Landmarker>;
  startFrames(stream: CameraStream, onFrame: (t: number) => void): FrameLoop;
}

export interface BlinkSourceDeps {
  readonly devices: BlinkDevices;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly page: PageLifecycle;
  readonly config?: Partial<DetectorConfig>;
}

export interface BlinkSource extends PressSource {
  setThresholds(close: unknown, open: unknown): Result<{ readonly close: number; readonly open: number }, ThresholdError>;
  setMinPressDuration(value: unknown): Result<number, SettingError>;
}

/** The Face_Landmarker must be ready this long after the camera stream opens (Req 9.11). */
export const LANDMARKER_READY_LIMIT_MS = 30_000;

/** getUserMedia error names (Req 10.2 to 10.4). */
export function cameraFailureStatus(error: unknown): FailureStatus {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission-denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no-camera';
    default:
      return 'error';
  }
}

function makeDetector(config: Partial<DetectorConfig> | undefined): BlinkDetector {
  const made = createBlinkDetector(config);
  if (made.ok) return made.value;
  const fallback = createBlinkDetector(DEFAULT_DETECTOR_CONFIG);
  if (!fallback.ok) throw new Error('the default blink detector configuration is invalid');
  return fallback.value;
}

/** Runs every cleanup step even when one throws. */
function quietly(step: () => void): void {
  try {
    step();
  } catch {
    // Releasing a device must never stop the others from being released.
  }
}

/**
 * The opt-in webcam source: a status machine over injected camera and model devices. Every async
 * step checks an attempt token; stop(), hide, failure and a new start() each change it, so late
 * results are disposed of with no status change (Req 9.8, 10.5). Nothing here throws or leaves a
 * rejected promise unhandled (Req 10.10).
 */
export function createBlinkSource(deps: BlinkSourceDeps): BlinkSource {
  const { devices } = deps;
  const detector = makeDetector(deps.config);
  const core = createSourceCore('blink', deps.clock, null, detector.debouncer);

  let attempt = 0;
  let resumeOnVisible = false;
  let stream: CameraStream | null = null;
  let landmarker: Landmarker | null = null;
  let loop: FrameLoop | null = null;
  let cancelTimer: (() => void) | null = null;
  let trackListeners: Unsubscribe[] = [];
  let pageListeners: Unsubscribe[] = [];

  const stopStream = (s: CameraStream): void => {
    for (const track of s.tracks) quietly(() => track.stop());
  };

  /** Stops frames and tracks and closes the Landmarker, then invalidates every pending async step. */
  const release = (): void => {
    const frames = loop;
    const camera = stream;
    const model = landmarker;
    loop = null;
    stream = null;
    landmarker = null;
    attempt++;
    cancelTimer?.();
    cancelTimer = null;
    for (const remove of trackListeners) quietly(remove);
    trackListeners = [];
    if (frames !== null) quietly(() => frames.stop());
    if (camera !== null) stopStream(camera);
    if (model !== null) quietly(() => model.close());
  };

  /** Ends or discards the press and resets the detector before anything else (Req 7.2, 9.9, 10.7). */
  const endPress = (): void => {
    core.endPress();
    detector.reset();
  };

  /** Req 10.6, 10.7: the press ends and the camera is released before the failure is reported. */
  const fail = (status: FailureStatus): void => {
    endPress();
    release();
    resumeOnVisible = false;
    core.setStatus(status);
  };

  const onFrame = (token: number, t: number): void => {
    if (token !== attempt || landmarker === null) return;
    // Req 9.2: nothing is processed, and no Press_Event appears, while 'starting'.
    if (core.status() !== 'active' && core.status() !== 'face-lost') return;
    let scores: ReturnType<Landmarker['detect']>;
    try {
      scores = landmarker.detect(t);
    } catch {
      fail('error');
      return;
    }
    const frame: RawBlinkFrame = scores === null ? { t, face: 'lost' } : { t, left: scores.left, right: scores.right };
    const out = detector.push(frame);
    core.feed(() => out.events);
    // Req 9.12, 9.13: the camera stays open while the face is lost.
    if (out.face !== null && token === attempt) core.setStatus(out.face);
  };

  /** Runs an async continuation; an unexpected throw fails the attempt it belongs to. */
  const guarded = (token: number, step: () => void): void => {
    try {
      step();
    } catch {
      if (token === attempt) fail('error');
    }
  };

  const onLandmarker = (token: number, model: Landmarker): void => {
    if (token !== attempt || stream === null) {
      // Late model after a timeout, stop or hide: closed at once with no status change (Req 10.5).
      quietly(() => model.close());
      return;
    }
    cancelTimer?.();
    cancelTimer = null;
    landmarker = model;
    try {
      loop = devices.startFrames(stream, (t) => onFrame(token, t));
    } catch {
      fail('error');
      return;
    }
    core.setStatus('active');
  };

  const onCamera = (token: number, opened: CameraStream): void => {
    if (token !== attempt) {
      // Late camera after stop or hide: its tracks stop as soon as it opens (Req 9.8).
      stopStream(opened);
      return;
    }
    stream = opened;
    trackListeners = opened.tracks.map((track) =>
      track.onEnded(() => {
        // Req 10.4: a track that ends by itself is a failure; our own stop and a hidden page are not.
        if (token === attempt && !deps.page.isHidden()) fail('error');
      }),
    );
    // Req 9.11: the 30 s limit starts once the stream is open, so the permission prompt never counts.
    cancelTimer = deps.scheduler.schedule(LANDMARKER_READY_LIMIT_MS, () => {
      cancelTimer = null;
      if (token === attempt) fail('error');
    });
    let loading: Promise<Landmarker>;
    try {
      loading = devices.loadLandmarker();
    } catch {
      fail('error');
      return;
    }
    loading.then(
      (model) => guarded(token, () => onLandmarker(token, model)),
      () => guarded(token, () => {
        if (token === attempt) fail('error');
      }),
    );
  };

  /** Steps 1 to 6 of the start sequence: camera first, then the model (no download without a camera). */
  const begin = (): void => {
    release();
    const token = attempt;
    let supported = false;
    quietly(() => {
      supported = devices.isSupported();
    });
    if (!supported) {
      // Req 10.1: 'unsupported' without 'starting', and no camera or asset request.
      core.setStatus('unsupported');
      return;
    }
    core.setStatus('starting');
    let opening: Promise<CameraStream>;
    try {
      opening = devices.openCamera();
    } catch (error) {
      fail(cameraFailureStatus(error));
      return;
    }
    opening.then(
      (opened) => guarded(token, () => onCamera(token, opened)),
      (error: unknown) => guarded(token, () => {
        if (token === attempt) fail(cameraFailureStatus(error));
      }),
    );
  };

  const onHidden = (): void => {
    const status = core.status();
    if (status === 'off' || isFailureStatus(status)) return;
    // Req 9.9: synchronous, so the camera is off well within 500 ms; the status stays as it was.
    endPress();
    release();
    resumeOnVisible = true;
  };

  const onVisible = (): void => {
    if (!resumeOnVisible) return;
    resumeOnVisible = false;
    const status = core.status();
    // Req 10.8: a failure status never reopens the camera.
    if (status === 'off' || isFailureStatus(status)) return;
    begin();
  };

  return {
    kind: 'blink',
    start() {
      const status = core.status();
      if (status !== 'off' && !isFailureStatus(status)) return;
      resumeOnVisible = false;
      if (pageListeners.length === 0) {
        // The Blink_Source ignores window blur (Req 7.6).
        pageListeners = [deps.page.onHidden(onHidden), deps.page.onVisible(onVisible)];
      }
      begin();
    },
    stop() {
      if (core.status() === 'off') return;
      endPress();
      release();
      resumeOnVisible = false;
      for (const remove of pageListeners) remove();
      pageListeners = [];
      core.setStatus('off');
    },
    status: core.status,
    ...core.subscribers,
    setThresholds: (close, open) => detector.setThresholds(close, open),
    setMinPressDuration: (value) => detector.setMinPressDuration(value),
  };
}
