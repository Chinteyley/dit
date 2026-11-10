import { z } from 'zod';
import { isWhitespace, suggestionKey, trimWhitespace } from './normalize';

/** Limits shared by the client and the route. Lengths are UTF-16 code units (`string.length`). */
export const TURN_TEXT_MAX = 500;
export const REQUEST_TEXT_MAX = 200;
export const CONTEXT_MAX_TURNS = 10;
export const SUGGESTIONS_MAX = 3;
export const SUGGESTION_TEXT_MAX = 200;

/** 1 to 200 UTF-16 code units with at least one character that is not Whitespace. */
export function isValidSuggestionText(s: string): boolean {
  if (s.length < 1 || s.length > SUGGESTION_TEXT_MAX) return false;
  for (const ch of s) {
    if (!isWhitespace(ch)) return true;
  }
  return false;
}

/** True when no two entries are equal after lowercasing. */
export function distinctCaseInsensitive(list: readonly string[]): boolean {
  return new Set(list.map(suggestionKey)).size === list.length;
}

/**
 * A string of `min` to `max` UTF-16 code units. Zod 4.6's own string `.min`/`.max` count Unicode
 * code points, so an astral character would count as 1 instead of the 2 units the requirements use.
 */
function utf16Length(min: number, max: number): z.ZodString {
  return z.string().refine((s) => s.length >= min && s.length <= max);
}

/** One conversation line. `z.object` strips unknown keys; Turn text is not trimmed. */
export const TurnSchema = z.object({
  role: z.enum(['speaker', 'partner']),
  text: utf16Length(1, TURN_TEXT_MAX),
});

/** Body of POST /api/expand. Only the request text is trimmed, and only of the 4 Whitespace characters. */
export const ExpandRequestSchema = z.object({
  text: z.string().transform(trimWhitespace).pipe(utf16Length(1, REQUEST_TEXT_MAX)),
  context: z.array(TurnSchema).max(CONTEXT_MAX_TURNS),
});

/** Success body of POST /api/expand: 0 to 3 displayable, case-insensitively distinct sentences. */
export const ExpandResponseSchema = z.object({
  suggestions: z
    .array(z.string().refine(isValidSuggestionText))
    .max(SUGGESTIONS_MAX)
    .refine(distinctCaseInsensitive),
});

export type Turn = z.infer<typeof TurnSchema>;
export type ExpandRequest = z.infer<typeof ExpandRequestSchema>;
export type ExpandResponse = z.infer<typeof ExpandResponseSchema>;
export type Role = Turn['role'];
