/**
 * fast-check generators shared by the expansion property tests. Test-only: never re-exported
 * from index.ts.
 */
import fc from 'fast-check';
import { PHRASE_INDEX } from '../lexicon';
import type { Turn } from '../schema';
import { WORD_LIST } from '../word-freq';

/** Minimum fast-check runs for every expansion property (Requirement 18.8). */
export const PROP_RUNS = 200;

// ---------------------------------------------------------------------------
// Characters and strings

/** The 4 Whitespace characters. */
export const wsCharArb: fc.Arbitrary<string> = fc.constantFrom(' ', '\t', '\n', '\r');

/** Strings made only of Whitespace (possibly empty). */
export const wsArb: fc.Arbitrary<string> = fc.string({ unit: wsCharArb, maxLength: 6 });

/** Characters that look like Whitespace but are not Whitespace, so they must never be trimmed. */
export const nonWsLookalikeArb: fc.Arbitrary<string> = fc.constantFrom('\u00A0', '\u2028', '\uFEFF', '\u3000');

const asciiPrintableArb = fc.integer({ min: 0x20, max: 0x7e }).map((code) => String.fromCharCode(code));
const bmpArb = fc.integer({ min: 0xa0, max: 0xd7ff }).map((code) => String.fromCharCode(code));
/** Astral characters take 2 UTF-16 code units. */
const astralArb = fc.integer({ min: 0x10000, max: 0x10ffff }).map((code) => String.fromCodePoint(code));

/** One character of 1 or 2 UTF-16 code units, mixing ASCII, Whitespace, look-alikes, BMP and astral characters. */
export const charPieceArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: asciiPrintableArb },
  { weight: 2, arbitrary: wsCharArb },
  { weight: 1, arbitrary: nonWsLookalikeArb },
  { weight: 2, arbitrary: bmpArb },
  { weight: 2, arbitrary: astralArb },
);

/** Lengths from [min, max], biased to both ends. */
export function lengthArb(min: number, max: number): fc.Arbitrary<number> {
  return fc.oneof(fc.constant(min), fc.constant(max), fc.integer({ min, max }));
}

/** Builds a string of exactly `length` UTF-16 code units from `pieces` (each 1 or 2 units). */
function fitToLength(pieces: readonly string[], length: number): string {
  let out = '';
  for (const piece of pieces) {
    const room = length - out.length;
    if (room <= 0) break;
    out += piece.length <= room ? piece : 'z';
  }
  return out;
}

/**
 * Strings whose UTF-16 length lies in [min, max] (biased to both ends), including astral
 * characters, Whitespace and look-alikes.
 */
export function textWithLenArb(min: number, max: number, pieceArb: fc.Arbitrary<string> = charPieceArb): fc.Arbitrary<string> {
  return lengthArb(min, max).chain((length) =>
    fc.array(pieceArb, { minLength: length, maxLength: length }).map((pieces) => fitToLength(pieces, length)),
  );
}

/** Whitespace-only strings of exactly the given length range. */
export function wsOnlyWithLenArb(min: number, max: number): fc.Arbitrary<string> {
  return textWithLenArb(min, max, wsCharArb);
}

// ---------------------------------------------------------------------------
// Turns

export const roleArb: fc.Arbitrary<Turn['role']> = fc.constantFrom('speaker', 'partner');

/** Turn text lengths biased to 1, 2, 499 and 500, including Whitespace-only texts. */
export const turnTextArb: fc.Arbitrary<string> = fc.oneof(
  textWithLenArb(1, 2),
  textWithLenArb(499, 500),
  textWithLenArb(1, 500),
  wsOnlyWithLenArb(1, 500),
);

/** Valid Turns (accepted by TurnSchema). */
export const turnArb: fc.Arbitrary<Turn> = fc.record({ role: roleArb, text: turnTextArb }, { noNullPrototype: true });

// ---------------------------------------------------------------------------
// Tokens and renderings (lexicon-based)

export const letterArb: fc.Arbitrary<string> = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz');
const digitArb = fc.constantFrom(...'0123456789');

export const knownWordArb: fc.Arbitrary<string> = fc.constantFrom(...WORD_LIST);

/** Proper_Prefixes of Word_List entries (some are Known_Words themselves). */
export const properPrefixArb: fc.Arbitrary<string> = fc
  .constantFrom(...WORD_LIST.filter((word) => word.length > 1))
  .chain((word) => fc.integer({ min: 1, max: word.length - 1 }).map((k) => word.slice(0, k)));

const KNOWN = new Set(WORD_LIST);

/** Proper_Prefixes of Word_List entries that are not Known_Words (they make an input 'partial'). */
export const unknownProperPrefixArb: fc.Arbitrary<string> = properPrefixArb.filter((prefix) => !KNOWN.has(prefix));

/** Tokens made of a-z and 0-9: words, prefixes, single letters, random letters and digits. */
export const tokenArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: knownWordArb },
  { weight: 2, arbitrary: properPrefixArb },
  { weight: 2, arbitrary: letterArb },
  { weight: 2, arbitrary: fc.string({ unit: letterArb, minLength: 1, maxLength: 15 }) },
  { weight: 1, arbitrary: fc.string({ unit: digitArb, minLength: 1, maxLength: 4 }) },
);

/**
 * Characters outside a-z, 0-9 and Whitespace whose lowercase form is not ASCII either, so
 * normalization deletes them. A-Z, U+212A and U+0130 are deliberately absent.
 */
export const junkCharArb: fc.Arbitrary<string> = fc.constantFrom(
  '.', ',', '!', '?', "'", '"', '-', '(', ')', ';', ':', '/', '<', '>', '{', '}', '\\',
  'é', 'É', 'ñ', 'ß', 'λ', 'д', '中', '😀', '\u00A0', '\u2028', '\uFEFF', '\u3000', '\u0301',
);

const optionalJunkArb = fc.option(junkCharArb, { nil: '', freq: 3 });

/** One token with random capitals and deleted characters inserted between its characters. */
function renderTokenArb(token: string): fc.Arbitrary<string> {
  return fc
    .array(fc.tuple(fc.boolean(), optionalJunkArb), { minLength: token.length, maxLength: token.length })
    .map((marks) =>
      token
        .split('')
        .map((ch, i) => {
          const [upper, junk] = marks[i] ?? [false, ''];
          return junk + (upper ? ch.toUpperCase() : ch);
        })
        .join(''),
    );
}

/**
 * Renders tokens as typed text whose Normalized_Tokens are exactly `tokens`: random Whitespace
 * runs between tokens, random capitals, and deleted characters between and inside tokens.
 */
export function renderTokensArb(tokens: readonly string[]): fc.Arbitrary<string> {
  const gapArb = fc
    .tuple(optionalJunkArb, fc.string({ unit: wsCharArb, minLength: 1, maxLength: 3 }), optionalJunkArb)
    .map(([before, ws, after]) => before + ws + after);
  const edgeArb = fc.tuple(wsArb, optionalJunkArb);
  const gaps = Math.max(0, tokens.length - 1);
  return fc
    .tuple(
      fc.tuple(...tokens.map(renderTokenArb)),
      fc.array(gapArb, { minLength: gaps, maxLength: gaps }),
      edgeArb,
      edgeArb,
    )
    .map(([rendered, between, [leadWs, leadJunk], [trailWs, trailJunk]]) => {
      const body = rendered.map((piece, i) => (i === 0 ? piece : (between[i - 1] ?? ' ') + piece)).join('');
      return leadJunk + leadWs + body + trailWs + trailJunk;
    });
}

/** A token list and one rendering of it. */
export const renderedTokensArb: fc.Arbitrary<{ readonly tokens: readonly string[]; readonly text: string }> = fc
  .array(tokenArb, { maxLength: 15 })
  .chain((tokens) => renderTokensArb(tokens).map((text) => ({ tokens, text })));

const PHRASE_INITIALS = PHRASE_INDEX.map((entry) => entry.initials).filter((s) => s.length >= 2 && s.length <= 12);

/** Initials_Letters of 2 to 12 letters, biased toward phrase-bank initials and their prefixes. */
export const initialsLettersArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...PHRASE_INITIALS),
  fc.constantFrom(...PHRASE_INITIALS).chain((s) => fc.integer({ min: 2, max: s.length }).map((k) => s.slice(0, k))),
  fc.string({ unit: letterArb, minLength: 2, maxLength: 12 }),
);

/** Context_Words that appear in the phrase bank. */
export const PHRASE_CONTEXT_WORDS: readonly string[] = [...new Set(PHRASE_INDEX.flatMap((entry) => [...entry.contextWords]))];

/** Partner lines built from 1 to 6 words that often appear in phrases (so Context_Scores vary). */
export const phraseWordsTextArb: fc.Arbitrary<string> = fc
  .array(fc.oneof(fc.constantFrom(...PHRASE_CONTEXT_WORDS), knownWordArb), { minLength: 1, maxLength: 6 })
  .chain(renderTokensArb);

/** 0 to 10 valid Turns whose partner texts often reuse Context_Words from phrases. */
export const contextArb: fc.Arbitrary<Turn[]> = fc.array(
  fc.oneof(
    fc.record({ role: fc.constant<Turn['role']>('partner'), text: phraseWordsTextArb }, { noNullPrototype: true }),
    fc.record({ role: roleArb, text: fc.oneof(phraseWordsTextArb, turnTextArb) }, { noNullPrototype: true }),
  ),
  { maxLength: 10 },
);
