import type { Result } from '@/lib/morse';

export type { Result };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type SourceKind = 'keyboard' | 'switch' | 'pointer' | 'blink';
export const SOURCE_KINDS: readonly SourceKind[] = Object.freeze(['keyboard', 'switch', 'pointer', 'blink'] as const);

export type PressKind = 'down' | 'up';

/** Exactly three fields (Req 1.1). Created only through pressEvent(). */
export interface PressEvent {
  readonly kind: PressKind;
  /** Finite ms in the Clock's time base. */
  readonly t: number;
  readonly source: SourceKind;
}

export const pressEvent = (kind: PressKind, t: number, source: SourceKind): PressEvent =>
  Object.freeze({ kind, t, source });

export type SourceStatus =
  | 'off'
  | 'starting'
  | 'active'
  | 'face-lost'
  | 'permission-denied'
  | 'no-camera'
  | 'unsupported'
  | 'error';

export type FailureStatus = 'unsupported' | 'permission-denied' | 'no-camera' | 'error';

export const FAILURE_STATUSES: readonly FailureStatus[] = Object.freeze([
  'unsupported',
  'permission-denied',
  'no-camera',
  'error',
] as const);

export function isFailureStatus(status: SourceStatus): status is FailureStatus {
  return (FAILURE_STATUSES as readonly SourceStatus[]).includes(status);
}

export type Unsubscribe = () => void;

/** The shared source contract (Req 1.2). */
export interface PressSource {
  readonly kind: SourceKind;
  /** No-op unless status is 'off' (Req 1.3, 1.6). Never throws. */
  start(): void;
  /** No-op when status is 'off' (Req 1.4 to 1.6). Never throws. */
  stop(): void;
  status(): SourceStatus;
  /** Raw_Down timestamp of the Debouncer's Pending_Press, or null (Req 2.13). */
  pendingSince(): number | null;
  onPress(listener: (event: PressEvent) => void): Unsubscribe;
  onStatus(listener: (status: SourceStatus) => void): Unsubscribe;
  onPending(listener: (since: number | null) => void): Unsubscribe;
}

export interface SettingError {
  readonly source: SourceKind;
  readonly setting: 'minPressDuration' | 'closeThreshold' | 'openThreshold';
  readonly value: unknown;
  readonly message: string;
}
