// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { setReducedMotion } from './test-setup';

afterEach(() => {
  document.body.replaceChildren();
});

function mountDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  document.body.append(dialog);
  return dialog;
}

describe('dialog polyfill', () => {
  it('showModal opens and close closes with one close event', () => {
    const dialog = mountDialog();
    let closes = 0;
    dialog.addEventListener('close', () => closes++);
    dialog.showModal();
    expect(dialog.open).toBe(true);
    dialog.close();
    dialog.close();
    expect(dialog.open).toBe(false);
    expect(closes).toBe(1);
  });

  it('Escape sends a cancelable cancel event and then closes the modal dialog', () => {
    const dialog = mountDialog();
    const seen: string[] = [];
    dialog.addEventListener('cancel', () => seen.push('cancel'));
    dialog.addEventListener('close', () => seen.push('close'));
    dialog.showModal();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(seen).toEqual(['cancel', 'close']);
    expect(dialog.open).toBe(false);
  });

  it('a cancelled cancel event keeps the dialog open', () => {
    const dialog = mountDialog();
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.showModal();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog.open).toBe(true);
  });

  it('Escape does nothing when no modal dialog is open', () => {
    const dialog = mountDialog();
    let cancels = 0;
    dialog.addEventListener('cancel', () => cancels++);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancels).toBe(0);
  });
});

describe('matchMedia stub', () => {
  it('reports reduced motion as set by the test and fires change when it flips', () => {
    const list = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changes: boolean[] = [];
    list.addEventListener('change', (event) => changes.push(event.matches));
    expect(list.matches).toBe(false);
    setReducedMotion(true);
    expect(list.matches).toBe(true);
    expect(window.matchMedia('(prefers-reduced-motion: no-preference)').matches).toBe(false);
    setReducedMotion(true);
    setReducedMotion(false);
    expect(changes).toEqual([true, false]);
  });

  it('starts every test with no motion preference', () => {
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false);
    expect(window.matchMedia('(min-width: 48rem)').matches).toBe(false);
  });
});
