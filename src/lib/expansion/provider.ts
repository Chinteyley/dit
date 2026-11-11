/**
 * The one call to the OpenAI-compatible chat-completions Provider (Requirement 13), with plain
 * fetch and no vendor SDK. Server-only: imported by handler.ts, never by client code. It never
 * returns the Provider's status, headers or body, only an outcome.
 */
import { z } from 'zod';
import { runWithDeadline, type Timers } from './deadline';
import type { ChatMessage } from './prompt';

/**
 * Default_Model: DeepSeek V4.1 Flash (1017) on Fireworks serverless, the model sent when DIT_MODEL
 * is unset or empty. Chosen on 2026-11-10 from Fireworks' serverless model list
 * (https://fireworks.ai/models?filter=Serverless). That list holds no non-reasoning instruct chat
 * model any more, so this is the fast, low-cost one Fireworks recommends for extraction and
 * classification (https://docs.fireworks.ai/guides/recommended-models), and its thinking can be
 * switched off (https://docs.fireworks.ai/api-reference/post-chatcompletions, reasoning_effort),
 * so no reasoning preamble uses up the 200-token budget before the JSON answer.
 * Live check complete (task 13.4, user-verified): correct top suggestions for iwtgo, cihsw,
 * mbh, tyfc and wtt in 0.7–2.4 s.
 */
export const DEFAULT_MODEL = 'accounts/fireworks/models/deepseek-v4p1-flash-1017';

/**
 * Sent as `reasoning_effort` only when the model is DEFAULT_MODEL: 'none' disables DeepSeek V4.1
 * thinking. A DIT_MODEL override gets no such field, because other models and other
 * OpenAI-compatible providers may reject it.
 */
export const DEFAULT_MODEL_REASONING_EFFORT = 'none';

export const DEFAULT_BASE_URL = 'https://api.fireworks.ai/inference/v1';
export const MAX_OUTPUT_TOKENS = 200;
export const SERVER_TIMEOUT_MS = 4_000;

export interface ProviderConfig {
  /** DIT_LLM_API_KEY; non-empty (the handler checks before calling). */
  readonly apiKey: string;
  readonly baseUrl: string | undefined;
  readonly model: string | undefined;
}

export type ProviderOutcome =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly error: 'upstream_failed' | 'upstream_timeout' };

export interface ProviderDeps {
  readonly fetch: typeof fetch;
  readonly timers: Timers;
}

/** `{base}/chat/completions` with the non-empty base (or the Fireworks default) and no trailing `/`. */
export function providerUrl(baseUrl: string | undefined): string {
  const base = baseUrl !== undefined && baseUrl !== '' ? baseUrl : DEFAULT_BASE_URL;
  return `${base.replace(/\/+$/, '')}/chat/completions`;
}

/** The non-empty DIT_MODEL value, or DEFAULT_MODEL. */
export function resolveModel(model: string | undefined): string {
  return model !== undefined && model !== '' ? model : DEFAULT_MODEL;
}

/** Exactly model, messages and max_tokens, plus reasoning_effort only for DEFAULT_MODEL. */
export function providerRequestBody(messages: readonly [ChatMessage, ChatMessage], model: string): Record<string, unknown> {
  const body = { model, messages, max_tokens: MAX_OUTPUT_TOKENS };
  return model === DEFAULT_MODEL ? { ...body, reasoning_effort: DEFAULT_MODEL_REASONING_EFFORT } : body;
}

/** Only the first choice is read, and it must have a string message.content. */
const ProviderReplySchema = z.object({ choices: z.array(z.unknown()).min(1) });
const FirstChoiceSchema = z.object({ message: z.object({ content: z.string() }) });

function contentOf(bodyText: string): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  const reply = ProviderReplySchema.safeParse(json);
  if (!reply.success) return undefined;
  const first = FirstChoiceSchema.safeParse(reply.data.choices[0]);
  return first.success ? first.data.message.content : undefined;
}

const FAILED: ProviderOutcome = { ok: false, error: 'upstream_failed' };
const TIMED_OUT: ProviderOutcome = { ok: false, error: 'upstream_timeout' };

/**
 * Sends one POST to the Provider and waits at most SERVER_TIMEOUT_MS, measured from the fetch
 * call, for the complete body. No retry. Non-2xx, network errors and bad replies are
 * `upstream_failed`; the deadline is `upstream_timeout` (the request is aborted).
 */
export async function callProvider(
  messages: readonly [ChatMessage, ChatMessage],
  config: ProviderConfig,
  deps: ProviderDeps,
): Promise<ProviderOutcome> {
  const outcome = await runWithDeadline(
    async (signal) => {
      const res = await deps.fetch(providerUrl(config.baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(providerRequestBody(messages, resolveModel(config.model))),
        signal,
      });
      if (res.status < 200 || res.status > 299) {
        res.body?.cancel().catch(() => undefined);
        return undefined;
      }
      return await res.text();
    },
    { ms: SERVER_TIMEOUT_MS, timers: deps.timers },
  );
  switch (outcome.kind) {
    case 'ok': {
      const content = outcome.value === undefined ? undefined : contentOf(outcome.value);
      return content === undefined ? FAILED : { ok: true, content };
    }
    case 'timeout':
      return TIMED_OUT;
    case 'aborted':
    case 'error':
      return FAILED;
  }
}
