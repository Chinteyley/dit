// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { localStorageBackend } from './browser';

const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

afterEach(() => {
  if (original !== undefined) Object.defineProperty(window, 'localStorage', original);
  window.localStorage.clear();
});

describe('localStorageBackend', () => {
  it('returns window.localStorage when it is available', () => {
    const backend = localStorageBackend();
    expect(backend).toBe(window.localStorage);
    backend?.setItem('k', 'v');
    expect(window.localStorage.getItem('k')).toBe('v');
  });

  it('returns null when reading window.localStorage throws', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    expect(localStorageBackend()).toBeNull();
  });
});
