# Implementation Plan: conversation-ui

## Overview

Build conversation-ui from the inside out, following the module layout in `design.md`. Task 1 adds only the tooling and sibling surfaces this spec needs, and only when they are not already present. Then come the pure modules in `src/lib/conversation/` and `src/lib/speech/listen.ts`, the Web Speech adapters, the framework-free `SessionController`, the `useMorseSession` hook, the components, and finally the `app/` files and design tokens.

This spec depends on `morse-engine`, `input-sources` and `expansion`. Their modules must exist under `src/lib/morse/`, `src/lib/input/` and `src/lib/expansion/`. If a sibling is not implemented yet, task 1.4 adds a stub behind that sibling's public `index.ts` with the exact names and signatures from the sibling design, so this spec compiles and its tests run against fakes. The sibling spec later replaces the stub without changing any import here.

Every correctness property in `design.md` (Properties 1 to 21) is its own required sub-task. Each one is exactly one `fc.assert` with `numRuns` of at least 200 (via `PROP_RUNS` from `src/lib/conversation/test-support.ts`), its test name starts with its ID (for example `P9 turns invariant`), and it carries the tag comment `// Feature: conversation-ui, Property N: <title>`. The arbitraries and fakes those properties use are also required. Example tests that Requirement 23 mandates, or that are the only automated check of a criterion, are required. Component tests are required and locate elements only by role and accessible name. Other example tests are optional and marked `*`.

The design section "Integration points for onboarding-and-safety" adds four additive seams: `PressRouter` with `sessionOnlyRouter()`, `SourceControl` with `DEFAULT_ENABLED_SOURCES`, the `extraSettingsActions` slot, and the controller's `discardInput()`, `onCharCommitted` and `withholdUp` reset on the next `down`. Sub-tasks 2.4, 2.5, 9.8 to 9.13, 11.16, 11.17, 12.7, 12.8 and 13.3 to 13.8 cover them. Each seam defaults to today's behaviour, so no earlier task or property changes. Their example tests are required, because they are the only automated check of each seam. Criterion numbers prefixed "O" (for example O12.10) refer to `.kiro/specs/onboarding-and-safety/requirements.md`; `_Requirements:_` lines list this spec's criteria only.

All commands use `bun run test`, `bun run typecheck` and `bun run lint`. Never run `bun test`, and never start `bun run dev` from an agent shell.

## Tasks

- [ ] 1. Add the tooling and sibling surfaces this spec needs, if not already present
  - [ ] 1.1 Ensure the Next.js App Router app with React 19, Tailwind CSS v4 and Zod
    - If the base scaffolding from `morse-engine` task 1.1 (`package.json` with `test` and `typecheck` scripts, strict `tsconfig.json` with the `@/*` alias, `vitest.config.ts`, `.gitignore`) is missing, create it exactly as that task describes; otherwise leave it unchanged
    - If missing, add `next`, `react@19`, `react-dom@19` and `zod` (version 4) with `bun add`, and `@types/react` and `@types/react-dom` with `bun add -d`
    - If missing, add `tailwindcss` (v4) and `@tailwindcss/postcss` with `bun add -d`, and create `postcss.config.mjs` that loads `@tailwindcss/postcss`
    - Add scripts `dev` (`next dev`) and `build` (`next build`) only if missing; create `next.config.ts` and add `"jsx"`, the `next` TypeScript plugin and `next-env.d.ts` to `tsconfig.json` only if missing
    - Do not create `src/app/` files here; task 14 does that
    - _Requirements: 22.4, 22.5, 23.7_
  - [ ] 1.2 Ensure jsdom, Testing Library and the DOM test setup
    - If missing, add `jsdom`, `@testing-library/react`, `@testing-library/dom` and `@testing-library/user-event` with `bun add -d`
    - `vitest.config.ts`: keep `environment: 'node'` as the default and make `include` cover `src/**/*.test.{ts,tsx}`; leave other settings unchanged. Component and hook tests opt into jsdom with `// @vitest-environment jsdom`
    - Create `src/components/test-setup.ts` that, only when `HTMLDialogElement` exists and lacks them, polyfills `showModal()` and `close()` to toggle `open` and dispatch `close`, and provides a `matchMedia` stub that tests can set for `(prefers-reduced-motion: reduce)`; append it to `setupFiles` without removing existing entries (keep the expansion no-network `fetch` guard)
    - _Requirements: 23.5, 23.7_
  - [ ] 1.3 Ensure ESLint flat config with `eslint-config-next` and the `lint` script
    - If missing, add `eslint` and `eslint-config-next` with `bun add -d`, create `eslint.config.mjs` (flat config extending `eslint-config-next`, which includes `jsx-a11y`), and add the script `lint` (`eslint .`)
    - Add a `no-restricted-imports` override for `src/lib/**` that forbids `react`, `react/*`, `next`, `next/*`, `@/components/*` and `@/hooks/*`, and forbids `@/lib/expansion/client` from `src/lib/conversation/**` except as a type-only import
    - Add a `no-restricted-globals` override for `src/lib/conversation/**` and `src/lib/speech/listen.ts` (excluding `src/lib/conversation/browser.ts` and test files) forbidding `window`, `document`, `localStorage`, `navigator`, `performance`, `setTimeout`, `setInterval` and `fetch`, plus `no-restricted-properties` for `Date.now` and `Math.random`
    - Merge with any existing sibling overrides instead of replacing them
    - _Requirements: 7.1, 7.6_
  - [ ] 1.4 Verify the sibling modules, and stub any that are missing behind their public `index.ts`
    - `@/lib/morse` must export `Engine`, `EngineEvent`, `EngineConfig`, `Estimates`, `createEngine`, `Result`, `ok` and `err` as the morse-engine design defines them
    - `@/lib/input` must export `PressEvent`, `SourceKind`, `SourceStatus`, `Clock`, `Scheduler`, `Unsubscribe`, `safeTickTime`, `SettingsStore`, `InputSettings`, `DEFAULT_INPUT_SETTINGS`, `validateMinPressDuration`, `validateThresholds`, `validateSwitchKey`, `browserScheduler` and `useInputSources`; its test support must provide `createManualClock()` and `createManualScheduler()` (with `runDue`, `pending()` and cancel)
    - `@/lib/expansion` must export `Turn`, `TurnSchema`, `Role`, `trimWhitespace`, `ExpansionResult`, `ExpansionClient`, `createExpansionClient`, `expandOnDevice` and `CONTEXT_MAX_TURNS`
    - For each missing module, add a stub file at the path the sibling design names, re-exported from that sibling's `index.ts`, with the exact signatures; stub behavior is the simplest value-correct version (for example `safeTickTime(now, p) = p === null ? now : Math.min(now, p)`, `trimWhitespace` on the 4 Whitespace characters, a `createEngine` that never emits events, a `useInputSources` that connects no sources). Mark each stub with a header comment naming the owning spec. Do not stub anything that already exists
    - _Requirements: 6.7, 8.1, 8.4, 9.1, 16.11_

- [ ] 2. Define conversation and speech types and plug-in interfaces
  - [ ] 2.1 Implement `src/lib/conversation/types.ts`
    - `TEXT_MAX = 500`, `HISTORY_CAP = 200`, `CONTEXT_WINDOW = 10` (equal to `CONTEXT_MAX_TURNS`), `SessionTurn`, `SuggestionSource`, `SessionState`, `HydrateEntry`, `SessionAction` (all six kinds), `SessionEffect` (`speak`, `reset-engine`, `alarm`, `unknown`) and `Transition`, all `readonly`
    - Sibling types imported from the sibling `index.ts` barrels with `import type`
    - _Requirements: 1.8, 3.9, 6.8, 7.6_
  - [ ] 2.2 Implement `src/lib/conversation/handlers.ts`
    - `AlarmHandler` (`start`, `isActive`, `handlePress`, `onActiveChange`), `UnknownPatternHandler` (`handle`), `inertAlarmHandler()` (inactive, `start()` no-op) and `inertUnknownPatternHandler()`
    - _Requirements: 5.3, 5.6, 8.10_
  - [ ] 2.3 Implement `src/lib/speech/types.ts`
    - `VoiceInfo`, `UtteranceOutcome`, `SpeechOutput`, `RecognitionError` and `SpeechInput` exactly as the design defines them
    - _Requirements: 17.1, 17.2, 18.8, 18.11_
  - [ ] 2.4 Add the onboarding integration types to `src/lib/conversation/handlers.ts`
    - `SessionPressTarget` (`handlePress`, `discardInput`), `PressRouter` (`connect(session): Unsubscribe`, `route(event)`), `sessionOnlyRouter()` (`route` calls the connected `session.handlePress(e)` for every event in order, never calls `discardInput`, and drops events while disconnected), `EnabledSources`, `DEFAULT_ENABLED_SOURCES = { keyboard: true, switch: true, pointer: true, blink: false }` (frozen) and `SourceControl`, exactly as the design defines them
    - `unavailableLearner(): SwitchLearner` (design Integration point 5): `arm()` resolves `err({ reason: 'cancelled', message: 'not available' })`, `clear()` returns `err({ reason: 'save-failed', message: 'not available' })`, `cancel()` does nothing and `isArmed()` returns false; uses only existing `LearnError` reasons, so input-sources types stay unchanged
    - Serves onboarding-and-safety O12.1 (router seam) and O11.12 (blink off at load)
    - _Requirements: 8.1, 8.14, 22.12_
  - [ ] 2.5 Write example tests in `src/lib/conversation/handlers.test.ts`
    - `sessionOnlyRouter()` connected to a recording target forwards `down, up, down, up` to `handlePress` in order and never calls `discardInput`; after the returned disconnect runs, `route` forwards nothing; `DEFAULT_ENABLED_SOURCES` equals `{ keyboard: true, switch: true, pointer: true, blink: false }` and is frozen
    - `unavailableLearner()`: `await arm()` equals `err({ reason: 'cancelled', message: 'not available' })`, `clear()` equals `err({ reason: 'save-failed', message: 'not available' })`, `cancel()` throws nothing and `isArmed()` is false before and after `arm()`
    - _Requirements: 8.1, 8.14_

- [ ] 3. Implement the Session_Reducer
  - [ ] 3.1 Implement `src/lib/conversation/session.ts`
    - `INITIAL_SESSION` (all empty or null, `nextTurnId` 1), `trimmedText()` using `trimWhitespace`, `contextWindow()` (last ≤ 10 Turns as `{ role, text }`), and `reduce()` following every row of the transition table in order
    - Internal `speakStep(sentence)` and `appendTurn(role, text)` (defensive `.slice(0, 500)`, `.slice(-200)`, `nextTurnId + 1`); after char, space and backspace compare `trimmedText` before and after and clear Suggestions, Suggestion_Source and Highlight only when it changed
    - Drop Suggestions entries that are empty after trimming; never mutate inputs; no clock, random, storage, DOM or module-level mutable state
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.5_
  - [ ] 3.2 Create the session arbitraries in `src/lib/conversation/test-support.ts`
    - `PROP_RUNS = 200`; `arbText()` (0 to 500 characters from `a–z`, digits, Character_Table punctuation and the 4 Whitespace characters, biased to lengths 0, 1, 499, 500 and to trailing spaces)
    - `arbStateDirect()` (invariant-satisfying states with 0 to 200 Turns, increasing IDs, `nextTurnId` above them, 0 to 3 Suggestions with matching source and highlight) and `arbReachableState()` (fold of `arbActions` over `INITIAL_SESSION`)
    - `arbAction(state)` covering every Session_Action kind: all Engine_Event variants and the four commands; Suggestions_Received matching the current Trimmed_Text 70% of the time (0 to 5 suggestions) and a near-miss (case or inner Whitespace) otherwise; Partner_Line with Whitespace-only, short and over-500 strings; Partner_Pick from `fc.oneof(fc.integer({ min: -2, max: 4 }), fc.double())`; Clear_History; Hydrate with 0 to 250 mixed valid and invalid entries
    - `arbActions({ max })` built as a stateful fold so Suggestions_Received can match the current text; `deepFreeze()` helper
    - Test-only; never re-exported from `index.ts`
    - _Requirements: 23.1, 23.2_
  - [ ] 3.3 Write example tests in `src/lib/conversation/session.test.ts`
    - One example per transition-table row, including the 500-character boundaries, Whitespace-only speak (only `[reset-engine]`), highlighted and raw speak flows, and Hydrate with invalid entries
    - Run `reduce` with `Date.now`, `Math.random` and `performance.now` replaced by throwing stubs and assert it still returns
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1, 4.2, 4.3, 6.6, 7.1_
  - [ ] 3.4 Write property test P1 in `src/lib/conversation/session.prop.test.ts`
    - **Property 1: Spacing and length invariant**
    - **Validates: Requirements 1.2, 1.4, 1.8**
  - [ ] 3.5 Write property test P2 in `src/lib/conversation/session.prop.test.ts`
    - **Property 2: Engine events follow the transition table**
    - Compare against a small reference model of the single-event rules
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 5.1, 5.2**
  - [ ] 3.6 Write property test P3 in `src/lib/conversation/session.prop.test.ts`
    - **Property 3: Backspace inverse**
    - **Validates: Requirements 2.4, 2.5**
  - [ ] 3.7 Write property test P4 in `src/lib/conversation/session.prop.test.ts`
    - **Property 4: Suggestions are accepted only when fresh and dropped when the text changes**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
  - [ ] 3.8 Write property test P5 in `src/lib/conversation/session.prop.test.ts`
    - **Property 5: Highlight range invariant**
    - **Validates: Requirements 3.8, 3.9**
  - [ ] 3.9 Write property test P6 in `src/lib/conversation/session.prop.test.ts`
    - **Property 6: Highlight cycle**
    - **Validates: Requirements 3.6, 3.7, 3.10**
  - [ ] 3.10 Write property test P7 in `src/lib/conversation/session.prop.test.ts`
    - **Property 7: Speak and Partner_Pick choose the right sentence**
    - Index values include negative, fractional, `NaN`, `±Infinity` and `≥ N`
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
  - [ ] 3.11 Write property test P8 in `src/lib/conversation/session.prop.test.ts`
    - **Property 8: Speak clears state**
    - Include states with exactly 200 Turns
    - **Validates: Requirements 4.6, 4.7, 4.8, 4.9, 4.10**
  - [ ] 3.12 Write property test P9 in `src/lib/conversation/session.prop.test.ts`
    - **Property 9: Turns invariant**
    - Track the maximum ID ever issued across caps, Clear_History and Hydrate
    - **Validates: Requirements 4.9, 6.3, 6.4, 6.8**
  - [ ] 3.13 Write property test P10 in `src/lib/conversation/session.prop.test.ts`
    - **Property 10: Partner_Line, Clear_History and Hydrate follow their model**
    - **Validates: Requirements 6.1, 6.2, 6.5, 6.6**
  - [ ] 3.14 Write property test P11 in `src/lib/conversation/session.prop.test.ts`
    - **Property 11: Determinism**
    - Sequences of 0 to 1,000 actions applied to two `structuredClone` copies
    - **Validates: Requirements 7.4**
  - [ ] 3.15 Write property test P12 in `src/lib/conversation/session.prop.test.ts`
    - **Property 12: The reducer is total, synchronous and non-mutating**
    - Deep-freeze inputs; assert no throw, no `then` on the result, inputs equal to a prior `structuredClone`
    - **Validates: Requirements 7.2, 7.3, 7.5**

- [ ] 4. Implement the Live_Region queue
  - [ ] 4.1 Implement `src/lib/conversation/live-queue.ts`
    - `ANNOUNCE_INTERVAL_MS = 1000`, `LiveItem`, `LiveQueueState`, `INITIAL_LIVE_QUEUE`, `LiveStep`, `enqueue()` (announce at once when nothing started in the last 1,000 ms, else hold with `nextDueAt = lastAnnouncedAt + 1000`), `flush()`, `joinItems()` (chars comma-separated, then the single newest suggestions item), `announcementsFor()` and `suggestionsItemText()` (`"1 suggestion"` / `"N suggestions"` plus `". Highlighted: <text>"`)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_
  - [ ]* 4.2 Write example tests in `src/lib/conversation/live-queue.test.ts`
    - `"1 suggestion"` vs `"3 suggestions. Highlighted: …"`; three chars inside one second announce as `"h, i, space"`; an emptied list adds nothing
    - _Requirements: 12.1, 12.4, 12.5, 12.7_
  - [ ] 4.3 Write property test P16 in `src/lib/conversation/live-queue.prop.test.ts`
    - **Property 16: Live_Region throttle**
    - **Validates: Requirements 12.2, 12.3**
  - [ ] 4.4 Write property test P17 in `src/lib/conversation/live-queue.prop.test.ts`
    - **Property 17: Live_Region coalescing order**
    - **Validates: Requirements 12.4, 12.6**
  - [ ] 4.5 Write property test P18 in `src/lib/conversation/live-queue.prop.test.ts`
    - **Property 18: Announcement derivation**
    - Uses `arbStateDirect` and `arbAction` from `test-support.ts`
    - **Validates: Requirements 12.1, 12.5, 12.7**

- [ ] 5. Implement the settings schema
  - [ ] 5.1 Implement `src/lib/conversation/settings.ts`
    - Range constants, `SettingsRecord`, `DEFAULT_SETTINGS`, strict `SettingsRecordSchema` for partner fields, `InputSettingsSchema` with per-value `.catch(default)` using `validateMinPressDuration` and `validateThresholds`, `SettingsPatch`, `PatchError` (WPM message `'Enter a number from 2 to 20.'`), `validateSettingsPatch()` returning a `Result`, and `engineConfigOf(settings, estimates)`
    - _Requirements: 8.9, 16.7, 16.11, 17.9, 17.10, 20.5, 20.6_
  - [ ]* 5.2 Write example tests in `src/lib/conversation/settings.test.ts`
    - Rate 0.5 and 2.0 accepted, 0.49 and `"1"` rejected; WPM 2.5 accepted; `engineConfigOf` maps `adaptive` and passes estimates through
    - _Requirements: 17.9, 20.5, 20.6_
  - [ ] 5.3 Write property test P15 in `src/lib/conversation/settings.prop.test.ts`
    - **Property 15: Settings validation rejects out-of-range values**
    - Uses `arbSettingsRecord` from `test-support.ts`
    - **Validates: Requirements 17.9, 20.6**

- [ ] 6. Implement Storage
  - [ ] 6.1 Implement `src/lib/conversation/storage.ts`
    - `HISTORY_KEY = 'dit:history:v1'`, `SETTINGS_KEY = 'dit:settings:v1'`, `KeyValueBackend`, `HistoryRecord` and `HistoryRecordSchema` (array of `TurnSchema`, transformed to the newest 200), `StorageError`, `ConversationStorage` (extends `SettingsStore`), `createConversationStorage(backend)` and `memoryBackend()`
    - `load*` wrap `getItem`, `JSON.parse` and `safeParse` so they never throw and fall back per record; a throwing `getItem` reports a read error; `save*` wrap `stringify` and `setItem` and return a failed `Result` while leaving `settings()` unchanged; `saveHistory` strips IDs; `readSwitchKey`, `writeSwitchKey` and `clearSwitchKey` use `switchKey` inside the Settings_Record
    - _Requirements: 15.5, 16.1, 16.2, 16.4, 16.6, 16.7, 16.8, 16.10, 16.11, 17.10_
  - [ ] 6.2 Implement `src/lib/conversation/browser.ts`
    - `localStorageBackend(): KeyValueBackend | null`, returning `null` when accessing `window.localStorage` throws; the only file in `src/lib/conversation/` that reads a browser global
    - _Requirements: 16.8, 16.9, 16.10_
  - [ ] 6.3 Add storage arbitraries and backends to `src/lib/conversation/test-support.ts`
    - `arbSettingsRecord()`, `arbHistoryRecord()` (0 to 200 Turns, plus an over-cap variant up to 250), `arbStoredJunk()` (invalid JSON, wrong shapes, out-of-range Speech_Rate and Starting_WPM, bad Input_Layer values, valid records) and `throwingBackend({ get, set })`
    - _Requirements: 23.3_
  - [ ] 6.4 Write property test P13 in `src/lib/conversation/storage.prop.test.ts`
    - **Property 13: Storage round-trip**
    - **Validates: Requirements 16.12**
  - [ ] 6.5 Write property test P14 in `src/lib/conversation/storage.prop.test.ts`
    - **Property 14: Storage survives bad data and failing backends**
    - Covers the invalid-JSON and schema-invalid cases of Requirement 23.3
    - **Validates: Requirements 16.4, 16.6, 16.7, 16.8, 16.11, 17.10**
  - [ ]* 6.6 Write example tests in `src/lib/conversation/storage.test.ts`
    - `saveHistory([])` writes `{ v: 1, turns: [] }`; `SettingsStore` methods round-trip `switchKey`; disabled storage path
    - _Requirements: 16.2, 16.9, 16.11_
  - [ ] 6.7 Create the public barrel `src/lib/conversation/index.ts`
    - Re-export `types.ts`, `session.ts`, `live-queue.ts`, `settings.ts`, `storage.ts` and `handlers.ts`; do not re-export `browser.ts` or `test-support.ts`
    - _Requirements: 7.6_

- [ ] 7. Implement the Listen state machine
  - [ ] 7.1 Implement `src/lib/speech/listen.ts`
    - `ListenMessage`, `ListenState`, `ListenInput`, `ListenCommand`, `initialListen(supported)` (off at load) and `listenStep()` following every row of the Listen table
    - _Requirements: 18.1, 18.2, 18.3, 18.6, 18.8, 18.9, 18.10, 18.11, 18.12_
  - [ ] 7.2 Write example tests in `src/lib/speech/listen.test.ts`
    - One test per Listen table row, including toggle ignored when unsupported, `no-speech` then `end` giving `restart-later`, and `end` while off giving no command
    - _Requirements: 18.3, 18.6, 18.8, 18.9, 18.10, 18.11, 18.12_

- [ ] 8. Implement the speech adapters
  - [ ] 8.1 Implement `src/lib/speech/fakes.ts`
    - `FakeSpeechOutput` (settable support and voice list, records `cancel` and `speak` calls in order, `finish(outcome)`, settable `isSpeaking`) and `FakeSpeechInput` (settable support, scripted `start` Result, `emitInterim`, `emitFinal`, `emitError`, `emitEnd`)
    - _Requirements: 23.6, 23.7_
  - [ ] 8.2 Implement `src/lib/speech/browser.ts`
    - `webSpeechOutput(win)`: support check, `voices()` mapping, `onVoicesChanged` on `voiceschanged` plus one poll 250 ms after subscribe, `speak` that calls `cancel()` first, picks the matching voice or none, maps `end` to `'done'`, `interrupted`/`canceled` to `'cancelled'` and other errors to `'error'`, with a once-only `onEnd` guard
    - `webSpeechInput(win)`: `SpeechRecognition ?? webkitSpeechRecognition`, `continuous`, `interimResults`, `lang` from `document.documentElement.lang || 'en'`, result mapping to interim and final, error-code mapping to `RecognitionError`, `start()` returning a failed Result when it throws
    - _Requirements: 17.1, 17.2, 17.5, 17.7, 18.8, 18.9, 18.11_
  - [ ] 8.3 Write adapter tests in `src/lib/speech/browser.test.ts`
    - A fake `speechSynthesis` records `cancel()` before every `speak()`; unknown voice URI speaks with no voice set; `interrupted` gives `'cancelled'`; voices update within 1 s without the event; a fake `SpeechRecognition` maps `not-allowed`, `service-not-allowed`, `audio-capture`, `no-speech`, `aborted` and `network`
    - _Requirements: 17.1, 17.2, 17.5, 17.7, 18.8, 23.6_
  - [ ] 8.4 Create `src/lib/speech/index.ts`
    - Re-export `types.ts` and `listen.ts`; do not re-export `browser.ts` or `fakes.ts`
    - _Requirements: 23.7_

- [ ] 9. Implement the SessionController
  - [ ] 9.1 Add controller fakes to `src/lib/conversation/test-support.ts`
    - `FakeEngine` (scripted `press`, `release` and `tick` returns, settable `nextDeadline`, call log, `reset` count), `FakeClient` (records `update(text, context)` calls, delivers results on demand, never resolves unless told), `FakeAlarmHandler` (settable `isActive`, optional throwing `start`, `handlePress` log, `onActiveChange` emitter) and `FakeUnknownPatternHandler`
    - _Requirements: 23.4_
  - [ ] 9.2 Implement the press, effect and timer core of `src/hooks/session-controller.ts`
    - `PENDING_RETRY_MS = 50`, `ControllerDeps`, `StatusMessage`, `SessionSnapshot`, `SessionController` and `createSessionController(deps)`
    - Construction: load settings and history, add `save-failed` on a read error, build the Engine from `engineConfigOf`, dispatch one `hydrate` before any press, create the Client, subscribe to voices and `alarm.onActiveChange`
    - Internal `dispatch`: reduce, commit, `saveHistory` when Turns changed, the Client rules (Trimmed_Text change including empty; partner Turn appended with non-empty text), live-queue enqueue with its own flush timer, then run effects in order (`speak`, `reset-engine`, `alarm` in try/catch followed by `reset()`, timer cancel and `withholdUp`, `unknown` in try/catch), then notify once
    - `handlePress`, `reschedule`, `fire(d)` with the pending-press guard and `safeTickTime`, Engine replacement (cancel timer, new Engine, `engineHeld` to `withholdUp`, clear Current_Pattern, reschedule) and alarm-end reschedule
    - `getSnapshot()` returns the same object until something changes
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 6.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.14, 8.15, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.3, 12.1, 12.2, 12.3, 12.4, 16.1, 16.5, 17.1, 17.3, 17.4, 17.5, 17.6_
  - [ ] 9.3 Add partner, settings, Listen, status and dispose methods to `src/hooks/session-controller.ts`
    - `partnerPick`, `partnerLine` (trim; dispatch only when non-empty), `clearHistory` (Clear_History plus `saveHistory([])`), `updateSettings` (validate, commit, `saveSettings`, `save-failed` on failure while keeping the value, Engine replacement on WPM or adaptation change), `updateInputSettings`, `setInitialEstimates`, `setListen` with `listenStep`, `start()` and `start-failed`, `LISTEN_RESTART_MS = 250` restart timer, `onFinal` discards while off or while `speechOutput.isSpeaking()` or when empty, `setSourceStatuses` (`source-<kind>` message per non-`off`/`active` status), `dismissMessage` (one message per id)
    - `dispose`: cancel the Tick_Timer, flush timer and restart timer, `client.dispose()`, unsubscribe everything, `speechInput.stop()`, set `disposed` so late callbacks are no-ops
    - _Requirements: 4.4, 8.9, 8.13, 13.7, 14.7, 15.5, 15.6, 16.2, 16.3, 16.9, 17.8, 17.9, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.11, 18.12, 19.4, 20.5, 20.6, 20.9, 20.10, 22.12, 22.13_
  - [ ] 9.4 Write example tests in `src/hooks/session-controller.test.ts`
    - Manual clock and scheduler, `FakeEngine`, `FakeClient`, `FakeSpeechOutput`, `FakeSpeechInput`, `FakeAlarmHandler`, `memoryBackend` and `throwingBackend`
    - `sos` reaches `AlarmHandler.start()` while a `FakeClient` request is unresolved and does not cancel it; a throwing `start()` still resets the Engine and later events are processed; effects run in returned order; Engine replacement withholds the pending `up`; hydrate precedes the first press; history and settings saved before the next action; one `save-failed` message on a failing backend while keying continues; no-voices message without calling `speak`; `speak-error` shown, `'cancelled'` silent; new voice and rate used for the next speak; final transcript discarded while `isSpeaking()` is true, while off and when Whitespace-only; restart within 1,000 ms after `end`; source status messages added and removed; dispose stops all calls; a `fetch` spy sees no request other than through the Client
    - _Requirements: 5.4, 5.5, 5.6, 5.7, 8.2, 8.8, 8.9, 8.13, 8.15, 9.5, 14.7, 16.1, 16.2, 16.3, 16.5, 16.9, 16.10, 17.3, 17.4, 17.5, 17.6, 17.8, 18.4, 18.5, 18.7, 18.9, 18.12, 20.5, 20.9, 20.10, 22.12, 22.13, 23.4, 23.6_
  - [ ] 9.5 Write property test P19 in `src/hooks/session-controller.prop.test.ts`
    - **Property 19: One Tick_Timer, never ticking past a pending press**
    - Model-based with `fc.commands` (`Down`, `Up`, `PendingStart`, `PendingEnd`, `Advance`, `RunDue`, `EngineReturns`, `SetDeadline`, `ReplaceEngine`); after every command assert `scheduler.pending() ≤ 1` and every recorded `tick(t)` has `t ≤` every pending Raw_Down
    - **Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7**
  - [ ] 9.6 Write property test P20 in `src/hooks/session-controller.prop.test.ts`
    - **Property 20: Press routing and the alarm**
    - Model-based with `fc.commands`, adding `sos` decodes, unresolved Client requests and `AlarmEnd`
    - **Validates: Requirements 5.3, 8.1, 8.10, 8.11, 8.12, 8.14**
  - [ ] 9.7 Write property test P21 in `src/hooks/session-controller.prop.test.ts`
    - **Property 21: Client calls follow Trimmed_Text and partner Turns**
    - **Validates: Requirements 6.7, 9.1, 9.2, 9.3, 9.4, 9.6**
  - [ ] 9.8 Add `discardInput()` to `src/hooks/session-controller.ts`
    - Serves onboarding-and-safety O12.10 and O12.2: cancel the Tick_Timer, call `engine.reset()` (keep the same Engine, so estimates are unchanged), move `engineHeld` into `withholdUp`, set `engineHeld = false`, commit `{ ...state, currentPattern: '' }`, notify subscribers once, then `reschedule()`
    - Not a Session_Action: no reducer call, no announcement, no Client call, no `saveHistory`; a no-op after `dispose()`
    - _Requirements: 8.3, 8.13, 8.15_
  - [ ] 9.9 Clear `withholdUp` on the next `down` in `handlePress` in `src/hooks/session-controller.ts`
    - Serves onboarding-and-safety O12.8: add `if (e.kind === 'down') withholdUp = false` before the `up`-withhold check, so an `up` that a Press_Router dropped cannot swallow a later `up`; without a router this line never changes behaviour
    - _Requirements: 8.12, 8.14, 8.15_
  - [ ] 9.10 Add `onCharCommitted(listener): Unsubscribe` to `src/hooks/session-controller.ts`
    - Serves onboarding-and-safety O10.3, O10.4 and O10.11: in `dispatch`, after the effects of an `{ type: 'engine', event: { type: 'char' } }` action run and before subscribers are notified, call each listener once with the character, each inside try/catch; also fire when the 500-character cap stopped the append; never for `symbol`, `space`, `unknown` or `command`; `dispose()` drops all listeners
    - _Requirements: 1.1, 1.8, 8.2, 8.8, 8.13_
  - [ ] 9.11 Write example tests for `discardInput()` in `src/hooks/session-controller.integration.test.ts`
    - With `FakeEngine`, `FakeClient` and a manual scheduler: after a `down` and a decoded symbol, `discardInput()` calls `reset()` once, leaves `scheduler.pending()` at 0, sets `currentPattern` to `''`, keeps `currentText` and the Engine instance, makes no `client.update` call and queues no announcement; the following `up` reaches neither `release` nor the alarm; a later `down` reaches `press`; after `dispose()` it does nothing
    - _Requirements: 8.3, 8.13, 8.15, 23.4_
  - [ ] 9.12 Write example tests for the `withholdUp` reset in `src/hooks/session-controller.integration.test.ts`
    - Engine replacement (or `discardInput()`) while a `down` is held sets `withholdUp`; delivering the next `down` without the withheld `up` (as a router drops it) calls `press`, and its matching `up` then reaches `release` exactly once; without that skip, the existing withhold rule still drops exactly one `up`
    - _Requirements: 8.12, 8.14, 8.15, 23.4_
  - [ ] 9.13 Write example tests for `onCharCommitted` in `src/hooks/session-controller.integration.test.ts`
    - A `FakeEngine` returning `char 'a'` calls a listener once with `'a'`, and `getSnapshot()` inside the listener already shows the appended text; it also fires at the 500-character cap; `symbol`, `space`, `unknown` and `command` events and presses routed to an active `FakeAlarmHandler` fire nothing; a throwing listener does not stop a second listener or later events; unsubscribe and `dispose()` stop calls
    - _Requirements: 1.1, 1.8, 8.2, 8.8, 8.10, 8.13, 23.4_

- [ ] 10. Implement the `useMorseSession` hook
  - [ ] 10.1 Implement `src/hooks/useMorseSession.ts`
    - `'use client'`; `UseMorseSessionOptions` with the `overrides` test seam; create the controller in an effect (safe under strict-mode double mount) with default deps `browserScheduler`, `createEngine` with a defaults fallback on a failed Result, `createExpansionClient` (with `fetch`, `window.setTimeout`, `navigator.onLine` and `expandOnDevice`), `webSpeechOutput(window)`, `webSpeechInput(window)` and `createConversationStorage(localStorageBackend() ?? memoryBackend())`, adding `save-failed` once when the backend is `null`
    - Pass `pendingSince` and `alarm` through refs; subscribe with `useSyncExternalStore`; dispose on cleanup
    - _Requirements: 8.13, 16.4, 16.5, 16.9, 17.10, 18.10, 22.14_
  - [ ]* 10.2 Write hook tests in `src/hooks/useMorseSession.test.tsx`
    - jsdom with all `overrides` fakes: snapshot updates after a press; unmount disposes the controller and leaves no scheduled timer; a rerender with a new `pendingSince` callback does not rebuild the controller
    - _Requirements: 8.13, 22.14_

- [ ] 11. Implement the display components
  - [ ] 11.1 Implement `src/components/session-api-context.ts`
    - `SessionApiContext` holding `{ focusKeyingSurface, setInitialEstimates, controller }`, with a no-op default so components render alone in tests
    - _Requirements: 21.1, 21.2, 21.4, 21.5_
  - [ ] 11.2 Implement `src/components/KeyingSurface.tsx`
    - `<div role="button" tabIndex={0} aria-label="Keying surface" aria-describedby>` with the visually hidden hint, focus on mount, `data-pressed` styling with no transition, `touch-action: none`, no selection or callout, `onContextMenu` prevented, dashed focus ring distinct from the solid pressed border
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_
  - [ ] 11.3 Write component tests in `src/components/KeyingSurface.test.tsx`
    - `getByRole('button', { name: 'Keying surface' })` has a description and focus on mount; `pressed` toggles the pressed state; `contextmenu` is prevented
    - _Requirements: 10.2, 10.3, 10.4, 10.7, 23.5_
  - [ ] 11.4 Implement `src/components/SymbolStream.tsx`
    - Fixed-height `container-type: inline-size` box; `aria-hidden` shape row with dot `u × u` circles and dash `3.25u × u` pills, `--sym-u: min(1rem, calc(100cqi / 45))`; sibling visually hidden text "dot dash …" (empty for an empty pattern), outside the Live_Region and without `aria-live`; no animation
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_
  - [ ] 11.5 Write component tests in `src/components/SymbolStream.test.tsx`
    - `getByText('dot dash dot')` for `.-.`; empty text alternative for `''`; no ancestor or self with `aria-live`; shapes hidden from the accessibility tree
    - _Requirements: 11.1, 11.2, 11.6, 11.7_
  - [ ] 11.6 Implement `src/components/SuggestionList.tsx`
    - `<ul aria-label="Suggestions">` of buttons named by their text, `aria-current="true"` plus 3 px accent outline and a "Will be spoken" marker outside the button on the highlighted one, "Your typed text will be spoken" when Highlight is none and text is non-empty, "Source: AI" / "Source: On-device", muted hint "Tap a suggestion to speak it" only when both are empty, `onPick(i)` then `focusKeyingSurface()`, wrapping text
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 21.1_
  - [ ] 11.7 Write component tests in `src/components/SuggestionList.test.tsx`
    - One button per suggestion in order with exact names; exactly one `aria-current` element matching Highlight and none when Highlight is none; "Source: AI" and "Source: On-device"; hint shown and hidden; click and Enter call `onPick` once with the index and then focus helper
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 23.5_
  - [ ] 11.8 Implement `src/components/PartnerDisplay.tsx`
    - Two sections with visible `h2` labels "Typing" and "Last said", display and last-said font sizes from the design, `pre-wrap` and `overflow-wrap: anywhere`, placeholders "Nothing typed yet" and "Nothing said yet", flip via `rotate(180deg)` on an inner wrapper with DOM order unchanged and no transition under Reduced_Motion
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.8, 14.9, 14.10, 14.11, 14.12_
  - [ ] 11.9 Write component tests in `src/components/PartnerDisplay.test.tsx`
    - Headings "Typing" and "Last said"; placeholders shown when empty or none; flip on applies a 180° transform and keeps heading order; flip off has no rotation
    - _Requirements: 14.1, 14.5, 14.6, 14.8, 14.9, 14.10_
  - [ ] 11.10 Implement `src/components/HistoryView.tsx`
    - `<ul aria-label="Conversation history">` keyed by Turn ID with visible "Speaker" / "Partner" labels; "No conversation yet." outside the list when empty; layout effect on a new last ID calls `scrollIntoView({ block: 'end', behavior })` with `'auto'` under Reduced_Motion or after hydrate, `'smooth'` otherwise
    - _Requirements: 15.1, 15.2, 15.3, 15.7, 15.8, 15.9, 15.10_
  - [ ] 11.11 Write component tests in `src/components/HistoryView.test.tsx`
    - List named "Conversation history" with one `listitem` per Turn and role labels; zero items plus the empty message; 200 items after a capped append; `scrollIntoView` spy called with `'smooth'` normally and `'auto'` under the stubbed reduced-motion `matchMedia` and on hydrate
    - _Requirements: 15.1, 15.2, 15.3, 15.7, 15.8, 15.9, 15.10_
  - [ ] 11.12 Implement `src/components/LiveRegion.tsx`
    - The only `aria-live` element: `<div aria-live="polite" aria-atomic="true" class="sr-only">` rendering `announcement.text`, with a zero-width suffix toggled by `seq` parity for repeated identical text
    - _Requirements: 12.3, 12.8_
  - [ ] 11.13 Write component tests in `src/components/LiveRegion.test.tsx`
    - Renders the announcement text; two identical texts with different `seq` produce different DOM text; exactly one `[aria-live="polite"]` element
    - _Requirements: 12.8, 23.5_
  - [ ] 11.14 Implement `src/components/StatusMessages.tsx`
    - `<ul aria-label="Status">` of messages, each with a "Dismiss" button calling `onDismiss(id)`; not a live region and no `role="status"`
    - _Requirements: 16.9, 17.3, 17.4, 17.6, 22.12, 22.13_
  - [ ] 11.15 Write component tests in `src/components/StatusMessages.test.tsx`
    - List named "Status" shows each message once; "Dismiss" calls `onDismiss` with the id; no `aria-live` attribute
    - _Requirements: 16.9, 17.6, 22.12_
  - [ ] 11.16 Add `sources: SourceControl` to `SessionApiContext` in `src/components/session-api-context.ts`
    - Serves onboarding-and-safety O11.9, O11.12 and O11.13: the context value becomes `{ focusKeyingSurface, setInitialEstimates, controller, sources }`; the no-op default `sources` returns `DEFAULT_ENABLED_SOURCES` from `enabled()`, all-`'off'` statuses, ignores every setter and returns a no-op unsubscribe from `onChange`
    - Type the value as `SessionApiContextValue` and add `learner: SwitchLearner` and `pendingSince(): number | null` (design Integration point 5); the no-op default supplies `learner: unavailableLearner()` from `handlers.ts` (2.4) and `pendingSince: () => null`
    - _Requirements: 21.1, 22.12, 22.13_
  - [ ] 11.17 Write example tests in `src/components/session-api-context.test.tsx`
    - A consumer rendered without a provider reads `sources.enabled()` equal to `DEFAULT_ENABLED_SOURCES` with blink off, and calling `setEnabled`, `startBlink`, `stopBlink`, `restore` and the `onChange` unsubscribe throws nothing
    - The same provider-less consumer reads `pendingSince()` as `null`, and `learner.isArmed()` is false while `await learner.arm()` resolves `err` with reason `'cancelled'`
    - _Requirements: 22.12, 23.5_

- [ ] 12. Implement the partner controls
  - [ ] 12.1 Implement `src/components/PartnerLineForm.tsx`
    - `<form>` with label "Your line", `<input type="text" maxLength={500}>` with an `onInput` slice fallback, and submit button "Add line"; submit trims, calls `onSubmit` and clears and calls `focusKeyingSurface()` only when non-empty; otherwise keeps value and focus
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 21.2, 21.3, 22.9_
  - [ ] 12.2 Write component tests in `src/components/PartnerLineForm.test.tsx`
    - `getByRole('textbox', { name: 'Your line' })` and `getByRole('button', { name: 'Add line' })`; typing a space and Enter submits the trimmed value once and clears the field; Whitespace-only submit keeps value and focus; a 600-character paste keeps the first 500
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 21.2, 21.3_
  - [ ] 12.3 Implement `src/components/ListenToggle.tsx`
    - `<button type="button" role="switch" aria-checked>` named "Listen"; disabled and showing "Listening is not supported in this browser. Type your line instead." when unsupported; shows the interim transcript and the Listen message text; calls `focusKeyingSurface()` after activation when rendered outside the Settings_Panel
    - _Requirements: 18.1, 18.2, 18.6, 18.8, 18.11, 21.1_
  - [ ] 12.4 Write component tests in `src/components/ListenToggle.test.tsx`
    - `getByRole('switch', { name: 'Listen' })` reflects `on`; unsupported state is disabled with the message; clicking calls `onToggle` with the opposite value; interim text and permission message shown
    - _Requirements: 18.1, 18.2, 18.6, 18.8, 23.5_
  - [ ] 12.5 Implement `src/components/SettingsPanel.tsx`
    - Native `<dialog aria-modal="true" aria-labelledby>` titled "Settings" (as `h2`), opened with `showModal()`; labelled controls "Voice" (first option "Browser default", falls back to it when the stored URI is missing), "Speech rate" range 0.5–2 step 0.1 with readout, `ListenToggle`, "Flip partner display" switch, "Clear history" button, "Starting speed (WPM)" number 2–20 committed on change or Enter with the range error in a `<p>` referenced by `aria-describedby`, "Adapt to my speed" switch, and "Close settings" button
    - Focus the first control on open; Tab and Shift+Tab wrap; Escape (`cancel`), close button and backdrop click call `onClose` then `focusKeyingSurface()`; clear history swaps to a `role="alertdialog"` "Clear the whole conversation?" with "Clear history" and "Cancel", either closing the dialog and focusing the Keying_Surface
    - _Requirements: 14.7, 15.4, 15.5, 15.6, 17.7, 17.9, 20.1, 20.2, 20.3, 20.4, 20.6, 20.7, 20.8, 21.4, 21.5, 22.9_
  - [ ] 12.6 Write component tests in `src/components/SettingsPanel.test.tsx`
    - `getByRole('dialog', { name: 'Settings' })` with `aria-modal="true"`; each control found by role and label with current values; focus starts on the first control and wraps both ways; Escape and "Close settings" close it and call the focus helper; invalid WPM keeps the previous value and shows the range text; invalid rate keeps the previous rate; clear-history confirm and cancel call the right handler and close the dialog; the voice select shows "Browser default" when the stored voice is missing
    - _Requirements: 15.4, 15.5, 15.6, 17.7, 17.9, 20.1, 20.2, 20.3, 20.4, 20.6, 20.7, 20.8, 21.4, 21.5, 23.5_
  - [ ] 12.7 Add the optional `extraActions?: ReactNode` prop to `src/components/SettingsPanel.tsx`
    - Serves onboarding-and-safety O11.6 ("Run setup again" slot): render `extraActions` directly after the "Clear history" button inside the dialog, so its focusable elements join the Tab and Shift+Tab wrap; render nothing extra when the prop is absent
    - _Requirements: 20.3, 20.7_
  - [ ] 12.8 Write example tests for `extraActions` in `src/components/SettingsPanel.test.tsx`
    - With `extraActions={<button type="button">Run setup again</button>}`: `getByRole('button', { name: 'Run setup again' })` is inside the dialog and follows "Clear history" in DOM order; pressing Tab repeatedly from the first control reaches it and then wraps back to the first control, and Shift+Tab from the first control wraps to the last focusable element; without the prop the dialog has the same buttons as before
    - _Requirements: 20.3, 20.7, 23.5_

- [ ] 13. Wire the root component
  - [ ] 13.1 Implement `src/components/DitApp.tsx`
    - `'use client'`; props `alarm`, `unknownPattern`, `legend`, `overlay` defaulting to the inert handlers and an empty legend box; calls `useInputSources({ surfaceRef, enabled, settings, store, onPress: controller.handlePress })` (13.3 routes `onPress` through the Press_Router and 13.5 moves `enabled` into state) and `useMorseSession`; forwards source statuses with `setSourceStatuses` in an effect and Input_Layer setting changes with `updateInputSettings`
    - Renders the single `h1` "Dit", `StatusMessages`, `PartnerDisplay`, `SymbolStream`, `SuggestionList`, `KeyingSurface`, `<aside aria-label="Commands">` with `min-height: 7rem`, `HistoryView`, the partner section (`ListenToggle`, `PartnerLineForm`, "Settings" button), `SettingsPanel`, `LiveRegion` and the overlay slot, in the named-area grid from the design
    - Provides `SessionApiContext`; `focusKeyingSurface()` uses `requestAnimationFrame` and `focus({ preventScroll: true })`
    - _Requirements: 10.1, 10.2, 12.8, 13.7, 16.3, 20.1, 20.9, 21.1, 21.2, 21.4, 21.5, 21.6, 22.4, 22.7, 22.8, 22.12, 22.13, 22.14_
  - [ ] 13.2 Write integration tests in `src/components/DitApp.test.tsx`
    - jsdom with fakes injected through the `useMorseSession` overrides and a `FakeEngine`
    - Exactly one `aria-live="polite"` region; exactly one level-1 heading, also while the Settings dialog is open; "Settings" opens the dialog, Escape closes it, and focus is then on `button` "Keying surface"; after clicking a suggestion, pressing Space yields a `down`/`up` Press_Event and does not activate the suggestion again; a partner line submit adds a "Partner" list item to "Conversation history"; a source failure status shows a message
    - _Requirements: 12.8, 20.1, 20.2, 20.8, 21.1, 21.2, 21.4, 21.6, 22.8, 22.12, 23.5_
  - [ ] 13.3 Add the optional `pressRouter?: PressRouter` prop to `src/components/DitApp.tsx`
    - Serves onboarding-and-safety O12.1 and O12.10: `router = pressRouter ?? sessionOnlyRouter()` (stable per mount); pass `router.route` to `useInputSources` as `onPress`; in an effect, `router.connect({ handlePress: controller.handlePress, discardInput: controller.discardInput })` and call the returned unsubscribe on unmount
    - _Requirements: 8.1, 8.10, 8.14, 21.6_
  - [ ] 13.4 Write example tests in `src/components/DitApp.press-router.test.tsx`
    - With a recording fake `PressRouter`: `connect` is called once with a target whose `handlePress` and `discardInput` reach the controller (a `FakeEngine` sees `press`; `discardInput()` resets it); Space on `button` "Keying surface" delivers `down` then `up` to `route`; unmount calls the unsubscribe. Without the prop, Space reaches `FakeEngine.press` and `release` as before
    - _Requirements: 8.1, 8.14, 21.6, 23.5_
  - [ ] 13.5 Provide `SessionApiContext.sources` from `src/components/DitApp.tsx`
    - Serves onboarding-and-safety O11.9, O11.12, O11.13 and O11.14: hold `enabled` in React state starting at `DEFAULT_ENABLED_SOURCES` (no camera request on load) and pass it to `useInputSources`; implement `SourceControl`: `enabled()`, `statuses()` from `useInputSources().statuses`, `setEnabled(kind, on)` for keyboard, switch and pointer, `stopBlink()`, `restore(flags)`, `onChange` fired after any flag or status change, and `startBlink()` that sets blink on, or, when blink is on with a failure status, commits blink off with `flushSync` and then sets it on; in development, warn when `navigator.userActivation?.isActive === false`
    - Also provide `learner` and `pendingSince` (design Integration point 5): pass `useInputSources().learner` unchanged, and provide a stable `pendingSince()` that reads the latest `useInputSources().pendingSince` through a ref at call time, so the context value does not change when that callback's identity changes
    - Existing `setSourceStatuses` forwarding and `source-<kind>` messages stay unchanged
    - _Requirements: 22.12, 22.13_
  - [ ] 13.6 Write example tests in `src/components/DitApp.sources.test.tsx`
    - A context consumer reads `enabled()` equal to `DEFAULT_ENABLED_SOURCES` after load and no camera request is made; `setEnabled('keyboard', false)` makes Space on the Keying_Surface produce no Press_Event and fires `onChange`; `restore(DEFAULT_ENABLED_SOURCES)` turns it back on; `startBlink()` from a click handler sets blink on, and after a fake failure status a second `startBlink()` passes through `'off'` and back on without adding a `source-blink` message for `'off'`; `stopBlink()` sets blink off
    - With a fake `useInputSources` result, the consumer's `learner` is the same object as the hook's `learner`, and `pendingSince()` returns the hook's current value (`null`, then `1200` after a rerender with a new `pendingSince` callback) while the `pendingSince` function identity read from context stays the same across that rerender
    - _Requirements: 22.12, 22.13, 23.5_
  - [ ] 13.7 Add the optional `extraSettingsActions` render prop to `src/components/DitApp.tsx`
    - Serves onboarding-and-safety O11.6 and O11.7: call `extraSettingsActions({ closeSettings })` and pass the result to `SettingsPanel` as `extraActions`; `closeSettings()` behaves like `onClose` (close, then `focusKeyingSurface()`), and `closeSettings({ focusKeyingSurface: false })` closes without moving focus; without the prop nothing extra renders
    - _Requirements: 20.7, 20.8, 21.4_
  - [ ] 13.8 Write example tests in `src/components/DitApp.settings-actions.test.tsx`
    - A render prop returning a "Run setup again" button that calls `closeSettings({ focusKeyingSurface: false })`: opening "Settings" shows the button inside the dialog; activating it closes the dialog and focus is not on `button` "Keying surface"; a variant calling `closeSettings()` closes it and focuses the Keying_Surface; without the prop the dialog has no "Run setup again" button
    - _Requirements: 20.7, 20.8, 21.4, 23.5_

- [ ] 14. Add the app files and design tokens
  - [ ] 14.1 Implement `src/app/globals.css`
    - `@import "tailwindcss";`, the `@theme` block with every token from the design (colors, font, text sizes, target size, pressed border, ring width and offset, highlight outline, fade duration), `.sr-only`, and a `@media (prefers-reduced-motion: reduce)` block that disables animations and limits transitions to opacity of at most 200 ms; no flashing keyframes
    - _Requirements: 10.5, 10.6, 11.8, 14.4, 22.1, 22.2, 22.3, 22.5, 22.6, 22.10, 22.11_
  - [ ] 14.2 Write the contrast test `src/app/tokens.test.ts`
    - Parse the `@theme` block from `globals.css`, compute WCAG relative luminance and contrast, and assert every row of the design's contrast table, page background luminance ≤ 0.05 and Partner_Display text luminance ≥ 0.85
    - _Requirements: 10.5, 10.6, 11.8, 13.8, 14.4, 14.8, 22.1, 22.2, 22.3_
  - [ ] 14.3 Implement `src/app/layout.tsx`
    - `<html lang="en" className="dark">`, `<body className="bg-bg text-text font-sans">`, imports `globals.css`, metadata title "Dit", `viewport` with `width=device-width, initial-scale=1` and no `maximum-scale`
    - _Requirements: 22.4, 22.5, 22.8_
  - [ ] 14.4 Implement `src/app/page.tsx`
    - Server component rendering `<DitApp />`, passing the `onboarding-and-safety` plug-ins (`alarm`, `unknownPattern`, `legend`, `overlay`) only when that spec's modules exist
    - _Requirements: 5.3, 5.6, 22.7, 22.8_

- [ ] 15. Checkpoint - Ensure all tests, type checks and lint pass
  - Run `bun run test`, `bun run typecheck` and `bun run lint`; all must pass with zero failing tests, without network access and without the real Web Speech APIs. Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 7.6, 23.7_

- [ ] 16. Manual tablet, zoom and contrast checklist (performed by a human with `bun run dev`)
  - On an iPad-class tablet (Safari) and desktop Chrome and Firefox, work through the design's manual checklist items 1 to 12 and record the results:
  - Viewports 320 × 640, 768 × 1024, 1024 × 768, 1440 × 900 and 2560 × 1440, portrait and landscape: no horizontal scrollbar, no clipped or overlapping text, Keying_Surface is the largest target, Command_Legend box and Keying_Surface fully visible at 768 × 1024 and 1024 × 768
  - Browser zoom 200% and default font size 200%: same checks, body text scales; Partner_Display font sizes at 767 px and 768 px widths
  - Long-press, drag and pinch on the Keying_Surface; twelve dashes at 320 px; empty Symbol_Stream keeps its height; 500-character text at 320 px
  - OS Reduce motion on: no slide, scale or pulse, instant flip and history scroll; focus rings visible and a focused idle surface does not look pressed; contrast spot-checks against the token table; rotation mid-typing keeps text, pattern, suggestions, highlight, history and focus; no flashing above 3 per second; VoiceOver and NVDA announce characters and suggestions at most once per second and do not announce dots and dashes
  - _Requirements: 10.1, 10.6, 10.7, 10.8, 11.3, 11.4, 11.5, 11.7, 12.2, 14.2, 14.3, 14.11, 14.12, 15.7, 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.10, 22.11, 22.14_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. All property tests (P1 to P21), their arbitraries and fakes, the example tests Requirement 23 mandates, the only-check example tests (purity stubs, Listen table, controller examples, contrast tokens) and all component tests are required.
- Property tests for one file share that file, so they run in separate waves; P1 to P12 in `session.prop.test.ts` form the longest chain.
- `src/lib/conversation/test-support.ts`, `src/lib/speech/fakes.ts` and `browser.ts` files are never re-exported from a barrel.
- Task 16 is a manual human check; it is not a coding task and is excluded from the dependency graph. Checkpoints are also excluded.
- Each task references specific requirements for traceability.
- The onboarding-and-safety integration sub-tasks (2.4, 2.5, 9.8 to 9.13, 11.16, 11.17, 12.7, 12.8, 13.3 to 13.8) are required. Edits to one file (`handlers.ts`, `session-controller.ts`, `session-controller.integration.test.ts`, `SettingsPanel.tsx`, `SettingsPanel.test.tsx`, `DitApp.tsx`) sit in separate waves.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["1.3", "2.4", "3.1", "5.1", "7.1"] },
    { "id": 3, "tasks": ["2.5", "3.2", "3.3", "4.1", "5.2", "6.1", "7.2", "8.1", "8.2"] },
    { "id": 4, "tasks": ["3.4", "4.2", "4.3", "6.2", "6.3", "8.3", "8.4"] },
    { "id": 5, "tasks": ["3.5", "4.4", "5.3", "6.4", "6.6", "6.7", "9.1"] },
    { "id": 6, "tasks": ["3.6", "4.5", "6.5", "9.2"] },
    { "id": 7, "tasks": ["3.7", "9.3"] },
    { "id": 8, "tasks": ["3.8", "9.4", "9.5", "9.8", "10.1"] },
    { "id": 9, "tasks": ["3.9", "9.6", "9.9", "9.11", "10.2", "11.1"] },
    { "id": 10, "tasks": ["3.10", "9.7", "9.10", "9.12", "11.2", "11.4", "11.6", "11.8", "11.10", "11.12", "11.14", "11.16", "12.1", "12.3", "14.1"] },
    { "id": 11, "tasks": ["3.11", "9.13", "11.3", "11.5", "11.7", "11.9", "11.11", "11.13", "11.15", "11.17", "12.2", "12.4", "12.5", "14.2", "14.3"] },
    { "id": 12, "tasks": ["3.12", "12.6", "12.7", "13.1"] },
    { "id": 13, "tasks": ["3.13", "12.8", "13.2", "13.3", "14.4"] },
    { "id": 14, "tasks": ["3.14", "13.4", "13.5"] },
    { "id": 15, "tasks": ["3.15", "13.6", "13.7"] },
    { "id": 16, "tasks": ["13.8"] }
  ]
}
```
