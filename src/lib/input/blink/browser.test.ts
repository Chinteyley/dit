import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManualClock, createManualScheduler } from '../clock';
import { createFakePage, flushPromises, plain } from '../test-support';
import type { PressEvent, SourceStatus } from '../types';
import { DEFAULT_ASSET_BASE, browserBlinkDevices, disableUsageMetrics } from './browser';
import { createBlinkSource } from './source';

/** State shared with the hoisted module mock. */
const mp = vi.hoisted(() => {
  const state = {
    imports: 0,
    gpuFails: false,
    cpuFails: false,
    options: [] as unknown[],
    filesetBases: [] as string[],
    detectCalls: [] as number[],
    result: { faceBlendshapes: [] as { categories: { categoryName: string; score: number }[] }[] },
    closes: 0,
    logger: null as null | { error?: unknown; closes: number; flush(): void; close(): void },
  };
  return state;
});

vi.mock('@mediapipe/tasks-vision', () => {
  mp.imports++;
  const makeLogger = () => {
    const logger = {
      closes: 0,
      error: undefined as unknown,
      flush(this: { error?: unknown }, _done?: unknown, failed?: (code: string) => void) {
        if (this.error) failed?.('net-send-failed');
      },
      close() {
        logger.closes++;
      },
    };
    return logger;
  };
  return {
    FilesetResolver: {
      forVisionTasks: async (base: string) => {
        mp.filesetBases.push(base);
        return { wasmLoaderPath: `${base}/vision_wasm_internal.js`, wasmBinaryPath: `${base}/vision_wasm_internal.wasm` };
      },
    },
    FaceLandmarker: {
      createFromOptions: async (_fileset: unknown, options: { baseOptions?: { delegate?: string } }) => {
        mp.options.push(options);
        const delegate = options.baseOptions?.delegate;
        if ((delegate === 'GPU' && mp.gpuFails) || (delegate === 'CPU' && mp.cpuFails)) {
          throw new Error(`${delegate} unavailable`);
        }
        const logger = makeLogger();
        mp.logger = logger;
        return {
          usage: { logger },
          detectForVideo: (_video: unknown, t: number) => {
            mp.detectCalls.push(t);
            return mp.result;
          },
          close: () => {
            mp.closes++;
          },
        };
      },
    },
  };
});

interface FakeMediaTrack {
  readyState: 'live' | 'ended';
  stop(): void;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
  fire(): void;
}

function fakeTrack(): FakeMediaTrack {
  const listeners = new Set<() => void>();
  const track: FakeMediaTrack = {
    readyState: 'live',
    stop() {
      track.readyState = 'ended';
    },
    addEventListener: (_type, fn) => void listeners.add(fn),
    removeEventListener: (_type, fn) => void listeners.delete(fn),
    fire: () => [...listeners].forEach((fn) => fn()),
  };
  return track;
}

interface FakeVideo {
  muted: boolean;
  playsInline: boolean;
  srcObject: unknown;
  readyState: number;
  attributes: Record<string, string>;
  playFails: boolean;
  callbacks: Map<number, (now: number, meta: { captureTime?: number; expectedDisplayTime?: number }) => void>;
  setAttribute(name: string, value: string): void;
  play(): Promise<void>;
  pause(): void;
  requestVideoFrameCallback?: (cb: (now: number, meta: { captureTime?: number; expectedDisplayTime?: number }) => void) => number;
  cancelVideoFrameCallback(handle: number): void;
  /** Delivers one video frame to every waiting callback. */
  present(now: number, meta: { captureTime?: number; expectedDisplayTime?: number }): void;
}

function fakeVideo(withVideoFrameCallback = true): FakeVideo {
  let next = 1;
  const video: FakeVideo = {
    muted: false,
    playsInline: false,
    srcObject: null,
    readyState: 4,
    attributes: {},
    playFails: false,
    callbacks: new Map(),
    setAttribute: (name, value) => {
      video.attributes[name] = value;
    },
    play: async () => {
      if (video.playFails) throw new DOMException('blocked', 'NotAllowedError');
    },
    pause: () => undefined,
    cancelVideoFrameCallback: (handle) => void video.callbacks.delete(handle),
    present(now, meta) {
      const waiting = [...video.callbacks.values()];
      video.callbacks.clear();
      waiting.forEach((cb) => cb(now, meta));
    },
  };
  if (withVideoFrameCallback) {
    video.requestVideoFrameCallback = (cb) => {
      const handle = next++;
      video.callbacks.set(handle, cb);
      return handle;
    };
  }
  return video;
}

let tracks: FakeMediaTrack[] = [];
let video: FakeVideo = fakeVideo();
let getUserMedia = vi.fn();
let createElement = vi.fn();

beforeEach(() => {
  Object.assign(mp, {
    imports: mp.imports,
    gpuFails: false,
    cpuFails: false,
    options: [],
    filesetBases: [],
    detectCalls: [],
    result: { faceBlendshapes: [] },
    closes: 0,
    logger: null,
  });
  tracks = [fakeTrack()];
  video = fakeVideo();
  getUserMedia = vi.fn(async () => ({
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
  }));
  createElement = vi.fn(() => video);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('document', { createElement });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const blendshapes = (left?: number, right?: number) => ({
  faceBlendshapes: [
    {
      categories: [
        ...(left === undefined ? [] : [{ categoryName: 'eyeBlinkLeft', score: left }]),
        ...(right === undefined ? [] : [{ categoryName: 'eyeBlinkRight', score: right }]),
        { categoryName: 'jawOpen', score: 0.2 },
      ],
    },
  ],
});

describe('browserBlinkDevices', () => {
  // Runs first: importing ./browser above must not have loaded the MediaPipe module.
  it('requests no camera and imports no MediaPipe code until asked (Req 9.1)', async () => {
    expect(mp.imports).toBe(0);
    const devices = browserBlinkDevices();
    expect(devices.isSupported()).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
    expect(mp.imports).toBe(0);

    await devices.openCamera();
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    expect(mp.imports).toBe(0);
    await devices.loadLandmarker();
    expect(mp.imports).toBe(1);
    expect(mp.filesetBases).toHaveLength(1);
  });

  it('is unsupported without getUserMedia or WebAssembly (Req 10.1)', () => {
    vi.stubGlobal('navigator', { mediaDevices: undefined });
    expect(browserBlinkDevices().isSupported()).toBe(false);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('WebAssembly', undefined);
    expect(browserBlinkDevices().isSupported()).toBe(false);
  });

  it('plays the stream in an off-DOM muted inline video', async () => {
    await browserBlinkDevices().openCamera();
    expect(createElement).toHaveBeenCalledExactlyOnceWith('video');
    expect(video).toMatchObject({ muted: true, playsInline: true, attributes: { playsinline: '' } });
    expect(video.srcObject).not.toBeNull();
  });

  it('stops the tracks and fails without a permission name when playback cannot start', async () => {
    video.playFails = true;
    await expect(browserBlinkDevices().openCamera()).rejects.toMatchObject({ name: 'PlaybackError' });
    expect(tracks[0]?.readyState).toBe('ended');
  });

  it('loads only same-origin assets, in VIDEO mode with blendshapes, GPU first (Req 9.3, 9.4)', async () => {
    await browserBlinkDevices().loadLandmarker();
    expect(DEFAULT_ASSET_BASE).toBe('/mediapipe/1.2.2');
    expect(mp.filesetBases).toStrictEqual(['/mediapipe/1.2.2/wasm']);
    expect(mp.options).toStrictEqual([
      {
        baseOptions: { modelAssetPath: '/mediapipe/1.2.2/face_landmarker.task', delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
      },
    ]);
  });

  it('retries once on the CPU with the same paths, and has no other fallback', async () => {
    mp.gpuFails = true;
    await browserBlinkDevices({ assetBase: '/assets/mp' }).loadLandmarker();
    expect(mp.options.map((o) => (o as { baseOptions: unknown }).baseOptions)).toStrictEqual([
      { modelAssetPath: '/assets/mp/face_landmarker.task', delegate: 'GPU' },
      { modelAssetPath: '/assets/mp/face_landmarker.task', delegate: 'CPU' },
    ]);

    mp.options = [];
    mp.cpuFails = true;
    await expect(browserBlinkDevices().loadLandmarker()).rejects.toThrow('CPU unavailable');
    expect(mp.options).toHaveLength(2);
    expect(mp.filesetBases.every((base) => base.startsWith('/'))).toBe(true);
  });

  it('switches off MediaPipe usage metrics on the new task', async () => {
    await browserBlinkDevices().loadLandmarker();
    expect(mp.logger?.error).toBeInstanceOf(Error);
    expect(mp.logger?.closes).toBe(1);
  });

  it("reads the first face's eye scores, and reports no face or a missing score (Req 9.4)", async () => {
    const devices = browserBlinkDevices();
    const stream = await devices.openCamera();
    const landmarker = await devices.loadLandmarker();
    const loop = devices.startFrames(stream, () => undefined);

    mp.result = blendshapes(0.7, 0.8);
    expect(landmarker.detect(10)).toStrictEqual({ left: 0.7, right: 0.8 });
    mp.result = blendshapes(0.7);
    expect(landmarker.detect(20)).toStrictEqual({ left: 0.7, right: undefined });
    mp.result = { faceBlendshapes: [] };
    expect(landmarker.detect(30)).toBeNull();

    // MediaPipe needs increasing timestamps: a repeated or older frame is not sent to it.
    expect(landmarker.detect(30)).toBeNull();
    expect(landmarker.detect(25)).toBeNull();
    expect(mp.detectCalls).toStrictEqual([10, 20, 30]);
    loop.stop();
    expect(landmarker.detect(40)).toBeNull();
    landmarker.close();
    expect(mp.closes).toBe(1);
  });

  it('passes frame capture times through and skips non-increasing ones (Req 9.5)', async () => {
    const devices = browserBlinkDevices();
    const stream = await devices.openCamera();
    const seen: number[] = [];
    const loop = devices.startFrames(stream, (t) => seen.push(t));
    video.present(1000, { captureTime: 990, expectedDisplayTime: 1005 });
    video.present(1033, { expectedDisplayTime: 1040 });
    video.present(1066, {});
    video.present(1070, { captureTime: 1050 });
    video.present(1100, { captureTime: 1050 });
    expect(seen).toStrictEqual([990, 1040, 1066]);
    loop.stop();
    expect(video.callbacks.size).toBe(0);
    video.present(2000, { captureTime: 2000 });
    expect(seen).toHaveLength(3);
  });

  it('falls back to animation frames without requestVideoFrameCallback', async () => {
    video = fakeVideo(false);
    createElement.mockImplementation(() => video);
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    let now = 500;
    vi.stubGlobal('performance', { now: () => (now += 1) });
    const devices = browserBlinkDevices();
    const stream = await devices.openCamera();
    const seen: number[] = [];
    const loop = devices.startFrames(stream, (t) => seen.push(t));
    frames.shift()?.();
    frames.shift()?.();
    expect(seen).toStrictEqual([501, 502]);
    loop.stop();
    frames.shift()?.();
    expect(seen).toHaveLength(2);
  });

  it('falls back to animation frames when video frame callbacks never arrive', async () => {
    vi.useFakeTimers();
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const devices = browserBlinkDevices();
    const stream = await devices.openCamera();
    const seen: number[] = [];
    devices.startFrames(stream, (t) => seen.push(t));
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(video.callbacks.size).toBe(0);
    expect(frames).toHaveLength(1);
  });

  it('turns every track off when the source stops (Req 9.7)', async () => {
    const clock = createManualClock(0);
    const source = createBlinkSource({
      devices: browserBlinkDevices(),
      clock: clock.now,
      scheduler: createManualScheduler(clock.now),
      page: createFakePage(),
    });
    const statuses: SourceStatus[] = [];
    const presses: PressEvent[] = [];
    source.onStatus((status) => statuses.push(status));
    source.onPress((event) => presses.push(event));
    source.start();
    await flushPromises();
    await flushPromises();
    expect(statuses).toStrictEqual(['starting', 'active']);

    mp.result = blendshapes(0.9, 0.9);
    video.present(100, { captureTime: 100 });
    video.present(400, { captureTime: 400 });
    expect(plain(presses)).toStrictEqual([{ kind: 'down', t: 100, source: 'blink' }]);

    source.stop();
    expect(tracks.every((track) => track.readyState === 'ended')).toBe(true);
    expect(video.srcObject).toBeNull();
    expect(mp.closes).toBe(1);
    expect(statuses).toStrictEqual(['starting', 'active', 'off']);
  });
});

describe('disableUsageMetrics', () => {
  it('finds nothing to switch off on an object without a logger', () => {
    expect(disableUsageMetrics({ a: { close: () => undefined, flush: () => undefined }, b: 3 })).toBe(false);
  });

  it('still matches the usage logger in the installed @mediapipe/tasks-vision bundle', () => {
    // If an upgrade changes the logger, this fails so its privacy handling is reviewed again.
    const bundle = readFileSync(
      fileURLToPath(new URL('../../../../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs', import.meta.url)),
      'utf8',
    );
    expect(bundle).toContain('if(this.error)e?.("net-send-failed")');
    expect(bundle).toContain('close(){void 0!==this.h&&(clearInterval(this.h),this.h=void 0),this.flush()}');
    expect(bundle).toContain('.error||t.i.push(e)');
  });
});
