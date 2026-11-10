/**
 * The expansion client the UI calls on every change of typed text or context (Requirements 15
 * and 16). It debounces, keeps at most one request to POST /api/expand in flight, caches 'ai'
 * results, and falls back to the injected on-device expander for every failure, so the caller
 * always gets one result per live expansion and never an error. Network, timers, the online
 * check and the on-device expander are all injected; this module never imports on-device.ts.
 */
import { runWithDeadline, type DeadlineOutcome, type Timers } from './deadline';
import { trimWhitespace } from './normalize';
import { CONTEXT_MAX_TURNS, ExpandResponseSchema, REQUEST_TEXT_MAX, TURN_TEXT_MAX, type Turn } from './schema';

export const DEBOUNCE_MS = 300;
export const CLIENT_TIMEOUT_MS = 5_000;
export const CACHE_MAX = 20;
export const EXPAND_ENDPOINT = '/api/expand';

export interface ExpansionResult {
  /** The trimmed typed text this result answers. */
  readonly text: string;
  readonly suggestions: readonly string[];
  readonly source: 'ai' | 'on-device';
}

export interface ClientDeps {
  readonly fetch: typeof fetch;
  readonly timers: Timers;
  readonly isOnline: () => boolean;
  readonly expandOnDevice: (text: string, context: readonly Turn[]) => readonly string[];
}

export interface ExpansionClient {
  /** Call on every change of typed text or context. Never throws. */
  update(text: string, context: readonly Turn[]): void;
  /** Clears the debounce timer and aborts any pending request. */
  dispose(): void;
}

/** Drops blank Turns, keeps the latest 10, oldest first, and cuts each text to 500 units. */
export function prepareContext(context: readonly Turn[]): Turn[] {
  return context
    .filter((turn) => trimWhitespace(turn.text) !== '')
    .slice(-CONTEXT_MAX_TURNS)
    .map((turn) => ({ role: turn.role, text: turn.text.slice(0, TURN_TEXT_MAX) }));
}

function cacheKey(trimmed: string, prepared: readonly Turn[]): string {
  return JSON.stringify([trimmed, prepared.map((turn) => [turn.role, turn.text])]);
}

interface RouteReply {
  readonly status: number;
  readonly bodyText: string;
}

/** An 'ai' result only for status 200 with a schema-valid body holding at least one suggestion. */
function aiResultOf(outcome: DeadlineOutcome<RouteReply>, trimmed: string): ExpansionResult | undefined {
  if (outcome.kind !== 'ok' || outcome.value.status !== 200) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(outcome.value.bodyText);
  } catch {
    return undefined;
  }
  const parsed = ExpandResponseSchema.safeParse(json);
  if (!parsed.success || parsed.data.suggestions.length === 0) return undefined;
  return { text: trimmed, suggestions: parsed.data.suggestions, source: 'ai' };
}

export function createExpansionClient(deps: ClientDeps, onResult: (result: ExpansionResult) => void): ExpansionClient {
  let latestText = '';
  let latestContext: readonly Turn[] = [];
  let debounce: { readonly handle: unknown } | null = null;
  let pending: AbortController | null = null;
  let disposed = false;
  /** LRU by insertion order: the first key is the least recently used. */
  const cache = new Map<string, ExpansionResult>();

  const deliver = (result: ExpansionResult): void => {
    try {
      onResult(result);
    } catch {
      // A failing UI callback must not break the client.
    }
  };

  const onDevice = (trimmed: string, prepared: readonly Turn[]): ExpansionResult => {
    try {
      return { text: trimmed, suggestions: [...deps.expandOnDevice(trimmed, prepared)], source: 'on-device' };
    } catch {
      return { text: trimmed, suggestions: [], source: 'on-device' };
    }
  };

  const online = (): boolean => {
    try {
      return deps.isOnline();
    } catch {
      return false;
    }
  };

  const remember = (key: string, result: ExpansionResult): void => {
    cache.delete(key);
    cache.set(key, result);
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next();
      if (oldest.done === true) break;
      cache.delete(oldest.value);
    }
  };

  const clearDebounce = (): void => {
    if (debounce !== null) deps.timers.clearTimeout(debounce.handle);
    debounce = null;
  };

  const postAndRead = async (body: string, signal: AbortSignal): Promise<RouteReply> => {
    const res = await deps.fetch(EXPAND_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
    });
    if (res.status !== 200) {
      res.body?.cancel().catch(() => undefined);
      return { status: res.status, bodyText: '' };
    }
    return { status: res.status, bodyText: await res.text() };
  };

  const start = (text: string, context: readonly Turn[]): void => {
    pending?.abort();
    pending = null;
    const trimmed = trimWhitespace(text);
    if (trimmed === '') {
      deliver({ text: '', suggestions: [], source: 'on-device' });
      return;
    }
    const prepared = prepareContext(context);
    if (trimmed.length > REQUEST_TEXT_MAX || !online()) {
      deliver(onDevice(trimmed, prepared));
      return;
    }
    const key = cacheKey(trimmed, prepared);
    const hit = cache.get(key);
    if (hit !== undefined) {
      remember(key, hit);
      deliver(hit);
      return;
    }
    const controller = new AbortController();
    pending = controller;
    const body = JSON.stringify({ text: trimmed, context: prepared });
    runWithDeadline((signal) => postAndRead(body, signal), {
      ms: CLIENT_TIMEOUT_MS,
      timers: deps.timers,
      signal: controller.signal,
    })
      .then((outcome) => {
        if (pending === controller) pending = null;
        // Superseded by a newer expansion: nothing is delivered and nothing runs on-device.
        if (outcome.kind === 'aborted' || disposed) return;
        // The text changed while the request was out: discard, and do not cache.
        if (text !== latestText) return;
        const ai = aiResultOf(outcome, trimmed);
        if (ai !== undefined) {
          remember(key, ai);
          deliver(ai);
        } else {
          deliver(onDevice(trimmed, prepared));
        }
      })
      .catch(() => undefined);
  };

  return {
    update(text, context) {
      try {
        if (disposed) return;
        latestContext = context;
        if (text === latestText) return;
        latestText = text;
        clearDebounce();
        debounce = {
          handle: deps.timers.setTimeout(() => {
            debounce = null;
            try {
              start(latestText, latestContext);
            } catch {
              // Never throw from a timer callback.
            }
          }, DEBOUNCE_MS),
        };
      } catch {
        // update never throws.
      }
    },
    dispose() {
      disposed = true;
      try {
        clearDebounce();
      } catch {
        // ignore
      }
      pending?.abort();
      pending = null;
    },
  };
}
