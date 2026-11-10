/**
 * A controllable fake `fetch` for the route and client tests (Requirement 17). Test-only: never
 * re-exported from index.ts. Each call is recorded and returns a promise the test settles with
 * `resolve`, `reject`, or not at all. Like the real fetch, an abort rejects a pending call with
 * an AbortError and errors a body that is still being delivered.
 */

export interface ResolveOptions {
  readonly statusText?: string;
  readonly headers?: Record<string, string>;
  /** Delay, in (fake) timer milliseconds, before the body is delivered. */
  readonly bodyDelayMs?: number;
}

export interface FakeFetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
  /** The request body parsed as JSON, or undefined when it is not a JSON string. */
  readonly body: unknown;
  readonly signal: AbortSignal | undefined;
  /** True once resolve or reject was called, or the call was aborted. */
  readonly settled: boolean;
  resolve(status: number, bodyText: string, options?: ResolveOptions): void;
  reject(error: unknown): void;
}

export interface FakeFetch {
  readonly fetch: typeof fetch;
  readonly calls: readonly FakeFetchCall[];
  /** Answers every future call at once with this status and body (resets with undefined). */
  autoRespond(responder: ((call: FakeFetchCall) => { status: number; body: string } | undefined) | undefined): void;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function parseBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') return undefined;
  try {
    return JSON.parse(init.body) as unknown;
  } catch {
    return undefined;
  }
}

/** A real Response whose status may be any integer (the constructor only allows 200 to 599). */
function makeResponse(status: number, bodyText: string, options: ResolveOptions, signal: AbortSignal | undefined): Response {
  const bytes = new TextEncoder().encode(bodyText);
  const delay = options.bodyDelayMs ?? 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    start(controller) {
      const deliver = (): void => {
        if (cancelled || signal?.aborted === true) return;
        try {
          controller.enqueue(bytes);
          controller.close();
        } catch {
          // the reader errored or cancelled the stream first
        }
      };
      signal?.addEventListener('abort', () => {
        try {
          controller.error(abortError());
        } catch {
          // already closed
        }
      });
      if (delay > 0) setTimeout(deliver, delay);
      else deliver();
    },
  });
  const response = new Response(stream, { status: 200, headers: options.headers ?? {} });
  Object.defineProperty(response, 'status', { value: status });
  Object.defineProperty(response, 'ok', { value: status >= 200 && status <= 299 });
  Object.defineProperty(response, 'statusText', { value: options.statusText ?? '' });
  return response;
}

export function createFakeFetch(): FakeFetch {
  const calls: FakeFetchCall[] = [];
  let responder: ((call: FakeFetchCall) => { status: number; body: string } | undefined) | undefined;

  const fake = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    new Promise<Response>((resolvePromise, rejectPromise) => {
      const signal = init?.signal ?? undefined;
      let settled = false;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const call: FakeFetchCall = {
        url,
        init,
        body: parseBody(init),
        signal,
        get settled() {
          return settled;
        },
        resolve(status, bodyText, options = {}) {
          if (settled) return;
          settled = true;
          resolvePromise(makeResponse(status, bodyText, options, signal));
        },
        reject(error) {
          if (settled) return;
          settled = true;
          rejectPromise(error);
        },
      };
      calls.push(call);
      if (signal?.aborted === true) {
        call.reject(abortError());
        return;
      }
      signal?.addEventListener('abort', () => call.reject(abortError()));
      const auto = responder?.(call);
      if (auto !== undefined) call.resolve(auto.status, auto.body);
    });

  return {
    fetch: fake as typeof fetch,
    calls,
    autoRespond(next) {
      responder = next;
    },
  };
}

/** A Provider reply whose first choice has this content. */
export function providerReply(content: string): string {
  return JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content } }] });
}
