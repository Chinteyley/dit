/** Browser-only capture and transport. VAD decisions live in vad.ts; no audio is persisted. */
import { err, ok } from '@/lib/input';
import { encodeSpeechWav } from '@/lib/transcribe/audio';
import { speechEvent } from './events';
import { rms, vadStep, type VadState, MAX_UTTERANCE_MS } from './vad';
import type { RecognitionError, SpeechInput } from './types';

export interface CaptureWindow {
  readonly navigator?: Pick<Navigator, 'mediaDevices'>;
  readonly MediaRecorder?: typeof MediaRecorder;
  readonly AudioContext?: typeof AudioContext;
  readonly fetch?: typeof fetch;
  readonly performance?: Pick<Performance, 'now'>;
  readonly setTimeout?: Window['setTimeout'];
  readonly clearTimeout?: Window['clearTimeout'];
}
const CLIP_LIMIT = 1_048_576;
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav'];

export function recorderSpeechInput(win: CaptureWindow): SpeechInput {
  const finals = speechEvent<string>();
  const errors = speechEvent<RecognitionError>();
  let generation = 0;
  let active = false;
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let recorder: MediaRecorder | null = null;
  let timer: number | undefined;
  let vad: VadState | null = null;
  let queue = Promise.resolve();
  let queued = 0;
  const uploads = new Set<AbortController>();
  const supported = () => !!(win.navigator?.mediaDevices?.getUserMedia && win.MediaRecorder && win.AudioContext
    && win.fetch && win.performance && win.setTimeout && win.clearTimeout);

  const stop = (): void => {
    active = false;
    generation++;
    win.clearTimeout?.(timer);
    timer = undefined;
    const rec = recorder;
    recorder = null;
    try {
      if (rec && rec.state !== 'inactive') rec.stop();
    } catch {
      // A recorder that already ended must not prevent releasing the microphone.
    }
    stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    stream = null;
    source?.disconnect();
    source = null;
    analyser?.disconnect();
    analyser = null;
    void context?.close().catch(() => undefined);
    context = null;
    for (const upload of uploads) upload.abort();
    uploads.clear();
    queue = Promise.resolve();
    queued = 0;
    vad = null;
  };
  const fail = (error: RecognitionError, token: number): void => {
    if (!active || token !== generation) return;
    stop();
    errors.emit(error);
  };

  const upload = (blob: Blob, token: number, clipContext: AudioContext): void => {
    if (!active || token !== generation || blob.size === 0) return;
    if (blob.size > CLIP_LIMIT || queued >= 2) { fail('network', token); return; }
    queued++;
    queue = queue.then(async () => {
      if (!active || token !== generation) return;
      const controller = new AbortController();
      uploads.add(controller);
      const timeout = win.setTimeout?.(() => controller.abort(), 20_000);
      try {
        const decoded = await clipContext.decodeAudioData(await blob.arrayBuffer());
        if (!active || token !== generation) return;
        if (decoded.duration > (MAX_UTTERANCE_MS + 1_000) / 1000) throw new Error('clip too long');
        const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
        const wav = encodeSpeechWav(channels, decoded.sampleRate);
        const response = await win.fetch!('/api/transcribe', {
          method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav,
          signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
        });
        if (!response.ok) throw new Error('transcription unavailable');
        const body: unknown = await response.json();
        if (typeof body !== 'object' || body === null || !('text' in body) || typeof body.text !== 'string') {
          throw new Error('invalid transcription');
        }
        if (active && token === generation && body.text.trim() !== '') finals.emit(body.text.trim());
      } catch {
        fail('network', token);
      } finally {
        win.clearTimeout?.(timeout);
        uploads.delete(controller);
        if (token === generation) queued--;
      }
    });
  };

  const beginClip = (token: number): void => {
    const Recorder = win.MediaRecorder;
    if (!Recorder || !stream || !context) return;
    const clipContext = context;
    const mimeType = MIME_TYPES.find((type) => Recorder.isTypeSupported(type));
    const rec = new Recorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32_000 });
    const startedAt = win.performance!.now();
    const chunks: Blob[] = [];
    let size = 0;
    let discard = false;
    recorder = rec;
    rec.ondataavailable = (event) => {
      if (!active || token !== generation || discard) return;
      size += event.data.size;
      if (size > CLIP_LIMIT) { discard = true; fail('network', token); return; }
      chunks.push(event.data);
    };
    rec.onerror = () => fail('other', token);
    rec.onstop = () => {
      if (!active || token !== generation || discard) return;
      // Background timer throttling must not turn a short utterance into a long upload.
      if (win.performance!.now() - startedAt > MAX_UTTERANCE_MS + 1_000) return;
      upload(new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' }), token, clipContext);
    };
    rec.start(250);
    // Discarding a click/noise is distinct from stopping a genuine utterance.
    discardClip = () => { discard = true; };
  };
  let discardClip = (): void => undefined;

  const open = async (token: number): Promise<void> => {
    try {
      const Context = win.AudioContext!;
      const ctx = new Context();
      context = ctx;
      const resumed = ctx.resume().then(() => true, () => false);
      const acquired = await win.navigator!.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }, video: false,
      });
      if (!active || token !== generation) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = acquired;
      acquired.getTracks().forEach((track) => { track.onended = () => fail('no-microphone', token); });
      if (!await resumed) throw new Error('audio context unavailable');
      if (!active || token !== generation) return;
      source = ctx.createMediaStreamSource(acquired);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const tick = (): void => {
        if (!active || token !== generation || !analyser) return;
        try {
          analyser.getFloatTimeDomainData(samples);
          const step = vadStep(vad, rms(samples), win.performance!.now());
          vad = step.state;
          if (step.action === 'start') beginClip(token);
          if (step.action === 'finish' || step.action === 'discard') {
            if (step.action === 'discard') discardClip();
            const rec = recorder;
            recorder = null;
            if (rec?.state === 'recording') rec.stop();
          }
          timer = win.setTimeout!(tick, 20);
        } catch { fail('other', token); }
      };
      tick();
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      fail(name === 'NotAllowedError' || name === 'SecurityError' ? 'permission-denied'
        : name === 'NotFoundError' || name === 'NotReadableError' ? 'no-microphone' : 'other', token);
    }
  };

  return {
    isSupported: supported,
    start() {
      if (!supported()) return err('other');
      if (!active) { active = true; void open(++generation); }
      return ok(undefined);
    },
    stop,
    onFinal: finals.subscribe,
    onError: errors.subscribe,
    onInterim: () => () => undefined,
    onEnd: () => () => undefined,
  };
}
