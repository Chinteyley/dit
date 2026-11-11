# Implementation Plan: expansion

## Overview

Build the expansion feature bottom-up in `src/lib/expansion/`, following the module layout and dependency graph in `design.md`, then add the thin `src/app/api/expand/route.ts` shell, then the client. Task 1 adds only the tooling this spec needs and only if it is not already present (another spec, such as `morse-engine`, may have created it). `normalize.ts` comes before `schema.ts` because `schema.ts` imports `trimWhitespace` from it.

Every correctness property in `design.md` (Properties 1 to 27) is its own required sub-task, implemented as exactly one `fc.assert` with `numRuns` of at least 200 (via `PROP_RUNS` from `test-support/arbitraries.ts`) and tagged `// Feature: expansion, Property N: <title>`. The shared generators and the fake `fetch` those properties depend on are also required. Example tests that implement Requirement 17 or are the only check of a criterion (Requirement 5, 5.7, 13.5) are required; other example tests are optional and marked `*`.

All commands use `bun run test` and `bun run typecheck`. Never run `bun test`.

## Tasks

- [x] 1. Add the tooling this spec needs, if not already present
  - [x] 1.1 Ensure base TypeScript, Vitest and fast-check tooling exists, and add Zod
    - If `package.json` is missing, create it with `"type": "module"`, `"private": true`, `"license": "MIT"` and scripts `test` (`vitest run`), `test:watch` (`vitest`) and `typecheck` (`tsc --noEmit`). If it exists, add only missing scripts and leave existing ones unchanged
    - If missing, add dev dependencies `typescript`, `vitest`, `fast-check` and `@types/node` with `bun add -d`
    - Add `zod` (version 4) as a runtime dependency with `bun add zod` if it is not already a dependency
    - If `tsconfig.json` is missing, create it with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `target` ES2022, `module` `esnext`, `moduleResolution` `bundler`, `noEmit`, `include: ["src"]`, path alias `@/*` → `src/*`, and `lib` including `ES2022`, `DOM` and `DOM.Iterable` (for `Request`, `Response`, `ReadableStream`, `AbortController`, `TextDecoder`)
    - If `vitest.config.ts` is missing, create it with `environment: 'node'`, `include: ['src/**/*.test.ts']` and `passWithNoTests: true`. If it exists, leave it unchanged in this task
    - _Requirements: 1.3, 2.8, 3.5, 17.7, 18.8_
  - [x] 1.2 Add a minimal Next.js App Router skeleton only if it is missing for the route
    - Skip this task entirely when `next` is already a dependency and `src/app/` exists
    - Otherwise add `next`, `react` and `react-dom` with `bun add`, and `@types/react` and `@types/react-dom` with `bun add -d`; add scripts `dev` (`next dev`) and `build` (`next build`) only if missing
    - Create a minimal `next.config.ts` (an empty `NextConfig` object as the default export Next.js requires) and add the `next` TypeScript plugin and `next-env.d.ts` to `tsconfig.json` only if missing
    - Do not add pages, layouts, Tailwind or ESLint here; they belong to `conversation-ui`
    - _Requirements: 13.2, 13.10_
  - [x] 1.3 Add `.env.example` and ignore real env files
    - Create or extend `.env.example` with the empty entries `DIT_LLM_API_KEY=`, `DIT_LLM_BASE_URL=` and `DIT_MODEL=`, each with a one-line comment: the key is optional and server-only, the base URL defaults to `https://api.fireworks.ai/inference/v1`, and the model defaults to `DEFAULT_MODEL` in `src/lib/expansion/provider.ts`
    - Ensure `.gitignore` exists and ignores `node_modules`, `.next` and `.env*` except `.env.example`; add only missing entries
    - _Requirements: 13.1, 13.3, 13.4, 13.5, 13.10_
  - [x] 1.4 Add the no-network test setup file
    - Create `src/lib/expansion/test-support/setup.ts` that replaces `globalThis.fetch` with a function that throws `Error('real fetch is not allowed in tests')`, restored after each test file
    - Register it in `vitest.config.ts` `setupFiles` (append to any existing list without changing other settings)
    - _Requirements: 17.7_

- [x] 2. Implement Whitespace and token normalization
  - [x] 2.1 Implement `src/lib/expansion/normalize.ts`
    - `WHITESPACE` (space, tab, line feed, carriage return), `isWhitespace`, `trimWhitespace` (these 4 characters only, not `String.prototype.trim`), `normalizedTokens` (lowercase, then delete `/[^a-z0-9 \t\n\r]/g`, then split on `/[ \t\n\r]+/`, drop empties), `initialsOf`, `suggestionKey` (`toLowerCase`)
    - _Requirements: 2.1, 3.1, 4.1, 11.1, 11.2, 11.4_
  - [x]* 2.2 Write `src/lib/expansion/normalize.test.ts`
    - `"I want, WA!"` → `["i","want","wa"]`; `"don't"` → `["dont"]`; `initialsOf("I want to go outside.") === 'iwtgo'`; `initialsOf("I'm cold") === 'ic'`; `trimWhitespace` keeps U+00A0, U+2028, U+FEFF; U+212A lowercases to `k` and survives
    - _Requirements: 2.1, 4.1_

- [x] 3. Implement the shared Zod schemas
  - [x] 3.1 Implement `src/lib/expansion/schema.ts`
    - Limit constants `TURN_TEXT_MAX`, `REQUEST_TEXT_MAX`, `CONTEXT_MAX_TURNS`, `SUGGESTIONS_MAX`, `SUGGESTION_TEXT_MAX`
    - `isValidSuggestionText` (1 to 200 UTF-16 units and at least one non-Whitespace character), `distinctCaseInsensitive` using `suggestionKey`
    - `TurnSchema`, `ExpandRequestSchema` (request `text` trimmed with `trimWhitespace` before the length check; Turn `text` not trimmed), `ExpandResponseSchema`, and inferred types `Turn`, `ExpandRequest`, `ExpandResponse`, `Role`
    - Unknown keys stripped by `z.object` default; use `safeParse` everywhere outside tests
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 3.2 Create the base generators in `src/lib/expansion/test-support/arbitraries.ts`
    - `PROP_RUNS = 200`; `wsArb` (strings over the 4 Whitespace characters); `nonWsLookalikeArb` (U+00A0, U+2028, U+FEFF, U+3000); `textWithLenArb(min, max)` with exact UTF-16 length ranges including astral characters; `turnArb` with text lengths biased to 1, 2, 499 and 500, including Whitespace-only texts
    - Test-only; not exported from `index.ts`
    - _Requirements: 18.1, 18.8_
  - [x]* 3.3 Write `src/lib/expansion/schema.test.ts`
    - Type-level assertions with `expectTypeOf` for `Turn`, `ExpandRequest`, `ExpandResponse`; examples `"  i want wa \n"` → `"i want wa"`, empty `suggestions` accepted, `Yes`/`yES` rejected
    - _Requirements: 1.3, 2.1, 2.8, 3.4, 3.5_
  - [x] 3.4 Write property test in `src/lib/expansion/schema.prop.test.ts`
    - **Property 1: Turn schema accepts exactly the valid Turns**
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.6, 18.1**
    - `fc.oneof` of a valid branch (with optional extra keys) and tagged one-break branches (text length 0 or 501, near-miss roles `'Speaker'`, `'system'`, `''`, missing or wrong-type fields, `null`, `undefined`, array, string, number, boolean); assert `success === (branch === 'valid')` and stripped output; `numRuns: PROP_RUNS`
  - [x] 3.5 Write property test in `src/lib/expansion/schema.prop.test.ts`
    - **Property 2: Request schema trims Whitespace only and enforces limits**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 18.1**
    - `text` as `ws1 + core + ws2` with core lengths 0, 1, 200, 201 and random; context lengths 0, 10, 11; one invalid Turn at a random index; leading or trailing look-alikes kept and counted; non-object values; `numRuns: PROP_RUNS`
  - [x] 3.6 Write property test in `src/lib/expansion/schema.prop.test.ts`
    - **Property 3: Response schema accepts exactly short, distinct, displayable lists**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 18.1**
    - Valid lists of 0 to 3 items plus one-break variants (4 items, 201-unit string, `''`, Whitespace-only, non-string, case-variant duplicate); extra keys stripped; non-objects rejected; `numRuns: PROP_RUNS`

- [x] 4. Add the bundled word list and phrase bank
  - [x] 4.1 Create `src/lib/expansion/word-freq.ts`
    - `WORD_LIST: readonly string[]` with at least 1,000 lowercase `a`–`z` words, most frequent first, deduplicated keeping first position, from a public-domain or permissively licensed frequency list named with its licence in a header comment
    - Include `i`, `a` and the everyday AAC words used in phrases (`water`, `outside`, `pain`, `nurse`, …); exclude `wa`, `iwtgo` and two-letter fragments that are not everyday words
    - Plain constant: no `fetch`, file read or dynamic `import()`
    - _Requirements: 4.4, 4.6, 5.6, 5.7_
  - [x] 4.2 Create `src/lib/expansion/phrase-bank.ts`
    - `PhraseCategory`, `Phrase`, `PHRASE_BANK` with at least 150 hand-written first-person AAC phrases, at least 20 per category (`needs`, `feelings`, `care`, `social`, `questions`)
    - "I want to go outside." comes before any other phrase with initials `iwtgo`; within each category, urgent and common phrases first
    - Plain constant: no `fetch`, file read or dynamic `import()`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 17.1_
  - [x] 4.3 Write `src/lib/expansion/word-freq.test.ts`
    - At least 1,000 entries; every entry matches `/^[a-z]+$/`; no duplicates; `i` and `a` present; `wa` and `iwtgo` absent; at least one entry has `wa` as a Proper_Prefix
    - _Requirements: 5.6, 17.1, 17.2_
  - [x] 4.4 Write `src/lib/expansion/phrase-bank.test.ts`
    - At least 150 phrases and at least 20 per category; every tag is one of the 5 categories; first-person token rule or `?`-ending with `you`/`your`; 1 to 200 characters, no leading or trailing Whitespace, no tab, line feed or carriage return, at least one Normalized_Token; no case-insensitive duplicates; the first `iwtgo` phrase is "I want to go outside."
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 17.1_

- [x] 5. Build the derived lexicon
  - [x] 5.1 Implement `src/lib/expansion/lexicon.ts`
    - `KNOWN_WORDS`, `PROPER_PREFIXES`, `PhraseEntry`, `PHRASE_INDEX` (index, text, tokens, initials, contextWords of length ≥ 3) built once at import without mutating the data
    - `isKnownWord`, `isProperPrefixOfSomeWord`, and `completionsOf(token)` as a lazy generator in `WORD_LIST` order
    - _Requirements: 4.4, 4.6, 5.7, 6.1, 6.2, 7.1, 7.3_
  - [x] 5.2 Write `src/lib/expansion/lexicon.test.ts`
    - Import the data and lexicon modules with `fetch` stubbed to throw and assert all tables are populated (5.7); `completionsOf('wa')` yields only entries with `wa` as a Proper_Prefix in `WORD_LIST` order; `PHRASE_INDEX[i].index === i`; data arrays unchanged after import
    - If an ESLint flat config exists, add a `no-restricted-syntax` rule banning `import()` and `fetch` in `word-freq.ts` and `phrase-bank.ts`; otherwise skip that step
    - _Requirements: 5.7, 7.1_
  - [x] 5.3 Extend `src/lib/expansion/test-support/arbitraries.ts` with lexicon-based generators
    - `tokenArb` (Word_List entries, Proper_Prefixes of entries, single letters, random `[a-z]{1,15}`, digit strings); `renderTokensArb(tokens)` (random Whitespace runs, random uppercase, inserted characters outside `[a-z0-9]` ∪ Whitespace, never `A`–`Z`-producing or ASCII-lowercasing characters such as U+212A and U+0130); `initialsLettersArb` (`[a-z]{2,12}` biased to `PHRASE_INDEX` initials and their prefixes); `contextArb` (0 to 10 Turns whose partner texts often reuse phrase Context_Words)
    - _Requirements: 18.3, 18.4, 18.5, 18.8_

- [x] 6. Implement the input classifier
  - [x] 6.1 Implement `src/lib/expansion/classify.ts`
    - `InputClassification` union and `classify(text)` applying the 5 rules in order (empty; one all-letter token of 2 to 12 not a Known_Word; 2 to 12 single letters; last token not known and a Proper_Prefix; words)
    - `initials` field only on `'initials'`; fresh object and `tokens` array per call; no input mutation
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_
  - [x] 6.2 Write `src/lib/expansion/classify.test.ts`
    - `iwtgo` and `I W T G O.` → `'initials'`/`iwtgo`; `go` → `'words'`; `i want wa` → `'partial'`; `i want water` → `'words'`; `?!` → `'empty'`; `i a` → `'initials'`/`ia`; `123` → `'words'`; 13 single letters ending in `a` → `'words'`; `i w water` → `'words'`
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 17.2_
  - [x] 6.3 Write property test in `src/lib/expansion/classify.prop.test.ts`
    - **Property 4: The classifier is total and well-formed**
    - **Validates: Requirements 4.2, 4.3, 4.8, 4.9, 4.10, 18.2**
    - `fc.string({ unit: 'binary', maxLength: 1000 })` mixed with `renderTokensArb` output; `numRuns: PROP_RUNS`
  - [x] 6.4 Write property test in `src/lib/expansion/classify.prop.test.ts`
    - **Property 5: Classification depends only on the Normalized_Tokens**
    - **Validates: Requirements 4.1, 18.3**
    - Two independent `renderTokensArb` renderings of `fc.array(tokenArb, { maxLength: 15 })`, with a precondition that `normalizedTokens(r1)` equals the tokens; `numRuns: PROP_RUNS`
  - [x] 6.5 Write property test in `src/lib/expansion/classify.prop.test.ts`
    - **Property 6: Classification follows the rule table**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**
    - Independent `refKind(ts)` using a linear scan of `WORD_LIST` (not `PROPER_PREFIXES`); token-list lengths biased to 1, 2, 12, 13; single tokens of length 1, 2, 12, 13; 13 single letters ending in a Known_Word or not; `numRuns: PROP_RUNS`

- [x] 7. Implement the on-device expander
  - [x] 7.1 Implement `src/lib/expansion/on-device.ts`
    - `ON_DEVICE_MAX = 3`, `contextScore(entry, context)` (latest partner Turn only; 0 without one), `expandOnDevice(text, context)` with the initials (exact tier then prefix tier), partial (`completionsOf`, no context) and words (token-prefix match, more tokens than input) branches, stable rank by score desc then Bank_Order asc, and `takeValid` that skips invalid lengths and case-insensitive duplicates and stops at 3
    - No clock, randomness, storage or network; copy before sorting; never mutate inputs
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [x] 7.2 Write `src/lib/expansion/on-device.test.ts`
    - With empty context unless stated: `iwtgo` and `i w t g o` give "I want to go outside." first; a prefix-tier-only initials input gives 1 to 3 suggestions whose Initials_Of has the letters as a Proper_Prefix; two same-tier phrases A (lower Bank_Order) and B appear A before B, and B before A when the latest partner Turn shares a Context_Word with B only; `i want wa` gives 1 to 3 suggestions of exactly 3 tokens starting `i want wa` with a last token in `WORD_LIST` that has `wa` as a Proper_Prefix; `?!` → `[]`
    - _Requirements: 6.1, 6.2, 6.5, 7.1, 7.6, 17.1, 17.7_
  - [x] 7.3 Write property test in `src/lib/expansion/on-device.prop.test.ts`
    - **Property 7: On-device output is always valid, repeatable and non-mutating**
    - **Validates: Requirements 6.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 18.4**
    - Arbitrary Unicode text, `renderTokensArb` text and 150 to 300 character texts ending in a Proper_Prefix; `contextArb`; `structuredClone` before the call; `vi.stubGlobal('fetch', throwingFetch)`; `numRuns: PROP_RUNS`
  - [x] 7.4 Write property test in `src/lib/expansion/on-device.prop.test.ts`
    - **Property 8: Initials suggestions follow the tier ranking**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 18.5**
    - Reference ranks `PHRASE_BANK` directly with `initialsOf` and its own context-score function; contexts with no partner Turn, several partner Turns, and 0 to 3 shared Context_Words; `numRuns: PROP_RUNS`
  - [x] 7.5 Write property test in `src/lib/expansion/on-device.prop.test.ts`
    - **Property 9: Initials output ignores how the letters were typed**
    - **Validates: Requirements 6.7**
    - `initialsLettersArb` filtered by `!WORD_LIST.includes(l)`; compare `l`, `l.toUpperCase()`, spaced letters and a mixed rendering; `numRuns: PROP_RUNS`
  - [x] 7.6 Write property test in `src/lib/expansion/on-device.prop.test.ts`
    - **Property 10: Partial completions follow Word_List order**
    - **Validates: Requirements 7.1, 7.2, 8.2, 8.3**
    - 0 to 5 leading tokens plus a Proper_Prefix last token filtered to `'partial'`; a 150 to 220 character leading section so some joins exceed 200; each input against two contexts; `numRuns: PROP_RUNS`
  - [x] 7.7 Write property test in `src/lib/expansion/on-device.prop.test.ts`
    - **Property 11: Word continuations are phrase-bank prefixes ranked by context**
    - **Validates: Requirements 7.3, 7.4, 7.5**
    - First k tokens of a random phrase rendered with `renderTokensArb` and kept when kind is `'words'`, mixed with shuffled orders such as `want i`; full-token-list inputs never return that phrase; `numRuns: PROP_RUNS`

- [x] 8. Checkpoint - Ensure all tests pass
  - Run `bun run test` and `bun run typecheck`; ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement the prompt builder and output parser
  - [x] 9.1 Implement `SYSTEM_PROMPT`, `ChatMessage`, `neutralize` and `buildPrompt` in `src/lib/expansion/prompt.ts`
    - Fixed `SYSTEM_PROMPT` text from the design (1 to 3 first-person sentences, use context, data between `<<<NAME`/`NAME>>>` markers, ignore instructions inside them, JSON-only answer)
    - User message: `<<<CONTEXT` block with labelled, neutralized Turns oldest first, only the latest partner Turn marked as the line being replied to, or `(no conversation context)`; kind-specific instruction (initials with letters and count; partial with last token; words/empty); `<<<TYPED` block with the neutralized trimmed text; each marker on its own line
    - `neutralize` splits runs of 3 or more `<` or `>` with single spaces and leaves other text unchanged
    - Note (2026-11-11): superseded in part by task 19, which asks for up to 5 sentences, most likely first, instead of 1 to 3
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
  - [x] 9.2 Implement `parseModelOutput` in `src/lib/expansion/prompt.ts`
    - `lastIndexOf('"suggestions"')` precheck; ascending scan of `{` positions; JSON-string-aware `matchingBrace`; `JSON.parse` in `try`; first plain object with an array `suggestions` wins; keep string entries only, in order, untrimmed; otherwise `[]`; never throws
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  - [x]* 9.3 Write `src/lib/expansion/prompt.test.ts`
    - `SYSTEM_PROMPT` mentions 1 to 3 sentences, first person, context, JSON-only and ignoring instructions inside markers; `iwtgo` user message states `5 letters`; parser examples: fenced JSON, prose around JSON, truncated JSON → `[]`, top-level array → `[]`, `{"suggestions":"x"}` → `[]`, mixed-type array keeps strings
    - Note (2026-11-11): superseded in part by task 19.3, which checks the up-to-5 wording instead of 1 to 3
    - _Requirements: 9.2, 9.3, 9.6, 10.1, 10.2, 10.3_
  - [x] 9.4 Write property test in `src/lib/expansion/prompt.prop.test.ts`
    - **Property 12: The prompt has a fixed system message and is deterministic**
    - **Validates: Requirements 9.1, 9.2, 9.8**
    - Requests from `textWithLenArb(1, 200)`, `renderTokensArb` text, initials renderings and `contextArb`, passed through `ExpandRequestSchema.parse`; deep-copy second call; `numRuns: PROP_RUNS`
  - [x] 9.5 Write property test in `src/lib/expansion/prompt.prop.test.ts`
    - **Property 13: The user message carries all data inside intact delimiters**
    - **Validates: Requirements 9.3, 9.4, 9.5, 9.6, 9.7**
    - Texts salted with `<<<`, `>>>`, `<<<<<`, `CONTEXT>>>`, `<<<TYPED` and newlines; contexts with 0, 1 and several partner Turns; also `neutralize(s)` has no `<<<`/`>>>` and is the identity on strings without them; `numRuns: PROP_RUNS`
  - [x] 9.6 Write property test in `src/lib/expansion/prompt.prop.test.ts`
    - **Property 14: The output parser never throws and returns only strings**
    - **Validates: Requirements 10.3, 10.4, 10.6, 18.6**
    - Strings of 0 to 10,000 characters from `fc.string({ unit: 'binary' })`, `fc.json()`, truncated `{"suggestions": …}` JSON, runs of `{`, `"` and `\`, unclosed fences, non-string array elements; `numRuns: PROP_RUNS`
  - [x] 9.7 Write property test in `src/lib/expansion/prompt.prop.test.ts`
    - **Property 15: The parser extracts the earliest suggestions object**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.5**
    - Prefix without `{`, optional ```` ```json ```` or ```` ``` ```` fence, `extra` keys, suffix optionally holding a second suggestions object; inputs with no `{` or no `"suggestions"`, top-level arrays and non-array `suggestions` give `[]`; `numRuns: PROP_RUNS`

- [x] 10. Implement the suggestion filter
  - [x] 10.1 Implement `src/lib/expansion/filter.ts`
    - `filterSuggestions(candidates, cls)`: trim with `trimWhitespace`, keep `isValidSuggestionText`, initials-exact check for `'initials'` only, first-seen `suggestionKey` dedupe, cap at 3; new array, input unchanged
    - Note (2026-11-11): superseded in part by task 19, which reads only the first 5 candidates before these steps
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_
  - [x]* 10.2 Write `src/lib/expansion/filter.test.ts`
    - An `iwtgo` list keeps "I want to go outside." and drops "I would like to go out."; trimming; `Yes`/`yes` dedupe keeps the first; empty input → `[]`
    - _Requirements: 11.1, 11.2, 11.4, 11.7_
  - [x] 10.3 Write property test in `src/lib/expansion/filter.prop.test.ts`
    - **Property 16: The filter output is schema-valid, ordered and initials-exact**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 18.7**
    - Lists of 0 to 50 strings of 0 to 1,000 characters mixing arbitrary strings, Whitespace-padded phrases, case variants, 200/201-unit items and sentences built from `c.initials` (some with one wrong initial); classifications from `classify` over `renderTokensArb` and initials renderings; reference pipeline equality, schema acceptance, initials check, input unchanged; `numRuns: PROP_RUNS`

- [x] 11. Implement the rate limiter
  - [x] 11.1 Implement `src/lib/expansion/rate-limit.ts`
    - `RateLimitConfig`, `RateDecision`, `RateLimiter`, `UNKNOWN_CLIENT_KEY`, pure `decide(times, nowMs, cfg)` (keep `nowMs - t < windowMs`; reject at `limit` with `retryAfterSeconds` clamped to 1..60 and no append; else append) and `createRateLimiter` with a `Map` re-inserted on each allowed request and front-expiry of keys whose newest request is 60,000 ms old
    - No clock, logging or storage
    - _Requirements: 12.3, 12.7_
  - [x]* 11.2 Write `src/lib/expansion/rate-limit.test.ts`
    - 30 allowed then rejected with `retryAfterSeconds` 60 at the same instant; allowed again at +60,000 ms; key removed from `size()` after 60,000 ms
    - _Requirements: 12.3, 12.7_
  - [x] 11.3 Write property test in `src/lib/expansion/rate-limit.prop.test.ts`
    - **Property 17: The rate limiter never allows more than 30 per 60 s window per key**
    - **Validates: Requirements 12.3, 12.7**
    - 1 to 4 keys, 0 to 200 events, time deltas from `fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1_000, max: 70_000 }))`; compare against a reference model, including `retryAfterSeconds` and `size()`; `numRuns: PROP_RUNS`

- [x] 12. Implement the injected-timer deadline helper
  - [x] 12.1 Implement `src/lib/expansion/deadline.ts`
    - `Timers`, `DeadlineOutcome`, `runWithDeadline(work, { ms, timers, signal? })` with an inner `AbortController`; settles once with `ok`, `error`, `timeout` or `aborted`; clears the timer and removes the external listener on settlement; attaches a no-op `catch` to the late work promise
    - _Requirements: 13.8, 15.2, 15.9, 16.3_
  - [x]* 12.2 Write `src/lib/expansion/deadline.test.ts`
    - With fake timers: work that ignores its signal still yields `timeout` and its signal is aborted; external abort yields `aborted`; a late resolve or reject after `timeout` changes nothing and causes no unhandled rejection
    - _Requirements: 13.8, 16.3_

- [x] 13. Implement the provider call
  - [x] 13.1 Implement `src/lib/expansion/provider.ts`
    - `DEFAULT_MODEL = 'accounts/fireworks/models/deepseek-v4p1-flash-1017'` (chosen in 13.3), `DEFAULT_MODEL_REASONING_EFFORT = 'none'`, `DEFAULT_BASE_URL`, `MAX_OUTPUT_TOKENS = 200`, `SERVER_TIMEOUT_MS = 4_000`, `ProviderConfig`, `ProviderOutcome`
    - `providerUrl` (non-empty base or default, trailing `/` removed, plus `/chat/completions`), `resolveModel` (non-empty model or `DEFAULT_MODEL`), `ProviderReplySchema` (first choice must have string `message.content`)
    - `callProvider(messages, config, deps)`: one `runWithDeadline` covering `fetch` and `res.text()`; `POST` with only `Authorization: Bearer <key>` and `Content-Type: application/json`; body exactly `{ model, messages, max_tokens: 200 }`, plus `reasoning_effort: DEFAULT_MODEL_REASONING_EFFORT` only when the model equals `DEFAULT_MODEL`; non-2xx, bad JSON or bad shape → `upstream_failed`; timeout → `upstream_timeout`; no retry; never returns provider status, headers or body
    - _Requirements: 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 14.5_
  - [x] 13.2 Write `src/lib/expansion/provider.test.ts`
    - `providerUrl` with `undefined`, `''` and 0 to 3 trailing slashes; `resolveModel(undefined)` and `resolveModel('')` equal `DEFAULT_MODEL`; read the files under `src/` and assert the literal default model ID appears only in `provider.ts`; outcome mapping examples with a fake `fetch` and fake timers
    - _Requirements: 13.2, 13.3, 13.4, 13.5, 13.7, 13.8, 13.9_
  - [x] 13.3 Choose the Default_Model from Fireworks' current serverless list
    - Done on 2026-11-10 without a key, from the Fireworks models page filtered to serverless: no non-reasoning instruct chat model is listed, so the choice is DeepSeek V4.1 Flash 1017, whose thinking `reasoning_effort: 'none'` switches off
    - Record the chosen ID, the check date, the reason and the completed live check (13.4) in a comment above `DEFAULT_MODEL`
    - _Requirements: 13.4, 13.5_
  - [x] 13.4 Live check of the Default_Model with a key (manual; a human with a Fireworks key runs it)
    - Completed check (user-provided evidence): `deepseek-v4p1-flash-1017` returned correct top suggestions for `iwtgo`, `cihsw`, `mbh`, `tyfc` and `wtt` in 0.7–2.4 s
    - If the model fails, pick another fast serverless chat model whose thinking can be switched off, update `DEFAULT_MODEL` (and `DEFAULT_MODEL_REASONING_EFFORT` if needed), and record the chosen ID and the check date in a comment above the constant
    - Never commit the key or write it to any file other than a local, git-ignored `.env.local`
    - _Requirements: 13.4, 13.5_

- [x] 14. Implement the route handler logic
  - [x] 14.1 Create `src/lib/expansion/test-support/fake-fetch.ts`
    - `createFakeFetch()` records each call (`url`, `init`, parsed JSON body, `signal`) and returns a controllable promise per call with `resolve(status, bodyText, { statusText?, headers?, bodyDelayMs? })`, `reject(error)`, or hang; a delayed `text()` lets tests check the full-body deadline
    - _Requirements: 17.3, 17.5, 17.6_
  - [x] 14.2 Implement request-check helpers in `src/lib/expansion/handler.ts`
    - `ExpandEnv`, `ExpandDeps`, `ErrorCode`, `BODY_LIMIT_BYTES = 16_384`, `jsonResponse(status, body, extraHeaders?)` that always sets `Cache-Control: no-store` and `Content-Type: application/json`
    - `checkOrigin` (absent passes; `'null'`, unparsable, credentials, non-`/` path, query, fragment or opaque origin fails; else WHATWG `URL.origin` equality; review v1: a `Sec-Fetch-Site` header decides alone, and without one a match with the `Host` header also passes), `clientKey` (first `x-forwarded-for` entry trimmed, then trimmed `x-real-ip`, then `UNKNOWN_CLIENT_KEY`), `readBodyCapped` (stream reader, cancel once bytes exceed the limit, `null` body → 0 bytes, exactly 16,384 passes)
    - _Requirements: 12.2, 12.5, 12.8, 12.9, 14.1_
  - [x] 14.3 Implement `handleExpand` in `src/lib/expansion/handler.ts`
    - Check order: origin → rate (`rateLimiter.check(clientKey, now)`, 429 with `Retry-After`) → `Content-Length` matching `/^\d+$/` above the limit → capped read → strict UTF-8 decode, non-empty, `JSON.parse`, `ExpandRequestSchema.safeParse` → non-empty `apiKey` (503); stop at the first failure without calling the provider
    - Then `classify`, `buildPrompt`, `callProvider`; on content, `filterSuggestions(parseModelOutput(content), cls)` guarded by `ExpandResponseSchema.safeParse` → 200 `{ suggestions }`; `upstream_failed` → 502; `upstream_timeout` → 504; any unexpected exception after the origin check → 502
    - `try/finally` calls `deps.log({ status, latencyMs: Math.round(deps.now() - t0) })` exactly once; caught error messages are never logged or returned
    - Review checklist: no module-level state in `handler.ts` (the limiter is owned by `route.ts`); request text, context and model output live only in local variables; no `process.env` access in `src/lib/`
    - _Requirements: 12.1, 12.3, 12.4, 12.6, 12.7, 13.1, 13.6, 13.9, 13.10, 14.1, 14.2, 14.3, 14.4, 14.6_
  - [x] 14.4 Write `src/lib/expansion/handler.test.ts`
    - With the fake `fetch`, fake timers and a test API key (unset only for 503): 403 for scheme, host and port differences; 30 non-429 responses then 429 with `Retry-After`; 413 for `Content-Length` 16,385 with a body stream that throws if read, and 413 for a streamed body over 16,384 bytes without `Content-Length`; 400 for invalid JSON, empty `text`, 201-character trimmed `text`, 11 Turns and a bad role; 503 with the key unset; 200 schema-valid on success; 502 for non-2xx, a rejecting fetch and a missing `message.content`; 504 at 4,000 ms; client-key header combinations
    - For an `'initials'` request, a provider reply with one matching and one non-matching sentence returns 200 with only the matching one
    - `fetch` call counts: 0 for 403, 429, 413, 400 and 503; exactly 1 for 200, 502 and 504
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 12.9, 13.1, 13.6, 13.7, 13.8, 13.9, 17.3, 17.4, 17.5, 17.7_
  - [x] 14.5 Write property test in `src/lib/expansion/handler.prop.test.ts`
    - **Property 18: The origin check passes exactly same-origin or absent Origin**
    - **Validates: Requirements 12.2, 12.8**
    - Same-origin variants (random case, explicit default port, trailing `/`) and one-change variants (scheme, host, port, path, `'null'`, garbage, `file:` and `data:`); review v1 adds optional `Host` headers built from parts and optional `Sec-Fetch-Site` values; `numRuns: PROP_RUNS`
  - [x] 14.6 Write property test in `src/lib/expansion/handler.prop.test.ts`
    - **Property 19: The route runs its checks in order and stops at the first failure**
    - **Validates: Requirements 12.1, 12.4, 12.5, 12.6, 12.7, 13.1**
    - `fc.record` of pass/fail booleans per check plus payload variants; string bodies with matching `Content-Length` or `ReadableStream` bodies (`duplex: 'half'`) without one; a wrapped real limiter to read counts; a 16,384-byte body passes; `fc.asyncProperty`, `numRuns: PROP_RUNS`
  - [x] 14.7 Write property test in `src/lib/expansion/handler.prop.test.ts`
    - **Property 20: The provider request has exactly the specified shape**
    - **Validates: Requirements 13.2, 13.3, 13.4, 14.5**
    - Env `baseUrl` unset, empty or with 0 to 3 trailing `/`; `model` unset, empty, `DEFAULT_MODEL` or random; incoming requests carry cookies, `x-forwarded-for` and custom headers; assert URL, method, exact header set, exact body keys (`model`, `messages`, `max_tokens`, plus `reasoning_effort === 'none'` iff the model is `DEFAULT_MODEL`), `messages` equal to `buildPrompt(req, classify(req.text))`, `max_tokens === 200`; `fc.asyncProperty`, `numRuns: PROP_RUNS`
  - [x] 14.8 Write property test in `src/lib/expansion/handler.prop.test.ts`
    - **Property 21: Provider outcomes map to the specified statuses**
    - **Validates: Requirements 13.6, 13.7, 13.8, 13.9**
    - Status from 100 to 599; tagged body variants; content embedding matching and non-matching initials; settle delays 0 to 3,999 ms or 4,001 to 6,000 ms of fake time; timeout aborts the signal and a later body changes nothing; exactly one `fetch` call; `fc.asyncProperty`, `numRuns: PROP_RUNS`
  - [x] 14.9 Write property test in `src/lib/expansion/handler.prop.test.ts`
    - **Property 22: Route responses and logs never leak request data or secrets**
    - **Validates: Requirements 12.6, 13.9, 13.10, 14.1, 14.2, 14.3, 14.4**
    - Marker `zq7marker` in request and Turn texts, random API key and client IP; fake provider echoes messages and the marker in error bodies and status text; assert headers, body key sets, absence of marker, key and IP, and exactly one `log` call with keys `status` and `latencyMs` (non-negative integer); `fc.asyncProperty`, `numRuns: PROP_RUNS`

- [x] 15. Add the Next.js route
  - [x] 15.1 Implement `src/app/api/expand/route.ts`
    - `export const runtime = 'nodejs'`; module-level `createRateLimiter({ limit: 30, windowMs: 60_000 })`; `POST` reads `DIT_LLM_API_KEY`, `DIT_LLM_BASE_URL` and `DIT_MODEL` from `process.env` per request (never `NEXT_PUBLIC_`), binds `globalThis.fetch`, timers and `Date.now`, and logs only `JSON.stringify({ status, latencyMs })` with `console.info`
    - _Requirements: 12.7, 13.1, 13.2, 13.10, 14.2, 14.3_
  - [x]* 15.2 Write `src/app/api/expand/route.test.ts`
    - With `DIT_LLM_API_KEY` unset via `vi.stubEnv`, `POST` returns 503 `not_configured` with `Cache-Control: no-store`; the logged line has only `status` and `latencyMs`
    - _Requirements: 13.1, 14.1, 14.2_

- [x] 16. Checkpoint - Ensure all tests pass
  - Run `bun run test` and `bun run typecheck`; ensure all tests pass, ask the user if questions arise.

- [x] 17. Implement the expansion client and public barrel
  - [x] 17.1 Implement `src/lib/expansion/client.ts`
    - Constants `DEBOUNCE_MS`, `CLIENT_TIMEOUT_MS`, `CACHE_MAX`, `EXPAND_ENDPOINT`; types `ExpansionResult`, `ClientDeps`, `ExpansionClient`; `prepareContext` (drop Whitespace-only Turns, keep last 10, cut text to 500 units)
    - `createExpansionClient(deps, onResult)`: `update` restarts the 300 ms timer only on text change; `start` aborts any pending request, handles empty text, over-200 text, offline and cache hits, otherwise `runWithDeadline` (5,000 ms, external signal) around `POST /api/expand` plus full body read; `'ai'` only for 200 with a schema-valid body of at least 1 suggestion; everything else on-device; stale outcomes discarded and not cached; LRU of 20 keyed by `JSON.stringify([trimmed, prepared.map(t => [t.role, t.text])])`; `dispose`
    - `expandOnDevice` and `onResult` wrapped in `try/catch`; `update` and timer callbacks never throw
    - Review checklist: no import of `on-device.ts`; no use of global `fetch`, `setTimeout`, `clearTimeout` or `navigator`, only Injected_Dependencies
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8_
  - [x] 17.2 Create `src/lib/expansion/index.ts`
    - Named re-exports of the `schema`, `normalize`, `classify`, `on-device` and `client` public APIs; no exports from `handler.ts`, `provider.ts`, `prompt.ts` or `test-support/`
    - _Requirements: 13.10, 15.8_
  - [x] 17.3 Write `src/lib/expansion/client.test.ts`
    - Fake timers, fake `fetch`, and global `fetch`, `setTimeout` and `navigator` stubbed to throw: 3 changes under 300 ms apart then 300 ms quiet → exactly 1 fetch carrying the latest text; a new expansion aborts the earlier signal and the earlier result is not delivered; a repeat with the same trimmed text and context delivers the cached `'ai'` result with 0 extra fetches; on-device fallback with source `'on-device'` for status 503, a throwing fetch, no response within 5,000 ms, offline (0 fetches) and an empty `suggestions` list; a throwing `expandOnDevice` gives `suggestions: []`
    - _Requirements: 15.1, 15.2, 15.3, 15.5, 15.8, 16.2, 16.3, 16.4, 16.5, 16.8, 17.6, 17.7_
  - [x] 17.4 Write property test in `src/lib/expansion/client.prop.test.ts`
    - **Property 23: The client starts one expansion per quiet period**
    - **Validates: Requirements 15.1**
    - Scripts of `update` calls with gaps of 0 to 1,000 ms clustered at 299, 300 and 301 ms; instant fake `fetch`; compare sent texts to a reference that skips empty, over-200 and cache-hit texts; context-only updates do not restart the timer (review v1: unless the prepared context changed for non-empty text); `vi.advanceTimersByTimeAsync`; `fc.asyncProperty`, `numRuns: PROP_RUNS`
  - [x] 17.5 Write property test in `src/lib/expansion/client.prop.test.ts`
    - **Property 24: The client has at most one pending request and delivers exactly once per live expansion**
    - **Validates: Requirements 15.2, 15.3, 15.9, 16.7**
    - `fc.commands`-style scripts of 1 to 40 steps interleaving `update`, time advances and fake-fetch resolve, reject or hang, including a throwing `onResult`; assert at most one live request, delivered `text` equals the latest trimmed text, exactly-once delivery for live expansions, 0 `expandOnDevice` calls for superseded ones, and no throw or unhandled rejection; `fc.asyncProperty`, `numRuns: PROP_RUNS`
  - [x] 17.6 Write property test in `src/lib/expansion/client.prop.test.ts`
    - **Property 25: Client outcomes map to the specified source**
    - **Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.8**
    - Non-empty trimmed texts including lengths 200 and 201; online states; route outcomes (status 100 to 599, valid, invalid JSON, schema-invalid or empty bodies, rejecting fetch, no answer within 5,000 ms); a recording `expandOnDevice` fake that may throw; `fc.asyncProperty`, `numRuns: PROP_RUNS`
  - [x] 17.7 Write property test in `src/lib/expansion/client.prop.test.ts`
    - **Property 26: The client sends trimmed text and prepared context**
    - **Validates: Requirements 15.4**
    - Turn arrays of 0 to 25 entries built directly (not schema-parsed) with blank, Whitespace-only and 501 to 800 unit texts; `prepareContext` equals the reference and the sent body equals `{ text: trimWhitespace(text), context: prepareContext(ctx) }` and passes `ExpandRequestSchema`; `fc.asyncProperty`, `numRuns: PROP_RUNS`
  - [x] 17.8 Write property test in `src/lib/expansion/client.prop.test.ts`
    - **Property 27: The Result_Cache is an LRU of at most 20 'ai' results**
    - **Validates: Requirements 15.5, 15.6, 15.3**
    - Pools of 1 to 30 `(text, context)` keys; the fake route answers 200 with a non-empty list unique to each key; `fetch` call count equals misses of a reference LRU of capacity 20; a stale-discarded result is not stored; `fc.asyncProperty`, `numRuns: PROP_RUNS`

- [x] 18. Final checkpoint - Ensure all tests pass
  - Run `bun run test` and `bun run typecheck` (and `bun run lint` if a lint script exists); ensure all tests pass, ask the user if questions arise.

- [x] 19. Ask the model for up to 5 candidates
  - Added on 2026-11-11 in the design polish pass: with 1 to 3 candidates, fewer than 3 suggestions often remained after the initials filter (see design Implementation notes, candidate count)
  - [x] 19.1 Add `CANDIDATES_MAX` and build `SYSTEM_PROMPT` from it
    - `export const CANDIDATES_MAX = 5` with a doc comment next to `SUGGESTIONS_MAX` in `src/lib/expansion/schema.ts`; route only, so `index.ts` does not export it
    - `SYSTEM_PROMPT` in `src/lib/expansion/prompt.ts` asks for up to 5 different natural first-person sentences the speaker might mean, most likely first. It stays one fixed string with the context, marker and JSON-only instructions, and the user message is unchanged
    - `MAX_OUTPUT_TOKENS` stays 200
    - _Requirements: 9.2_
  - [x] 19.2 Read only the first `CANDIDATES_MAX` candidates in `src/lib/expansion/filter.ts`
    - `filterSuggestions` walks `candidates.slice(0, CANDIDATES_MAX)`, then trims, length-checks, initials-checks, dedupes and caps at 3 as before; new array, input unchanged
    - _Requirements: 11.5, 11.9_
  - [x] 19.3 Update and add the example tests
    - `prompt.test.ts`: `SYSTEM_PROMPT` asks for up to 5 different sentences, most likely first, and no longer says 1 to 3
    - `filter.test.ts`: of 5 `iwtgo` candidates whose 1st and 3rd fail the initials check, the 2nd, 4th and 5th are kept in order; a passing 6th candidate is ignored when only 2 of the first 5 pass; blank and repeated entries count toward the first 5
    - `handler.test.ts`: a 6-candidate Provider reply gives 200 with the first 3 that pass among the first 5, and a passing 6th candidate is ignored when only 2 of the first 5 pass
    - `schema.test.ts`: `CANDIDATES_MAX` is 5
    - _Requirements: 9.2, 11.9, 17.3, 17.4_
  - [x] 19.4 Update the property test in `src/lib/expansion/filter.prop.test.ts`
    - **Property 16: The filter output is schema-valid, ordered and initials-exact**
    - **Validates: Requirements 11.5, 11.9**
    - `refFilter` starts with `list.slice(0, CANDIDATES_MAX)`; generators, tag and `numRuns: PROP_RUNS` unchanged
  - [x] 19.5 Checkpoint - Ensure all tests pass
    - Run `bun run test`, `bun run typecheck` and `bun run lint`; with the window removed from `filterSuggestions`, the new filter and handler window cases and Property 16 fail

## Notes

- Tasks marked with `*` are optional example tests and can be skipped for a faster MVP. All 27 property sub-tasks, the shared generators (3.2, 5.3), the no-network setup (1.4), the fake `fetch` (14.1), and the example tests required by Requirements 5, 13.5 and 17 are required.
- Task 13.3 chose `DEFAULT_MODEL` from Fireworks' serverless list without a key. Task 13.4 is complete: the user verified correct top suggestions for iwtgo, cihsw, mbh, tyfc and wtt in 0.7–2.4 s with the default model.
- Each property test is one `fc.assert` tagged `// Feature: expansion, Property N: <title>` with `numRuns: PROP_RUNS` (200).
- Tests never call the real network; the setup file from 1.4 makes any real `fetch` fail.
- Use `bun run test`, never `bun test`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "1.4", "2.1", "4.1", "4.2", "11.1", "12.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "4.3", "4.4", "5.1", "11.2", "11.3", "12.2", "14.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "5.2", "6.1"] },
    { "id": 4, "tasks": ["3.4", "5.3", "6.2", "7.1", "9.1", "10.1"] },
    { "id": 5, "tasks": ["3.5", "6.3", "7.2", "9.2", "10.2", "13.1"] },
    { "id": 6, "tasks": ["3.6", "6.4", "7.3", "9.3", "10.3", "13.2", "14.2"] },
    { "id": 7, "tasks": ["6.5", "7.4", "9.4", "13.3", "14.3"] },
    { "id": 8, "tasks": ["7.5", "9.5", "13.4", "14.4", "15.1", "17.1"] },
    { "id": 9, "tasks": ["7.6", "9.6", "14.5", "15.2", "17.2"] },
    { "id": 10, "tasks": ["7.7", "9.7", "14.6", "17.3"] },
    { "id": 11, "tasks": ["14.7", "17.4"] },
    { "id": 12, "tasks": ["14.8", "17.5"] },
    { "id": 13, "tasks": ["14.9", "17.6"] },
    { "id": 14, "tasks": ["17.7"] },
    { "id": 15, "tasks": ["17.8"] },
    { "id": 16, "tasks": ["19.1"] },
    { "id": 17, "tasks": ["19.2"] },
    { "id": 18, "tasks": ["19.3", "19.4"] },
    { "id": 19, "tasks": ["19.5"] }
  ]
}
```


## Review corrections: initials, request freshness and public endpoint (review, 2026-11-11)

These corrections supersede earlier conflicting criteria in this document.

- [x] 20.1 Recognise paused initials across letters-only tokens (2–12 letters total) when no multi-letter token is a known word or proper word prefix; prioritise exact phrase-bank initials for single two-letter tokens, including known words. Preserve real words and partial phrases.
  - Verified: `classify.prop.test.ts; word-freq.test.ts`.
- [x] 20.2 Invalidate requests immediately on any text or prepared-context change with a monotonically increasing generation; deliver/cache only the current generation. Clearing history immediately replaces client context and cancels old pending/debounced work.
  - Verified: `client.prop.test.ts; hooks/session-expansion.prop.test.ts`.
- [x] 20.3 Reject POST requests without Origin before reading the body or counting rate limits; retain same-origin, Sec-Fetch-Site and LAN Host matching.
  - Verified: `handler.test.ts; handler.prop.test.ts; route.test.ts`.
- [x] 20.4 Record the completed live default-model check: deepseek-v4p1-flash-1017 returned correct top suggestions for iwtgo, cihsw, mbh, tyfc and wtt in 0.7–2.4 seconds (user-provided verification).
  - Verified: `user-provided completed live check; no new provider call`.

Round-2 clarification: paused initials depend on whether every leading token is a known word, not individual multi-letter prefixes or exact phrase matches (`ci hs`, `iw th`, `iwt go`). Remove the contraction token `im` from the word list; it has no exact two-letter phrase-bank entry and should follow the existing unknown-token initials rule.

- [x] 21.1 Correct paused-initial and partial classification using known leading words; cover review examples, phrase controls and on-device expansion in focused regressions.
- [x] 21.2 Rewrite last-round review requirements as conditional EARS criteria.
- [x] 21.3 Refine paused-initial classification (Requirement 20.5): no initials when a 3+ letter Known_Word is present; initials when a multi-letter token is neither a word nor a prefix or the joined letters match phrase-bank initials; add mom, dad, hi, hey, bye, ok to the Word_List; regressions for `i wtgo`, `i nh`, `mom come`, `ok thanks`.
