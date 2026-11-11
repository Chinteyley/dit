// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPage, browserScheduler, describeElement, documentPointerTarget, performanceClock, surfaceElement, windowKeyTarget } from './browser';
import { classifyFocus } from './focus';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing #${id}`);
  return el;
}

describe('describeElement', () => {
  it('describes the body and no element as body-or-null', () => {
    expect(describeElement(null, null).isBodyOrNull).toBe(true);
    expect(describeElement(document.body, null)).toMatchObject({ isBodyOrNull: true, tagName: '' });
    expect(classifyFocus(describeElement(document.body, null))).toBe('keying');
  });

  it('sees contenteditable on descendants, and contenteditable="false" stops it', () => {
    mount('<div contenteditable="true"><p><span id="inner">x</span></p><div contenteditable="false"><b id="off">y</b></div></div>');
    expect(describeElement(byId('inner'), null).contentEditable).toBe(true);
    expect(classifyFocus(describeElement(byId('inner'), null))).toBe('editable');
    expect(describeElement(byId('off'), null).contentEditable).toBe(false);
  });

  it('treats any input inside an open dialog as editable, and not in a closed one', () => {
    mount('<dialog open><input id="check" type="checkbox"></dialog><dialog><input id="closed" type="checkbox"></dialog>');
    expect(describeElement(byId('check'), null)).toMatchObject({ tagName: 'input', inputType: 'checkbox', inOpenDialog: true });
    expect(classifyFocus(describeElement(byId('check'), null))).toBe('editable');
    expect(classifyFocus(describeElement(byId('closed'), null))).toBe('interactive');
  });

  it('normalises input types, roles and links', () => {
    mount(
      '<input id="plain"><input id="odd" type="FOO"><input id="hidden" type="hidden">' +
        '<a id="link" href="#x">x</a><a id="anchor">y</a><div id="role" role=" Button  link ">z</div>',
    );
    expect(describeElement(byId('plain'), null).inputType).toBe('text');
    expect(describeElement(byId('odd'), null).inputType).toBe('text');
    expect(classifyFocus(describeElement(byId('hidden'), null))).toBe('keying');
    expect(describeElement(byId('link'), null)).toMatchObject({ tagName: 'a', hasHref: true });
    expect(describeElement(byId('anchor'), null).hasHref).toBe(false);
    expect(describeElement(byId('role'), null).role).toBe('button');
  });

  it('marks the Keying_Surface, even with role="button" and a tabindex', () => {
    mount('<div id="surface" role="button" tabindex="0" aria-label="Keying surface"></div>');
    const surface = byId('surface');
    expect(describeElement(surface, surface).isKeyingSurface).toBe(true);
    expect(classifyFocus(describeElement(surface, surface))).toBe('keying');
    expect(classifyFocus(describeElement(surface, null))).toBe('interactive');
  });
});

describe('windowKeyTarget', () => {
  it('listens in the capture phase, before the focused element, and removes both listeners', () => {
    mount('<button id="button">Settings</button>');
    const button = byId('button');
    const order: string[] = [];
    button.addEventListener('keydown', (event) => {
      order.push('button');
      event.stopPropagation();
    });
    const remove = windowKeyTarget().addKeyListeners(
      (event) => order.push(`down:${event.code}`),
      (event) => order.push(`up:${event.code}`),
    );
    button.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    button.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
    expect(order).toStrictEqual(['down:Space', 'button', 'up:Space']);

    remove();
    button.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    expect(order).toStrictEqual(['down:Space', 'button', 'up:Space', 'button']);
  });

  it('lets a source prevent the default action', () => {
    windowKeyTarget().addKeyListeners((event) => event.preventDefault(), () => undefined);
    const event = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('surfaceElement', () => {
  it('returns false when pointer capture throws and never throws on release', () => {
    mount('<div id="surface"><span id="child"></span></div>');
    const el = byId('surface');
    el.setPointerCapture = () => {
      throw new DOMException('No active pointer', 'NotFoundError');
    };
    el.hasPointerCapture = () => {
      throw new DOMException('broken', 'InvalidStateError');
    };
    const surface = surfaceElement(el);
    expect(surface.setPointerCapture(1)).toBe(false);
    expect(() => surface.releasePointerCapture(1)).not.toThrow();
  });

  it('captures and releases through the element', () => {
    mount('<div id="surface"></div>');
    const el = byId('surface');
    const captured = new Set<number>();
    el.setPointerCapture = (id) => void captured.add(id);
    el.hasPointerCapture = (id) => captured.has(id);
    el.releasePointerCapture = (id) => void captured.delete(id);
    const surface = surfaceElement(el);
    expect(surface.setPointerCapture(4)).toBe(true);
    expect(captured.has(4)).toBe(true);
    surface.releasePointerCapture(4);
    expect(captured.size).toBe(0);
  });

  it('knows its descendants', () => {
    mount('<div id="surface"><span id="child"></span></div><p id="outside"></p>');
    const surface = surfaceElement(byId('surface'));
    expect(surface.contains(byId('child'))).toBe(true);
    expect(surface.contains(byId('outside'))).toBe(false);
    expect(surface.contains({ not: 'a node' })).toBe(false);
  });

  it('saves and restores the inline gesture styles', () => {
    mount('<div id="surface" style="touch-action: pan-y"></div>');
    const el = byId('surface');
    const restore = surfaceElement(el).applyNoGestureStyle();
    expect(el.style.getPropertyValue('touch-action')).toBe('none');
    expect(el.style.getPropertyValue('user-select')).toBe('none');
    restore();
    restore();
    expect(el.style.getPropertyValue('touch-action')).toBe('pan-y');
    expect(el.style.getPropertyValue('user-select')).toBe('');
  });

  it('adapts pointer and context menu events and removes listeners', () => {
    mount('<div id="surface"></div>');
    const el = byId('surface');
    const surface = surfaceElement(el);
    const seen: string[] = [];
    const remove = surface.on('contextmenu', (event) => {
      seen.push(`${event.pointerType}|${event.button}`);
      event.preventDefault();
    });
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    el.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(seen).toStrictEqual(['|2']);
    remove();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(seen).toHaveLength(1);
  });
});

describe('documentPointerTarget', () => {
  it('hears pointerup anywhere in the document', () => {
    mount('<p id="far"></p>');
    const seen: unknown[] = [];
    const remove = documentPointerTarget().on('pointerup', (event) => seen.push(event.target));
    byId('far').dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(seen).toStrictEqual([byId('far')]);
    remove();
    byId('far').dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(seen).toHaveLength(1);
  });
});

describe('browserPage', () => {
  it('reports window blur and visibility changes', () => {
    const page = browserPage();
    const seen: string[] = [];
    const removers = [
      page.onBlur(() => seen.push('blur')),
      page.onHidden(() => seen.push('hidden')),
      page.onVisible(() => seen.push('visible')),
    ];
    window.dispatchEvent(new Event('blur'));
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    expect(page.isHidden()).toBe(true);
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(page.isHidden()).toBe(false);
    expect(seen).toStrictEqual(['blur', 'hidden', 'visible']);

    removers.forEach((remove) => remove());
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toHaveLength(3);
    visibility.mockRestore();
  });
});

describe('performanceClock and browserScheduler', () => {
  it('reads performance.now()', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1234.5);
    expect(performanceClock()).toBe(1234.5);
    now.mockRestore();
  });

  it('wraps setTimeout and cancels with clearTimeout', () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    browserScheduler.schedule(30, () => fired.push('a'));
    const cancel = browserScheduler.schedule(30, () => fired.push('b'));
    browserScheduler.schedule(Number.NaN, () => fired.push('c'));
    cancel();
    vi.advanceTimersByTime(29);
    expect(fired).toStrictEqual(['c']);
    vi.advanceTimersByTime(1);
    expect(fired).toStrictEqual(['c', 'a']);
  });
});
