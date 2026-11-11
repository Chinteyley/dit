/**
 * DOM adapters for the input layer: the only file here besides blink/browser.ts that reads browser
 * globals. Nothing is touched at import time, so server rendering can import it safely.
 */
import type { Clock, Scheduler } from './clock';
import type { FocusDescription } from './focus';
import type { KeyEventTarget } from './key-router';
import type { DocumentPointerTarget, PointerEventLike, SurfaceElement } from './pointer';
import type { PageLifecycle } from './source-base';
import type { Unsubscribe } from './types';

export const performanceClock: Clock = () => performance.now();

export const browserScheduler: Scheduler = {
  schedule(delayMs, fn) {
    const id = setTimeout(fn, Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0);
    return () => clearTimeout(id);
  },
};

function listen(
  target: EventTarget,
  type: string,
  fn: (event: Event) => void,
  options?: AddEventListenerOptions,
): Unsubscribe {
  // A fresh wrapper per call, so registering the same function twice gives two subscriptions.
  const handler = (event: Event): void => fn(event);
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/** window 'blur' and document 'visibilitychange'. */
export function browserPage(): PageLifecycle {
  return {
    isHidden: () => document.visibilityState === 'hidden',
    onBlur: (fn) => listen(window, 'blur', () => fn()),
    onHidden: (fn) =>
      listen(document, 'visibilitychange', () => {
        if (document.visibilityState === 'hidden') fn();
      }),
    onVisible: (fn) =>
      listen(document, 'visibilitychange', () => {
        if (document.visibilityState === 'visible') fn();
      }),
  };
}

const CAPTURE: AddEventListenerOptions = { capture: true };

/**
 * window keydown/keyup in the capture phase, so the sources can call preventDefault() before a
 * focused control sees the event.
 */
export function windowKeyTarget(): KeyEventTarget {
  return {
    addKeyListeners(onDown, onUp) {
      const removeDown = listen(window, 'keydown', (event) => {
        if (event instanceof KeyboardEvent) onDown(event);
      }, CAPTURE);
      const removeUp = listen(window, 'keyup', (event) => {
        if (event instanceof KeyboardEvent) onUp(event);
      }, CAPTURE);
      return () => {
        removeDown();
        removeUp();
      };
    },
  };
}

/** Reads the pointer fields the input layer uses; works for PointerEvent and plain MouseEvent (contextmenu). */
function pointerLike(event: Event): PointerEventLike {
  const field = <T>(key: string, isType: (value: unknown) => value is T, fallback: T): T => {
    const value: unknown = Reflect.get(event, key);
    return isType(value) ? value : fallback;
  };
  const isNumber = (value: unknown): value is number => typeof value === 'number';
  const isString = (value: unknown): value is string => typeof value === 'string';
  const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
  return {
    pointerId: field('pointerId', isNumber, -1),
    isPrimary: field('isPrimary', isBoolean, false),
    pointerType: field('pointerType', isString, ''),
    button: field('button', isNumber, 0),
    target: event.target,
    preventDefault: () => event.preventDefault(),
  };
}

/** The four long-press suppression properties (Req 6.7). */
const NO_GESTURE_PROPERTIES = ['touch-action', 'user-select', '-webkit-user-select', '-webkit-touch-callout'] as const;

/** Binds the Keying_Surface element. Capture calls never throw; styles are restored exactly. */
export function surfaceElement(el: HTMLElement): SurfaceElement {
  return {
    contains: (target) => target instanceof Node && el.contains(target),
    on: (type, fn) => listen(el, type, (event) => fn(pointerLike(event))),
    setPointerCapture(id) {
      try {
        el.setPointerCapture(id);
        return true;
      } catch {
        return false;
      }
    },
    releasePointerCapture(id) {
      try {
        if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
      } catch {
        // Already released, or the browser lacks pointer capture.
      }
    },
    applyNoGestureStyle() {
      const saved = NO_GESTURE_PROPERTIES.map(
        (name) => [name, el.style.getPropertyValue(name), el.style.getPropertyPriority(name)] as const,
      );
      for (const name of NO_GESTURE_PROPERTIES) el.style.setProperty(name, 'none');
      let restored = false;
      return () => {
        if (restored) return;
        restored = true;
        for (const [name, value, priority] of saved) {
          if (value === '') el.style.removeProperty(name);
          else el.style.setProperty(name, value, priority);
        }
      };
    },
  };
}

/** Document-level pointerup/pointercancel, used only after a failed pointer capture (Req 6.11). */
export function documentPointerTarget(): DocumentPointerTarget {
  return {
    on: (type, fn) => listen(document, type, (event) => fn(pointerLike(event)), CAPTURE),
  };
}

/** Own or inherited contenteditable state; falls back to the attributes where isContentEditable is missing. */
function isEditableContent(el: Element): boolean {
  if (el instanceof HTMLElement && el.isContentEditable === true) return true;
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    const value = node.getAttribute('contenteditable');
    if (value === null) continue;
    const state = value.trim().toLowerCase();
    if (state === '' || state === 'true' || state === 'plaintext-only') return true;
    if (state === 'false') return false;
  }
  return false;
}

const BODY_OR_NULL: FocusDescription = Object.freeze({
  isBodyOrNull: true,
  isKeyingSurface: false,
  tagName: '',
  inputType: null,
  hasHref: false,
  contentEditable: false,
  role: null,
  inOpenDialog: false,
});

/**
 * The only DOM-reading part of focus handling (Req 4.8). For inputs the type is the normalised
 * `type` property, so a missing or unknown type reads as 'text', as the browser treats it.
 */
export function describeElement(el: Element | null, surface: Element | null): FocusDescription {
  if (el === null || el === el.ownerDocument.body || el === el.ownerDocument.documentElement) {
    return BODY_OR_NULL;
  }
  const tagName = el.tagName.toLowerCase();
  const role = el.getAttribute('role')?.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return {
    isBodyOrNull: false,
    isKeyingSurface: surface !== null && el === surface,
    tagName,
    inputType: el instanceof HTMLInputElement ? el.type.toLowerCase() : (el.getAttribute('type')?.toLowerCase() ?? null),
    hasHref: el.hasAttribute('href'),
    contentEditable: isEditableContent(el),
    role: role === '' ? null : role,
    inOpenDialog: el.closest('dialog[open]') !== null,
  };
}
