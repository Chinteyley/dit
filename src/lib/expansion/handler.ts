/**
 * The logic of POST /api/expand (Requirements 12 to 14) as a pure function of the request and
 * injected dependencies. It uses only WHATWG globals (Request, Response, TextDecoder,
 * AbortController) and never reads process.env: route.ts passes the environment, fetch, timers,
 * clock, rate limiter and logger in. It keeps no module state; request text, context and model
 * output live only in local variables of one call, and the log line holds only status and latency.
 */
import { classify } from './classify';
import type { Timers } from './deadline';
import { filterSuggestions } from './filter';
import { trimWhitespace } from './normalize';
import { buildPrompt, parseModelOutput } from './prompt';
import { callProvider } from './provider';
import { UNKNOWN_CLIENT_KEY, type RateLimiter } from './rate-limit';
import { ExpandRequestSchema, ExpandResponseSchema, type ExpandRequest } from './schema';

export interface ExpandEnv {
  /** DIT_LLM_API_KEY */
  readonly apiKey: string | undefined;
  /** DIT_LLM_BASE_URL */
  readonly baseUrl: string | undefined;
  /** DIT_MODEL */
  readonly model: string | undefined;
}

export interface ExpandDeps {
  readonly env: ExpandEnv;
  readonly fetch: typeof fetch;
  readonly timers: Timers;
  readonly now: () => number;
  readonly rateLimiter: RateLimiter;
  readonly log: (entry: { readonly status: number; readonly latencyMs: number }) => void;
}

export type ErrorCode =
  | 'forbidden_origin'
  | 'rate_limited'
  | 'payload_too_large'
  | 'invalid_request'
  | 'not_configured'
  | 'upstream_failed'
  | 'upstream_timeout';

/** The largest request body the route accepts, in bytes. */
export const BODY_LIMIT_BYTES = 16_384;

/** Every response: JSON, never cached. */
export function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function errorResponse(status: number, error: ErrorCode, extraHeaders?: Record<string, string>): Response {
  return jsonResponse(status, { error }, extraHeaders);
}

/**
 * True when the Origin header is absent, or names exactly the request URL's origin (scheme and
 * host compared case-insensitively, default ports implied) with no credentials, path, query or
 * fragment. `'null'`, unparsable values and opaque origins fail.
 */
export function checkOrigin(originHeader: string | null, requestUrl: string): boolean {
  if (originHeader === null) return true;
  if (originHeader === 'null') return false;
  let origin: URL;
  let target: URL;
  try {
    origin = new URL(originHeader);
    target = new URL(requestUrl);
  } catch {
    return false;
  }
  if (origin.username !== '' || origin.password !== '') return false;
  if (origin.pathname !== '/' || origin.search !== '' || origin.hash !== '') return false;
  if (origin.origin === 'null') return false;
  return origin.origin === target.origin;
}

/**
 * The rate-limit key: the first x-forwarded-for entry, else x-real-ip, else one shared key for
 * unknown clients. Used only as a Map key; never logged or returned.
 */
export function clientKey(headers: Headers): string {
  const forwarded = trimWhitespace((headers.get('x-forwarded-for') ?? '').split(',')[0] ?? '');
  if (forwarded !== '') return forwarded;
  const real = trimWhitespace(headers.get('x-real-ip') ?? '');
  return real !== '' ? real : UNKNOWN_CLIENT_KEY;
}

/** Reads the body, cancelling as soon as more than `limit` bytes arrive. A missing body is 0 bytes. */
export async function readBodyCapped(
  request: Request,
  limit: number,
): Promise<{ readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false }> {
  const body = request.body;
  if (body === null) return { ok: true, bytes: new Uint8Array(0) };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/** Strict UTF-8, non-empty, JSON and schema-valid; otherwise undefined. */
function parseRequest(bytes: Uint8Array): ExpandRequest | undefined {
  if (bytes.byteLength === 0) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
  const parsed = ExpandRequestSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

const CONTENT_LENGTH = /^\d+$/;

/** The checks in order (origin, rate, size, validation, configuration), then the Provider call. */
async function respond(request: Request, deps: ExpandDeps): Promise<Response> {
  if (!checkOrigin(request.headers.get('origin'), request.url)) return errorResponse(403, 'forbidden_origin');
  try {
    const decision = deps.rateLimiter.check(clientKey(request.headers), deps.now());
    if (!decision.allowed) {
      return errorResponse(429, 'rate_limited', { 'Retry-After': String(decision.retryAfterSeconds) });
    }
    const declared = request.headers.get('content-length');
    if (declared !== null && CONTENT_LENGTH.test(declared) && Number(declared) > BODY_LIMIT_BYTES) {
      return errorResponse(413, 'payload_too_large');
    }
    const body = await readBodyCapped(request, BODY_LIMIT_BYTES);
    if (!body.ok) return errorResponse(413, 'payload_too_large');
    const req = parseRequest(body.bytes);
    if (req === undefined) return errorResponse(400, 'invalid_request');
    const apiKey = deps.env.apiKey;
    if (apiKey === undefined || apiKey === '') return errorResponse(503, 'not_configured');

    const cls = classify(req.text);
    const outcome = await callProvider(
      buildPrompt(req, cls),
      { apiKey, baseUrl: deps.env.baseUrl, model: deps.env.model },
      { fetch: deps.fetch, timers: deps.timers },
    );
    if (!outcome.ok) return errorResponse(outcome.error === 'upstream_timeout' ? 504 : 502, outcome.error);
    const checked = ExpandResponseSchema.safeParse({ suggestions: filterSuggestions(parseModelOutput(outcome.content), cls) });
    if (!checked.success) return errorResponse(502, 'upstream_failed');
    return jsonResponse(200, { suggestions: checked.data.suggestions });
  } catch {
    // An unexpected failure after the origin check; its message is never logged or returned.
    return errorResponse(502, 'upstream_failed');
  }
}

/** Handles one POST /api/expand and writes exactly one log line: status and whole-ms latency. */
export async function handleExpand(request: Request, deps: ExpandDeps): Promise<Response> {
  const t0 = deps.now();
  let response: Response;
  try {
    response = await respond(request, deps);
  } catch {
    response = errorResponse(502, 'upstream_failed');
  }
  deps.log({ status: response.status, latencyMs: Math.max(0, Math.round(deps.now() - t0)) });
  return response;
}
