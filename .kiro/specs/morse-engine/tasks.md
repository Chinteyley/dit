# Implementation Plan: morse-engine

## Overview

Build the pure TypeScript Morse core in `src/lib/morse/` bottom-up, following the module layout and dependency graph in `design.md`. The repository has no `package.json` yet, so the first task adds the minimal Bun + TypeScript + Vitest + fast-check scaffolding needed to run `bun run test:engine` and `bun run typecheck`. Shared types come next because `codes.ts` and `timing.ts` import them. The decoder `step()` function is built in fixed-speed form first, then adaptation is wired in, then the `Engine` wrapper and the shared test generators. The encoder, calibrator and barrel follow.

Every correctness property from `design.md` is its own sub-task, implemented as exactly one `fc.assert` with `numRuns` of at least 200 (via `PROP_RUNS` from `test-support.ts`) and tagged `// Feature: morse-engine, Property N: <title>`.

## Tasks

- [x] 1. Set up minimal project scaffolding for the engine
  - [x] 1.1 Create `package.json`, `tsconfig.json` and `vitest.config.ts`
    - `package.json`: `"type": "module"`, `"private": true`, `"license": "MIT"`; scripts `test` (`vitest run`), `test:engine` (`vitest run src/lib/morse`), `test:watch` (`vitest`), `typecheck` (`tsc --noEmit`); dev dependencies `typescript`, `vitest`, `fast-check`, `@types/node` added with `bun add -d` (no runtime dependencies)
    - `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `module`/`moduleResolution` suited to bundler use (`esnext` / `bundler`), `target` ES2022, `noEmit`, `include: ["src"]`, path alias `@/*` → `src/*`
    - `vitest.config.ts`: `environment: 'node'` for `src/lib/**`, `include: ['src/**/*.test.ts']` (covers `*.prop.test.ts`), `passWithNoTests: true` so the scripts succeed before tests exist
    - Add `.gitignore` entries for `node_modules`, `.next`, `.env*` (except `.env.example`) if no `.gitignore` exists
    - Do not add Next.js, React or Tailwind here; they belong to later specs
    - _Requirements: 15.2, 15.6_

- [x] 2. Define shared result and type modules
  - [x] 2.1 Implement `src/lib/morse/result.ts` and `src/lib/morse/types.ts`
    - `Result<T, E>`, `ok()`, `err()` exactly as in the design
    - `MorseSymbol`, `CommandName`, `EngineMode`, `EngineEvent`, `Estimates`, `EstimateSnapshot`, `EngineConfig`, `EngineConfigError` as readonly types
    - _Requirements: 1.4, 1.5, 1.8, 7.8_
  - [x] 2.2 Write `src/lib/morse/result.test.ts`
    - `ok(v)` and `err(e)` produce the discriminated shapes and narrow on `ok`
    - _Requirements: 1.4_

- [x] 3. Implement the character and command tables
  - [x] 3.1 Implement `src/lib/morse/codes.ts`
    - Frozen `CHARACTER_TABLE` (49 entries), `COMMAND_TABLE` (4 entries), `CODE_TO_CHAR` built at module load, `SUPPORTED_CHARACTERS` in table order
    - `lookupPattern(pattern)` checks `COMMAND_TABLE` first, then `CODE_TO_CHAR`, else returns `unknown` with the pattern
    - `+` is not a key
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 4.1, 4.2, 5.5_
  - [x] 3.2 Write `src/lib/morse/codes.test.ts`
    - Compare each table to a literal copy of Requirements 3.1–3.3 and 4.1; assert 49 and 4 entries, `CODE_TO_CHAR.size === 49`, `+` absent, no uppercase keys
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7, 4.1_
  - [x] 3.3 Write property test in `src/lib/morse/codes.prop.test.ts`
    - **Property 1: Tables are injective and commands never collide with characters**
    - **Validates: Requirements 3.4, 3.5, 3.7, 3.8, 4.1, 4.2, 5.5**
    - Generators per design: `fc.constantFrom(...SUPPORTED_CHARACTERS)` pairs, command codes, random `.`/`-` patterns of length 0–12 mixed with all known codes; `numRuns ≥ 200`

- [x] 4. Implement timing constants, conversions and Estimate_Guards
  - [x] 4.1 Implement `src/lib/morse/timing.ts`
    - Constants `MIN_UNIT`, `MAX_UNIT`, `DEFAULT_WPM`, `DEFAULT_UNIT`, `MIN_START_WPM`, `MAX_START_WPM`, `DEFAULT_ADAPTATION_RATE`, `MAX_SYMBOLS`
    - `wpmToUnit`, `unitToWpm`, `thresholds(e)` (`(dot + dash) / 2`, `2 × dot`, `4.5 × dot`), `applyEstimateGuards(e)` in the three-step order
    - _Requirements: 1.1, 1.10, 8.3_
  - [x] 4.2 Write `src/lib/morse/timing.test.ts`
    - `wpmToUnit(2) = 600`, `(6) = 200`, `(20) = 60`; guard order examples (dot 2000 → 1500 and dash raised to 2250; dash 10 → 60 then raised to `1.5 × dot`); threshold values at 6 WPM (400, 400, 900)
    - _Requirements: 1.1, 1.10, 8.3_
  - [x] 4.3 Write property test in `src/lib/morse/timing.prop.test.ts`
    - **Property 2: WPM and Unit conversions are inverse**
    - **Validates: Requirements 1.1**
    - Generator `fc.double({ min: 0.1, max: 1e4, noNaN: true })`; relative error `1e-12`; `numRuns ≥ 200`

- [x] 5. Implement the decoder step function (fixed-speed behaviour)
  - [x] 5.1 Implement state, validation, press and release in `src/lib/morse/decoder.ts`
    - `DecoderState`, `EngineInput`, `StepResult`, and an internal `initialState(mode, alpha, estimates)`
    - `step()` validation: ignore non-finite or non-number timestamps and timestamps below `lastT`; equal timestamps pass
    - `press`: ignore while down; otherwise set `lastT`, `switchDown`, `pressStart` (gap settling is added in 5.2)
    - `release`: ignore while up; zero or negative duration sets switch up with no event and keeps `lastRelease`, buffer and estimates; otherwise classify with the deadline form `t >= pressStart + dotDashThreshold` using thresholds computed at the start of the step, append the symbol, set `lastRelease`, emit `symbol`, and on the 10th symbol emit `unknown`, clear the buffer and set `spaceEligible = false`
    - No adaptation yet; estimates stay unchanged in this task
    - _Requirements: 1.10, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 7.8_
  - [x] 5.2 Implement gap settling, tick and reset in `src/lib/morse/decoder.ts`
    - `settleGaps(state, t, T)`: letter-gap commit via `lookupPattern` (command / char / unknown; Space_Eligible true only for char), then word-gap space if Space_Eligible, both using `t >= lastRelease + threshold`
    - Call `settleGaps` from `press` before setting the switch down, and from `tick` when the switch is up; ticks while down emit nothing but advance `lastT`
    - `reset`: clear buffer, switch state, `pressStart`, `lastRelease`, `spaceEligible`; keep estimates, `alpha`, `mode`, `lastT`; emit nothing
    - _Requirements: 3.6, 3.8, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.4, 10.1, 10.2, 10.3, 10.5, 10.6, 10.7_
  - [x] 5.3 Implement `deadlineOf(state)` in `src/lib/morse/decoder.ts`
    - `null` when down or `lastRelease === null`; `lastRelease + 2 × dot` when the buffer is non-empty; `lastRelease + 4.5 × dot` when Space_Eligible; else `null`
    - Use the same expressions as `settleGaps` so `tick(deadline)` always acts
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 10.4_

- [x] 6. Implement adaptive timing and wire it into the decoder
  - [x] 6.1 Implement `src/lib/morse/adapt.ts`
    - `adaptEstimates(prior, symbol, duration, alpha)`: clamp the duration to `[0.5 × prior, 2 × prior]` of the classified estimate, apply the EMA update, leave the other estimate unchanged, then `applyEstimateGuards` on both
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 6.2 Wire adaptation into `release` in `src/lib/morse/decoder.ts`
    - In adaptive mode, after classifying with pre-release thresholds, replace estimates with `adaptEstimates(...)`; fixed mode never changes estimates; press, tick, reset and zero-length releases never change estimates
    - _Requirements: 1.9, 8.1, 8.2, 8.4, 8.5, 8.8, 8.9, 9.3, 9.4_
  - [x] 6.3 Write `src/lib/morse/adapt.test.ts`
    - Examples: a dot of exactly the estimate leaves it unchanged; a very long dot is clamped to `2 × prior` before the update; a dash update that would put dash below `1.5 × dot` is raised by the guard; `alpha = 1` jumps to the clamped observation
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 7. Implement the Engine wrapper and engine-level tests
  - [x] 7.1 Implement `createEngine`, `Engine` and `decodedText` in `src/lib/morse/decoder.ts`
    - Validate `startingWpm` (finite, `[2, 20]`), `adaptationRate` (finite, `(0, 1]`), initial estimates (both or neither; each finite and `> 0`; missing one reported with `reason: 'missing'`) using `typeof v === 'number' && Number.isFinite(v)`; collect every error and return `err(errors)` with no Engine
    - Initial estimates: guarded supplied values, else guarded `(u0, 3 × u0)`; default mode `'adaptive'`
    - `Engine` holds one `DecoderState` in a closure; `press`/`release`/`tick` return `step` events; `reset()` returns nothing; `nextDeadline()` is `deadlineOf`; `estimates()` returns `thresholds(state.estimates)`; `snapshot()` returns the immutable state; `mode` is read-only
    - `decodedText(events)`: concatenate `char` values and one `' '` per `space`
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.11, 7.7, 7.8, 9.1, 9.2, 10.2, 11.6_
  - [x] 7.2 Create engine generators and replay helpers in `src/lib/morse/test-support.ts`
    - `PROP_RUNS = 200`, `feed(engine, inputs)` (per-call event lists and their concatenation), `guardedEstimatesArb`, `validConfigArb` and `invalidFieldArb` per Property 4, `inputSequenceArb(opts)` (press/release/tick/reset with `dt` in unit multiples, optional `noReset`, about 1 in 20 bad timestamps, optional `durationScale`), `insertExtraTicks(inputs)` helper (0–3 ticks per gap, `r ∈ [0, 1]` including endpoints)
    - Imported only by test files; never re-exported from `index.ts`
    - _Requirements: 15.3, 15.5_
  - [x] 7.3 Write `src/lib/morse/decoder.test.ts`
    - Examples from the design: "sos" at 6 WPM gives 9 `symbol` events then `command: 'sos'`; `.-.-.` gives `speak`; "hi" then 900 ms gives `h`, `i`, `space`; backspace code then a word gap gives no space and leaves Decoded_Text unchanged; reset mid-press then release is ignored; equal-timestamp inputs are accepted; defaults are adaptive with estimates 200/600; invalid config returns errors and no Engine
    - _Requirements: 1.2, 1.6, 1.9, 2.6, 4.4, 4.6, 4.7, 6.1, 10.1, 10.6_
  - [x] 7.4 Write property test in `src/lib/morse/timing.prop.test.ts`
    - **Property 3: Estimate_Guards produce valid, stable estimates**
    - **Validates: Requirements 1.7, 1.10, 1.11, 8.3, 9.1, 11.3, 11.6**
    - Generator `fc.double({ min: 1e-3, max: 1e5, noNaN: true })` mixed with `fc.constantFrom(60, 1500, 4500, 2250)`; check idempotence and engine `estimates()` in both modes; `numRuns ≥ 200`
  - [x] 7.5 Write property test in `src/lib/morse/config.prop.test.ts`
    - **Property 4: Engine configuration is accepted exactly when valid**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 9.2**
    - `fc.record` with `requiredKeys: []`, each field `fc.oneof(validArb, invalidArb)`; oracle is a separately written predicate per field; `numRuns ≥ 200`
  - [x] 7.6 Write property test in `src/lib/morse/decoder.prop.test.ts`
    - **Property 5: Press classification uses pre-release thresholds**
    - **Validates: Requirements 1.10, 2.1, 2.2, 8.4, 9.4**
    - Both modes; durations include `threshold ± tiny`; `numRuns ≥ 200`
  - [x] 7.7 Write property test in `src/lib/morse/decoder.prop.test.ts`
    - **Property 6: Ignored and zero-length inputs change nothing**
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.8, 10.6**
    - Reach states by replaying `inputSequenceArb` through `step`; compare state snapshots for deep equality; `numRuns ≥ 200`
  - [x] 7.8 Write property test in `src/lib/morse/decoder.prop.test.ts`
    - **Property 7: The 10th symbol forces an unknown commit**
    - **Validates: Requirements 2.7**
    - 10 random symbols, fixed mode, unit via `startingWpm`; `numRuns ≥ 200`
  - [x] 7.9 Write property test in `src/lib/morse/decoder.prop.test.ts`
    - **Property 8: Letter-gap commit happens once, exactly at the threshold**
    - **Validates: Requirements 3.6, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 5.9, 5.10, 6.6, 6.7**
    - Patterns from all 53 known codes plus random 1–9 symbol strings; silence includes `LG` and `LG ± 1e-9`; trigger `tick` or `press`; `numRuns ≥ 200`
  - [x] 7.10 Write property test in `src/lib/morse/deadline.prop.test.ts`
    - **Property 10: nextDeadline is pure and agrees with tick**
    - **Validates: Requirements 1.11, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 10.4, 10.5**
    - Snapshot state around `nextDeadline()` and `estimates()`; ticks in `[lastT, deadline)` return `[]`; `tick(deadline)` is non-empty; `numRuns ≥ 200`
  - [x] 7.11 Write property test in `src/lib/morse/adapt.prop.test.ts`
    - **Property 11: Adaptive update matches the clamped EMA model**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5**
    - Model written inline, independent of `adapt.ts`; `α` from `fc.double({ min: 1e-6, max: 1, noNaN: true })`; `d` spans `[0.1e, 5e]`; `numRuns ≥ 200`
  - [x] 7.12 Write property test in `src/lib/morse/adapt.prop.test.ts`
    - **Property 12: Estimates stay inside the guard bounds**
    - **Validates: Requirements 8.7**
    - `durationScale` log-uniform from 1e-3 to 1e6; check bounds after every call; `numRuns ≥ 200`
  - [x] 7.13 Write property test in `src/lib/morse/adapt.prop.test.ts`
    - **Property 13: Fixed-speed estimates never move**
    - **Validates: Requirements 1.9, 8.8, 9.3**
    - Valid fixed configs, sequences with resets; `===` per field after every call; `numRuns ≥ 200`
  - [x] 7.14 Write property test in `src/lib/morse/convergence.prop.test.ts`
    - **Property 14: Adaptive estimates converge on a consistent keyer**
    - **Validates: Requirements 8.6**
    - Generators exactly as in the design (wpm, ratio `r`, 40 kinds with 15–25 dots, factors in `[0.9, 1.1]`); `numRuns ≥ 200`
  - [x] 7.15 Write property test in `src/lib/morse/tick-independence.prop.test.ts`
    - **Property 23: Extra ticks never change the outcome**
    - **Validates: Requirements 15.5**
    - `inputSequenceArb({ noReset: true })` forced to end with a release; both versions end with a tick at or after `lastRelease + 4.5 × dot`; `numRuns ≥ 200`

- [x] 8. Checkpoint - Ensure all tests pass
  - Run `bun run test:engine` and `bun run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement the encoder and text-based generators
  - [x] 9.1 Implement `src/lib/morse/encode.ts`
    - `normalizeText(text)`: explicit `A`–`Z` lowercase map, trim Whitespace (space, tab, LF, CR), collapse runs to `' '`
    - `encode(text, unit)`: validate unit (`typeof`, finite, `[60, 1500]`) and text (empty / Whitespace-only, or unsupported code points with UTF-16 start index, `+` included) independently and report both; build timestamps as `k × unit` from an integer counter (press 1/3, gaps 1/3/7); `endTime = (k_lastRelease + 3) × unit`
    - _Requirements: 3.9, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 12.13_
  - [x] 9.2 Extend `src/lib/morse/test-support.ts` with text generators
    - `supportedStringArb` (1–200 chars, about 4:1 non-Whitespace weighting), `unitArb`, `keyedTextArb` (via `encode`), `jitteredSequenceArb` built with `fc.chain` and endpoint-biased factors in `[0.7, 1.3]`; let `inputSequenceArb` mix in `keyedTextArb` fragments so `char` commits are common
    - _Requirements: 13.2, 14.1_
  - [x] 9.3 Write `src/lib/morse/encode.test.ts`
    - `encode('e', 200)` is press 0, release 200, endTime 800; `encode('+', 200)` fails with `{ char: '+', index: 0 }`; `encode('  ', 200)` fails with `empty`; `encode('a', 59)` fails with unit; text and unit errors together; emoji reported once at its UTF-16 start index
    - _Requirements: 3.9, 12.5, 12.7, 12.8, 12.9, 12.10, 12.11_
  - [x] 9.4 Write property test in `src/lib/morse/encode.prop.test.ts`
    - **Property 18: Encoded sequences have exact Morse timing**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.13**
    - Oracle recomputes `k` independently from the normalized text; `numRuns ≥ 200`
  - [x] 9.5 Write property test in `src/lib/morse/encode.prop.test.ts`
    - **Property 19: Encoder rejects bad text and bad units completely**
    - **Validates: Requirements 3.9, 12.7, 12.8, 12.9, 12.10, 12.11**
    - Unsupported pool includes `+`, `#`, `é`, `€`, NBSP, `\v`, emoji; expected indices computed while inserting; `numRuns ≥ 200`
  - [x] 9.6 Write property test in `src/lib/morse/roundtrip.prop.test.ts`
    - **Property 20: Encode then decode returns the normalized text**
    - **Validates: Requirements 12.12, 13.1, 13.2, 13.3, 13.4, 13.5**
    - Fixed-mode engine with `initialDotEstimate = u`, `initialDashEstimate = 3u`; tick-insertion variant via `insertExtraTicks`; single-character sub-case drawn in the same generator via `fc.oneof(supportedStringArb, fc.constantFrom(...SUPPORTED_CHARACTERS, ...'A'..'Z'))` so the property stays one `fc.assert`; `numRuns ≥ 200`
  - [x] 9.7 Write property test in `src/lib/morse/jitter.prop.test.ts`
    - **Property 21: Decoding survives ±30% jitter on every element**
    - **Validates: Requirements 14.1, 14.2, 14.3**
    - Event list deep-equals the unjittered decode; no trailing space, no `unknown` or `command`; `numRuns ≥ 200`
  - [x] 9.8 Write property test in `src/lib/morse/spaces.prop.test.ts`
    - **Property 9: Space rules hold for every input stream**
    - **Validates: Requirements 4.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8, 10.7**
    - Both modes; checker walks per-call event lists and tracks reset boundaries; includes the word-then-tick and command-then-tick cases; `numRuns ≥ 200`
  - [x] 9.9 Write property test in `src/lib/morse/reset.prop.test.ts`
    - **Property 15: Reset clears the character and keeps the learned speed**
    - **Validates: Requirements 6.8, 8.9, 10.1, 10.2, 10.3, 10.7**
    - Compare post-reset replay of a `keyedTextArb` suffix (shifted by `gap ∈ [0, 1e5]`) against a fresh engine built from the pre-reset estimates, mode and `α`; `numRuns ≥ 200`

- [x] 10. Implement the calibrator
  - [x] 10.1 Implement `src/lib/morse/calibrate.ts`
    - `calibrate(durations: unknown)`: `not-a-list`, `wrong-length` (with length), `invalid-duration` (1-based position of the first bad element) all fall back to `{ 200, 600 }`; otherwise median of positions 1–3 from a sorted copy, mean of positions 4–5, replace dash with `3 × dot` only when strictly below `1.5 × dot`, then `applyEstimateGuards` once; `reason: null` on success; never throws, never mutates input
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - [x] 10.2 Write `src/lib/morse/calibrate.test.ts`
    - `[200, 210, 190, 600, 620]` gives 200 / 610; long presses too short give dash `3 × dot`; dash exactly `1.5 × dot` is kept; `[]` gives `wrong-length` with length 0; `[1, 2, NaN, 4, 5]` gives position 3; non-array gives `not-a-list`
    - _Requirements: 11.1, 11.2, 11.4_
  - [x] 10.3 Write property test in `src/lib/morse/calibrate.prop.test.ts`
    - **Property 16: Calibration matches the median/mean model**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.6**
    - Includes the `d[3] = d[4] = 1.5 × median` boundary case; passes results to `createEngine` in both modes; `numRuns ≥ 200`
  - [x] 10.4 Write property test in `src/lib/morse/calibrate.prop.test.ts`
    - **Property 17: Calibration is total, pure and reports why it fell back**
    - **Validates: Requirements 11.4, 11.5**
    - `fc.anything()`, wrong-length arrays, valid 5-lists with one bad value at a random position; compare against a pre-call `structuredClone` where cloneable; `numRuns ≥ 200`

- [x] 11. Wire the public barrel and enforce module boundaries
  - [x] 11.1 Implement `src/lib/morse/index.ts`
    - Re-export `createEngine`, `decodedText`, `encode`, `normalizeText`, `calibrate`, `wpmToUnit`, `unitToWpm`, `lookupPattern`, `CHARACTER_TABLE`, `COMMAND_TABLE`, `SUPPORTED_CHARACTERS`, the timing constants, and all public types; do not export `step`, `deadlineOf` or `test-support.ts`
    - _Requirements: 15.6_
  - [x] 11.2 Write `src/lib/morse/boundaries.test.ts`
    - Read every non-test `src/lib/morse/*.ts` file; assert each `import` target is a relative path inside the folder; assert no use of `Date`, `performance`, `setTimeout`, `setInterval`, `Math.random`, `crypto`, `window`, `document`, `localStorage`, `navigator`; assert `index.ts` does not export `step`, `deadlineOf` or anything from `test-support`
    - _Requirements: 15.1, 15.2, 15.6_
  - [x] 11.3 Write property test in `src/lib/morse/determinism.prop.test.ts`
    - **Property 22: Replays are deterministic**
    - **Validates: Requirements 9.5, 11.5, 12.13, 15.1, 15.3, 15.4**
    - Import the engine, encoder and calibrator through `index.ts`; two fresh engines per config, `===` estimates after every call; `encode` and `calibrate` called twice; `numRuns ≥ 200`

- [x] 12. Final checkpoint - Ensure all tests pass
  - Run `bun run test:engine` and `bun run typecheck`; both must pass with no errors. Ensure all tests pass, ask the user if questions arise.

## Notes

- Test sub-tasks are not marked optional. The project steering (`.kiro/steering/tech.md`) requires a `*.test.ts` for every `src/lib/` module and a `*.prop.test.ts` for every design property, so they are part of the definition of done.
- Shared types (task 2) come before the tables and timing because `codes.ts` and `timing.ts` import `CommandName` and `Estimates` from `types.ts`.
- The decoder is built in fixed-speed form first (task 5) and adaptation is wired in afterwards (task 6.2), so each step stays verifiable.
- Properties 9 and 15 sit under the encoder task because their generators use `keyedTextArb`, which needs `encode`.
- The ESLint `no-restricted-globals` / `no-restricted-imports` rules named in the design for Requirements 15.2 and 15.6 depend on the ESLint setup from a later spec (`eslint-config-next`). Until then, `boundaries.test.ts` (task 11.2) enforces the same rules.
- Never run `bun test`; always `bun run test` or `bun run test:engine`.
- Each task references specific requirement clauses for traceability; checkpoints ensure incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "4.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.2", "4.3", "5.1", "6.1", "9.1", "10.1"] },
    { "id": 4, "tasks": ["5.2", "6.3", "9.3", "10.2"] },
    { "id": 5, "tasks": ["5.3"] },
    { "id": 6, "tasks": ["6.2"] },
    { "id": 7, "tasks": ["7.1"] },
    { "id": 8, "tasks": ["7.2", "7.3", "11.1"] },
    { "id": 9, "tasks": ["7.4", "7.5", "7.6", "7.10", "7.11", "7.14", "7.15", "10.3"] },
    { "id": 10, "tasks": ["7.7", "7.12", "9.2", "10.4", "11.2"] },
    { "id": 11, "tasks": ["7.8", "7.13", "9.4", "9.6", "9.7", "9.8", "9.9", "11.3"] },
    { "id": 12, "tasks": ["7.9", "9.5"] }
  ]
}
```


## Review correction: separate pressing speed from pause speed (review, 2026-11-11)

These corrections supersede earlier conflicting criteria in this document.

- [x] 17.1 Compute letter and word gap thresholds as 2 and 4.5 times max(dotEstimate, 1200 / startingWpm), while dot/dash classification continues to use calibrated/adapted press estimates. Deadlines and every gap comparison use the same floor.
  - Verified: `timing.prop.test.ts; deadline/jitter/roundtrip/reset/tick-independence properties`.

- [x] 18.1 Base the gap floor on calibration when supplied, otherwise Starting WPM; verify fast calibrated iwtgo and retain uncalibrated/jitter properties. Update timing steering, glossary and EARS criteria.
