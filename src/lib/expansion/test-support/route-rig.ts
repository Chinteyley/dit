/**
 * Request builders and a dependency rig for the handler tests. Test-only: never re-exported
 * from index.ts.
 */
import { vi, type Mock } from 'vitest';
import type { Timers } from '../deadline';
import type { ExpandDeps, ExpandEnv } from '../handler';
import { createRateLimiter, type RateDecision, type RateLimiter } from '../rate-limit';
import { createFakeFetch, type FakeFetch } from './fake-fetch';

export const ROUTE_URL = 'https://dit.test/api/expand';
export const SAME_ORIGIN = 'https://dit.test';

/** Obviously fake; never a real credential. */
export const TEST_API_KEY = 'test-key-not-a-secret';

export type BodyInit_ = string | Uint8Array | ReadableStream<Uint8Array> | null;

/** A POST to the route. Stream bodies need `duplex: 'half'`. */
export function post(body: BodyInit_, headers: Record<string, string> = {}, url: string = ROUTE_URL): Request {
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers,
    body: body instanceof Uint8Array ? new Blob([body.slice()]) : body,
    duplex: 'half',
  };
  return new Request(url, init);
}

/** A stream that delivers `bytes` in chunks of at most `chunk` bytes. */
export function streamOf(bytes: Uint8Array, chunk = 4_096): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
}

/** A stream that fails the test path if anything reads it. */
export function unreadableStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull() {
      throw new Error('the body must not be read');
    },
  });
}

export const fakeTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface CountingLimiter extends RateLimiter {
  /** Requests the limiter counted (allowed). */
  counted(): number;
}

export function countingLimiter(): CountingLimiter {
  const inner = createRateLimiter({ limit: 30, windowMs: 60_000 });
  let counted = 0;
  return {
    check(key, nowMs): RateDecision {
      const decision = inner.check(key, nowMs);
      if (decision.allowed) counted += 1;
      return decision;
    },
    size: () => inner.size(),
    counted: () => counted,
  };
}

export interface Rig {
  readonly deps: ExpandDeps;
  readonly fake: FakeFetch;
  readonly log: Mock<(entry: { readonly status: number; readonly latencyMs: number }) => void>;
  readonly limiter: CountingLimiter;
}

export function createRig(env: Partial<ExpandEnv> = {}, limiter: CountingLimiter = countingLimiter()): Rig {
  const fake = createFakeFetch();
  const log = vi.fn<(entry: { readonly status: number; readonly latencyMs: number }) => void>();
  const deps: ExpandDeps = {
    env: { apiKey: TEST_API_KEY, baseUrl: undefined, model: undefined, ...env },
    fetch: fake.fetch,
    timers: fakeTimers,
    now: () => Date.now(),
    rateLimiter: limiter,
    log,
  };
  return { deps, fake, log, limiter };
}

/** Parses a route response: status, the JSON body and the headers as a plain object. */
export async function readResponse(response: Response): Promise<{
  readonly status: number;
  readonly body: unknown;
  readonly text: string;
  readonly headers: Record<string, string>;
}> {
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as unknown, text, headers: Object.fromEntries(response.headers.entries()) };
}
