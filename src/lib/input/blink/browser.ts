/**
 * Browser devices for the Blink_Source: the camera, an off-DOM video element, the frame loop and
 * the lazily imported MediaPipe Face Landmarker. With src/lib/input/browser.ts, the only file in
 * the input layer that reads browser globals, and the only file that loads @mediapipe/tasks-vision
 * at runtime (through `await import()`, after the user turns blink input on).
 *
 * Privacy (Req 9.6, 11.7): frames, landmarks and blendshape scores stay in memory on this device.
 * Nothing here logs, stores or sends them, and every MediaPipe asset is same-origin (Req 9.3).
 */
import type { FaceLandmarker, FaceLandmarkerOptions } from '@mediapipe/tasks-vision';
import type { BlinkDevices, CameraStream, CameraTrack, FrameLoop, Landmarker } from './source';

/** Same-origin, versioned asset path; scripts/mediapipe-assets.ts fills it on install. */
export const DEFAULT_ASSET_BASE = '/mediapipe/1.2.2';

/** If requestVideoFrameCallback has not fired by then, frames come from requestAnimationFrame instead. */
const VIDEO_FRAME_CALLBACK_GRACE_MS = 1000;

/** HTMLMediaElement.HAVE_CURRENT_DATA: the video has a frame to read. */
const HAVE_CURRENT_DATA = 2;

interface UsageLogger {
  close(): void;
  flush(...args: unknown[]): void;
}

function isUsageLogger(value: unknown): value is UsageLogger {
  if (typeof value !== 'object' || value === null) return false;
  const flush: unknown = Reflect.get(value, 'flush');
  const close: unknown = Reflect.get(value, 'close');
  // The 1.2.2 logger's flush() reports this code when it does not send.
  return typeof flush === 'function' && typeof close === 'function' && String(flush).includes('net-send-failed');
}

/**
 * @mediapipe/tasks-vision 1.2.2 creates a usage logger with every task. It queues usage metrics
 * (task name, running mode, platform, latency) and POSTs them to a Google endpoint every 60 s and
 * on close(). Dit makes no third-party requests, so the logger is switched off as soon as the task
 * exists: setting its `error` field makes flush() send nothing, and close() stops its timer.
 * blink/browser.test.ts checks the installed bundle still has this shape. Returns whether a logger
 * was found.
 */
export function disableUsageMetrics(task: object): boolean {
  let found = false;
  for (const owned of Object.values(task)) {
    if (typeof owned !== 'object' || owned === null) continue;
    for (const candidate of Object.values(owned)) {
      if (!isUsageLogger(candidate)) continue;
      Reflect.set(candidate, 'error', new Error('usage metrics are disabled'));
      candidate.close();
      found = true;
    }
  }
  return found;
}

function wrapTrack(track: MediaStreamTrack, video: HTMLVideoElement, media: MediaStream): CameraTrack {
  return {
    stop() {
      track.stop();
      if (video.srcObject === media && media.getTracks().every((t) => t.readyState === 'ended')) {
        video.pause();
        video.srcObject = null;
      }
    },
    onEnded(fn) {
      const handler = (): void => fn();
      track.addEventListener('ended', handler);
      return () => track.removeEventListener('ended', handler);
    },
    get readyState() {
      return track.readyState;
    },
  };
}

export function browserBlinkDevices(opts: { readonly assetBase?: string } = {}): BlinkDevices {
  const assetBase = opts.assetBase ?? DEFAULT_ASSET_BASE;
  const videos = new WeakMap<CameraStream, HTMLVideoElement>();
  /** The video of the running frame loop; detect() reads frames from it. */
  let activeVideo: HTMLVideoElement | null = null;

  return {
    isSupported: () =>
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof WebAssembly === 'object',

    async openCamera() {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      // Never appended to the page and never shown by this module.
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.srcObject = media;
      try {
        await video.play();
      } catch {
        for (const track of media.getTracks()) track.stop();
        video.srcObject = null;
        // Not a camera permission problem: reported as a plain error status.
        throw Object.assign(new Error('The camera video could not start.'), { name: 'PlaybackError' });
      }
      const stream: CameraStream = { tracks: media.getVideoTracks().map((track) => wrapTrack(track, video, media)) };
      videos.set(stream, video);
      return stream;
    },

    async loadLandmarker(): Promise<Landmarker> {
      const { FilesetResolver, FaceLandmarker: FaceLandmarkerTask } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks(`${assetBase}/wasm`);
      const options = (delegate: 'GPU' | 'CPU'): FaceLandmarkerOptions => ({
        baseOptions: { modelAssetPath: `${assetBase}/face_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
      let task: FaceLandmarker;
      try {
        task = await FaceLandmarkerTask.createFromOptions(vision, options('GPU'));
      } catch {
        // One CPU retry; there is no other origin to fall back to (Req 9.3).
        task = await FaceLandmarkerTask.createFromOptions(vision, options('CPU'));
      }
      disableUsageMetrics(task);

      let lastT = -Infinity;
      let last: ReturnType<Landmarker['detect']> = null;
      return {
        detect(frameT) {
          const video = activeVideo;
          if (video === null) return null;
          // MediaPipe needs strictly increasing timestamps; a repeated frame keeps the last answer.
          if (!(frameT > lastT)) return last;
          lastT = frameT;
          const result = task.detectForVideo(video, frameT);
          const categories = result.faceBlendshapes[0]?.categories;
          if (categories === undefined) {
            last = null;
            return null;
          }
          const score = (name: string): number | undefined =>
            categories.find((category) => category.categoryName === name)?.score;
          last = { left: score('eyeBlinkLeft'), right: score('eyeBlinkRight') };
          return last;
        },
        close() {
          task.close();
        },
      };
    },

    startFrames(stream, onFrame): FrameLoop {
      const video = videos.get(stream);
      if (video === undefined) return { stop: () => undefined };
      activeVideo = video;
      let stopped = false;
      let lastT = -Infinity;
      let videoFrameHandle: number | null = null;
      let animationHandle: number | null = null;
      let grace: ReturnType<typeof setTimeout> | null = null;

      // Frames go to the detector in capture order, each stamped once (Req 9.5).
      const emit = (t: number): void => {
        if (stopped || !Number.isFinite(t) || t <= lastT) return;
        lastT = t;
        onFrame(t);
      };

      const animationFrames = (): void => {
        const tick = (): void => {
          if (stopped) return;
          if (video.readyState >= HAVE_CURRENT_DATA) emit(performance.now());
          if (!stopped) animationHandle = requestAnimationFrame(tick);
        };
        animationHandle = requestAnimationFrame(tick);
      };

      if (typeof video.requestVideoFrameCallback === 'function') {
        const step = (now: number, meta: VideoFrameCallbackMetadata): void => {
          if (grace !== null) {
            clearTimeout(grace);
            grace = null;
          }
          // All three values are in the performance.now() time base.
          emit(meta.captureTime ?? meta.expectedDisplayTime ?? now);
          if (!stopped) videoFrameHandle = video.requestVideoFrameCallback(step);
        };
        videoFrameHandle = video.requestVideoFrameCallback(step);
        grace = setTimeout(() => {
          grace = null;
          if (stopped || lastT !== -Infinity) return;
          if (videoFrameHandle !== null) video.cancelVideoFrameCallback(videoFrameHandle);
          videoFrameHandle = null;
          animationFrames();
        }, VIDEO_FRAME_CALLBACK_GRACE_MS);
      } else {
        animationFrames();
      }

      return {
        stop() {
          stopped = true;
          if (grace !== null) clearTimeout(grace);
          if (videoFrameHandle !== null) video.cancelVideoFrameCallback(videoFrameHandle);
          if (animationHandle !== null) cancelAnimationFrame(animationHandle);
          grace = null;
          videoFrameHandle = null;
          animationHandle = null;
          if (activeVideo === video) activeVideo = null;
        },
      };
    },
  };
}
