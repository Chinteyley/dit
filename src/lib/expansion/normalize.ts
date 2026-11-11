/**
 * Whitespace and token normalization shared by the schema, classifier, expanders, filter and
 * client, so they all agree on what Whitespace, a token and "case-insensitively equal" mean.
 */

/** The glossary's Whitespace: space, tab, line feed and carriage return. Nothing else. */
export const WHITESPACE: ReadonlySet<string> = new Set([' ', '\t', '\n', '\r']);

export function isWhitespace(ch: string): boolean {
  return WHITESPACE.has(ch);
}

/**
 * Removes leading and trailing Whitespace (the 4 characters above only). Unlike
 * String.prototype.trim it keeps U+00A0, U+2028, U+FEFF and other look-alikes.
 */
export function trimWhitespace(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isWhitespace(s.charAt(start))) start += 1;
  while (end > start && isWhitespace(s.charAt(end - 1))) end -= 1;
  return s.slice(start, end);
}

const NOT_TOKEN_CHAR = /[^a-z0-9 \t\n\r]/g;
const WHITESPACE_RUN = /[ \t\n\r]+/;

/**
 * Lowercases, deletes every character outside a-z, 0-9 and Whitespace, then splits on runs of
 * Whitespace and drops empty tokens. Lowercasing comes first, so a character whose lowercase form
 * is ASCII (U+212A KELVIN SIGN becomes k) survives.
 */
export function normalizedTokens(s: string): readonly string[] {
  return s
    .toLowerCase()
    .replace(NOT_TOKEN_CHAR, '')
    .split(WHITESPACE_RUN)
    .filter((token) => token.length > 0);
}

/** The first character of each Normalized_Token, joined in order. */
export function initialsOf(s: string): string {
  return normalizedTokens(s)
    .map((token) => token.charAt(0))
    .join('');
}

/** The key for case-insensitive equality of suggestions. */
export function suggestionKey(s: string): string {
  return s.toLowerCase();
}
