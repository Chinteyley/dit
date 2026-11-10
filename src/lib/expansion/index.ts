/**
 * Public API of the expansion feature for client code. The route-only modules (handler,
 * provider, prompt, filter, rate-limit) and test-support are deliberately not exported, so the
 * client bundle never holds the prompt or the provider call.
 */
export {
  CONTEXT_MAX_TURNS,
  ExpandRequestSchema,
  ExpandResponseSchema,
  REQUEST_TEXT_MAX,
  SUGGESTIONS_MAX,
  SUGGESTION_TEXT_MAX,
  TURN_TEXT_MAX,
  TurnSchema,
  distinctCaseInsensitive,
  isValidSuggestionText,
  type ExpandRequest,
  type ExpandResponse,
  type Role,
  type Turn,
} from './schema';
export { WHITESPACE, initialsOf, isWhitespace, normalizedTokens, suggestionKey, trimWhitespace } from './normalize';
export { classify, type InputClassification, type InputKind } from './classify';
export { ON_DEVICE_MAX, expandOnDevice } from './on-device';
export {
  CACHE_MAX,
  CLIENT_TIMEOUT_MS,
  DEBOUNCE_MS,
  EXPAND_ENDPOINT,
  createExpansionClient,
  prepareContext,
  type ClientDeps,
  type ExpansionClient,
  type ExpansionResult,
} from './client';
export type { Timers } from './deadline';
