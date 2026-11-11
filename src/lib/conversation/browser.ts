/**
 * The only file in src/lib/conversation that reads a browser global (design "lib/conversation/
 * browser.ts"). Accessing window.localStorage throws when storage is disabled (for example when
 * the browser blocks site data); the hook then uses memoryBackend() and shows one save-failure
 * message (Req 16.9). No probe key is written: the app writes only its two records.
 */
import type { KeyValueBackend } from './storage';

export function localStorageBackend(): KeyValueBackend | null {
  try {
    const storage = window.localStorage;
    return typeof storage === 'object' && storage !== null ? storage : null;
  } catch {
    return null;
  }
}
