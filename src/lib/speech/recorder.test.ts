import { afterEach, describe, expect, it, vi } from 'vitest';
import { recorderSpeechInput, type CaptureWindow } from './recorder';
import { wavDurationMs } from '@/lib/transcribe/audio';

function rig() {
  vi.useFakeTimers();
  let energy = 0;
  const stopTrack = vi.fn();
  const track = { stop: stopTrack, onended: null as (() => void) | null };
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ text: 'Do you need anything?' }));
  const close = vi.fn(async () => undefined);
  class Context {
    resume = async () => undefined;
    close = close;
    decodeAudioData = async () => ({
      duration: 0.25, numberOfChannels: 1, sampleRate: 16000,
      getChannelData: () => new Float32Array(4000),
    });
    createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
    createAnalyser = () => ({
      fftSize: 2048, disconnect() {},
      getFloatTimeDomainData(samples: Float32Array) { samples.fill(energy); },
    });
  }
  class Recorder {
    static instances: Recorder[] = [];
    static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus';
    state = 'inactive';
    mimeType = 'audio/webm;codecs=opus';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { Recorder.instances.push(this); }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) });
        this.onstop?.();
      });
    }
  }
  // The fake supplies only the browser members the adapter reads, like browser.test.ts.
  const win = {
    navigator: { mediaDevices: { getUserMedia } }, MediaRecorder: Recorder, AudioContext: Context,
    fetch, performance: { now: () => Date.now() }, setTimeout, clearTimeout,
  } as unknown as CaptureWindow;
  const input = recorderSpeechInput(win);
  const finals: string[] = [];
  const errors: string[] = [];
  input.onFinal((text) => finals.push(text));
  input.onError((error) => errors.push(error));
  const speech = async (ms = 240) => { energy = 0.1; await vi.advanceTimersByTimeAsync(ms); };
  const silence = async (ms = 820) => { energy = 0; await vi.advanceTimersByTimeAsync(ms); };
  return { input, getUserMedia, fetch, finals, errors, stopTrack, close, track, Recorder, stream, speech, silence };
}
let cleanup = () => undefined as void;
afterEach(() => { cleanup(); vi.useRealTimers(); });
function setup() { const r = rig(); cleanup = () => r.input.stop(); return r; }

describe('microphone capture adapter', () => {
  it('opens no microphone before Listen starts and releases permission granted after Listen stops', async () => {
    const r = setup();
    expect(r.input.isSupported()).toBe(true);
    expect(r.getUserMedia).not.toHaveBeenCalled();
    let grant: (stream: typeof r.stream) => void = () => undefined;
    r.getUserMedia.mockImplementation(() => new Promise((resolve) => { grant = resolve; }));
    r.input.start();
    r.input.stop();
    grant(r.stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.stopTrack).toHaveBeenCalledOnce();
    expect(r.close).toHaveBeenCalledOnce();
    expect(r.fetch).not.toHaveBeenCalled();
  });

  it('sends each completed utterance to the same-origin route and emits only final text', async () => {
    const r = setup();
    r.input.start();
    await r.speech();
    expect(r.fetch).not.toHaveBeenCalled();
    await r.silence();
    expect(r.fetch).toHaveBeenCalledOnce();
    expect(r.fetch.mock.calls[0]?.[0]).toBe('/api/transcribe');
    expect(r.fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'audio/wav' } });
    const sent = r.fetch.mock.calls[0]?.[1]?.body;
    expect(sent).toBeInstanceOf(Uint8Array);
    if (sent instanceof Uint8Array) expect(wavDurationMs(sent)).toBe(250);
    expect(r.finals).toEqual(['Do you need anything?']);
    await r.speech();
    await r.silence();
    expect(r.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not upload silence or clicks, and discards an unfinished clip on off', async () => {
    const r = setup();
    r.input.start();
    await r.silence(2000);
    expect(r.Recorder.instances).toHaveLength(0);
    await r.speech(20);
    await r.silence();
    expect(r.fetch).not.toHaveBeenCalled();
    await r.speech();
    r.input.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.fetch).not.toHaveBeenCalled();
    expect(r.stopTrack).toHaveBeenCalledOnce();
  });

  it('cuts continuous speech into bounded clips', async () => {
    const r = setup();
    r.input.start();
    await r.speech(15_100);
    expect(r.fetch).toHaveBeenCalledOnce();
    expect(r.Recorder.instances.length).toBe(2);
  });

  it('aborts in-flight transcription on off and ignores its late result', async () => {
    const r = setup();
    let deliver: (response: Response) => void = () => undefined;
    r.fetch.mockImplementation(() => new Promise((resolve) => { deliver = resolve; }));
    r.input.start();
    await r.speech(); await r.silence();
    const signal = r.fetch.mock.calls[0]?.[1]?.signal;
    r.input.stop();
    expect(signal?.aborted).toBe(true);
    deliver(Response.json({ text: 'too late' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.finals).toEqual([]);
  });

  it('serializes utterances to preserve conversation order', async () => {
    const r = setup();
    let deliver: (response: Response) => void = () => undefined;
    r.fetch.mockImplementationOnce(() => new Promise((resolve) => { deliver = resolve; }));
    r.input.start();
    await r.speech(); await r.silence();
    await r.speech(); await r.silence();
    expect(r.fetch).toHaveBeenCalledOnce();
    deliver(Response.json({ text: 'first' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(r.finals).toEqual(['first', 'Do you need anything?']);
  });

  it.each([401, 429, 502, 503])('releases capture and reports network on route status %s', async (status) => {
    const r = setup();
    r.fetch.mockResolvedValue(new Response('', { status }));
    r.input.start();
    await r.speech(); await r.silence();
    expect(r.errors).toEqual(['network']);
    expect(r.stopTrack).toHaveBeenCalledOnce();
    expect(r.close).toHaveBeenCalledOnce();
  });

  it('reports denied microphone permission without uploading', async () => {
    const r = setup();
    r.getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    r.input.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.errors).toEqual(['permission-denied']);
    expect(r.close).toHaveBeenCalledOnce();
    expect(r.fetch).not.toHaveBeenCalled();
  });
});
