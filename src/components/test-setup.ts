/**
 * Vitest setup file for component and hook tests (registered in vitest.config.ts after the
 * expansion no-network guard). It runs before every test file; in the default `node` environment
 * there is no DOM, so everything below is skipped.
 *
 * - jsdom 31 has HTMLDialogElement without show(), showModal() and close(). The polyfill follows
 *   the HTML rules the components rely on (onboarding-and-safety task 16.1):
 *   - showModal() opens the dialog and puts it on a top-layer stack, newest last (topLayer());
 *     show() opens it without the stack. Each throws InvalidStateError when the dialog is already
 *     open the other way, and does nothing when it is already open the same way.
 *   - Every open and close fires a `toggle` event with oldState and newState (synchronously here;
 *     browsers queue it), and close() fires `close`.
 *   - An Escape keydown that no listener cancelled sends a cancelable `cancel` event to the newest
 *     modal dialog after the keydown has reached every listener (bubbling keydowns only), and the
 *     dialog then closes unless a listener cancels the `cancel` event.
 *   - `:modal` in matches(), closest(), querySelector() and querySelectorAll() matches exactly the
 *     dialogs on the stack (jsdom parses `:modal` but never matches it).
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
/** Marks the dialogs on the stack, so `:modal` can be rewritten into an attribute selector. */
const MODAL_ATTRIBUTE = 'data-polyfill-modal';

/** The open modal dialogs in top-layer order, oldest first: the last one renders on top. */
export function topLayer(): readonly HTMLDialogElement[] {
  return modalStack.filter((dialog) => dialog.open && dialog.isConnected);
}

function topModal(): HTMLDialogElement | undefined {
  return topLayer().at(-1);
}

function invalidState(message: string): DOMException {
  return new DOMException(message, 'InvalidStateError');
}

function fireToggle(dialog: HTMLDialogElement, oldState: 'open' | 'closed', newState: 'open' | 'closed'): void {
  const event = new Event('toggle');
  Object.defineProperties(event, { oldState: { value: oldState }, newState: { value: newState } });
  dialog.dispatchEvent(event);
}

/** Wraps a selector method so `:modal` matches the dialogs on the stack. */
function supportModalPseudoClass(proto: object, names: readonly string[]): void {
  for (const name of names) {
    const original: unknown = Reflect.get(proto, name);
    if (typeof original !== 'function') continue;
    Object.defineProperty(proto, name, {
      configurable: true,
      writable: true,
      value: function withModal(this: unknown, selectors: unknown, ...rest: unknown[]): unknown {
        const rewritten =
          typeof selectors === 'string' ? selectors.replace(/:modal\b/g, `[${MODAL_ATTRIBUTE}]`) : selectors;
        return Reflect.apply(original, this, [rewritten, ...rest]);
      },
    });
  }
}

if (typeof HTMLDialogElement !== 'undefined' && typeof document !== 'undefined') {
  const proto = HTMLDialogElement.prototype;
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function showModal(this: HTMLDialogElement): void {
      if (this.open && this.hasAttribute(MODAL_ATTRIBUTE)) return;
      if (this.open) throw invalidState('The dialog is already open as a non-modal dialog.');
      if (!this.isConnected) throw invalidState('The dialog is not connected to a document.');
      this.open = true;
      this.setAttribute(MODAL_ATTRIBUTE, '');
      modalStack.push(this);
      fireToggle(this, 'closed', 'open');
    };
    proto.show = function show(this: HTMLDialogElement): void {
      if (this.open && this.hasAttribute(MODAL_ATTRIBUTE)) throw invalidState('The dialog is already open as a modal dialog.');
      if (this.open) return;
      this.open = true;
      fireToggle(this, 'closed', 'open');
    };
    // A browser sends Escape to the newest open modal dialog as a cancelable close request once the
    // keydown has finished dispatching, unless a listener cancelled it. A listener added to window
    // while the event is still on its way down runs after every bubble listener already there.
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        window.addEventListener(
          'keydown',
          (late) => {
            if (late !== event || event.defaultPrevented) return;
            const dialog = topModal();
            if (dialog === undefined) return;
            if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close();
          },
          { once: true },
        );
      },
      true,
    );
    supportModalPseudoClass(Element.prototype, ['matches', 'closest', 'querySelector', 'querySelectorAll']);
    supportModalPseudoClass(Document.prototype, ['querySelector', 'querySelectorAll']);
    supportModalPseudoClass(DocumentFragment.prototype, ['querySelector', 'querySelectorAll']);
  }
  if (typeof proto.close !== 'function') {
    proto.close = function close(this: HTMLDialogElement, returnValue?: string): void {
      if (!this.open) return;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.open = false;
      this.removeAttribute(MODAL_ATTRIBUTE);
      const index = modalStack.indexOf(this);
      if (index !== -1) modalStack.splice(index, 1);
      fireToggle(this, 'open', 'closed');
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
    for (const dialog of modalStack) dialog.removeAttribute(MODAL_ATTRIBUTE);
    modalStack.length = 0;
  });
}
