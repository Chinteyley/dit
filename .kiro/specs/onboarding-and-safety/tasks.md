# Implementation Plan: onboarding-and-safety

## Overview

The plan builds this spec in TypeScript as "pure core, thin shell", in the order the design sets out.

1. Verify that the sibling specs `morse-engine`, `input-sources` and `conversation-ui` provide every export and integration point this spec uses.
2. Build the pure modules in `src/lib/safety/` and `src/lib/onboarding/`. Each design property gets its own required fast-check sub-task.
3. Build the Chime_Player and the Web Audio adapter, tested against fake audio objects.
4. Build the framework-free runtime objects: Alarm_Handler, Cheat_Sheet store and Onboarding controller.
5. Build the React components. Each one has required tests that find elements by role and accessible name.
6. Wire everything in `DitRoot`, then render `DitRoot` from `src/app/page.tsx` in place of the inert alarm stub.

Rules for every task:

- Run tests with `bun run test` (Vitest, single pass). Never use `bun test` or watch mode.
- Every property test uses fast-check with `numRuns` of at least 200. The reducer and router properties use 500.
- Each property test name starts with its ID, for example `P2 exactly one dismissal per episode`. It carries the comment `// Feature: onboarding-and-safety, Property N: <title>`.
- `src/lib/safety/**` and `src/lib/onboarding/**` tests run in the `node` environment. `src/components/**` tests use `// @vitest-environment jsdom`.
- Component tests find elements only by role and accessible name, never by class or test ID.
- No task here is optional. Safety-critical paths (alarm, press routing, Guard_Engine) are never stubbed.

## Tasks

- [x] 1. Verify dependency modules and scaffold the folders
  - [x] 1.1 Verify the morse-engine exports
    - Confirm that the `@/lib/morse` barrel exports `CHARACTER_TABLE`, `COMMAND_TABLE`, `SUPPORTED_CHARACTERS`, `CommandName`, `calibrate`, `Calibration`, `unitToWpm`, `createEngine`, `Engine`, `EngineConfig`, `EngineEvent` and `Estimates`, with the signatures in `.kiro/specs/morse-engine/design.md`. Check this with a throwaway type-only import compiled by `bun run typecheck`, then delete the file.
    - Confirm that `Engine` exposes `press`, `release`, `tick` and `nextDeadline`, and that the Command_Table maps `...---...` to `sos`.
    - If any export is missing, stop. Implement the missing part of the `morse-engine` spec first. Do not stub it here.
    - _Requirements: 8.1, 9.1, 12.3, 12.4, 12.5, 15.1_
  - [x] 1.2 Verify the input-sources exports
    - Confirm that the `@/lib/input` barrel exports `PressEvent`, `SourceKind`, `SourceStatus`, `Clock`, `Scheduler`, `ManualClock`, `ManualScheduler`, `SwitchLearner` (with `arm()` resolving a Result and `cancel()`), `browserScheduler` and `performanceClock`.
    - Confirm that the Blink_Source starts only from an explicit call (input-sources Requirement 9.1) and reports the statuses `off`, `starting`, `active`, `face-lost`, `permission-denied`, `no-camera`, `unsupported` and `error`.
    - If any export is missing, stop. Implement the missing part of the `input-sources` spec first. Do not stub it here.
    - _Requirements: 11.12, 11.13, 11.14, 12.4, 13.4, 13.5, 13.6, 13.8, 13.10_
  - [x] 1.3 Verify the conversation-ui integration points
    - Confirm that `@/lib/conversation` exports `AlarmHandler`, `UnknownPatternHandler`, `PressRouter`, `SessionPressTarget` (with `discardInput()`), `engineConfigOf`, `KeyValueBackend`, `localStorageBackend`, `SettingsRecord` and `SourceControl` (`enabled`, `restore`, `startBlink`, `stopBlink`, `statuses`, `onChange`).
    - Confirm that its test support provides `memoryBackend()` and `throwingBackend()`.
    - Confirm that `DitApp` accepts the `alarm`, `unknownPattern`, `pressRouter`, `legend`, `overlay` and `extraSettingsActions` props.
    - Confirm that `SessionApiContext` exposes `setInitialEstimates`, `onCharCommitted`, `focusKeyingSurface`, the settings snapshot, `sources`, `learner: SwitchLearner` and `pendingSince: () => number | null`.
    - Confirm that the Keying_Surface has `role="button"` and `aria-label="Keying surface"`. Confirm that `tokens.test.ts` and the ESLint `no-restricted-imports` rule for `src/lib/**` exist. Confirm that `fast-check`, `@testing-library/react`, `@testing-library/user-event` and `jsdom` are installed.
    - Find the inert alarm stub that `src/app/page.tsx` or `DitApp` uses today, and record its location for task 21.2.
    - If any of these is missing, including `learner` or `pendingSince`, stop. Implement that part of the `conversation-ui` spec first. Do not stub it here.
    - _Requirements: 2.9, 2.10, 8.6, 10.3, 11.4, 11.6, 12.1, 12.4, 12.10, 13.4, 15.6_
    - Note (implementation): everything exists; nothing was stubbed. `browserScheduler` and `performanceClock` come from `@/lib/input/browser`, `localStorageBackend` from `@/lib/conversation/browser`, `memoryBackend` from the `@/lib/conversation` barrel and `throwingBackend` from `@/lib/conversation/test-support`. `SessionApiContext` exposes `onCharCommitted` and the settings snapshot through `controller` (`controller.onCharCommitted`, `controller.getSnapshot().settings`). The inert alarm stub for task 21.2: `src/app/page.tsx` renders `<DitApp />` with no plug-ins, and `DitApp` falls back to `inertAlarmHandler()` and `inertUnknownPatternHandler()` (`const [fallback] = useState(...)` in `src/components/DitApp.tsx`) when no `alarm` or `unknownPattern` prop is given.
  - [x] 1.4 Create the folder scaffolding and shared test helpers
    - Create `src/lib/safety/` and `src/lib/onboarding/`, each with an empty `index.ts` barrel.
    - Create `src/lib/safety/test-support.ts` and `src/lib/onboarding/test-support.ts`. Each holds `deepFreeze()` and a `PROP_RUNS` constant (200) plus `PROP_RUNS_HEAVY` (500). Neither file is re-exported from a barrel.
    - Confirm with `bun run lint` that the existing `src/lib/**` import rule covers both folders.
    - _Requirements: 3.1, 17.1_

- [x] 2. Strings and spoken text
  - [x] 2.1 Create `src/lib/onboarding/strings.ts`
    - Add every user-facing string from the requirements: the alarm texts ("I need help", "Dismiss", the description naming the 3 ways to dismiss, "Sound is unavailable on this device right now."), the command labels and Legend_Step sentences, the Legend_Step hint sentence, the Input_Step and Practice_Step prompts, the switch texts, the camera explanation, the blink status and failure texts from the design table, "Turn on camera for blink input", "Run setup again", "Cancel setup", "All codes", "Close codes", "Not a code:", the close-presses sentence and the save-failure message.
    - Add the step headings "Choose an input", "Practice", "Commands" and "Setup done".
    - _Requirements: 1.3, 1.4, 6.5, 8.3, 11.6, 11.8, 11.12, 11.14, 13.4, 13.5, 13.7, 13.8, 13.10, 14.1, 14.6, 15.3, 16.1, 16.2, 16.6, 18.2_
  - [x] 2.2 Implement `src/lib/onboarding/spoken.ts`
    - Implement `spokenCode(code)`, `PUNCTUATION_NAMES` (the 13 names from the design), `characterName(ch)` and `speedText(dotEstimate)`. `speedText` returns `about N words per minute`, where N is `max(1, round(unitToWpm(dot)))`.
    - _Requirements: 8.4, 9.6, 15.2, 18.7_
  - [x] 2.3 Write unit tests in `src/lib/onboarding/spoken.test.ts`
    - Check that `PUNCTUATION_NAMES` has 13 unique names covering every punctuation key of `CHARACTER_TABLE`.
    - Check that `spokenCode('.-.-.')` is "dot dash dot dash dot".
    - Check `speedText` rounding and its minimum of 1.
    - _Requirements: 8.4, 9.6, 15.2_

- [x] 3. Alarm_Machine
  - [x] 3.1 Implement `src/lib/safety/alarm-machine.ts`
    - Implement `AlarmState`, `AlarmInput`, `AlarmEffect`, `AlarmStepResult`, `alarmStep`, `isAlarmActive` and `isDismissal`, following the design's transition table.
    - Use frozen effect-array constants. Do not mutate inputs. The code has no DOM, clock, timer, audio or storage access.
    - _Requirements: 3.1, 3.7, 3.8, 2.7_
  - [x] 3.2 Write example tests in `src/lib/safety/alarm-machine.test.ts`
    - Write one example per row of the transition table, covering next state, consumed flag and the ordered effects.
    - _Requirements: 3.7, 3.8, 1.2, 2.1, 2.2, 2.3, 2.12_
  - [x] 3.3 Add alarm arbitraries to `src/lib/safety/test-support.ts`
    - Add `arbAlarmInputs({ max: 200 })`, weighted toward `start` followed by `down`/`up` bursts. Add a `foldAlarm(inputs)` helper that returns the per-step results, and a `splitEpisodes(steps)` helper.
    - _Requirements: 3.2, 3.3, 3.5_
  - [x] 3.4 Write property test P1 in `src/lib/safety/alarm-machine.prop.test.ts`
    - **Property 1: Every press is consumed while the alarm is active, and none while idle**
    - **Validates: Requirements 3.2, 3.8, 2.1, 2.3, 2.12**
  - [x] 3.5 Write property test P2 in `src/lib/safety/alarm-machine.prop.test.ts`
    - **Property 2: Exactly one Dismissal per Alarm_Episode**
    - **Validates: Requirements 3.3, 2.1, 2.13, 3.7**
  - [x] 3.6 Write property test P3 in `src/lib/safety/alarm-machine.prop.test.ts`
    - **Property 3: Active-change effects alternate and match isActive**
    - **Validates: Requirements 3.5, 2.7, 2.8**
  - [x] 3.7 Write property test P4 in `src/lib/safety/alarm-machine.prop.test.ts`
    - **Property 4: The Alarm_Machine is deterministic and does not mutate**
    - Deep-freeze each state and input before the call.
    - **Validates: Requirements 3.1, 3.6**

- [x] 4. Chime_Schedule
  - [x] 4.1 Implement `src/lib/safety/chime-schedule.ts`
    - Add `CHIME_PERIOD_MS = 1000`, `TONES`, `PEAK_GAIN = 0.8`, `RAMP_MS = 10` and `CHIME_END_MS = 360`.
    - Implement `chimeSchedule(s, from, to, x?)` with the design algorithm. Compute each time directly as `s + k × 1000`, with the floating-point correction for `k0`. Return `[]` for invalid inputs without throwing.
    - _Requirements: 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7_
  - [x] 4.2 Add chime arbitraries to `src/lib/safety/test-support.ts`
    - Add `arbChimeInputs()`: finite doubles within ±1e9, windows up to 10⁶ ms, biased so that `from` and `x` land exactly on `s + k × 1000`, with an optional `x`.
    - Add `arbBadNumber()` (NaN and ±Infinity) and a reference loop `referenceSchedule(s, from, to, x?)`.
    - _Requirements: 5.1, 5.2, 5.7_
  - [x] 4.3 Write property test P8 in `src/lib/safety/chime-schedule.prop.test.ts`
    - **Property 8: The Chime_Schedule matches its model inside the window**
    - **Validates: Requirements 5.2, 5.5**
  - [x] 4.4 Write property test P9 in `src/lib/safety/chime-schedule.prop.test.ts`
    - **Property 9: The Chime_Period is exact**
    - **Validates: Requirements 5.4**
  - [x] 4.5 Write property test P10 in `src/lib/safety/chime-schedule.prop.test.ts`
    - **Property 10: Splitting the window never repeats or skips a Chime**
    - Cover a single split point and splits into 1 to 20 consecutive windows.
    - **Validates: Requirements 5.6**
  - [x] 4.6 Write property test P11 in `src/lib/safety/chime-schedule.prop.test.ts`
    - **Property 11: Nothing is scheduled at or after the stop time, and invalid inputs give an empty list**
    - **Validates: Requirements 5.3, 5.7, 5.1**

- [x] 5. Press_Router
  - [x] 5.1 Implement the pure `routePress` in `src/lib/safety/press-router.ts`
    - Add `Consumer`, `RouterState`, `INITIAL_ROUTER`, `RouteContext` and `routePress(state, event, ctx)`. The priority is alarm, then onboarding, then session. An `up` whose `down` went to a different consumer returns `to: null`. `downOwner` is reset after every `up`.
    - _Requirements: 12.1, 12.8, 2.9_
  - [x] 5.2 Implement the `createPressRouter` runtime in `src/lib/safety/press-router.ts`
    - Implement `SafetyPressRouter`, which implements the conversation-ui `PressRouter`.
    - `route(e)` reads `alarm.isActive()` and `onboarding.isOpen()` when the event arrives and delivers it to exactly one consumer or to none. It drops events that arrive before `connect()`.
    - `onOnboardingOpenChange()` calls `session.discardInput()` inside `try/catch`. `connect(session)` returns a disconnect function.
    - _Requirements: 12.1, 12.2, 12.8, 12.10, 2.9, 10.8_
  - [x] 5.3 Write unit tests in `src/lib/safety/press-router.test.ts`
    - Check that events before `connect()` are dropped and that `onOnboardingOpenChange` calls `discardInput` once per change.
    - Check that a session press with alarm idle and onboarding closed reaches the session, including while the Cheat_Sheet is open.
    - _Requirements: 12.10, 10.8, 12.1_
  - [x] 5.4 Add router arbitraries to `src/lib/safety/test-support.ts`
    - Add `arbPressEvents()` (alternating or arbitrary `down`/`up`, non-decreasing `t`, random Source_Kind) and `arbRouteContexts()`.
    - _Requirements: 12.1, 12.8_
  - [x] 5.5 Write property test P6 in `src/lib/safety/press-router.prop.test.ts`
    - **Property 6: Each Press_Event goes to at most one consumer, chosen by priority at arrival**
    - Check both the pure `routePress` and the runtime with recording consumers. Use `numRuns: 500`.
    - **Validates: Requirements 12.1, 12.2, 10.8**
  - [x] 5.6 Write property test P7 in `src/lib/safety/press-router.prop.test.ts`
    - **Property 7: Cross-consumer ups are dropped and same-consumer pairs are kept**
    - Use `numRuns: 500`.
    - **Validates: Requirements 12.8**

- [x] 6. Legend_Model
  - [x] 6.1 Implement `src/lib/onboarding/legend-model.ts`
    - Add `COMMAND_ORDER`, `COMMAND_LABELS`, `COMMAND_SENTENCES` (from `strings.ts`), `LegendEntry`, `buildLegendModel(table = COMMAND_TABLE)` and `legendAccessibleText`. `buildLegendModel` inverts the Command_Table at run time and holds no copy of any code.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 16.1_
  - [x] 6.2 Write unit tests in `src/lib/onboarding/legend-model.test.ts`
    - Check that the real table gives 4 entries in the order speak, next, backspace, sos, with the exact labels and sentences, and that the accessible text is "Speak: dot dash dot dash dot".
    - _Requirements: 8.1, 8.3, 8.4, 16.1_
  - [x] 6.3 Add `arbCode()` and `arbCommandTable()` to `src/lib/onboarding/test-support.ts`
    - `arbCode()` generates codes over `{.,-}` with 1 to 10 symbols. `arbCommandTable()` maps 4 distinct codes of length 1 to 9 to the 4 command names.
    - _Requirements: 8.2, 8.4_
  - [x] 6.4 Write property test P13 in `src/lib/onboarding/legend-model.prop.test.ts`
    - **Property 13: The Legend_Model equals the Command_Table**
    - **Validates: Requirements 8.1, 8.2**

- [x] 7. Cheat_Sheet_Model
  - [x] 7.1 Implement `src/lib/onboarding/cheat-sheet-model.ts`
    - Add `CheatSheetGroupName`, `CheatSheetEntry`, `CheatSheetGroup`, `buildCheatSheetModel(chars = CHARACTER_TABLE, commands = COMMAND_TABLE)` and `entryAccessibleText`.
    - Build the groups Letters (a–z, uppercase labels), Digits (0–9) and Punctuation (other keys in table order). Commands comes from `buildLegendModel`. Skip `+` and any character whose code equals a Command_Code.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
  - [x] 7.2 Write unit tests in `src/lib/onboarding/cheat-sheet-model.test.ts`
    - Check that the real tables give 26 + 10 + 13 + 4 entries, uppercase letter labels and the punctuation names in the accessible texts.
    - _Requirements: 9.2, 9.3, 9.5, 9.6_
  - [x] 7.3 Add `arbCharTable()` to `src/lib/onboarding/test-support.ts`
    - Generate permutations of the real codes across the 49 keys, with an optional `+` key and an optional key whose code collides with a Command_Code.
    - _Requirements: 9.3, 9.8_
  - [x] 7.4 Write property test P14 in `src/lib/onboarding/cheat-sheet-model.prop.test.ts`
    - **Property 14: The Cheat_Sheet_Model equals the engine tables, grouped, with no `+`**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.8**
  - [x] 7.5 Write property test P15 in `src/lib/onboarding/spoken.prop.test.ts`
    - **Property 15: Spoken_Code and accessible texts follow the code exactly**
    - **Validates: Requirements 8.4, 9.6, 9.7, 18.7**

- [x] 8. Cheat_Sheet state and panel placement
  - [x] 8.1 Implement `src/lib/onboarding/cheat-sheet-state.ts`
    - Add `OpenReason`, `CheatSheetState`, `CLOSED_SHEET`, `CheatSheetAction`, `CheatSheetContext` and `cheatSheetStep`, following the design table. While the alarm is active, every action is ignored. An `unknown` pattern during onboarding is not kept. Every close clears the pattern.
    - _Requirements: 7.9, 8.9, 9.10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.7, 10.11, 10.12, 10.13, 10.14_
  - [x] 8.2 Add Cheat_Sheet arbitraries to `src/lib/onboarding/test-support.ts`
    - Add `arbCheatSheetRun()` (0 to 200 actions, each paired with random `onboardingOpen` and `alarmActive` flags) and a reference model `referenceSheet()`.
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - [x] 8.3 Write property test P16 in `src/lib/onboarding/cheat-sheet-state.prop.test.ts`
    - **Property 16: The Cheat_Sheet state follows its model**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.11, 10.12, 10.13, 10.14, 8.9, 9.10, 7.9**
  - [x] 8.4 Implement `src/lib/onboarding/placement.ts`
    - Add `Rect`, `Placement` and `placePanel(viewport, keying, minSize)`. It returns the largest band above, below, left or right of the Keying_Surface minus an 8 px gap, or `none`.
    - _Requirements: 14.2, 10.9, 18.11_
  - [x] 8.5 Add `arbRect()` and `arbPlacementInput()` to `src/lib/onboarding/test-support.ts`
    - Generate viewports from 320 × 320 to 3840 × 2160, including Keying_Surfaces that are partly off-screen.
    - _Requirements: 14.2_
  - [x] 8.6 Write property test P17 in `src/lib/onboarding/placement.prop.test.ts`
    - **Property 17: Placed panels never cover the Keying_Surface**
    - **Validates: Requirements 14.2, 10.9**

- [x] 9. Onboarding_Reducer
  - [x] 9.1 Create `src/lib/onboarding/types.ts`
    - Add `InputChoice`, `Step`, `Origin`, `SwitchPhase`, `BlinkPhase`, `PracticeResult`, `OnboardingState`, `OnboardingReport`, `OnboardingAction` and `OnboardingEffect`, exactly as in the design.
    - _Requirements: 17.1, 13.1, 14.3, 15.1_
  - [x] 9.2 Implement the state functions in `src/lib/onboarding/flow.ts`
    - Implement `initialFirstRun`, `initialRerun(previous, blinkStatus)`, `onboardingStep`, `isOpenStep`, `continueEnabled`, `heldIndicatorShown` and `practicePrompt`, following the design's reducer table.
    - An invalid action returns the same object. `calibrate()` is called once, when the fifth duration is appended. After `use-default`, a later fifth press replaces the default result with the calibrated one.
    - _Requirements: 11.2, 11.7, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.9, 13.10, 13.11, 13.12, 13.13, 14.1, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.11, 14.12, 15.1, 15.4, 15.5, 15.6, 15.7, 15.8, 16.4, 16.7, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.8, 17.9_
  - [x] 9.3 Implement `onboardingEffects(prev, next, action)` in `src/lib/onboarding/flow.ts`
    - Derive `arm-learner`, `disarm-learner`, `start-blink`, `stop-blink`, `apply-estimates`, `focus-keying-surface`, `finish` and `cancel` following the design table. Return an empty list when `next === prev`.
    - _Requirements: 11.9, 13.3, 13.4, 13.6, 13.7, 13.8, 14.1, 15.5, 15.6, 15.7, 15.8, 15.9, 16.4, 16.5, 16.7_
  - [x] 9.4 Write example tests in `src/lib/onboarding/flow.test.ts`
    - Write one example per reducer table row, and test `practicePrompt` exhaustively for n = 0 to 5.
    - Check the rerun initial states for each Input_Choice and blink status.
    - Check that the `key-tap` path finishes with exactly 4 Partner actions and 5 presses, with no timed gate.
    - _Requirements: 13.1, 14.4, 14.5, 14.6, 14.10, 11.7, 16.8_
  - [x] 9.5 Add onboarding arbitraries to `src/lib/onboarding/test-support.ts`
    - Add `arbInitialOnboardingState()` (first-run and rerun with every choice and status), and a stateful `arbOnboardingActions()` of 0 to 300 actions with about 20 % invalid actions, non-decreasing timestamps, durations from 0 to 3000 ms, unmatched ups and restarts.
    - Add `arbFallbackDurations()`: 5-tuples with zeros, negatives, NaN or Infinity whose `calibrate()` reason is non-null.
    - Add a `foldOnboarding()` helper that collects states and effects.
    - _Requirements: 17.2, 17.3, 17.4, 17.5_
  - [x] 9.6 Write property test P18 in `src/lib/onboarding/flow.prop.test.ts`
    - **Property 18: Onboarding steps advance only in order**
    - Use `numRuns: 500`.
    - **Validates: Requirements 17.2, 17.6, 13.12, 15.5**
  - [x] 9.7 Write property test P19 in `src/lib/onboarding/flow.prop.test.ts`
    - **Property 19: Only the first 5 Practice_Presses since the latest Practice_Step start count**
    - Use `numRuns: 500`.
    - **Validates: Requirements 17.3, 14.1, 14.3, 14.7, 14.8, 14.9, 14.12**
  - [x] 9.8 Write property test P20 in `src/lib/onboarding/flow.prop.test.ts`
    - **Property 20: The held Calibration_Result equals calibrate() of the collected durations**
    - Use `numRuns: 500`.
    - **Validates: Requirements 17.4, 15.1**
  - [x] 9.9 Write property test P21 in `src/lib/onboarding/flow.prop.test.ts`
    - **Property 21: Skipping or a fallback calibration gives null estimates**
    - Use `numRuns: 500`.
    - **Validates: Requirements 17.5, 14.11, 15.4, 15.7**
  - [x] 9.10 Write property test P22 in `src/lib/onboarding/flow.prop.test.ts`
    - **Property 22: Estimates are applied once and reported once per Onboarding_Flow**
    - Use `numRuns: 500`.
    - **Validates: Requirements 17.9, 15.6, 15.7, 15.8, 15.9, 16.4, 16.7**
  - [x] 9.11 Write property test P23 in `src/lib/onboarding/flow.prop.test.ts`
    - **Property 23: Invalid onboarding actions are no-ops**
    - Use `numRuns: 500`.
    - **Validates: Requirements 17.8, 13.13**
  - [x] 9.12 Write property test P24 in `src/lib/onboarding/flow.prop.test.ts`
    - **Property 24: The Onboarding_Reducer is deterministic and does not mutate**
    - Deep-freeze every state before each call. Use `numRuns: 500`.
    - **Validates: Requirements 17.1, 17.7**
  - [x] 9.13 Write property test P25 in `src/lib/onboarding/flow.prop.test.ts`
    - **Property 25: Continue on the Input_Step is enabled exactly when an Input_Choice is confirmed**
    - Use `numRuns: 500`.
    - **Validates: Requirements 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.9, 13.10, 13.11**

- [x] 10. Onboarding_Record schema
  - [x] 10.1 Implement `src/lib/onboarding/record.ts`
    - Add `ONBOARDING_KEY = 'dit:onboarding:v1'`, the Zod `EstimatesSchema` and `OnboardingRecordSchema` (both `.strict()`), `parseOnboardingRecord`, `serializeOnboardingRecord` (exactly 4 fields), `readOnboardingRecord` (returns `valid`, `absent` or `read-error`, never writes) and `writeOnboardingRecord`.
    - `writeOnboardingRecord` calls `setItem`, then reads the value back and compares it. It returns a Result and never throws.
    - _Requirements: 11.1, 11.2, 11.5, 11.11, 16.4, 16.6_
  - [x] 10.2 Write unit tests in `src/lib/onboarding/record.test.ts`
    - Use `memoryBackend()` and `throwingBackend()` to check: a `read-error` when `getItem` throws or no backend exists; reading never writes; a failed write when `setItem` throws or the read-back differs; and a failed write leaves the earlier stored value unchanged.
    - _Requirements: 11.2, 11.5, 16.6_
  - [x] 10.3 Add record arbitraries to `src/lib/onboarding/test-support.ts`
    - Add `arbValidRecord()` and `arbStoredRecord()`. The second covers valid complete and incomplete records, near-misses with each field broken once, extra keys, random strings, non-JSON text and `null`.
    - _Requirements: 11.1_
  - [x] 10.4 Write property test P26 in `src/lib/onboarding/record.prop.test.ts`
    - **Property 26: Onboarding_Record serialization round trip**
    - **Validates: Requirements 11.1, 11.11, 16.4**
  - [x] 10.5 Write property test P27 in `src/lib/onboarding/record.prop.test.ts`
    - **Property 27: The record schema accepts exactly the valid records**
    - **Validates: Requirements 11.1**

- [x] 11. Checkpoint: pure core
  - Run `bun run test`, `bun run typecheck` and `bun run lint`. Ensure all tests pass, ask the user if questions arise.

- [x] 12. Chime_Player and Web Audio adapter
  - [x] 12.1 Implement `src/lib/safety/chime-player.ts`
    - Add `AudioState`, `AudioPort`, `ChimeVoice`, `PageVisibility`, `ChimePlayer`, the lookahead, refill and sound-check constants, and `createChimePlayer({ audio, scheduler, page })`.
    - Implement episode state, `start()`, `fill()`, `stop()`, the `running` state-change handling, the page-visibility refill and the sound-unavailable note, as the design describes.
    - Read time only from the injected port and schedule only through the injected scheduler. Never call `speechSynthesis`.
    - _Requirements: 1.1, 1.11, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 5.8, 6.4, 6.5, 6.6, 6.9, 6.10_
  - [x] 12.2 Create the audio fakes in `src/lib/safety/fakes.ts`
    - Add `FakeAudioPort`: settable state, manual audio clock, recorded `playChime(t)` calls and `silence(t)` calls on returned voices, and an option to throw on the Nth `playChime`.
    - Add `FakeAudioContext`: records oscillator and gain creation, frequencies, param ramps, `cancelScheduledValues`, `start`/`stop` times, `createBuffer` and `resume()` calls, and can reject `resume()`.
    - Add `FakeChimePlayer`, which can throw on `start`.
    - _Requirements: 4.1, 4.7, 5.8, 6.8_
  - [x] 12.3 Write example tests in `src/lib/safety/chime-player.test.ts`
    - Check that the first Chime is at `s`, within 100 ms of start. Check that a missing context shows the note at once.
    - Check that a suspended context gets one `resume()` call, that the note appears after 1000 ms on the scheduler, and that when the context becomes `running` the note is removed and Chimes start from the next schedule time.
    - Check that `running` while idle or closing plays nothing; that a throw on `playChime` shows the note and makes no further calls; that a new episode clears the note; and that no speech object is touched.
    - _Requirements: 1.11, 4.4, 4.7, 4.8, 4.10, 4.11, 6.4, 6.5, 6.6, 6.9, 6.10_
  - [x] 12.4 Add `arbChimePlayerCommands()` to `src/lib/safety/test-support.ts`
    - Generate 0 to 100 commands: `advance(ms)` with late firing of 0 to 120 000 ms, `hide`, `show`, `start` again, and `stop`.
    - _Requirements: 4.5, 4.9_
  - [x] 12.5 Write property test P12 in `src/lib/safety/chime-player.prop.test.ts`
    - **Property 12: The Chime_Player plays each scheduled Chime once, on time, and nothing after stop**
    - Use `FakeAudioPort` and `ManualScheduler`.
    - **Validates: Requirements 4.5, 4.6, 4.9, 5.8**
    - Note (implementation): `advance(ms)` covers 0 to 120 000 ms. The harness clamps each command's timer lateness (generated from 0 to 120 000 ms) to 1 000 ms while the page is visible and 60 000 ms while hidden, the throttling bounds the 70 s hidden lookahead is sized for; a timer 120 s late in a hidden page would skip Chimes with this design. `createLateScheduler` wraps a `ManualScheduler` so timers can fire late. Chimes requested ahead of a stop count as scheduled and must receive `silence(stopAt)`; the player releases voices of Chimes that have ended, so only voices that could still sound at the stop are checked.
  - [x] 12.6 Implement `src/lib/safety/browser.ts`
    - Implement `webAudioPort(win)`: at most one AudioContext per page load, state mapping including `interrupted`, a non-throwing `resume()`, `playChime` with two sine tones (880 Hz at +0 ms and 660 Hz at +200 ms, 150 ms each, peak 0.8, 10 ms ramps, oscillators stop at +360 ms), `silence(at)`, and `unlockSilently()` (a 1-sample zero buffer and no gain node).
    - Implement `installAudioUnlock(win, port)` with passive capture listeners for `keydown`, `pointerdown` and `click` that never prevent or stop the event.
    - Implement `browserPageVisibility(doc)`. This is the only safety file that touches globals.
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 6.1, 6.2, 6.3, 6.7, 6.8_
  - [x] 12.7 Write unit tests in `src/lib/safety/browser.test.ts`
    - Use `FakeAudioContext` on a fake `window` to check: tone frequencies, offsets and durations; peak 0.8 and 10 ms ramps; oscillator stop at or before 400 ms; `silence` ramps to 0 within 20 ms and stops future tones at `at`.
    - Check unlock on the first `keydown`, `pointerdown` and `click`; `resume()` on later gestures while suspended; one context per page; a silent buffer with no gain node during unlock; and no unhandled rejection from a rejected `resume()`.
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 6.1, 6.2, 6.3, 6.7, 6.8_
  - [x] 12.8 Add the no-globals lint rule for the pure and runtime modules
    - In the ESLint config, add `no-restricted-globals` (`window`, `document`, `AudioContext`, `webkitAudioContext`, `localStorage`, `speechSynthesis`, `performance`) for `src/lib/safety/**` and `src/lib/onboarding/**`. Exclude `src/lib/safety/browser.ts` and test files.
    - Run `bun run lint` to confirm it passes.
    - _Requirements: 5.8, 3.1, 17.1_
    - Note (implementation): the `dit/safety-onboarding-purity` object in `eslint.config.mjs` also bans the conversation core's timer, storage, network and DOM globals (`setTimeout`, `navigator`, `fetch`, …), `SpeechSynthesisUtterance`, `Date.now` and `Math.random`.

- [x] 13. Alarm_Handler
  - [x] 13.1 Implement `src/lib/safety/alarm-handler.ts`
    - Add `CardView`, `SafetyAlarmHandler` and `createAlarmHandler({ chime })`.
    - `apply(input)` commits the state first, then runs each effect in its own `try/catch`. It calls each `onActiveChange` listener once, each wrapped. On `active-change(false)` it calls `focusKeyingSurface()`. It then notifies subscribers.
    - Expose `start`, `handlePress`, `partnerDismiss`, `cardPointer`, `isActive`, `state`, `setView`, `setFocusKeyingSurface`, `soundUnavailable` (delegated to the chime) and `subscribe`. Nothing awaits.
    - _Requirements: 1.1, 1.2, 1.11, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8, 2.10, 2.12, 2.13, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 18.9_
  - [x] 13.2 Add `FakeCardView` to `src/lib/safety/fakes.ts`
    - It records `show`/`hide` calls and can throw on `show`.
    - _Requirements: 7.3_
  - [x] 13.3 Write unit tests in `src/lib/safety/alarm-handler.test.ts`
    - Check that `start()` runs card `show`, chime `start` and one `onActiveChange(true)`, in that order, within one synchronous call.
    - Check `start()` with a throwing view, a throwing chime and no view: the machine is `ringing`, `isActive()` is true, nothing is rethrown, and all 3 kinds of Dismissal still work.
    - Check that a repeated `start()` is a no-op; that the focus function is called once on return to `idle`; that a throwing listener does not block the others; and that `start()` succeeds while fakes report a pending Client request, an open Settings_Panel, an open Cheat_Sheet and an open onboarding flow.
    - _Requirements: 1.1, 1.2, 1.11, 2.8, 2.10, 2.13, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_
  - [x] 13.4 Add `arbRouterCommands()` to `src/lib/safety/test-support.ts`
    - Generate 0 to 200 commands mixing `press(kind, t)` from any Source_Kind with `start`, `partner-dismiss`, `onboarding-open` and `onboarding-close`.
    - _Requirements: 3.4_
  - [x] 13.5 Write property test P5 in `src/lib/safety/press-router.prop.test.ts`
    - **Property 5: No Press_Event reaches the Session_Engine or Guard_Engine while the alarm is active**
    - Use the real Alarm_Handler with `FakeCardView` and `FakeChimePlayer`, and recording session and onboarding consumers. Use `numRuns: 500`.
    - **Validates: Requirements 3.4, 2.9, 2.11**
    - Note (implementation): an `up` that arrives while the alarm is active but whose `down` went to the session or onboarding before the alarm started is delivered to no consumer (Requirement 12.8); every other press in the span goes to the Alarm_Handler only.

- [x] 14. Cheat_Sheet store, Onboarding controller and barrels
  - [x] 14.1 Implement `src/lib/onboarding/cheat-sheet-store.ts`
    - Implement `createCheatSheetStore(ctx)` with `getState`, `dispatch` and `subscribe`, plus `createUnknownPatternHandler(store)`, which implements the conversation-ui `UnknownPatternHandler`.
    - _Requirements: 10.1, 10.2, 10.11, 7.8, 7.9_
  - [x] 14.2 Write unit tests in `src/lib/onboarding/cheat-sheet-store.test.ts`
    - Check that the unknown-pattern handler opens the store with reason `unknown`, does nothing while onboarding is open or the alarm is active, and notifies subscribers once per change.
    - _Requirements: 10.1, 10.11, 7.8_
  - [x] 14.3 Create the controller fakes in `src/lib/onboarding/fakes.ts`
    - Add `FakeEngine` (scripted events per `press`/`release`/`tick` and a settable `nextDeadline`), `FakeSourceControl` (records `startBlink`, `stopBlink` and `restore`, with settable statuses and `onChange`) and `FakeSwitchLearner` (`arm()` resolves on demand, records `cancel`).
    - _Requirements: 12.3, 12.4, 13.4, 13.8, 11.9_
  - [x] 14.4 Implement `src/lib/onboarding/controller.ts`
    - Add `OnboardingSessionApi`, `OnboardingView`, `OnboardingController` and `createOnboardingController(deps)`.
    - `attach` reads the record. For a valid complete record it stays closed and calls `setInitialEstimates` once. For an absent or incomplete record it opens. For a read error it opens without calling `setInitialEstimates`.
    - `open` snapshots the sources, builds the Guard_Engine with `engineConfigOf(settings, estimatesInEffect)` (falling back to defaults), calls `router.onOnboardingOpenChange()` and subscribes to blink status.
    - `handlePress` gives the event to the Guard_Engine first and calls `alarm.start()` synchronously on `sos`. Other Engine_Events are discarded. It then dispatches the press and reschedules the guard: at most 1 timer, with a 50 ms re-arm while `pendingSince` reports a pending press.
    - `dispatch` runs effects synchronously: learner arm with an attempt token, `startBlink` inside the user action, `apply-estimates`, `finish` (write the record and set `saveFailed`), `cancel` (restore the sources) and focus.
    - `close` cancels the timer, drops the Guard_Engine and notifies the router.
    - Also implement `runSetupAgain`, `turnOnBlinkCamera`, `getView` (including `blinkResume` and `inputChoiceInEffect`) and `subscribe`. If `api.learner` is null, the switch path shows "Switch setup is not available in this build." and keeps Continue disabled.
    - _Requirements: 7.6, 11.2, 11.3, 11.4, 11.5, 11.7, 11.9, 11.10, 11.12, 11.13, 11.14, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.9, 12.10, 13.3, 13.4, 13.5, 13.6, 13.8, 13.10, 15.6, 15.7, 15.9, 16.4, 16.5, 16.6, 16.7_
    - Note (implementation): `OnboardingSessionApi` also has `focusSelectedChoice()`, which carries the `focus-selected-choice` effect of `runSetupAgain`. A press whose Guard_Engine call yields `sos` is not passed on as a practice press, and the Guard_Engine is reset, so the flow state after the alarm equals its state when the alarm started (Requirement 2.11). `attach` makes the load decision once per page load, so a strict-mode detach and attach does not apply estimates twice. A Guard_Engine that has seen no press yet is rebuilt at the first press when the settings changed after the flow opened (on first load the flow opens before the session has read the stored settings).
  - [x] 14.5 Write unit tests in `src/lib/onboarding/controller.test.ts`
    - Guard_Engine: it gets each press before the reducer; at most one guard timer exists after each press and each fire; the timer re-arms while a press is pending; `sos` from a press and from a tick calls `alarm.start()` once and keeps the step and durations; other events are discarded; close cancels the timer and no tick follows.
    - Load and rerun: the read-error path. "Run setup again" selects the previous choice, emits focus on it and writes nothing until Start. "Cancel setup" restores the sources and leaves storage and estimates untouched.
    - Start and blink: Start writes once; a throwing or mismatching backend sets `saveFailed` and keeps the in-memory choice and estimates; a repeated Start does nothing. Check the blink resume button visibility and reason for each status.
    - _Requirements: 7.6, 11.5, 11.7, 11.9, 11.10, 11.12, 11.13, 11.14, 12.3, 12.4, 12.5, 12.6, 12.7, 12.9, 12.10, 16.4, 16.5, 16.6, 16.7_
  - [x] 14.6 Write property test P28 in `src/lib/onboarding/controller.prop.test.ts`
    - **Property 28: The load decision follows the stored record**
    - Use `arbStoredRecord()` with `memoryBackend()`.
    - **Validates: Requirements 11.2, 11.3, 11.4**
  - [x] 14.7 Fill the `src/lib/safety/index.ts` and `src/lib/onboarding/index.ts` barrels
    - Export the public API of every module in both folders, including `strings.ts`. Do not export `test-support.ts` or `fakes.ts`.
    - _Requirements: 8.1, 9.1_

- [x] 15. Checkpoint: library and runtime objects
  - Run `bun run test`, `bun run typecheck` and `bun run lint`. Ensure all tests pass, ask the user if questions arise.

- [x] 16. Component foundations
  - [x] 16.1 Extend the jsdom test setup with dialog and motion stubs
    - Polyfill `HTMLDialogElement.showModal`, `show` and `close`: toggle `open`, fire `toggle`, `cancel` and `close`, and keep a top-layer stack so the topmost modal and `:modal` can be checked.
    - Stub `matchMedia('(prefers-reduced-motion: reduce)')` with a settable value. Reuse the existing conversation-ui setup file if there is one.
    - _Requirements: 1.5, 1.9, 7.8, 14.13_
  - [x] 16.2 Add the alarm color token and contrast rows
    - Add `--color-alarm: #5C0A14` to the `@theme` block in `globals.css`.
    - Add the design's contrast rows to `tokens.test.ts`: text on alarm at 7:1 or more, focus on alarm at 3:1 or more, the Dismiss label, Glyphs, muted hints, borders and the panel focus ring.
    - _Requirements: 1.7, 8.5, 18.1_
  - [x] 16.3 Implement `src/components/CodeGlyphs.tsx`
    - Render an `aria-hidden="true"` row with one Glyph per symbol: a dot is a `u × u` circle and a dash is a `3u × u` bar, both in `bg-text`. Support the sizes `legend`, `sheet` and `practice`. Use no animation.
    - _Requirements: 8.3, 9.5, 14.4, 18.6, 18.7_
    - Note (implementation): the Glyphs use the Symbol_Stream's shapes (a `3.25u × u` pill, 1u apart) so all Morse on screen looks the same; `u` is `min(size, 100cqi / 24)`, so the longest code fits its container at 320 px. See design.md "Implementation notes".
  - [x] 16.4 Write tests in `src/components/CodeGlyphs.test.tsx`
    - Check that the row is hidden from the accessibility tree, that there is one Glyph per symbol in code order, that the dash width is 3 times the dot width at equal height, and that no animation or transition class is used.
    - _Requirements: 8.3, 18.6, 18.7, 18.8_

- [x] 17. AlarmCard
  - [x] 17.1 Implement `src/components/AlarmCard.tsx`
    - Render an always-mounted `<dialog role="alertdialog" aria-modal="true">`, named by "I need help" and described by the text naming the 3 ways to dismiss. Show the sound note when `soundUnavailable()`, and a Dismiss button at least 44 × 44. Size the text with `clamp(3rem, …)` and `overflow-wrap: anywhere`. Use no animation.
    - In a layout effect, register a CardView: `show()` calls `showModal()` and then focuses Dismiss; `hide()` closes the dialog with a `hiding` flag. If the alarm is already ringing at registration, show the card.
    - Add window capture listeners: Escape calls `partnerDismiss`; Tab and Shift+Tab keep focus on Dismiss. Prevent `cancel` and treat it as `partnerDismiss`; treat a `close` that `hide()` did not cause as `partnerDismiss`.
    - Pointer path: a primary `pointerdown` calls `cardPointer('down')`. The matching `pointerup`/`pointercancel` is swallowed and calls `cardPointer('up')`. The trailing `click` is swallowed. Dismiss `onClick` calls `partnerDismiss`.
    - Add a re-raise guard for any other dialog that opens while ringing. Pass `handler.setFocusKeyingSurface` the session focus function.
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.12, 2.4, 2.5, 2.6, 2.10, 6.5, 6.6, 7.8, 10.14, 18.4, 18.8, 18.9_
    - Note (implementation): the card counts its own `close()` calls (hide and re-raise) instead of one `hiding` flag, because browsers fire `close` later, as a task.
  - [x] 17.2 Write role and name tests in `src/components/AlarmCard.test.tsx`
    - Find the card with `getByRole('alertdialog', { name: 'I need help' })`. Check `aria-modal` and that the description names all 3 ways to dismiss.
    - Find Dismiss with `getByRole('button', { name: 'Dismiss' })`. Check that it has focus right after `start()` and that Tab and Shift+Tab keep it there.
    - Check that Enter and Space on Dismiss go straight to `idle` with no Press_Event. Check that Escape goes to `idle` and leaves the Settings dialog and Cheat_Sheet as they were.
    - Check that `pointerdown` on the card hides it and that the following `pointerup` and `click` reach no element underneath. Check that focus returns to the Keying_Surface.
    - Check that with the Settings dialog open first, the card is topmost, and that a dialog opened during Ringing triggers a re-raise.
    - Check that the sound note appears and disappears with the fake player, and that no element has a CSS animation.
    - _Requirements: 1.4, 1.5, 1.6, 1.8, 1.9, 1.10, 1.12, 2.4, 2.5, 2.6, 2.10, 6.5, 6.6, 7.8, 10.14, 18.4, 18.9_

- [x] 18. CommandLegend and SafetyNotices
  - [x] 18.1 Implement `src/components/CommandLegend.tsx`
    - Render `<ul aria-label="Command codes">` from `useMemo(buildLegendModel)`. Each item has an `aria-hidden` label and Glyphs, plus an `.sr-only` `legendAccessibleText`.
    - Use the wrapping grid with `white-space: nowrap` on code rows.
    - Add an "All codes" button (44 × 44 minimum) that dispatches `partner-open` and then focuses the Keying_Surface. The content must not depend on onboarding or alarm state.
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 10.5, 18.1, 18.6, 18.7_
    - Note (implementation): grid cells are at least `13.5rem`, and "All codes" sits beside the two code columns when they fit (a tablet in portrait), so the legend box and the Keying_Surface both fit at 768 × 1024 and 1024 × 768 with three suggestions (conversation-ui Requirement 22.7).
  - [x] 18.2 Write role and name tests in `src/components/CommandLegend.test.tsx`
    - Check for 4 list items named "Speak: dot dash dot dash dot", "Next suggestion: …", "Delete last letter: …" and "Help alarm: …", with `aria-hidden` Glyphs and the right Glyph count per code.
    - Check that `getByRole('button', { name: 'All codes' })` opens the sheet with reason `partner`, focuses the Keying_Surface and produces no Press_Event.
    - Check that the content is identical with the flow open and with the alarm ringing.
    - _Requirements: 8.3, 8.4, 8.8, 8.9, 8.10, 8.11_
  - [x] 18.3 Implement `src/components/SafetyNotices.tsx`
    - Show the "Turn on camera for blink input" button when `blinkResume.visible`; its click handler calls `turnOnBlinkCamera()`. Show the plain-words reason for failure statuses. Show the save-failure message while `saveFailed` is true. This is not a live region.
    - _Requirements: 11.12, 11.13, 11.14, 16.6_
  - [x] 18.4 Write role and name tests in `src/components/SafetyNotices.test.tsx`
    - Check that the button is found by name, that a click calls `startBlink` once inside the handler, that the button is hidden for `starting`, `active` and `face-lost`, and that it shows again with a reason for each failure status except `unsupported`.
    - Check that the save-failure text stays shown for at least 10 seconds on a manual clock.
    - _Requirements: 11.12, 11.13, 11.14, 16.6_

- [x] 19. CheatSheet
  - [x] 19.1 Implement `src/components/CheatSheet.tsx`
    - When open, render `<section aria-labelledby>` with `<h2>All codes</h2>`, fixed at `placePanel(...)` (tracked with `ResizeObserver` plus `resize` and `scroll`), with internal scroll.
    - Show the "Not a code:" line with Glyphs and Spoken_Code when a pattern is set. Render four `<h3>` groups from `buildCheatSheetModel()`, rebuilt on each open, and a "Close codes" button.
    - On Escape, close only when the alarm is idle and no `dialog:modal` exists. Subscribe to `onCharCommitted`. Move focus to the Keying_Surface on close only if focus was inside the sheet or a control was used. Never move focus on open. Use no `aria-modal`, no focus trap and no `inert`.
    - _Requirements: 9.1, 9.5, 9.6, 9.7, 9.9, 9.10, 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.9, 10.10, 10.13, 10.14, 18.1, 18.4, 18.5, 18.6, 18.7_
  - [x] 19.2 Write role and name tests in `src/components/CheatSheet.test.tsx`
    - Check for the region named "All codes" with group headings Letters, Digits, Punctuation and Commands, 49 character entries and 4 command entries with the right accessible names, and the "Not a code:" line only for reason `unknown`.
    - Check that opening does not move focus, that Tab leaves the sheet, and that nothing outside it is `inert` or `aria-hidden`.
    - Check that "Close codes" and Escape close it and focus the Keying_Surface, and that Escape does not close it while the Settings dialog is open.
    - Check that a `char` commit through a fake controller closes an `unknown` sheet and leaves a `partner` sheet open.
    - _Requirements: 9.5, 9.6, 9.7, 9.9, 9.10, 10.1, 10.3, 10.4, 10.5, 10.6, 10.7, 10.9, 10.10_

- [x] 20. Onboarding UI
  - [x] 20.1 Implement `src/components/InputStep.tsx`
    - Render a `<fieldset>` with the three `aria-pressed` tiles and a visible "Selected" marker on the selected tile.
    - Add the switch area (armed, learned with the key, and failed with "Try again" and "Use key or tap instead"). Add the blink area (the explanation and "Turn on camera" dispatching `camera-on` in the click handler, the status texts, and the failure reasons with "Try again" for every status except `unsupported`).
    - Add a Continue button disabled by `continueEnabled`. On rerun, focus the selected tile.
    - _Requirements: 11.7, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13, 18.4, 18.6_
  - [x] 20.2 Write role and name tests in `src/components/InputStep.test.tsx`
    - Check the three tiles by name, `aria-pressed`, and that Continue is disabled at start.
    - Switch path: use the fake learner to check "Press the switch now.", "Switch learned." with the key, and the failure buttons.
    - Blink path: check that `startBlink` is not called before "Turn on camera", then check every status text and failure text, and that "Try again" is absent for `unsupported`.
    - Check that "Use key or tap instead" selects "Key or tap".
    - _Requirements: 13.1, 13.2, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.13_
  - [x] 20.3 Implement `src/components/PracticeStep.tsx`
    - Show the prompt and count from `practicePrompt`, and a practice row whose Glyph type depends only on position (dots 1–3, dashes 4–5). Show "Holding…" when `heldIndicatorShown`. Show "Use default speed" at all times.
    - Result area: for `measured`, the Speed_Text, the close-presses sentence when `mean(d[3], d[4]) < 1.5 × median(d[0..2])`, "Use this speed" and "Practice again". For `default`, the default speed text from `settings.startingWpm`, "Practice again" only when a Calibration is held, and Continue.
    - Use no transitions.
    - _Requirements: 14.1, 14.4, 14.5, 14.6, 14.7, 14.9, 14.10, 14.11, 14.13, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_
  - [x] 20.4 Write role and name tests in `src/components/PracticeStep.test.tsx`
    - Check the prompt and count text at n = 0, 3 and 4; a Glyph row of 5 with 3 dots then 2 dashes for arbitrary durations; the held indicator; and the "Use default speed" button at n = 0, 3 and 5.
    - Check the result texts and buttons for `measured`, for `default` after skip, and for `default` from a fallback. Check the close-presses sentence.
    - _Requirements: 14.1, 14.4, 14.5, 14.6, 14.7, 14.10, 14.11, 15.2, 15.3, 15.4_
  - [x] 20.5 Implement `src/components/LegendStep.tsx`
    - Show the 4 Legend_Model entries in order with Glyphs, label, `.sr-only` Spoken_Code and the one sentence from `COMMAND_SENTENCES`. Add the "Tap All codes…" hint and a "Start" button (44 × 44 minimum).
    - _Requirements: 16.1, 16.2, 16.3, 18.7_
  - [x] 20.6 Write role and name tests in `src/components/LegendStep.test.tsx`
    - Check the 4 entries with their sentences, the hint, and that `getByRole('button', { name: 'Start' })` dispatches `start`.
    - _Requirements: 16.1, 16.2, 16.3_
  - [x] 20.7 Implement `src/components/OnboardingFlow.tsx`
    - Render one `<dialog aria-labelledby="setup-step-title">`. The Input_Step and Legend_Step use `showModal()`. The Practice_Step uses `close()` then `show()`, placed with `placePanel(...)`.
    - Prevent `cancel`; for reruns, dispatch `cancel`. Render one `h2` per step, including the Done view.
    - Keep one polite `aria-live` region for the life of the flow. Set it to the step heading on step change and to "N of 5" on count change, with nothing per press.
    - Show "Cancel setup" at every step for reruns. Keep the step, choice and durations across resize and orientation changes.
    - _Requirements: 11.8, 11.9, 14.2, 18.2, 18.3, 18.4, 18.5, 18.10, 18.11_
    - Note (implementation): `OnboardingFlow` also takes `startingWpm` (for the default speed text) and an `id` (for `focusSelectedChoice`). The Practice_Step and the Cheat_Sheet share the placement hook `src/hooks/usePanelPlacement.ts`.
  - [x] 20.8 Write role and name tests in `src/components/OnboardingFlow.test.tsx`
    - Check one `h2` per step, including Done in isolation, and still exactly one `h1` on the page.
    - Check the live-region text on step and count changes, and no change per press.
    - Check that "Cancel setup" appears only for reruns, and that a fake resize keeps the step, choice and durations.
    - _Requirements: 11.8, 18.2, 18.3, 18.11_
  - [x] 20.9 Implement `src/components/OnboardingHost.tsx` and `src/components/RunSetupAgainButton.tsx`
    - `OnboardingHost` builds `OnboardingSessionApi` from `SessionApiContext` (including `learner` and `pendingSince`), calls `controller.attach(api)` in a layout effect, subscribes with `useSyncExternalStore`, and renders `OnboardingFlow` while open.
    - `RunSetupAgainButton` (44 × 44 minimum) calls `closeSettings({ focusKeyingSurface: false })` and then `controller.runSetupAgain()`.
    - _Requirements: 11.2, 11.3, 11.4, 11.6, 11.7, 12.4, 13.4_
  - [x] 20.10 Write role and name tests in `src/components/OnboardingHost.test.tsx`
    - Check that attach runs in a layout effect before any passive effect.
    - Check that `getByRole('button', { name: 'Run setup again' })` inside the Settings dialog closes it, opens the flow and focuses the selected tile.
    - Check that Start closes the flow and focuses the Keying_Surface.
    - _Requirements: 11.2, 11.6, 11.7, 16.5_

- [x] 21. DitRoot wiring
  - [x] 21.1 Implement `src/components/DitRoot.tsx`
    - Use `'use client'`. Build `createSafetyRuntime()` once with `useState`: chime player, alarm handler, press router, onboarding controller, cheat-sheet store with a context reading `onboarding.isOpen()` and `alarm.isActive()`, and the unknown-pattern handler. Nothing in the build touches `window`.
    - `attachBrowser(window)` runs in a layout effect and injects `webAudioPort`, `installAudioUnlock`, `browserScheduler`, `performanceClock`, `browserPageVisibility` and `localStorageBackend()`.
    - Render `DitApp` with the `alarm`, `unknownPattern`, `pressRouter`, `legend` (CommandLegend and SafetyNotices), `overlay` (CheatSheet, OnboardingHost, then AlarmCard last) and `extraSettingsActions` (RunSetupAgainButton) props.
    - _Requirements: 2.9, 6.1, 7.2, 8.6, 11.2, 11.3, 11.4, 11.6, 12.1_
  - [x] 21.2 Render `DitRoot` from `src/app/page.tsx` and remove the inert alarm stub
    - Replace `<DitApp/>` with `<DitRoot/>`, and remove the page-level inert alarm stub found in task 1.3 so the real Alarm_Handler is the only alarm in the running app. Keep any conversation-ui default that its own tests need.
    - Keep `page.tsx` a server component.
    - _Requirements: 1.1, 7.2, 8.6_
  - [x] 21.3 Write integration tests in `src/components/DitRoot.test.tsx`
    - With an empty memory backend, check that the flow (found by its step heading) opens before the first keyboard press, and that a press during the flow never changes Current_Text.
    - Check that a complete record calls `setInitialEstimates` once before the first press.
    - Key `...---...` through the real keyboard source and a real Engine at a fast WPM. Check that `getByRole('alertdialog', { name: 'I need help' })` appears, that the next Space press dismisses it, and that Current_Text is unchanged.
    - Check that an SOS keyed during onboarding raises the alarm and keeps the onboarding step.
    - _Requirements: 1.1, 2.9, 2.11, 7.2, 7.6, 11.2, 11.4, 12.2, 12.6_
    - Note (implementation): the tests use jsdom's localStorage and Vitest fake timers for `setTimeout`, `requestAnimationFrame` and `performance.now`, so every press has an exact length. The Space that dismisses is sent to the focused Dismiss button as keydown, keyup and click, as a browser does; user-event's waits hang under these fake timers.

- [x] 22. Final checkpoint
  - Run `bun run test`, `bun run typecheck` and `bun run lint`. All three must pass. Ensure all tests pass, ask the user if questions arise.

- [ ] 23. Manual checklist (a human runs `bun run dev`; not for the coding agent)
  - Real speaker volume: trigger SOS at the device's normal volume and confirm the Chime is clearly audible from the next room. Repeat with the tab in the background for at least 6 minutes and confirm no Chime is missing or doubled (4.2, 4.3, 4.5).
  - Blink-triggered SOS after audio unlock: complete onboarding with the Blink choice using taps only, which unlocks audio, then key `...---...` with blinks alone and confirm the Chime plays. Reload, enable blink with "Turn on camera for blink input", trigger SOS by blink, and confirm that sound plays or the sound-unavailable note appears within 1 s (6.1, 6.5).
  - Tablet layouts at 768×1024 and 1024×768, portrait and landscape, rotating mid-step: the Command_Legend is fully visible without scrolling; no onboarding step has horizontal scroll or clipping; the Practice_Step and Cheat_Sheet never cover the Keying_Surface (8.6, 14.2, 18.10, 18.11).
  - Also run the rest of the design's manual list: alarm stacking over Settings, pointer dismissal over a suggestion, 320 px width and 200 % zoom, 2560×1440 and 3840×2160, Reduce Motion, VoiceOver and NVDA, and camera denied or missing (1.3, 1.5, 1.9, 1.10, 1.12, 2.6, 7.8, 8.7, 13.10, 18.5, 18.8).
  - _Requirements: 1.3, 1.5, 4.2, 4.3, 4.5, 6.1, 6.5, 8.6, 8.7, 14.2, 18.5, 18.10, 18.11_

## Notes

- No task is marked optional. Each property from the design (P1–P28) is its own required fast-check sub-task, and the test-support arbitraries are required too.
- Task 1 is a gate. If a sibling export or integration point is missing, implement that sibling spec first. Do not stub the alarm, router or Guard_Engine paths.
- `SessionApiContext.learner` and `pendingSince` come from the conversation-ui design update. Task 1.3 confirms they exist before task 20.9 uses them.
- Task 23 is a manual check by a person. The coding agent does not run it.
- Requirement 7.8 and the visual criteria (1.3, 1.5, 8.6, 8.7, 18.5, 18.10) are partly covered by the jsdom tests and fully covered by task 23.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1", "5.1", "8.1", "8.4", "9.1", "16.1", "16.2"] },
    { "id": 3, "tasks": ["2.2", "3.2", "3.3", "5.2", "8.2", "9.2", "10.1", "12.1", "14.3"] },
    { "id": 4, "tasks": ["2.3", "3.4", "4.2", "5.3", "6.1", "8.3", "8.5", "9.3", "10.2", "12.2", "14.1"] },
    { "id": 5, "tasks": ["3.5", "4.3", "5.4", "6.2", "6.3", "7.1", "8.6", "9.4", "12.3", "12.6", "13.1", "14.2", "14.4"] },
    { "id": 6, "tasks": ["3.6", "4.4", "5.5", "6.4", "7.2", "7.3", "7.5", "12.4", "12.7", "12.8", "13.2", "14.5", "14.7"] },
    { "id": 7, "tasks": ["3.7", "4.5", "5.6", "7.4", "9.5", "12.5", "13.3", "13.4", "16.3", "17.1", "18.3"] },
    { "id": 8, "tasks": ["4.6", "9.6", "10.3", "13.5", "16.4", "17.2", "18.1", "18.4", "19.1", "20.1", "20.3", "20.5"] },
    { "id": 9, "tasks": ["9.7", "10.4", "14.6", "18.2", "19.2", "20.2", "20.4", "20.6", "20.7"] },
    { "id": 10, "tasks": ["9.8", "10.5", "20.8", "20.9"] },
    { "id": 11, "tasks": ["9.9", "20.10", "21.1"] },
    { "id": 12, "tasks": ["9.10", "21.2"] },
    { "id": 13, "tasks": ["9.11", "21.3"] },
    { "id": 14, "tasks": ["9.12"] },
    { "id": 15, "tasks": ["9.13"] }
  ]
}
```


## Review corrections: single-input reachability and cancellation (review, 2026-11-11)

These corrections supersede earlier conflicting criteria in this document.

- [x] 24.1 Close the cheat sheet on any committed character or command regardless of open reason. Every code must be reachable without scrolling: use a dense viewport layout or single-input paging at 1280×800, 820×1180 and 393×852.
  - Verified: `CheatSheet.test.tsx at all three viewport sizes; sheet-state property`.
- [x] 24.2 After five calibration presses, Speak or a further press followed by a letter gap accepts the measured/default speed. Defer acceptance to a committed pattern, preserve SOS priority and rebuild the guard with accepted timing for the legend.
  - Verified: `DitRoot.test.tsx (Speak/extra press acceptance, fast calibration at default Starting WPM, SOS priority)` and `OnboardingFlow.test.tsx (partner acceptance returns focus to the keying surface)`.
- [x] 24.3 Finishing setup with key/tap or blink disables switch input and clears the learned switch key. Apply the same source selection when restoring a completed record.
  - Verified: `controller.prop.test.ts (finish and reload)`.
- [x] 24.4 Cancelling rerun restores the timing estimates that were in effect before setup, even after accepting a new calibration; leave the persisted record unchanged.
  - Verified: `controller.test.ts cancellation property`.
- [x] 24.5 On reload with saved blink input, automatically resume only if the Permissions API reports camera permission granted; prompt/denied/unsupported states retain the explicit camera action.
  - Verified: `SafetyNotices.test.tsx (granted/prompt/denied/unsupported)`.

- [x] 25.1 Detect letter-by-letter SOS on guard press and timer commits, with focused regression coverage.
- [x] 25.2 Snapshot and restore active/persisted switch keys on cancel; clear switch on non-switch selection; cover learner rollback and controller selection/cancel.
- [x] 25.3 Freeze chosen practice results, focus after default speed and accept by single input before five durations; adjust focused reducer/controller/UI tests.
- [x] 25.4 Stack non-modal setup above codes and cancel re-run Practice/Legend on Escape; verify component behavior.
- [x] 25.5 Show Commands first, remove fixed paging cap, add partner page buttons and polite page status, retain single-input paging; verify panel capacities and code reachability.
- [x] 25.6 Rewrite last-round review requirements in conditional EARS form.
