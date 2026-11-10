import { createKeySource, type KeySourceDeps } from './keyboard';
import type { SettingsStore } from './settings';
import type { PressSource, Result, SettingError } from './types';

/** Space and Enter belong to the Keyboard_Source; Tab and Escape stay free for partner navigation. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['Space', 'Enter', 'NumpadEnter', 'Tab', 'Escape']);

export function isReservedKey(code: string): boolean {
  return RESERVED_KEYS.has(code);
}

/** The value as a Learned_Switch_Key when it is a non-empty, non-reserved string, else null (Req 5.8). */
export function validateSwitchKey(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && !isReservedKey(value) ? value : null;
}

export interface SwitchSource extends PressSource {
  setMinPressDuration(value: unknown): Result<number, SettingError>;
  learnedKey(): string | null;
  /** Called by the learner and by clear; ends a Held press first (Req 5.13). */
  setLearnedKey(code: string | null): void;
}

const NO_CODES: ReadonlySet<string> = new Set();

/**
 * The Learned_Switch_Key keys Morse unless focus is in an Editable_Target (Req 4.9, 5.9 to 5.11).
 * The store is read once per start() and never written here (Req 5.7, 5.8).
 */
export function createSwitchSource(deps: KeySourceDeps & { readonly store: SettingsStore }): SwitchSource {
  let learned: string | null = null;
  let codes: ReadonlySet<string> = NO_CODES;
  const use = (code: string | null): void => {
    learned = code;
    codes = code === null ? NO_CODES : new Set([code]);
  };
  const { source, releaseActive } = createKeySource(deps, 'switch', 'switch', () => codes);

  return {
    ...source,
    start() {
      if (source.status() !== 'off') return;
      const read = deps.store.readSwitchKey();
      use(read.ok ? validateSwitchKey(read.value) : null);
      source.start();
    },
    learnedKey: () => learned,
    setLearnedKey(code) {
      // The old key's press ends now, and its later keyup passes nothing (Req 5.13).
      releaseActive();
      use(code === null ? null : validateSwitchKey(code));
    },
  };
}
