# Requirements Document

## Introduction

Expansion turns what the speaker has keyed in Morse into up to 3 natural sentences the speaker can choose and speak. The speaker can key word initials (`iwtgo` or `i w t g o` → "I want to go outside."), a partial word (`i want wa` → "i want water"), or complete words, which Expansion can continue. This implements MVP items 4 and 7 of `docs/BRIEF.md`.

The feature has four parts:

1. Shared Zod schemas for the request and response of `POST /api/expand` (`src/lib/expansion/schema.ts`).
2. A pure input classifier (`src/lib/expansion/classify.ts`) and a pure, deterministic, offline on-device expander built on a bundled phrase bank and word frequency list (`src/lib/expansion/on-device.ts`, `phrase-bank.ts`, `word-freq.ts`).
3. The `POST /api/expand` route handler (`src/app/api/expand/route.ts`) and its prompt builder and output parser (`src/lib/expansion/prompt.ts`). The route calls any OpenAI-compatible chat-completions endpoint (default Fireworks serverless) with plain `fetch` and no vendor SDK, using conversation context in the style of SpeakFaster abbreviation expansion.
4. A client (`src/lib/expansion/client.ts`) that debounces requests and falls back to the on-device expander. Each result carries its source so the UI can show which expander answered.

Out of scope: UI rendering of suggestions, suggestion highlight and selection, speech synthesis and recognition, conversation state storage, and the Morse engine. Those belong to the `conversation-ui`, `input-sources` and `morse-engine` specs. Nothing in this feature stores user text on a server, and the app stays fully usable without `DIT_LLM_API_KEY` or a network.

## Glossary

- **Schema_Module**: The Zod schemas and inferred types in `src/lib/expansion/schema.ts`: Turn, Expand_Request and Expand_Response.
- **Turn**: One conversation line, `{ role: 'speaker' | 'partner', text: string }`, where `text` has 1 to 500 characters inclusive.
- **Expand_Request**: The body of `POST /api/expand`, `{ text: string, context: Turn[] }`.
- **Expand_Response**: The success body of `POST /api/expand`, `{ suggestions: string[] }`.
- **Suggestion**: One candidate sentence in an Expand_Response or Expansion_Result.
- **Classifier**: The pure function in `src/lib/expansion/classify.ts` that maps a string to an Input_Classification.
- **Input_Classification**: A discriminated union with `kind` equal to `'initials'`, `'partial'`, `'words'` or `'empty'`, carrying the Tokens and, for `'initials'`, the Initials_Letters.
- **Normalized_Tokens**: For a string, the result of lowercasing it, replacing every character that is not `a`–`z`, `0`–`9` or Whitespace with nothing, and splitting on runs of Whitespace, discarding empty tokens. For example, `"I want, WA!"` gives `["i", "want", "wa"]` and `"don't"` gives `["dont"]`.
- **Whitespace**: The characters space (U+0020), tab (U+0009), line feed (U+000A) and carriage return (U+000D).
- **Word_List**: The bundled list in `src/lib/expansion/word-freq.ts` of lowercase English words made only of letters `a`–`z`, ordered from most frequent to least frequent, with no duplicates.
- **Known_Word**: A token that appears in the Word_List.
- **Proper_Prefix**: A token `p` is a Proper_Prefix of a word `w` when `w` starts with `p` and `w` is longer than `p`.
- **Initials_Letters**: The typed letters of an `'initials'` input, in order. For one token, the token's letters; for single-letter tokens, those letters joined.
- **Initials_Of**: For a string, the first character of each of its Normalized_Tokens, joined in order. For example, Initials_Of("I want to go outside.") is `iwtgo`, and Initials_Of("I'm cold") is `ic`.
- **Phrase_Bank**: The bundled ordered list in `src/lib/expansion/phrase-bank.ts` of common first-person AAC phrases, each tagged with one Phrase_Category.
- **Phrase_Category**: One of `needs`, `feelings`, `care`, `social`, `questions`.
- **Bank_Order**: The index of a phrase in the Phrase_Bank. A lower index ranks higher.
- **Context_Word**: A Normalized_Token with at least 3 characters.
- **Context_Score**: For a phrase and a context, the number of distinct Context_Words that appear both in the phrase and in the text of the latest Turn with role `'partner'` in the context. The Context_Score is 0 when the context has no partner Turn.
- **Exact_Tier**: The Phrase_Bank phrases whose Initials_Of equals the Initials_Letters.
- **Prefix_Tier**: The Phrase_Bank phrases whose Initials_Of has the Initials_Letters as a Proper_Prefix.
- **On_Device_Expander**: The pure function in `src/lib/expansion/on-device.ts` that takes typed text and a context (a list of Turns) and returns a list of Suggestions without network access.
- **Prompt_Builder**: The pure function in `src/lib/expansion/prompt.ts` that builds the system prompt and user message for the model from an Expand_Request and its Input_Classification.
- **Output_Parser**: The pure function in `src/lib/expansion/prompt.ts` that turns raw model output text into a list of Suggestions.
- **Suggestion_Filter**: The pure function in `src/lib/expansion/filter.ts` that reads the first Candidate_Max entries of a list of candidate Suggestions and trims, length-checks, initials-checks, deduplicates and caps them.
- **Candidate_Max**: 5, the most candidate sentences the Prompt_Builder asks the model for and the Suggestion_Filter reads.
- **Expand_Route**: The `POST` route handler in `src/app/api/expand/route.ts`.
- **Provider**: Any OpenAI-compatible chat-completions endpoint, reached at `POST {Provider_Base_URL}/chat/completions` with the platform `fetch` function and no vendor SDK.
- **DIT_LLM_API_KEY**: The server-only environment variable holding the Provider API key, sent as `Authorization: Bearer <key>`.
- **DIT_LLM_BASE_URL**: The server-only environment variable holding the Provider base URL.
- **DIT_MODEL**: The server-only environment variable holding the Provider model ID.
- **Provider_Base_URL**: The value of `DIT_LLM_BASE_URL` when set to a non-empty value, otherwise `https://api.fireworks.ai/inference/v1`.
- **Default_Model**: A single exported constant in the expansion server code holding the ID of a fast Fireworks serverless chat model whose thinking can be switched off, chosen from Fireworks' current serverless model list at implementation time.
- **Max_Output_Tokens**: 200, the `max_tokens` value sent with every Provider request.
- **Server_Timeout**: 4,000 ms, the longest time the Expand_Route waits for the Provider.
- **Body_Limit**: 16,384 bytes, the largest request body the Expand_Route accepts.
- **Rate_Limit**: 30 requests per client IP address in any 60-second window, counted in the memory of one server instance.
- **Error_Body**: The JSON body `{ error: <code> }` returned with every non-200 Expand_Route response, where `<code>` is one of `forbidden_origin`, `rate_limited`, `payload_too_large`, `invalid_request`, `not_configured`, `upstream_failed`, `upstream_timeout`.
- **Client**: The expansion client in `src/lib/expansion/client.ts` that the UI calls with the current typed text and context.
- **Expansion_Result**: The Client's output, `{ text: string, suggestions: string[], source: 'ai' | 'on-device' }`, where `text` is the typed text the result answers.
- **Debounce_Delay**: 300 ms.
- **Client_Timeout**: 5,000 ms, the longest time the Client waits for the Expand_Route.
- **Result_Cache**: The Client's in-memory store of the 20 most recently used `'ai'` Expansion_Results, keyed by the trimmed typed text and the context sent.
- **Injected_Dependencies**: The fetch function, timer functions, online-status check and On_Device_Expander passed into the Client when the Client is created.

## Requirements

### Requirement 1: Turn schema

**User Story:** As a developer, I want one shared schema for conversation turns, so that the client and the server agree on what context looks like.

#### Acceptance Criteria

1. THE Schema_Module SHALL accept a value as a Turn exactly when the value is a plain object (not `null` and not an array) whose `role` is exactly the string `'speaker'` or `'partner'` (case-sensitive) and whose `text` is a string of 1 to 500 characters inclusive, where characters are counted as UTF-16 code units of the string as given, without trimming or other normalization.
2. IF a value has a `role` other than `'speaker'` or `'partner'`, a missing `role`, a `text` that is not a string, an empty `text` or a `text` longer than 500 characters, THEN THE Schema_Module SHALL reject the value as a Turn.
3. THE Schema_Module SHALL export the Turn TypeScript type inferred from the Turn schema.
4. IF a value is `null`, `undefined`, an array, or a primitive (string, number, boolean), or has a missing `text`, THEN THE Schema_Module SHALL reject the value as a Turn.
5. WHEN the Schema_Module accepts a value as a Turn, THE Schema_Module SHALL return a Turn containing only the `role` and `text` keys, with `role` and `text` unchanged from the input, and with any other keys of the input left out.
6. THE Schema_Module SHALL accept a Turn whose `text` has exactly 1 or exactly 500 characters, including a `text` made only of Whitespace, and SHALL reject a Turn whose `text` has 501 characters.

### Requirement 2: Expand request schema

**User Story:** As a developer, I want the expansion request validated against fixed limits, so that the server only processes small, well-formed input.

#### Acceptance Criteria

1. WHEN a value is parsed as an Expand_Request, THE Schema_Module SHALL remove leading and trailing Whitespace from `text` before checking its length, and SHALL leave Whitespace inside `text` unchanged (for example, `"  i want wa \n"` becomes `"i want wa"`).
2. THE Schema_Module SHALL accept a value as an Expand_Request exactly when the value is an object, `text` is a string of 1 to 200 characters inclusive after trimming, and `context` is an array of 0 to 10 Turns inclusive.
3. IF `text` is missing, is not a string, or has 0 characters or more than 200 characters after trimming (including a `text` made only of Whitespace), THEN THE Schema_Module SHALL reject the Expand_Request.
4. IF `context` is missing, is not an array, has more than 10 entries, or has any entry that is not a valid Turn under Requirement 1, THEN THE Schema_Module SHALL reject the Expand_Request.
5. WHEN the Schema_Module accepts an Expand_Request, THE Schema_Module SHALL return the trimmed `text` and the `context` Turns in their original order, with each Turn's `role` and `text` unchanged and no trimming applied to Turn `text`.
6. IF the value being parsed is not an object (for example `null`, an array, a string or a number), THEN THE Schema_Module SHALL reject the Expand_Request.
7. WHEN the Schema_Module accepts a value that has properties other than `text` and `context`, THE Schema_Module SHALL leave those properties out of the returned Expand_Request.
8. THE Schema_Module SHALL export the Expand_Request TypeScript type inferred from the Expand_Request schema.

### Requirement 3: Expand response schema

**User Story:** As a developer, I want the expansion response validated, so that the UI only receives a short list of distinct, displayable sentences.

#### Acceptance Criteria

1. THE Schema_Module SHALL accept a value as an Expand_Response exactly when the value is an object, `suggestions` is an array of 0 to 3 strings inclusive, each string has 1 to 200 characters inclusive and contains at least one character that is not Whitespace, and no two strings are equal after both are converted to lowercase.
2. IF the value is not an object (including `null`, an array, a string or a number), `suggestions` is missing or is not an array, `suggestions` has more than 3 entries, or `suggestions` contains a non-string, an empty string, a string made only of Whitespace, a string longer than 200 characters, or two strings that are equal after both are converted to lowercase, THEN THE Schema_Module SHALL reject the Expand_Response and return no partial `suggestions` list.
3. WHEN the Schema_Module accepts an Expand_Response, THE Schema_Module SHALL return the `suggestions` strings unchanged (no trimming or case change) and in their original order, and SHALL omit any properties of the value other than `suggestions`.
4. WHEN the Schema_Module parses an Expand_Response whose `suggestions` is an empty array, THE Schema_Module SHALL accept it and return an empty `suggestions` list.
5. THE Schema_Module SHALL export the Expand_Response TypeScript type inferred from the Expand_Response schema.

### Requirement 4: Input classification

**User Story:** As a speaker, I want Dit to recognise whether I keyed initials, part of a word or full words, so that it expands my input the right way.

#### Acceptance Criteria

1. THE Classifier SHALL compute the Normalized_Tokens of the input and classify the input from those tokens only, so that inputs with the same Normalized_Tokens get the same Input_Classification whatever their letter case, punctuation, Whitespace or removed non-ASCII characters (for example, `"I W T G O!"`, `"iwtgo"` and `"  IwTgO  "` all give kind `'initials'` with Initials_Letters `iwtgo`).
2. WHEN the Classifier classifies an input, THE Classifier SHALL check criteria 3 to 7 in ascending order and return the kind of the first criterion whose condition holds, so that each input matches exactly one criterion.
3. WHEN the Classifier classifies an input whose Normalized_Tokens list is empty (for example, `""`, `"   "`, `"?!"` or `"é"`), THE Classifier SHALL return kind `'empty'`.
4. WHEN the Classifier classifies an input whose Normalized_Tokens list has exactly one token, the token has 2 to 12 characters inclusive, every character is a letter `a`–`z`, and the token is not a Known_Word, THE Classifier SHALL return kind `'initials'` with Initials_Letters equal to the token (for example, `iwtgo` gives `iwtgo`, and `wa` gives `wa` even when `wa` is a Proper_Prefix of a Word_List entry).
5. WHEN an input has multiple all-letter Normalized_Tokens totalling 2–12 letters and either at least one token before the last is not a Known_Word or every token is a single letter, THE Classifier SHALL return kind 'initials' with the tokens joined as Initials_Letters.
6. WHEN criteria 3 to 5 do not hold, every token before the last is a Known_Word, and the last token is an unknown Proper_Prefix, THE Classifier SHALL return kind 'partial'.
7. WHEN criteria 3 to 6 do not hold, THE Classifier SHALL return kind `'words'` (for example, `i want water`, the single Known_Word `go`, the single letter `i`, the digits-only input `123`, a single token of 13 or more letters that is not a Proper_Prefix of any Word_List entry, 13 or more single-letter tokens whose last letter is a Known_Word).
8. THE Classifier SHALL return exactly one Input_Classification for every string input, including strings made only of punctuation, digits, Whitespace or non-ASCII characters, without throwing, without mutating its input or any bundled list, and with the same Input_Classification every time it gets the same input.
9. THE Classifier SHALL include the Normalized_Tokens, in input order, in every Input_Classification it returns.
10. WHEN the Classifier returns a kind other than `'initials'`, THE Classifier SHALL return an Input_Classification with no Initials_Letters.

### Requirement 5: Bundled phrase bank and word list

**User Story:** As a speaker, I want a built-in set of everyday phrases and words, so that I get useful suggestions with no network.

#### Acceptance Criteria

1. THE Phrase_Bank SHALL contain at least 150 phrases, with at least 20 phrases in each of the 5 Phrase_Categories.
2. THE Phrase_Bank SHALL tag every phrase with exactly one Phrase_Category, and every tag SHALL be one of `needs`, `feelings`, `care`, `social` or `questions`.
3. THE Phrase_Bank SHALL contain only phrases whose Normalized_Tokens include at least one of the first-person tokens `i`, `im`, `ive`, `ill`, `id`, `me`, `my`, `mine`, `myself`, `we`, `us` or `our`, or phrases that end with `?` and whose Normalized_Tokens include `you` or `your` (for example, "I want to go outside.", "I'm in pain.", "Can you call my daughter?").
4. THE Phrase_Bank SHALL contain only phrases of 1 to 200 characters inclusive that have no leading or trailing Whitespace, contain no tab, line feed or carriage return, and have at least one Normalized_Token.
5. THE Phrase_Bank SHALL contain no two phrases that are equal when compared case-insensitively.
6. THE Word_List SHALL contain at least 1,000 entries, including the words `i` and `a`, where every entry has at least 1 character, consists only of letters `a`–`z`, and appears only once in the list.
7. THE Phrase_Bank and THE Word_List SHALL be plain typed constants bundled with the app that are fully available as soon as their modules are imported, with no network request, file read or dynamic import at runtime, so that they work with no network connection.

### Requirement 6: On-device expansion of initials

**User Story:** As a speaker, I want my initials expanded into full phrases with no network, so that I can say a sentence in a few presses even offline.

#### Acceptance Criteria

1. WHEN the On_Device_Expander receives typed text whose Input_Classification from the Classifier has kind `'initials'`, THE On_Device_Expander SHALL list every Exact_Tier phrase before any Prefix_Tier phrase.
2. WHEN the On_Device_Expander orders phrases within the Exact_Tier or within the Prefix_Tier, THE On_Device_Expander SHALL order them by Context_Score from highest to lowest, and phrases with equal Context_Score by Bank_Order from lowest to highest, so that with a context of 0 Turns or no `'partner'` Turn the order is Bank_Order alone.
3. WHEN the On_Device_Expander receives typed text classified as kind `'initials'`, THE On_Device_Expander SHALL return the first 3 phrases of the ordered list from criteria 1 and 2, or all of them in that order when 1 or 2 phrases match.
4. WHEN the On_Device_Expander receives typed text classified as kind `'initials'`, THE On_Device_Expander SHALL return each Suggestion as the exact Phrase_Bank phrase text, with case, punctuation and spacing unchanged, and only phrases whose Initials_Of equals the Initials_Letters or has the Initials_Letters as a Proper_Prefix.
5. IF the typed text is classified as kind `'initials'` and no Phrase_Bank phrase is in the Exact_Tier or Prefix_Tier, THEN THE On_Device_Expander SHALL return an empty list without throwing.
6. WHEN the On_Device_Expander is called twice with the same typed text and the same context, THE On_Device_Expander SHALL return identical Suggestion lists in identical order, without making any network request.
7. WHEN two typed texts have the same Initials_Letters (for example, `iwtgo`, `I W T G O` and `i w t g o`) and the same context, THE On_Device_Expander SHALL return identical Suggestion lists for them.

### Requirement 7: On-device word completion and continuation

**User Story:** As a speaker, I want a half-keyed word completed and full words continued, so that I can stop keying early.

#### Acceptance Criteria

1. WHEN the Classifier returns kind `'partial'`, THE On_Device_Expander SHALL select the Word_List entries of which the last Normalized_Token is a Proper_Prefix, keep them in Word_List order (most frequent first) without applying Context_Score, and form one candidate Suggestion per selected entry by joining the Normalized_Tokens before the last token and the selected entry with single spaces (U+0020), with no leading or trailing Whitespace and no added capitalisation or punctuation (for example, `I want, WA!` can give `i want water`).
2. WHEN the Classifier returns kind `'partial'`, THE On_Device_Expander SHALL drop every candidate from criterion 1 that is longer than 200 characters and return the first 3 remaining candidates in order, or all remaining candidates when fewer than 3 remain, or an empty list when none remain.
3. WHEN the Classifier returns kind `'words'`, THE On_Device_Expander SHALL select the Phrase_Bank phrases whose Normalized_Tokens list has more tokens than the input's Normalized_Tokens list and whose first N tokens equal the input's N Normalized_Tokens in the same order, where N is the number of input tokens (for example, `i want` matches "I want to go outside." but `want i` does not).
4. WHEN the Classifier returns kind `'words'`, THE On_Device_Expander SHALL order the phrases selected in criterion 3 by Context_Score from highest to lowest, and phrases with equal Context_Score by Bank_Order from lowest to highest, and return the first 3 phrases exactly as stored in the Phrase_Bank (original case and punctuation), or all of them when fewer than 3 are selected.
5. IF the Classifier returns kind `'words'` and no Phrase_Bank phrase meets criterion 3, including when the input's Normalized_Tokens equal a phrase's Normalized_Tokens with no further tokens, THEN THE On_Device_Expander SHALL return an empty list.
6. WHEN the Classifier returns kind `'empty'`, THE On_Device_Expander SHALL return an empty list.

### Requirement 8: On-device expander output invariants

**User Story:** As a developer, I want the on-device expander to always produce valid, repeatable output, so that the UI can trust it without extra checks.

#### Acceptance Criteria

1. THE On_Device_Expander SHALL return, for every string input and every list of 0 or more valid Turns, an array of 0 to 3 strings that the Schema_Module accepts as the `suggestions` of an Expand_Response, so that each string has 1 to 200 characters inclusive and no two strings are equal when compared case-insensitively.
2. WHEN the On_Device_Expander builds its output and a candidate is equal, when compared case-insensitively, to a candidate earlier in the order defined by Requirement 6 or Requirement 7, THE On_Device_Expander SHALL discard the later candidate and fill the freed place with the next remaining candidate in that order, until it holds 3 Suggestions or no candidates remain.
3. IF a candidate built by the On_Device_Expander has 0 characters or more than 200 characters (for example, a `'partial'` completion joined onto a long typed text), THEN THE On_Device_Expander SHALL discard that candidate and fill the freed place with the next remaining candidate in order, as in criterion 2.
4. THE On_Device_Expander SHALL return, for the same input text and an equal context (same Turns with the same roles and texts, in the same order), lists with the same strings in the same order on every call, without reading the clock, randomness, storage or the network.
5. THE On_Device_Expander SHALL return a list without throwing for every string input, including the empty string, strings with only Whitespace, punctuation, digits or non-ASCII characters, and strings longer than 200 characters, and for an empty context.
6. WHEN the On_Device_Expander returns, THE On_Device_Expander SHALL leave the input text and every Turn in the input context unchanged.

### Requirement 9: Prompt building

**User Story:** As a speaker, I want the AI to use what my partner just said, so that its suggestions fit the conversation.

#### Acceptance Criteria

1. THE Prompt_Builder SHALL return exactly two messages for the Provider's `messages` array, in this order: one message with role `system` holding the system prompt and one message with role `user` holding the user message.
2. THE Prompt_Builder SHALL produce a system prompt that is the same fixed string for every Expand_Request, contains no request text and no context Turn text, and tells the model three things: expand the speaker's abbreviated input into up to Candidate_Max (5) different natural first-person sentences the speaker might mean, most likely first; use the conversation context; and answer with only a JSON object of the form `{"suggestions": [...]}` with no other text. (Changed on 2026-11-11 in the design polish pass: the prompt asked for 1 to 3 sentences, and after the initials check of Requirement 11 criterion 2 fewer than 3 often remained.)
3. WHEN the Input_Classification kind is `'initials'`, THE Prompt_Builder SHALL state the Initials_Letters and the number of letters in the user message. It SHALL also instruct the model that each sentence must have exactly one word per letter, in the same order, and that each word must start with the matching letter (for example, `iwtgo` gives 5 words starting with `i`, `w`, `t`, `g`, `o`).
4. WHEN the Input_Classification kind is `'partial'`, `'words'` or `'empty'`, THE Prompt_Builder SHALL include the trimmed typed text unchanged in the user message. It SHALL instruct the model to start each sentence with the speaker's typed words in the order typed. WHEN the kind is `'partial'`, it SHALL also instruct the model to complete the last typed token into a word that starts with that token.
5. THE Prompt_Builder SHALL include the text of every context Turn in the user message, oldest first, each labelled with its role `speaker` or `partner`. It SHALL mark the latest Turn with role `'partner'` as the line the speaker is replying to. WHEN the context is empty, it SHALL state in the user message that there is no conversation context.
6. THE Prompt_Builder SHALL place the context and the typed text inside delimiters that mark them as data. It SHALL instruct the model, in the system prompt, to ignore any instructions that appear inside the delimited context or typed text.
7. IF the typed text or any context Turn text contains the delimiter character sequence, THEN THE Prompt_Builder SHALL change that sequence so that it cannot end or open a delimited section. The rest of the text SHALL remain unchanged.
8. THE Prompt_Builder SHALL return character-for-character identical system prompts and user messages for equal Expand_Requests on every call, without reading the clock, randomness, environment variables or the network, and without throwing for any Expand_Request that the Schema_Module accepts.

### Requirement 10: Defensive output parsing

**User Story:** As a developer, I want model output parsed defensively, so that a malformed or unexpected reply never breaks the route.

#### Acceptance Criteria

1. WHEN the raw model output contains a substring that parses as a JSON object with a top-level `suggestions` property whose value is an array, THE Output_Parser SHALL return that array's string entries in their original order. The substring may be the whole text, sit inside a Markdown code fence with or without a language tag such as `json`, or have other text before or after it. The Output_Parser SHALL return the entries without trimming, length-checking, deduplicating or capping them, because those steps belong to the Suggestion_Filter.
2. IF the raw model output contains no substring that parses as a JSON object with a top-level `suggestions` array, THEN THE Output_Parser SHALL return an empty list. This covers output with no JSON, truncated or unbalanced JSON, an object without `suggestions`, an object whose `suggestions` is not an array (for example a string, number, `null` or object), and a top-level JSON array that is not wrapped in an object.
3. THE Output_Parser SHALL leave out every entry of the `suggestions` array that is not a string (numbers, booleans, `null`, objects and arrays) and keep the remaining string entries in their original order. It SHALL return an empty list when the array is empty or holds no strings.
4. THE Output_Parser SHALL return a list without throwing for every string input of 0 to 100,000 characters inclusive. This includes the empty string, Whitespace-only text, truncated JSON, unclosed Markdown code fences, unbalanced braces and arbitrary Unicode.
5. WHEN the raw model output contains more than one JSON object that meets criterion 1, THE Output_Parser SHALL use only the object whose opening brace comes earliest in the text and ignore the later objects.
6. THE Output_Parser SHALL return the same list for the same raw model output on every call, without reading the clock, randomness, storage or the network.

### Requirement 11: Suggestion filtering

**User Story:** As a speaker, I want AI suggestions that match the letters I keyed, so that I am never offered a sentence that ignores my input.

#### Acceptance Criteria

1. THE Suggestion_Filter SHALL trim leading and trailing Whitespace from each candidate and drop each candidate that has 0 characters or more than 200 characters after trimming, counting characters the same way the Schema_Module counts them for an Expand_Response.
2. WHEN the Input_Classification kind is `'initials'`, THE Suggestion_Filter SHALL drop each trimmed candidate whose Initials_Of is not exactly equal to the Initials_Letters, including candidates that have no Normalized_Tokens.
3. WHEN the Input_Classification kind is `'partial'`, `'words'` or `'empty'`, THE Suggestion_Filter SHALL keep every candidate that passes criterion 1, without an initials check.
4. WHEN two candidates that remain after criteria 1 to 3 are equal after trimming when compared case-insensitively, using the same comparison the Schema_Module uses for an Expand_Response, THE Suggestion_Filter SHALL keep only the one that appears first in the input list.
5. THE Suggestion_Filter SHALL apply its steps in this order: the window of the first Candidate_Max entries (criterion 9), trimming and length check (criterion 1), initials check (criteria 2 and 3), deduplication (criterion 4), then the cap (criterion 6). (Changed on 2026-11-11 in the design polish pass: the window step comes first.)
6. THE Suggestion_Filter SHALL return the trimmed text of at most the first 3 candidates that remain after deduplication, in their original input order.
7. IF the input list is empty or no candidate remains after filtering, THEN THE Suggestion_Filter SHALL return an empty list without throwing.
8. THE Suggestion_Filter SHALL return, for every list of strings of any length and for every Input_Classification, a list that the Schema_Module accepts as the `suggestions` of an Expand_Response, and SHALL leave the input list unchanged.
9. THE Suggestion_Filter SHALL read only the first Candidate_Max (5) entries of the input list, whether or not they pass criteria 1 to 4, and SHALL ignore every later entry. (Added on 2026-11-11 in the design polish pass, with the larger candidate count of Requirement 9 criterion 2.)

### Requirement 12: Expand route request checks

**User Story:** As the app owner, I want the expansion endpoint to reject foreign, oversized, too-frequent and malformed requests, so that the API key is not used as a public proxy.

#### Acceptance Criteria

1. THE Expand_Route SHALL apply its checks in this order: origin (criteria 2 and 8), rate (criterion 3), body size (criteria 4 and 5), request validation (criterion 6), configuration (Requirement 13, criterion 1). It SHALL stop at the first check that fails and return only that check's response, without running later checks and without calling the Provider.
2. IF the request has an `Origin` header whose value is `null`, cannot be parsed as an origin, or does not name this server, THEN THE Expand_Route SHALL respond with status 403 and Error_Body `forbidden_origin` without reading the body. The `Origin` names this server when the request has a `Sec-Fetch-Site` header whose value is `same-origin`; or, when the request has no `Sec-Fetch-Site` header, when its scheme, host and port equal those of the request URL, or its host and port equal the request's `Host` header. Scheme and host SHALL be compared case-insensitively. An omitted port SHALL be treated as the scheme's default port (443 for `https`, 80 for `http`; for the `Host` header, the default port of the `Origin`'s scheme). (Changed in review v1: outside Vercel, Next.js fills the request URL with `http://localhost:<port>` whatever address the browser used, so LAN, `127.0.0.1`, proxy and container setups were rejected.)
3. IF the client IP address (criterion 9) already has 30 counted requests on the same server instance that arrived less than 60,000 ms before the current request, THEN THE Expand_Route SHALL respond with status 429, a `Retry-After` header, and Error_Body `rate_limited`, and SHALL NOT count the rejected request. The `Retry-After` header SHALL be a whole number of seconds from 1 to 60: the time until the oldest of those 30 requests is 60,000 ms old, rounded up.
4. IF the request `Content-Length` header states more than Body_Limit (16,384) bytes, THEN THE Expand_Route SHALL respond with status 413 and Error_Body `payload_too_large` without reading the body.
5. IF the number of body bytes read so far exceeds Body_Limit, whether or not a `Content-Length` header is present, THEN THE Expand_Route SHALL stop reading and respond with status 413 and Error_Body `payload_too_large`. A body of exactly 16,384 bytes SHALL pass this check.
6. IF the request body is empty, is not valid UTF-8 JSON, or the Schema_Module rejects the parsed body as an Expand_Request, THEN THE Expand_Route SHALL respond with status 400 and Error_Body `invalid_request`. The response SHALL NOT contain any part of the submitted text or context.
7. THE Expand_Route SHALL keep rate-limit counts in server memory only, keyed by client IP address, and SHALL NOT write them to storage, logs or any external service. It SHALL count every request that passes the origin check and is not rejected by criterion 3, including requests later rejected with status 413 or 400. It SHALL discard each entry once 60,000 ms have passed since that entry's newest counted request.
8. IF the request has no `Origin` header, THEN THE Expand_Route SHALL treat the origin check as passed and go on to the rate check (criterion 3).
9. WHEN the Expand_Route determines the client IP address for criteria 3 and 7, it SHALL use the first comma-separated entry of the `x-forwarded-for` header, trimmed of Whitespace. Deployed on Vercel, this header is set by the platform. If that entry is missing or empty, the route SHALL use the trimmed `x-real-ip` header value. If both are missing or empty, the route SHALL count the request under one shared key for unknown clients, which is subject to the same Rate_Limit.

### Requirement 13: Expand route provider call

**User Story:** As a speaker, I want the server to ask a fast AI model for suggestions, so that my initials become sentences that fit the conversation.

#### Acceptance Criteria

1. IF a request passes every check in Requirement 12 and `DIT_LLM_API_KEY` is unset or set to the empty string, THEN THE Expand_Route SHALL respond with status 503 and Error_Body `not_configured` without contacting the Provider.
2. WHEN a request passes every check in Requirement 12 and `DIT_LLM_API_KEY` is set to a non-empty value, THE Expand_Route SHALL send exactly one `POST` request using the platform `fetch` function to Provider_Base_URL with any trailing `/` characters removed, followed by `/chat/completions`. The request SHALL carry the headers `Authorization: Bearer <DIT_LLM_API_KEY>` and `Content-Type: application/json` and forward no header from the incoming request. Its JSON body SHALL hold `model`, a `messages` array of exactly two entries (the Prompt_Builder's system prompt with role `system` first, then its user message with role `user`), and `max_tokens` equal to Max_Output_Tokens, plus `reasoning_effort` equal to `'none'` only when `model` equals Default_Model, and no other fields. THE Expand_Route SHALL not retry after a failure or timeout.
3. WHERE `DIT_MODEL` is set to a non-empty value, THE Expand_Route SHALL send that value unchanged as the Provider request's `model`.
4. IF `DIT_MODEL` is unset or set to the empty string, THEN THE Expand_Route SHALL send Default_Model as the Provider request's `model`.
5. THE expansion server code SHALL define Default_Model as one exported constant and SHALL reference that constant wherever the default model ID is needed.
6. WHEN the Provider responds within Server_Timeout with a status from 200 to 299 inclusive and a JSON body whose first `choices` entry has a string `message.content`, THE Expand_Route SHALL pass that string through the Output_Parser and then the Suggestion_Filter (using the request's Input_Classification). It SHALL then respond with status 200 and an Expand_Response that the Schema_Module accepts. The Expand_Response SHALL contain `suggestions: []` when the Suggestion_Filter returns an empty list.
7. IF the Provider responds with a status from 200 to 299 inclusive and the body is not valid JSON, has no `choices` array, has an empty `choices` array, or has a first `choices` entry without a string `message.content`, THEN THE Expand_Route SHALL respond with status 502 and Error_Body `upstream_failed`.
8. IF the Provider has not delivered its complete response body within Server_Timeout, measured from the moment the Expand_Route calls `fetch`, THEN THE Expand_Route SHALL abort the Provider request through an `AbortSignal`, respond with status 504 and Error_Body `upstream_timeout`, and ignore any Provider output that arrives later.
9. IF the Provider request fails with a network error other than the abort in criterion 8, or the Provider responds with a status outside 200 to 299, THEN THE Expand_Route SHALL respond with status 502 and Error_Body `upstream_failed`. That response SHALL not include the Provider's status code, status text, headers or response body.
10. THE Expand_Route SHALL read `DIT_LLM_API_KEY`, `DIT_LLM_BASE_URL` and `DIT_MODEL` on the server only and SHALL exclude the value of `DIT_LLM_API_KEY` from every response body, response header, log line and error message.

### Requirement 14: Expand route privacy and response headers

**User Story:** As a speaker, I want my words kept off the server, so that what I say stays private.

#### Acceptance Criteria

1. THE Expand_Route SHALL set `Cache-Control: no-store` and `Content-Type: application/json` on every response it returns, including the 200 response and every non-200 response with an Error_Body (403, 400, 413, 429, 502, 503 and 504), and including responses sent without reading the request body.
2. WHEN the Expand_Route finishes a request, THE Expand_Route SHALL write at most one log line for that request, and that line SHALL contain only the response status code and the request latency as a whole number of milliseconds, measured from the moment the Expand_Route receives the request to the moment it returns the response.
3. THE Expand_Route SHALL exclude the request text, the context Turns, the Provider's response body (model output and error replies alike) and the client IP address from every log line, every response header and every error message.
4. THE Expand_Route SHALL return response bodies that contain only the `suggestions` field for status 200 and only the `error` field for every other status, without raw model output, Provider error details, the request text or the context.
5. WHEN the Expand_Route contacts the Provider, THE Expand_Route SHALL send only the headers and body fields listed in Requirement 13, criteria 2 to 4, and SHALL NOT forward the client IP address, cookies or any header taken from the incoming request.
6. THE Expand_Route SHALL keep request text, context and model output in memory only while it handles the request. It SHALL NOT write them to any file, database, cache or external service other than the Provider, and SHALL hold no reference to them after it returns the response. The only per-client data the Expand_Route may keep across requests is the IP-keyed rate-limit count from Requirement 12, criterion 7.

### Requirement 15: Client request scheduling

**User Story:** As a speaker, I want suggestions to follow my keying without flooding the server, so that the app stays fast and the API stays cheap.

#### Acceptance Criteria

1. WHEN the typed text passed to the Client changes, or the typed text is unchanged and not empty after trimming while the context prepared under criterion 4 differs from the context prepared from the previous call, THE Client SHALL restart a Debounce_Delay timer and start exactly one expansion for the latest typed text and context only once Debounce_Delay passes with no further such change, so that a run of changes each less than Debounce_Delay apart causes one expansion. (Changed in review v1 so that a new partner line refreshes the suggestions, as conversation-ui Requirement 9.3 expects.)
2. WHEN the Client starts an expansion while an earlier Expand_Route request is still pending, THE Client SHALL abort the earlier request before sending the new one, so that at most one Expand_Route request is pending at any time.
3. WHEN an expansion finishes for typed text that differs from the latest typed text passed to the Client at the moment it finishes, THE Client SHALL discard the result without delivering it and without storing it in the Result_Cache.
4. WHEN the Client sends a request, THE Client SHALL send the trimmed typed text and the context prepared as follows: Turns whose text is empty or only Whitespace are removed first, then the most recent 10 or fewer remaining Turns are kept, oldest first, with each kept Turn's text cut to its first 500 characters.
5. WHEN an expansion starts and the Result_Cache holds a result for the trimmed typed text and the prepared context from criterion 4 (same Turns in the same order with the same roles and texts), THE Client SHALL deliver the cached result with source `'ai'` without contacting the Expand_Route and SHALL mark that entry as the most recently used.
6. WHEN the Client delivers an `'ai'` Expansion_Result received from the Expand_Route, THE Client SHALL store it in the Result_Cache under the trimmed typed text and prepared context that were sent, removing the least recently used entry when the Result_Cache already holds 20 entries, so that the Result_Cache never holds more than 20 entries.
7. WHEN an expansion starts and the trimmed typed text is empty, THE Client SHALL abort any pending Expand_Route request and deliver an Expansion_Result with an empty `suggestions` list and source `'on-device'` without contacting the Expand_Route.
8. THE Client SHALL take its fetch function, timer functions, online-status check and On_Device_Expander as Injected_Dependencies and SHALL use only those Injected_Dependencies for network access, timing, online-status checks and on-device expansion.
9. IF the Client aborts an Expand_Route request because a newer expansion started, THEN THE Client SHALL deliver no Expansion_Result for the aborted request and SHALL NOT run the On_Device_Expander for it.

### Requirement 16: Client fallback and result source

**User Story:** As a speaker, I want suggestions even when the AI is unavailable, and as a partner, I want to see which expander answered, so that the app works anywhere and I know what to expect.

#### Acceptance Criteria

1. WHEN the Expand_Route responds with status 200 and a body that the Schema_Module accepts as an Expand_Response with at least one Suggestion, THE Client SHALL deliver an Expansion_Result with `text` equal to the trimmed typed text, `suggestions` equal to the Expand_Response Suggestions in the same order with none added or removed, and source `'ai'`.
2. IF the Expand_Route responds with any status other than 200, THEN THE Client SHALL deliver an Expansion_Result with `text` equal to the trimmed typed text, `suggestions` equal to the On_Device_Expander output for the trimmed typed text and the context that would be sent under Requirement 15 criterion 4, and source `'on-device'`.
3. IF the Client has not received the complete Expand_Route response body within Client_Timeout, measured from the moment the request is sent, THEN THE Client SHALL abort the request and deliver an Expansion_Result with `text` equal to the trimmed typed text, `suggestions` equal to the On_Device_Expander output for the trimmed typed text and the context that would be sent, and source `'on-device'`.
4. IF the fetch call rejects for any reason other than an abort caused by a newer expansion under Requirement 15 criterion 2, or the response body is not valid JSON, or the Schema_Module rejects the body as an Expand_Response, or the Expand_Response has zero Suggestions, THEN THE Client SHALL deliver an Expansion_Result with `text` equal to the trimmed typed text, `suggestions` equal to the On_Device_Expander output for the trimmed typed text and the context that would be sent, and source `'on-device'`.
5. IF the online-status check reports offline when the Client starts an expansion, THEN THE Client SHALL deliver an Expansion_Result with `text` equal to the trimmed typed text, `suggestions` equal to the On_Device_Expander output for the trimmed typed text and the context that would be sent, and source `'on-device'`, without contacting the Expand_Route.
6. IF the trimmed typed text is longer than 200 characters, THEN THE Client SHALL deliver an Expansion_Result with `text` equal to the trimmed typed text, `suggestions` equal to the On_Device_Expander output for the trimmed typed text and the context that would be sent, and source `'on-device'`, without contacting the Expand_Route. Trimmed text of exactly 200 characters SHALL still be sent to the Expand_Route.
7. THE Client SHALL deliver every expansion outcome that Requirement 15 criterion 3 does not discard as exactly one Expansion_Result, and SHALL report failures only through the `'on-device'` source, without throwing or rejecting to the caller.
8. IF the On_Device_Expander throws while the Client is producing an `'on-device'` Expansion_Result, THEN THE Client SHALL deliver an Expansion_Result with `text` equal to the trimmed typed text, an empty `suggestions` list and source `'on-device'`, without throwing or rejecting to the caller.

### Requirement 17: Example-based tests

**User Story:** As a developer, I want example tests on the expander and the route checks, so that the documented behaviour stays correct.

#### Acceptance Criteria

1. THE On_Device_Expander unit tests SHALL check at least these examples, each with an empty context unless stated otherwise:
   - `iwtgo` and `i w t g o` each return "I want to go outside." as the first Suggestion.
   - An initials input whose Phrase_Bank matches are all in the Prefix_Tier returns 1 to 3 Suggestions, and each Suggestion's Initials_Of has the Initials_Letters as a Proper_Prefix.
   - Two phrases in the same tier, A with lower Bank_Order and B with higher Bank_Order, appear as A before B with an empty context. They appear as B before A when the context's latest partner Turn contains a Context_Word that appears in B and not in A.
   - `i want wa` returns 1 to 3 Suggestions. Each Suggestion has exactly 3 Normalized_Tokens, starts with `i want wa`, and has a last token that is a Word_List entry with `wa` as a Proper_Prefix.
   - `?!` returns an empty list.
2. THE Classifier unit tests SHALL check at least these examples:
   - `iwtgo` → `'initials'` with Initials_Letters `iwtgo`.
   - `I W T G O.` → `'initials'` with Initials_Letters `iwtgo`.
   - `go` → `'words'`.
   - `i want wa` → `'partial'`.
   - `i want water` → `'words'`.
   - `?!` → `'empty'`.
3. THE Expand_Route unit tests SHALL use a fake `fetch` in place of the Provider and a test value for `DIT_LLM_API_KEY` (except in the 503 case), and SHALL check at least these responses, each with the stated status and Error_Body code:
   - 403 `forbidden_origin` for an `Origin` header that does not name this server under Requirement 12 criterion 2.
   - A status other than 429 for each of the first 30 requests from one client IP address within 60 seconds, and 429 `rate_limited` with a `Retry-After` header for the 31st.
   - 413 `payload_too_large` for a `Content-Length` header above 16,384 bytes, and 413 for a body above 16,384 bytes sent without a `Content-Length` header.
   - 400 `invalid_request` for each of: invalid JSON, empty `text`, `text` of 201 characters after trimming, 11 context Turns, and a Turn with a role other than `'speaker'` or `'partner'`.
   - 503 `not_configured` when `DIT_LLM_API_KEY` is unset.
   - 200 with an Expand_Response that the Schema_Module accepts when the Provider replies successfully.
   - 502 `upstream_failed` for each of: a Provider non-success status, a fake `fetch` that rejects with a network error, and a successful Provider body with no string `message.content` in its first choice.
   - 504 `upstream_timeout` when the fake `fetch` has not settled within Server_Timeout (4,000 ms).
4. THE Expand_Route unit tests SHALL check, for an `'initials'` request, that a Provider reply holding one Suggestion whose Initials_Of equals the Initials_Letters and one whose Initials_Of differs returns status 200 with only the matching Suggestion.
5. THE Expand_Route unit tests SHALL check that the fake `fetch` is called 0 times for the 403, 429, 413, 400 and 503 cases, and exactly 1 time for each 200, 502 and 504 case.
6. THE Client unit tests SHALL use fake timers and a fake fetch and SHALL check at least these cases:
   - Debounce: 3 text changes less than 300 ms apart, followed by 300 ms with no change, cause exactly 1 fetch call, and that call carries the latest text.
   - Stale requests: starting a new expansion aborts the earlier request's signal, and the earlier result is not delivered.
   - Cache: a second expansion with the same trimmed text and context delivers the cached `'ai'` result with 0 additional fetch calls.
   - Fallback: the Client delivers the On_Device_Expander output with source `'on-device'` for each of: status 503, a fetch that throws, no response within Client_Timeout (5,000 ms), an offline status report (with 0 fetch calls), and an Expand_Response with an empty `suggestions` list.
7. THE example-based tests for the Classifier, On_Device_Expander, Expand_Route and Client SHALL pass on every run with no network access.

### Requirement 18: Property-based tests

**User Story:** As a developer, I want property tests on the pure expansion code, so that edge cases I did not think of are covered.

#### Acceptance Criteria

1. THE Schema_Module property tests SHALL check, for generated Turn, Expand_Request and Expand_Response values, that every value with all fields inside the limits of Requirements 1 to 3 is accepted, and that every value with exactly one limit broken (one field one step below its minimum, one step above its maximum, or of the wrong type or enum value) is rejected.
2. THE Classifier property tests SHALL check that for every generated string of 0 to 1,000 characters, including arbitrary Unicode, the Classifier returns without throwing an Input_Classification whose `kind` is exactly one of `'initials'`, `'partial'`, `'words'` or `'empty'`.
3. THE Classifier property tests SHALL check that for every pair of generated strings with equal Normalized_Tokens, such as a string and the same string with letter case changed, characters other than `a`–`z`, `0`–`9` and Whitespace added or removed, or runs of Whitespace between tokens lengthened or shortened, the Classifier returns deeply equal Input_Classifications.
4. THE On_Device_Expander property tests SHALL check that for every generated text of 0 to 200 characters and every generated list of 0 to 10 Turns that the Schema_Module accepts, the output is accepted by the Schema_Module as Expand_Response `suggestions`, and that two calls with the same arguments return lists with the same Suggestions in the same order.
5. THE On_Device_Expander property tests SHALL check that for every generated text that the Classifier classifies as `'initials'`, the Initials_Of of each Suggestion either equals the Initials_Letters or has the Initials_Letters as a Proper_Prefix, and that every Suggestion whose Initials_Of equals the Initials_Letters appears at a lower list index than every Suggestion whose Initials_Of has the Initials_Letters as a Proper_Prefix.
6. THE Output_Parser property tests SHALL check that for every generated string of 0 to 10,000 characters, including well-formed JSON, truncated JSON, JSON with non-string array elements and arbitrary Unicode, the Output_Parser returns without throwing a list in which every element is a string.
7. THE Suggestion_Filter property tests SHALL check that for every generated list of 0 to 50 strings, each of 0 to 1,000 characters, and every generated Input_Classification, the output is accepted by the Schema_Module as Expand_Response `suggestions`, and that for `'initials'` Input_Classifications the Initials_Of of every output Suggestion equals the Initials_Letters.
8. THE expansion property tests SHALL each run with fast-check for at least 200 generated cases, and each property test SHALL be tagged with the property ID from the expansion design document that it verifies.


## Review corrections: initials, request freshness and public endpoint (review, 2026-11-11)

These corrections supersede earlier conflicting criteria in this document.

20.1. WHEN multiple all-letter tokens total 2–12 letters and not every leading token is a Known_Word, THE Classifier SHALL join them as initials; WHEN no initials rule applies, every leading token is known and the last token is an unknown Proper_Prefix, THE Classifier SHALL return partial; WHEN a single two-letter token matches phrase-bank initials, THE Classifier SHALL prioritise initials.
20.2. WHEN typed text or prepared context changes, THE Expansion_Client SHALL increment its request generation, cancel pending work and deliver or cache only the current generation; WHEN history is cleared, THE client SHALL immediately replace context and cancel old work.
20.3. WHEN a POST request has no Origin, THE Expand_Route SHALL reject it before reading the body or counting rate limits; WHEN Origin is present, THE route SHALL retain same-origin, Sec-Fetch-Site and LAN Host checks.
20.4. WHEN documenting default-model verification, THE project SHALL retain the user-provided result: deepseek-v4p1-flash-1017 returned correct top suggestions for iwtgo, cihsw, mbh, tyfc and wtt in 0.7–2.4 seconds.

Round-2 clarification: paused initials depend on whether every leading token is a known word, not individual multi-letter prefixes or exact phrase matches (`ci hs`, `iw th`, `iwt go`). Remove the contraction token `im` from the word list; it has no exact two-letter phrase-bank entry and should follow the existing unknown-token initials rule.
