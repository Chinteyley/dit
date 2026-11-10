export type MorseSymbol = '.' | '-';
export type CommandName = 'speak' | 'next' | 'backspace' | 'sos';
export type EngineMode = 'adaptive' | 'fixed';

/** One engine output, in emission order. */
export type EngineEvent =
  | { readonly type: 'symbol'; readonly symbol: MorseSymbol }
  | { readonly type: 'char'; readonly char: string }
  | { readonly type: 'space' }
  | { readonly type: 'command'; readonly command: CommandName }
  | { readonly type: 'unknown'; readonly pattern: string };

/** Running estimates of the user's dot and dash press lengths, in milliseconds. */
export interface Estimates {
  readonly dotEstimate: number;
  readonly dashEstimate: number;
}

export interface EstimateSnapshot extends Estimates {
  /** (dot + dash) / 2 */
  readonly dotDashThreshold: number;
  /** 2 × dot */
  readonly letterGapThreshold: number;
  /** 4.5 × dot */
  readonly wordGapThreshold: number;
}

export interface EngineConfig {
  /** Default 6. Valid: finite, 2 ≤ wpm ≤ 20. */
  readonly startingWpm?: number;
  /** Default 0.15. Valid: finite, 0 < α ≤ 1. */
  readonly adaptationRate?: number;
  /** Supply both initial estimates or neither. Each must be finite and > 0. */
  readonly initialDotEstimate?: number;
  readonly initialDashEstimate?: number;
  /** Default 'adaptive'. */
  readonly mode?: EngineMode;
}

export type EngineConfigError =
  | { readonly setting: 'startingWpm'; readonly value: unknown }
  | { readonly setting: 'adaptationRate'; readonly value: unknown }
  | {
      readonly setting: 'initialDotEstimate';
      readonly value: unknown;
      readonly reason: 'missing' | 'invalid';
    }
  | {
      readonly setting: 'initialDashEstimate';
      readonly value: unknown;
      readonly reason: 'missing' | 'invalid';
    };
