import type { Clock, Scheduler } from './clock';
import { createDebouncer } from './debounce';
import { createSourceCore, type PageLifecycle } from './source-base';
import type { PressSource, Result, SettingError, Unsubscribe } from './types';

export interface PointerEventLike {
  readonly pointerId: number;
  readonly isPrimary: boolean;
  readonly pointerType: string;
  readonly button: number;
  readonly target: unknown;
  preventDefault(): void;
}

export type SurfaceEventType = 'pointerdown' | 'pointerup' | 'pointercancel' | 'lostpointercapture' | 'contextmenu';

export interface SurfaceElement {
  contains(target: unknown): boolean;
  on(type: SurfaceEventType, fn: (e: PointerEventLike) => void): Unsubscribe;
  /** False when the browser throws. */
  setPointerCapture(id: number): boolean;
  /** Never throws. */
  releasePointerCapture(id: number): void;
  /** Sets the long-press suppression styles; returns a function that restores the previous inline values. */
  applyNoGestureStyle(): () => void;
}

export interface DocumentPointerTarget {
  on(type: 'pointerup' | 'pointercancel', fn: (e: PointerEventLike) => void): Unsubscribe;
}

export type PointerState =
  | { readonly held: false }
  | { readonly held: true; readonly pointerId: number; readonly captured: boolean };

export const NOT_HELD: PointerState = Object.freeze({ held: false });

/**
 * A primary pointer pressed on the surface starts a press, with the main button for a mouse
 * (Req 6.1, 6.2). The source applies the capture outcome to `captured`.
 */
export function pointerDown(
  s: PointerState,
  e: PointerEventLike,
  onSurface: boolean,
): { readonly state: PointerState; readonly raw: 'down' | null } {
  const qualifies = !s.held && e.isPrimary && onSurface && (e.pointerType !== 'mouse' || e.button === 0);
  return qualifies ? { state: { held: true, pointerId: e.pointerId, captured: false }, raw: 'down' } : { state: s, raw: null };
}

/** pointerup, pointercancel or lostpointercapture for the held pointer ends the press once (Req 6.3 to 6.5). */
export function pointerEnd(
  s: PointerState,
  e: { readonly pointerId: number },
): { readonly state: PointerState; readonly raw: 'up' | null } {
  return s.held && s.pointerId === e.pointerId ? { state: NOT_HELD, raw: 'up' } : { state: s, raw: null };
}

export interface PointerSourceDeps {
  /** Resolved at start(). */
  readonly surface: () => SurfaceElement | null;
  readonly doc: DocumentPointerTarget;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly page: PageLifecycle;
  readonly minPressDuration?: number;
}

export interface PointerSource extends PressSource {
  setMinPressDuration(value: unknown): Result<number, SettingError>;
}

/**
 * A primary pointer press anywhere on the Keying_Surface (Req 6). Listens only on the surface and,
 * when pointer capture fails, on the document for that pointer's release (Req 6.8, 6.11).
 */
export function createPointerSource(deps: PointerSourceDeps): PointerSource {
  const debouncer = createDebouncer('pointer', deps.minPressDuration);
  const core = createSourceCore('pointer', deps.clock, deps.scheduler, debouncer);
  let state: PointerState = NOT_HELD;
  let surface: SurfaceElement | null = null;
  let detach: Unsubscribe[] = [];
  let fallback: Unsubscribe[] = [];

  const removeFallback = (): void => {
    for (const remove of fallback) remove();
    fallback = [];
  };

  const end = (e: PointerEventLike): void => {
    const next = pointerEnd(state, e);
    if (next.raw === null) return;
    state = next.state;
    removeFallback();
    core.feed((d) => d.rawUp(deps.clock()));
  };

  const down = (e: PointerEventLike): void => {
    if (surface === null) return;
    const next = pointerDown(state, e, surface.contains(e.target));
    if (next.raw === null) return;
    const captured = surface.setPointerCapture(e.pointerId);
    state = { held: true, pointerId: e.pointerId, captured };
    if (!captured) {
      // Req 6.11: without capture, the first release anywhere in the document ends the press.
      fallback = [deps.doc.on('pointerup', end), deps.doc.on('pointercancel', end)];
    }
    core.feed((d) => d.rawDown(deps.clock()));
  };

  // Blur, hide and stop: end or discard the press and forget the pointer (Req 7.1 to 7.4).
  const endPress = (): void => {
    if (state.held) {
      const { pointerId, captured } = state;
      // Forget the pointer first: a lostpointercapture caused by the release then does nothing.
      state = NOT_HELD;
      removeFallback();
      if (captured) surface?.releasePointerCapture(pointerId);
    }
    core.endPress();
  };

  return {
    kind: 'pointer',
    start() {
      if (core.status() !== 'off') return;
      state = NOT_HELD;
      surface = deps.surface();
      detach = [deps.page.onBlur(endPress), deps.page.onHidden(endPress)];
      if (surface !== null) {
        const restoreStyle = surface.applyNoGestureStyle();
        detach.push(
          surface.on('pointerdown', down),
          surface.on('pointerup', end),
          surface.on('pointercancel', end),
          surface.on('lostpointercapture', end),
          surface.on('contextmenu', (e) => e.preventDefault()),
          restoreStyle,
        );
      }
      core.setStatus('active');
    },
    stop() {
      if (core.status() === 'off') return;
      endPress();
      for (const remove of detach) remove();
      detach = [];
      surface = null;
      core.setStatus('off');
    },
    status: core.status,
    ...core.subscribers,
    setMinPressDuration: (value) => debouncer.setMinPressDuration(value),
  };
}
