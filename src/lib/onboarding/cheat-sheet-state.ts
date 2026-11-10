/**
 * Cheat_Sheet state (design "lib/onboarding/cheat-sheet-state.ts", Requirement 10): open or
 * closed, why, and the "Not a code:" pattern. Pure; returns the same object when nothing changes.
 */

export type OpenReason = 'partner' | 'unknown';

export interface CheatSheetState {
  readonly open: boolean;
  readonly reason: OpenReason | null;
  readonly pattern: string | null;
}

export const CLOSED_SHEET: CheatSheetState = Object.freeze({ open: false, reason: null, pattern: null });

export type CheatSheetAction =
  | { readonly type: 'unknown'; readonly pattern: string }
  /** "All codes" */
  | { readonly type: 'partner-open' }
  | { readonly type: 'char-committed' }
  /** "Close codes" or Escape */
  | { readonly type: 'close' };

export interface CheatSheetContext {
  readonly onboardingOpen: boolean;
  readonly alarmActive: boolean;
}

/** The design's table. While the alarm is active every action is ignored (7.9, 10.14). */
export function cheatSheetStep(s: CheatSheetState, a: CheatSheetAction, ctx: CheatSheetContext): CheatSheetState {
  if (ctx.alarmActive) return s;
  switch (a.type) {
    case 'unknown':
      // During onboarding the pattern is not kept, so it never shows after the flow closes (10.11).
      if (ctx.onboardingOpen) return s;
      if (!s.open) return { open: true, reason: 'unknown', pattern: a.pattern }; // 10.1
      return s.pattern === a.pattern ? s : { ...s, pattern: a.pattern }; // 10.2: keep the reason
    case 'partner-open':
      if (!s.open) return { open: true, reason: 'partner', pattern: null }; // 10.5
      return s.reason === 'partner' ? s : { ...s, reason: 'partner' }; // 8.9, 10.12: keep the pattern
    case 'char-committed':
      return s.open && s.reason === 'unknown' ? CLOSED_SHEET : s; // 10.3, 10.4
    case 'close':
      return s.open ? CLOSED_SHEET : s; // 10.7, 10.13
  }
}
