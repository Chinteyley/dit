// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { setReducedMotion, topLayer } from './test-setup';

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

  it('show opens without the top layer, and Escape sends it no cancel event', () => {
    const dialog = mountDialog();
    let cancels = 0;
    dialog.addEventListener('cancel', () => cancels++);
    dialog.show();
    dialog.show();
    expect(dialog.open).toBe(true);
    expect(topLayer()).toEqual([]);
    expect(dialog.matches(':modal')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancels).toBe(0);
    expect(dialog.open).toBe(true);
  });

  it('throws InvalidStateError when a dialog is opened the other way, and ignores a repeat of the same way', () => {
    const modal = mountDialog();
    const plain = mountDialog();
    modal.showModal();
    modal.showModal();
    plain.show();
    expect(() => modal.show()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(() => plain.showModal()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(() => document.createElement('dialog').showModal()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(topLayer()).toEqual([modal]);
  });

  it('fires toggle events with the old and new state for every open and close', () => {
    const dialog = mountDialog();
    const states: string[] = [];
    dialog.addEventListener('toggle', (event) => {
      const { oldState, newState } = event as Event & { oldState: string; newState: string };
      states.push(`${oldState}>${newState}`);
    });
    dialog.showModal();
    dialog.close();
    dialog.show();
    dialog.close();
    expect(states).toEqual(['closed>open', 'open>closed', 'closed>open', 'open>closed']);
  });

  it('keeps the top layer in opening order and matches :modal in every selector method', () => {
    const first = mountDialog();
    const second = mountDialog();
    first.showModal();
    second.showModal();
    expect(topLayer()).toEqual([first, second]);
    expect(document.querySelectorAll('dialog:modal')).toHaveLength(2);
    second.close();
    expect(topLayer()).toEqual([first]);
    expect(document.querySelector('dialog:modal')).toBe(first);
    expect(first.matches(':modal')).toBe(true);
    expect(second.matches(':modal')).toBe(false);
    const inner = document.createElement('p');
    first.append(inner);
    expect(inner.closest('dialog:modal')).toBe(first);
    expect(document.body.querySelector(':modal')).toBe(first);
    first.close();
    expect(document.querySelector('dialog:modal')).toBeNull();
  });

  it('handles Escape after every keydown listener ran, so a late window listener still sees the dialog open', () => {
    const dialog = mountDialog();
    dialog.showModal();
    const seen: boolean[] = [];
    const late = (): void => {
      seen.push(dialog.open);
    };
    window.addEventListener('keydown', late);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.removeEventListener('keydown', late);
    expect(seen).toEqual([true]);
    expect(dialog.open).toBe(false);
  });

  it('keeps the dialog open when a late keydown listener cancels Escape', () => {
    const dialog = mountDialog();
    dialog.showModal();
    const cancel = (event: Event): void => event.preventDefault();
    window.addEventListener('keydown', cancel);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', cancel);
    expect(dialog.open).toBe(true);
  });

  it('sends Escape to the newest modal dialog only', () => {
    const lower = mountDialog();
    const upper = mountDialog();
    const cancelled: string[] = [];
    lower.addEventListener('cancel', () => cancelled.push('lower'));
    upper.addEventListener('cancel', () => cancelled.push('upper'));
    lower.showModal();
    upper.showModal();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelled).toEqual(['upper']);
    expect(lower.open).toBe(true);
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
