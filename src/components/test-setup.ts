/**
 * Vitest setup file for component and hook tests (registered in vitest.config.ts after the
 * expansion no-network guard). It runs before every test file; in the default `node` environment
 * there is no DOM, so everything below is skipped.
 *
 * - jsdom 31 has HTMLDialogElement without showModal() and close(). When they are missing, the
 *   polyfill toggles `open` and dispatches `close`, and, as a browser does for a modal dialog,
 *   turns an Escape keydown into a cancelable `cancel` event that closes the dialog unless a
 *   listener cancels it.
 * - jsdom has no window.matchMedia. The stub answers `(prefers-reduced-motion: reduce)` (and
 *   `no-preference`) from a setting that tests change with setReducedMotion(); every other query
 *   does not match. The setting goes back to "no preference" after each test.
 */
import { afterEach } from 'vitest';

type ChangeListener = (event: MediaQueryListEvent) => void;

interface StubList {
  readonly list: MediaQueryList;
  readonly listeners: Set<ChangeListener>;
  matched: boolean;
}

let reducedMotion = false;
const stubLists = new Set<StubList>();

function evaluate(media: string): boolean {
  const query = media.replace(/\s+/g, '').toLowerCase();
  if (query === '(prefers-reduced-motion:reduce)') return reducedMotion;
  if (query === '(prefers-reduced-motion:no-preference)') return !reducedMotion;
  return false;
}

function stubMatchMedia(media: string): MediaQueryList {
  const listeners = new Set<ChangeListener>();
  const list = {
    media,
    get matches(): boolean {
      return evaluate(media);
    },
    onchange: null as ChangeListener | null,
    addEventListener(type: string, listener: unknown): void {
      if (type === 'change' && typeof listener === 'function') listeners.add(listener as ChangeListener);
    },
    removeEventListener(type: string, listener: unknown): void {
      if (type === 'change' && typeof listener === 'function') listeners.delete(listener as ChangeListener);
    },
    addListener(listener: ChangeListener | null): void {
      if (listener !== null) listeners.add(listener);
    },
    removeListener(listener: ChangeListener | null): void {
      if (listener !== null) listeners.delete(listener);
    },
    dispatchEvent(event: Event): boolean {
      for (const listener of [...listeners]) listener(event as MediaQueryListEvent);
      return true;
    },
  } as unknown as MediaQueryList;
  stubLists.add({ list, listeners, matched: evaluate(media) });
  return list;
}

/** Sets whether `(prefers-reduced-motion: reduce)` matches, and fires `change` on every list that flips. */
export function setReducedMotion(reduce: boolean): void {
  reducedMotion = reduce;
  for (const entry of stubLists) {
    const matches = evaluate(entry.list.media);
    if (matches === entry.matched) continue;
    entry.matched = matches;
    const event = new Event('change') as MediaQueryListEvent;
    Object.defineProperties(event, { media: { value: entry.list.media }, matches: { value: matches } });
    entry.list.onchange?.call(entry.list, event);
    entry.list.dispatchEvent(event);
  }
}

/** Modal dialogs opened with the polyfilled showModal(), newest last. */
const modalStack: HTMLDialogElement[] = [];

function topModal(): HTMLDialogElement | undefined {
  for (let i = modalStack.length - 1; i >= 0; i--) {
    const dialog = modalStack[i];
    if (dialog !== undefined && dialog.open && dialog.isConnected) return dialog;
  }
  return undefined;
}

if (typeof HTMLDialogElement !== 'undefined' && typeof document !== 'undefined') {
  const proto = HTMLDialogElement.prototype;
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function showModal(this: HTMLDialogElement): void {
      if (this.open) return;
      this.open = true;
      modalStack.push(this);
    };
    // A browser sends Escape to the newest open modal dialog as a cancelable close request.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const dialog = topModal();
      if (dialog === undefined) return;
      if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
    });
  }
  if (typeof proto.close !== 'function') {
    proto.close = function close(this: HTMLDialogElement, returnValue?: string): void {
      if (!this.open) return;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.open = false;
      const index = modalStack.indexOf(this);
      if (index !== -1) modalStack.splice(index, 1);
      this.dispatchEvent(new Event('close'));
    };
  }
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = stubMatchMedia;
}

if (typeof window !== 'undefined') {
  afterEach(() => {
    setReducedMotion(false);
    stubLists.clear();
    modalStack.length = 0;
  });
}
