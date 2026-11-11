import { describe, expect, it } from 'vitest';
import { UNKNOWN_CLIENT_KEY, createRateLimiter, decide } from './rate-limit';

const CONFIG = { limit: 30, windowMs: 60_000 };

describe('createRateLimiter', () => {
  it('allows 30 requests, then rejects with Retry-After 60 at the same instant', () => {
    const limiter = createRateLimiter(CONFIG);
    for (let i = 0; i < 30; i += 1) expect(limiter.check('1.2.3.4', 1_000)).toStrictEqual({ allowed: true });
    expect(limiter.check('1.2.3.4', 1_000)).toStrictEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(limiter.check('5.6.7.8', 1_000)).toStrictEqual({ allowed: true });
  });

  it('does not count rejected requests and allows again when the window has passed', () => {
    const limiter = createRateLimiter(CONFIG);
    for (let i = 0; i < 30; i += 1) limiter.check('k', 0);
    expect(limiter.check('k', 59_999)).toStrictEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.check('k', 60_000)).toStrictEqual({ allowed: true });
  });

  it('rounds Retry-After up to whole seconds', () => {
    const limiter = createRateLimiter(CONFIG);
    for (let i = 0; i < 30; i += 1) limiter.check('k', 0);
    expect(limiter.check('k', 30_500)).toStrictEqual({ allowed: false, retryAfterSeconds: 30 });
    expect(limiter.check('k', 30_001)).toStrictEqual({ allowed: false, retryAfterSeconds: 30 });
    expect(limiter.check('k', 29_999)).toStrictEqual({ allowed: false, retryAfterSeconds: 31 });
  });

  it('forgets a key 60,000 ms after its newest counted request', () => {
    const limiter = createRateLimiter(CONFIG);
    limiter.check('a', 0);
    limiter.check(UNKNOWN_CLIENT_KEY, 10_000);
    expect(limiter.size()).toBe(2);
    limiter.check('b', 59_999);
    expect(limiter.size()).toBe(3);
    limiter.check('b', 60_000);
    expect(limiter.size()).toBe(2);
    limiter.check('b', 70_000);
    expect(limiter.size()).toBe(1);
  });
});

describe('decide', () => {
  it('keeps only timestamps inside the window and appends the allowed one', () => {
    expect(decide([0, 10_005, 10_010, 70_000], 70_005, CONFIG)).toStrictEqual({
      decision: { allowed: true },
      times: [10_010, 70_000, 70_005],
    });
  });

  it('clamps Retry-After to 60 when stored times are in the future', () => {
    const times = Array.from({ length: 30 }, () => 90_000);
    expect(decide(times, 10_000, CONFIG).decision).toStrictEqual({ allowed: false, retryAfterSeconds: 60 });
  });
});
