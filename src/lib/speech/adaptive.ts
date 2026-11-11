/** Selects one backend per session; backend failure never requires a second toggle. */
import { ok, type Unsubscribe } from '@/lib/input';
import { speechEvent } from './events';
import type { RecognitionError, SpeechInput } from './types';

export function adaptiveSpeechInput(browser: SpeechInput, server: SpeechInput, unavailable: {
  get(): boolean;
  set(): void;
}): SpeechInput {
  const interim = speechEvent<string>();
  const final = speechEvent<string>();
  const errors = speechEvent<RecognitionError>();
  const ends = speechEvent<void>();
  const modes = speechEvent<'browser' | 'server'>();
  let wanted = false;
  let paused = false;
  let backend = browser;
  let subscriptions: Unsubscribe[] = [];
  const mode = () => backend === server ? 'server' as const : 'browser' as const;
  const detach = (): void => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    subscriptions = [];
    backend.stop();
  };
  const start = (): ReturnType<SpeechInput['start']> => {
    detach();
    backend = !browser.isSupported() || unavailable.get() ? server : browser;
    modes.emit(mode());
    if (paused) return ok(undefined);
    subscriptions = [
      backend.onInterim(interim.emit), backend.onFinal(final.emit), backend.onEnd(() => ends.emit(undefined)),
      backend.onError((error) => {
        if (!wanted || paused) return;
        if (backend === browser && (error === 'network' || error === 'service-unavailable')) {
          unavailable.set();
          const result = start();
          if (!result.ok) errors.emit('network');
        } else errors.emit(error);
      }),
    ];
    return backend.start();
  };
  return {
    isSupported: () => (!unavailable.get() && browser.isSupported()) || server.isSupported(),
    start() { wanted = true; return start(); },
    stop() { wanted = false; detach(); },
    mode,
    onMode: modes.subscribe,
    setPaused(value) {
      if (paused === value) return;
      paused = value;
      if (paused) detach();
      else if (wanted) {
        const result = start();
        if (!result.ok) errors.emit(result.error);
      }
    },
    onInterim: interim.subscribe, onFinal: final.subscribe,
    onError: errors.subscribe, onEnd: (listener) => ends.subscribe(listener),
  };
}
