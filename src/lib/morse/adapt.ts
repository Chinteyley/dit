import { applyEstimateGuards, clamp } from './timing';
import type { Estimates, MorseSymbol } from './types';

/**
 * One EMA update for a classified press (Req 8.1–8.3).
 * observation = clamp(duration, 0.5 × prior, 2 × prior) for the classified estimate;
 * next = prior + alpha × (observation − prior); then applyEstimateGuards on both.
 * Caller guarantees duration > 0 and mode === 'adaptive'.
 */
export function adaptEstimates(
  prior: Estimates,
  symbol: MorseSymbol,
  duration: number,
  alpha: number,
): Estimates {
  if (symbol === '.') {
    return applyEstimateGuards({
      dotEstimate: emaStep(prior.dotEstimate, duration, alpha),
      dashEstimate: prior.dashEstimate,
    });
  }
  return applyEstimateGuards({
    dotEstimate: prior.dotEstimate,
    dashEstimate: emaStep(prior.dashEstimate, duration, alpha),
  });
}

/** One stuck or interrupted press can move the estimate at most halfway down or double it up. */
function emaStep(estimate: number, duration: number, alpha: number): number {
  const observation = clamp(duration, 0.5 * estimate, 2 * estimate);
  return estimate + alpha * (observation - estimate);
}
