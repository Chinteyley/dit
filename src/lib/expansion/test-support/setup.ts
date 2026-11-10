/**
 * Vitest setup file (registered in vitest.config.ts): no test may reach the real network
 * (expansion Requirement 17.7). Every test file starts with a global fetch that throws, and the
 * original is put back when the file finishes.
 *
 * The blocked fetch is defined as a plain property rather than with vi.stubGlobal, so a test
 * that calls vi.unstubAllGlobals() restores the blocked fetch, not the real one.
 */
import { afterAll } from 'vitest';

const realFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

export function blockedFetch(): never {
  throw new Error('real fetch is not allowed in tests');
}

Object.defineProperty(globalThis, 'fetch', { value: blockedFetch, writable: true, configurable: true });

afterAll(() => {
  if (realFetch === undefined) {
    Reflect.deleteProperty(globalThis, 'fetch');
  } else {
    Object.defineProperty(globalThis, 'fetch', realFetch);
  }
});
