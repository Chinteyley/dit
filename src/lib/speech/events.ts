import type { Unsubscribe } from '@/lib/input';

/** Snapshot delivery lets a callback unsubscribe or stop its input safely. */
export function speechEvent<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe(listener: (value: T) => void): Unsubscribe {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    emit(value: T): void {
      for (const listener of [...listeners]) {
        try { listener(value); } catch { /* Match Web Speech: one consumer must not stop capture. */ }
      }
    },
  };
}
