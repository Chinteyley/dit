import type { InputClassification } from './classify';
import { initialsOf, suggestionKey, trimWhitespace } from './normalize';
import { CANDIDATES_MAX, SUGGESTIONS_MAX, isValidSuggestionText } from './schema';

/**
 * Cleans model candidates (Requirement 11), in this order: read only the first CANDIDATES_MAX (5)
 * entries, blank and repeated ones included, and ignore the rest; trim Whitespace and keep 1 to
 * 200 units; for initials, keep only sentences whose Initials_Of is exactly the typed letters (the
 * SpeakFaster filter); drop case-insensitive repeats, keeping the first; keep at most
 * SUGGESTIONS_MAX (3). Returns a new array and leaves the input unchanged.
 */
export function filterSuggestions(candidates: readonly string[], cls: InputClassification): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates.slice(0, CANDIDATES_MAX)) {
    if (out.length >= SUGGESTIONS_MAX) break;
    const trimmed = trimWhitespace(candidate);
    if (!isValidSuggestionText(trimmed)) continue;
    if (cls.kind === 'initials' && initialsOf(trimmed) !== cls.initials) continue;
    const key = suggestionKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
