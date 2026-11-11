# Implementation Plan: input-sources

## Overview

Build `src/lib/input/` in TypeScript from the inside out. Pure modules come first (types, clock, Result re-export, Debouncer, Input_Arbiter, focus classification, KeyMachine and KeyRouter, Blink_Detector), each followed by its fast-check property tests. The sources come next (shared source core, Keyboard_Source, Switch_Source and Switch_Learner, Pointer_Source), then the browser adapters (`browser.ts`, `blink/source.ts`, `blink/browser.ts`), then the barrel and the `useInputSources` hook. A checkpoint runs the full suite and the type check, and a final manual task covers the hardware checklist from the design.

Conventions for every property sub-task:

- One `fc.assert` per property, `numRuns` at least 200.
- A tag comment in the steering format, for example `// Feature: input-sources, Property 1: Arbiter alternation and model conformance`.
- Integer-millisecond timestamps in generators.
- Shared arbitraries, reference models and fakes live in `src/lib/input/test-support.ts`. That file is never re-exported from `index.ts`.

Run tests with `bun run test` (never `bun test`). Run one module with `bunx vitest run src/lib/input/<file>`.

## Tasks

- [x] 1. Add the tooling this spec needs
  - [x] 1.1 Extend the project scaffolding, adding each item only if not already present
    - If the `morse-engine` scaffolding (task 1.1 of that spec: `package.json` scripts `test`, `typecheck`; `tsconfig.json`; `vitest.config.ts`; `.gitignore`) is missing, create it exactly as that task describes. Otherwise leave it as it is.
    - If `src/lib/morse/index.ts` does not yet export `type Result`, create `src/lib/morse/result.ts` (`Result`, `ok`, `err`) exactly as the morse-engine design defines it, and an `index.ts` that re-exports it. Do not add other engine code.
    - Dev dependencies (`bun add -d`): `jsdom`, `@testing-library/react`, `@testing-library/dom`, plus `react`, `react-dom`, `@types/react`, `@types/react-dom` if no later spec has added them yet.
    - Runtime dependency pinned with no caret: `bun add --exact @mediapipe/tasks-vision@1.2.2`.
    - `vitest.config.ts`: keep `environment: 'node'` as the default; extend `include` to `src/**/*.test.{ts,tsx}` and `scripts/**/*.test.ts`. jsdom is chosen per file with a `// @vitest-environment jsdom` docblock.
    - `tsconfig.json`: add `"jsx": "react-jsx"` and include `scripts` if they are missing.
    - `.gitignore`: add `public/mediapipe/*/wasm/`.
    - _Requirements: 9.1, 9.3, 11.6_
  - [x] 1.2 Write the MediaPipe asset script `scripts/mediapipe-assets.ts`
    - Copy `vision_wasm_internal.js` and `vision_wasm_internal.wasm` from `node_modules/@mediapipe/tasks-vision/wasm/` into `public/mediapipe/1.2.2/wasm/`; do not copy the `vision_wasm_module_internal.*` pair.
    - Fail with a clear message when the installed package version is not `1.2.2`.
    - Verify `public/mediapipe/1.2.2/face_landmarker.task` against SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`; fail on mismatch. With `--fetch-model`, download it from the pinned Google Storage URL and verify it when it is missing. Run the script once with `--fetch-model` so the model file exists in `public/`.
    - Add `package.json` scripts `"postinstall": "bun scripts/mediapipe-assets.ts"` and `"assets:mediapipe": "bun scripts/mediapipe-assets.ts"`.
    - If `next.config.ts` exists, add `Cache-Control: public, max-age=31536000, immutable` for `/mediapipe/:path*`. Otherwise leave a note in the script header for the spec that adds Next.js.
    - _Requirements: 9.3_
  - [x]* 1.3 Write unit tests in `scripts/mediapipe-assets.test.ts`
    - Version mismatch fails; hash mismatch fails; copy targets `public/mediapipe/1.2.2/wasm/` (use a temporary directory, no network)
    - _Requirements: 9.3_

- [x] 2. Define shared types, clock and Result access
  - [x] 2.1 Implement `src/lib/input/types.ts`
    - Re-export `type Result` from `@/lib/morse`; define `ok()`, `err()`, `SourceKind`, `SOURCE_KINDS`, `PressKind`, `PressEvent`, frozen `pressEvent()` constructor, `SourceStatus`, `FailureStatus`, `Unsubscribe`, `PressSource`, `SettingError` as in the design
    - _Requirements: 1.1, 1.2_
  - [x] 2.2 Implement `src/lib/input/clock.ts`
    - `Clock`, `Scheduler`, `createManualClock()`, `createManualScheduler()` (`runDue(now)` fires due callbacks in order, `pending()` counts live timers, cancel removes a timer)
    - _Requirements: 11.2, 11.6_
  - [x]* 2.3 Write unit tests `types.test.ts` and `clock.test.ts`
    - `pressEvent()` returns a frozen object with exactly `kind`, `t`, `source`; manual scheduler ordering, cancel and `pending()` counts
    - _Requirements: 1.1, 11.6_
  - [x] 2.4 Create `src/lib/input/test-support.ts` with base arbitraries
    - Integer timestamp-script arbitraries (running clock with signed steps), `sourceKindArb`, `pressEventArb` with weighted `NaN`/`±Infinity`, and a helper that collects emitted events
    - _Requirements: 11.4_

- [x] 3. Implement the Debouncer
  - [x] 3.1 Implement `src/lib/input/debounce.ts`
    - `MIN_PRESS_RANGES`, `DEFAULT_MIN_PRESS`, `validateMinPressDuration()`, pure `debounceStep()` following every row of the transition table (deadline form `t >= downT + min`, `min` captured at Raw_Down, non-finite inputs ignored), and the `createDebouncer()` wrapper with `isHeld`, `pendingSince`, `deadline`, `setMinPressDuration`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 1.4, 7.3, 7.8_
  - [x]* 3.2 Write unit tests in `debounce.test.ts`
    - One case per transition-table row; defaults per kind; 0 ms emits `down` synchronously; `cancel` drops only pending presses; `forceUp` emits `up@max(now, downT)`
    - _Requirements: 3.2 to 3.11, 7.3, 7.8_
  - [x] 3.3 Write property test for the Debouncer
    - **Property 5: Debounce property**
    - Add `debounceModel` to `test-support.ts`; file `debounce.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10, 3.11, 3.12**
  - [x] 3.4 Write property test for Debouncer independence and per-press settings
    - **Property 6: Debouncers are independent and capture their setting per press**
    - File `debounce.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 3.1, 3.8**
  - [x] 3.5 Write property test for invalid Min_Press_Duration values
    - **Property 7: Invalid settings are rejected and leave the previous values in effect** (Min_Press_Duration half)
    - File `debounce.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 3.8**

- [x] 4. Implement the Input_Arbiter
  - [x] 4.1 Implement `arbiterStep()`, `INITIAL_ARBITER_STATE` and `safeTickTime()` in `src/lib/input/arbiter.ts`
    - Rules 1 to 9 in the design order; `marks` kept sorted and unique; the Holder's mark cleared when it becomes Holder; `up` from the Holder checked before marks; the original event object passed through when unchanged
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12_
  - [x] 4.2 Implement `createArbiter(clock)` in `src/lib/input/arbiter.ts`
    - `connect` (fails for a duplicate kind), `onPress`/`onStatus`/`onPending` subscriptions, `detach` with `clock()` on `'off'`, a `FailureStatus` or unsubscribe; `onOutput`, `isHeld`, `holder`, `pendingSince` (earliest across sources), `onPendingChange` notifying only on change; listener errors caught and dropped
    - _Requirements: 1.2, 2.9, 2.10, 2.13, 10.8, 10.10_
  - [x]* 4.3 Write unit tests in `arbiter.test.ts`
    - Holder stop: own `up` then `'off'` yields one `up`; disconnect while Held; duplicate-kind connect fails; `safeTickTime` cases; throwing output listener does not block others
    - _Requirements: 2.9, 2.10, 2.13, 10.10_
  - [x] 4.4 Write property test for arbiter alternation and model conformance
    - **Property 1: Arbiter alternation and model conformance**
    - Add `arbiterModel` and the interleaved-streams arbitrary to `test-support.ts`; file `arbiter.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.9, 2.10, 2.11**
  - [x] 4.5 Write property test for single-source pass-through
    - **Property 2: Single-source pass-through**
    - File `arbiter.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 2.12**
  - [x] 4.6 Write property test for discarded arbiter inputs
    - **Property 3: Discarded arbiter inputs change nothing**
    - File `arbiter.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 2.6, 2.8**
  - [x] 4.7 Write property test for the pending signal
    - **Property 4: Pending signal is the earliest pending Raw_Down**
    - Fake sources built inline; file `arbiter.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 2.13**

- [x] 5. Implement focus classification
  - [x] 5.1 Implement `src/lib/input/focus.ts`
    - `FocusDescription`, `FocusClass`, `classifyFocus()` in the design's rule order (Keying_Surface first, then Editable_Target, body/null, Interactive_Target with the 17 roles, otherwise keying)
    - _Requirements: 4.1, 4.8, 11.3_
  - [x]* 5.2 Write unit tests in `focus.test.ts`
    - One case per listed tag, input type and role; Keying_Surface with `role="button"` and `tabindex` is keying; `input type="hidden"` is keying
    - _Requirements: 4.1, 4.8_
  - [x] 5.3 Write property test for focus classification
    - **Property 12: Focus classification is total, pure and keying-first**
    - File `focus.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 4.8, 11.3**

- [x] 6. Implement the KeyMachine and KeyRouter
  - [x] 6.1 Implement `src/lib/input/key-machine.ts`
    - `FocusRule`, `KeyMachineState`, `keyDown()`, `keyUp()`, `abandonActive()` following the decision table (repeat handling, second key while held, focus-blocked keys recorded with `preventDefaultOnUp: false`)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.9, 5.9, 5.11, 7.4_
  - [x]* 6.2 Write unit tests in `key-machine.test.ts`
    - Space on a button: no raw input and no `preventDefault`; Space in a text field: native; Enter then Space while held; repeat of the active key prevented; `abandonActive` swallows the later `keyup`
    - _Requirements: 4.3, 4.4, 4.6, 4.7, 7.4_
  - [x] 6.3 Write property test for key routing
    - **Property 13: Key routing respects focus and alternates raw inputs**
    - Run with both the keyboard rule and the switch rule; file `key-machine.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.9, 5.9, 5.11**
  - [x] 6.4 Implement `src/lib/input/key-router.ts`
    - `KeyEventLike`, `KeyEventTarget`, `KeyHandler`, `LearnerHook`, `createKeyRouter()`: armed learner gets first look, consumed codes go into `learnSuppressed` and their `keyup` is swallowed even after disarm; DOM listeners exist only while a handler or an armed learner is registered
    - _Requirements: 5.1, 5.2, 5.5_
  - [x]* 6.5 Write unit tests in `key-router.test.ts`
    - Learner consumes the keydown and the late keyup; unconsumed events reach every handler; listener added on first `add` and removed after the last unsubscribe
    - _Requirements: 5.5_

- [x] 7. Implement the Blink_Detector
  - [x] 7.1 Implement `src/lib/input/blink/detector.ts`
    - `BlinkFrame`, `RawBlinkFrame`, `normalizeFrame()`, `DetectorConfig`, `DEFAULT_DETECTOR_CONFIG`, `validateThresholds()`, `createBlinkDetector()` with `push`, `reset`, `eyeState`, `setThresholds`, `setMinPressDuration`; hysteresis drives the single owned blink Debouncer (`rawDown` on close, `advance` on each closed frame, `advance` then `rawUp` on open or face lost); face status starts `'active'` and is reported only on change
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.16, 3.3_
  - [x]* 7.2 Write unit tests in `blink/detector.test.ts`
    - Defaults; 150 ms natural blink rejected; 250 ms closure gives `down` at start and `up` at end; threshold change mid-Closure keeps the Closure; `reset` discards a Closure
    - _Requirements: 8.4, 8.5, 8.6, 8.12_
  - [x] 7.3 Write property test for blink hysteresis
    - **Property 8: Blink hysteresis**
    - File `blink/detector.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.7, 8.14**
  - [x] 7.4 Write property test for minimum closure
    - **Property 9: Minimum closure**
    - Add `closuresFromFrames` and the frame arbitraries to `test-support.ts`; file `blink/detector.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 8.4, 8.5, 8.6, 8.15**
  - [x] 7.5 Write property test for face status reports
    - **Property 10: Face status reports are deduplicated and correct**
    - File `blink/detector.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 8.8, 8.9, 8.16**
  - [x] 7.6 Write property test for invalid and stale frames
    - **Property 11: Invalid and stale frames**
    - File `blink/detector.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 8.10, 8.11**
  - [x] 7.7 Write property test for threshold validation
    - **Property 7: Invalid settings are rejected and leave the previous values in effect** (threshold half)
    - File `blink/detector.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 8.12, 8.13**
  - [x] 7.8 Write property test for pipeline determinism
    - **Property 17: Determinism, input-only timestamps and no mutation**
    - Add `runPipeline(config, script)` (pure Debouncers and Blink_Detector folded through `arbiterStep`) to `test-support.ts`; file `pipeline.prop.test.ts`; deep-freeze and `structuredClone` checks; `numRuns: 200` or more
    - **Validates: Requirements 1.8, 11.2, 11.4, 11.5**

- [x] 8. Checkpoint - pure core
  - Ensure all tests pass (`bun run test`, `bun run typecheck`), ask the user if questions arise.

- [x] 9. Implement the shared source core and settings
  - [x] 9.1 Implement `src/lib/input/source-base.ts`
    - `PageLifecycle`, `SourceCore`, `createSourceCore()`: snapshot delivery with `try/catch` per listener, status dedupe, `feed()` that emits events and keeps the confirmation timer (`schedule(deadline − clock())`, reschedule when it fires early, cancel on leaving `pending`) and pending listeners in sync; idempotent `endPress()` (`cancel()` then `forceUp(clock())`) that leaves status unchanged; no timer when the scheduler is `null` (blink)
    - _Requirements: 1.4, 1.5, 1.7, 1.8, 1.10, 3.3, 7.1, 7.2, 7.3, 7.5, 7.7, 7.8, 10.10_
  - [x]* 9.2 Write unit tests in `source-base.test.ts`
    - Unsubscribe during delivery; throwing subscriber does not stop others; repeated status report delivers once; early timer reschedules; `endPress()` twice emits one `up`
    - _Requirements: 1.7, 1.10, 7.7, 10.10_
  - [x] 9.3 Implement `src/lib/input/settings.ts`
    - `StoreError`, `SettingsStore`, `InputSettings`, `DEFAULT_INPUT_SETTINGS`, `validateInputSettings()` reusing `validateMinPressDuration` and `validateThresholds`
    - _Requirements: 3.8, 5.7, 5.8, 8.13_
  - [x]* 9.4 Write unit tests in `settings.test.ts`
    - Defaults validate; each out-of-range field is named in the errors
    - _Requirements: 3.8, 8.13_
  - [x] 9.5 Add fake browser targets to `test-support.ts`
    - `FakeKeyTarget`, `FakeSurface` (capture success or failure, style restore), `FakeDocPointer`, `FakePage`, `FakeStore`, each counting live listeners and timers so tests can assert zero after `stop()`
    - _Requirements: 1.4, 11.6_

- [x] 10. Implement the Keyboard_Source
  - [x] 10.1 Implement `createKeyboardSource()` in `src/lib/input/keyboard.ts`
    - Codes `{Space, Enter, NumpadEnter}`, keyboard focus rule, registers a `KeyHandler` with the router on `start()` and removes it on `stop()`; blur and hide call `endPress()` and `abandonActive`; `setMinPressDuration`
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x]* 10.2 Write unit tests in `keyboard.test.ts`
    - Clock-driven confirmation through the manual scheduler; early timer reschedule; `preventDefault` calls per event; blur while held emits one `up` at the Clock; stop while pending emits nothing
    - _Requirements: 3.3, 4.5, 7.1, 7.3_

- [x] 11. Implement the Switch_Source and Switch_Learner
  - [x] 11.1 Implement `src/lib/input/switch.ts`
    - `RESERVED_KEYS`, `isReservedKey()`, `validateSwitchKey()`, `createSwitchSource()`: reads the store once on `start()` without writing, uses the switch focus rule, empty code set when no key, `setLearnedKey()` ends a Held press with `rawUp(clock())` and `abandonActive` before replacing codes
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 4.9, 5.7, 5.8, 5.9, 5.10, 5.11, 5.13, 7.1, 7.2, 7.3_
  - [x]* 11.2 Write unit tests in `switch.test.ts`
    - Store read once; no key gives no presses; key change and clear while Held end the press and swallow the old `keyup`; learned key on a button keys Morse; learned key in a text field is left native
    - _Requirements: 5.7, 5.9, 5.10, 5.11, 5.13_
  - [x] 11.3 Write property test for stored switch keys
    - **Property 16: Stored switch keys are validated without writing**
    - File `switch.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 5.8**
  - [x] 11.4 Implement `src/lib/input/switch-learner.ts`
    - `LearnError`, `createSwitchLearner()`: `arm()` returns a never-rejecting promise with no timeout, re-arm resolves the earlier promise `cancelled`, `offer()` follows the design table, `cancel()`, `clear()` (clears the key in use even when the store fails); registers itself with `router.setLearner`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.12_
  - [x]* 11.5 Write unit tests in `switch-learner.test.ts`
    - Space, Enter and NumpadEnter fail with `reserved-input`; Tab, Escape and repeat stay armed without `preventDefault`; cancel; clear; store write failure keeps the previous key in use and stored; re-arm cancels the earlier promise
    - _Requirements: 5.2, 5.3, 5.4, 5.6, 5.12_
  - [x] 11.6 Write property test for the learning press
    - **Property 15: The learning press never keys Morse**
    - Wire a router, Keyboard_Source, Switch_Source and learner over `FakeKeyTarget` and `FakeStore`; file `switch-learner.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 5.1, 5.5**

- [x] 12. Implement the Pointer_Source
  - [x] 12.1 Implement `src/lib/input/pointer.ts`
    - `PointerEventLike`, `SurfaceElement`, `DocumentPointerTarget`, pure `pointerDown()` and `pointerEnd()`, and `createPointerSource()`: surface resolved at `start()`, capture with document fallback listeners on failure, `contextmenu` prevented, `applyNoGestureStyle()` while active and restored on stop, `stop()` while held releases capture then `forceUp`
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 7.1, 7.2, 7.3, 7.4_
  - [x]* 12.2 Write unit tests in `pointer.test.ts`
    - Context menu prevented; gesture styles applied and restored; listeners only on the surface; capture failure falls back to the document; right click and non-primary pointers ignored; `lostpointercapture` then `pointerup` gives one Raw_Up
    - _Requirements: 6.2, 6.4, 6.6, 6.7, 6.8, 6.11_
  - [x] 12.3 Write property test for the source lifecycle contract
    - **Property 14: Source lifecycle contract**
    - One `fc.assert` drawing `'keyboard' | 'switch' | 'pointer'`; fake targets, manual Clock and Scheduler from `test-support.ts`; file `sources.prop.test.ts`; `numRuns: 200` or more
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.6, 1.7, 1.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.9, 6.10, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8**

- [x] 13. Implement the DOM browser adapter
  - [x] 13.1 Implement `src/lib/input/browser.ts`
    - `performanceClock`, `browserScheduler`, `browserPage()` (window `blur`, document `visibilitychange`), `windowKeyTarget()` (capture phase), `surfaceElement()` (capture calls in `try/catch`, style save and restore), `documentPointerTarget()`, `describeElement()`
    - _Requirements: 4.1, 4.8, 6.7, 6.11, 7.1, 7.2, 11.6_
  - [x]* 13.2 Write jsdom tests in `browser.test.ts`
    - `describeElement` for contenteditable descendants, inputs inside an open `dialog`, body and null; key listeners registered in capture phase; `surfaceElement` returns `false` when capture throws
    - _Requirements: 4.8, 6.11_

- [x] 14. Implement the Blink_Source and its browser adapter
  - [x] 14.1 Implement `src/lib/input/blink/source.ts`
    - `CameraStream`, `FrameLoop`, `Landmarker`, `BlinkDevices`, `createBlinkSource()`: `attempt` token guarding every async step; `'unsupported'` without `'starting'`; camera first, then the 30 000 ms readiness timer, then the Landmarker; error-name mapping; `fail(status)` releasing everything before reporting; synchronous hide with `resumeOnVisible`; blur ignored; frames ignored while `'starting'`; face reports mapped to `'face-lost'`/`'active'`; `stop()` from any status; every promise handled
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.8, 7.2, 7.6, 9.2, 9.5, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10_
  - [x]* 14.2 Write unit tests in `blink/source.test.ts`
    - Controllable promises: `'starting'` then `'active'` once; stop while starting with a late camera; hide releases tracks synchronously and visible reopens; 30 s timeout excludes the permission wait; face lost and back; each failure mapping; late model after timeout closed; failure while Held emits one `up` first; failure status sticky across visibility; retry and stop from failure; blur ignored; an `unhandledRejection` listener fails the test
    - _Requirements: 7.6, 9.2, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 10.1 to 10.10_
  - [x] 14.3 Implement `src/lib/input/blink/browser.ts`
    - `browserBlinkDevices({ assetBase = '/mediapipe/1.2.2' })`: `isSupported`; `openCamera` with the design's constraints and an off-DOM muted `playsinline` video; `loadLandmarker` through `await import('@mediapipe/tasks-vision')` only, `forVisionTasks(`${assetBase}/wasm`)`, VIDEO mode, `numFaces: 1`, `outputFaceBlendshapes: true`, GPU then one CPU retry, no fallback URL; `detect` reading `eyeBlinkLeft`/`eyeBlinkRight` of the first face and skipping non-increasing timestamps; `startFrames` with `requestVideoFrameCallback` (capture time, expected display time, then `now`) and a `requestAnimationFrame` fallback; no logging, storage or `fetch`
    - _Requirements: 9.1, 9.3, 9.4, 9.5, 9.6, 9.7, 11.6, 11.7_
  - [x]* 14.4 Write unit tests in `blink/browser.test.ts`
    - `vi.mock('@mediapipe/tasks-vision')` and fake `getUserMedia`, `requestVideoFrameCallback`, `WebAssembly`: no import or camera call before `loadLandmarker`/`openCamera`; same-origin asset paths; VIDEO mode and blendshapes; missing category gives lost; timestamps passed through and non-increasing ones skipped; tracks `'ended'` after stop
    - _Requirements: 9.1, 9.3, 9.4, 9.5, 9.7_

- [x] 15. Wire the barrel and the hook
  - [x] 15.1 Implement `src/lib/input/index.ts`
    - Re-export the public types and functions listed in the design; do not re-export `browser.ts`, `blink/browser.ts` or `test-support.ts`. If an ESLint config exists, add a `no-restricted-globals`/`no-restricted-imports` override for the pure modules.
    - _Requirements: 1.2, 11.1, 11.6_
  - [x] 15.2 Implement `src/hooks/useInputSources.ts`
    - `'use client'`; build clock, scheduler, page, router, the four sources, learner and arbiter once per mount; connect every source; forward `arbiter.onOutput` through a ref; one effect per `enabled` flag calling `start()`/`stop()`; settings effect calling the setters; statuses mirrored into state; `pendingSince` exposed as a function plus `onPendingChange`; unmount stops and disconnects everything; blink never started on mount unless enabled
    - _Requirements: 1.2, 2.13, 9.1, 10.8_
  - [x]* 15.3 Write jsdom tests in `src/hooks/useInputSources.test.tsx`
    - Enabled flags start and stop sources; Space on the body reaches `onPress` in order; `pendingSince` is live; unmount leaves no listeners; blink not started on mount and MediaPipe not imported
    - _Requirements: 2.13, 9.1_
  - [x]* 15.4 Write `src/lib/input/purity.test.ts`
    - Pure modules (`debounce.ts`, `arbiter.ts`, `focus.ts`, `key-machine.ts`, `blink/detector.ts`) contain none of the identifiers banned by Req 11.1 and no forbidden imports; no `console.` or `fetch(` anywhere in `src/lib/input` or the hook; only `blink/browser.ts` references `@mediapipe/tasks-vision` outside `import type`
    - _Requirements: 9.1, 9.6, 11.1, 11.6, 11.7_

- [x] 16. Checkpoint - full suite and type check
  - Run `bun run test` and `bun run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Manual verification on real hardware
  - Follow the design's "Manual test checklist" on a production build (`bun run build`, then `bunx next start`). Record results in the PR description. This task is not performed by a coding agent.
  - [ ] 17.1 Real switch checklist
    - Space switch keys `.-`; learning a non-reserved key keys no dot; learned switch keys Morse on a focused button while Space activates it; text field keeps both native; Alt-Tab while holding ends the press; Bluetooth switch repeat with latency noted
    - _Requirements: 4.1, 4.6, 4.9, 5.1, 5.5, 5.11, 7.1_
  - [ ] 17.2 Touch tablet checklist (iPad Safari and Android Chrome, both orientations)
    - Short tap and 2 s hold give dot and dash with no selection, callout, context menu, scroll or zoom; slide off and lift ends the press; second finger ignored; sub-30 ms tap ignored; app switch while holding ends the press
    - _Requirements: 3.4, 6.1, 6.2, 6.3, 6.6, 6.7, 7.2_
  - [ ] 17.3 Webcam checklist
    - No `/mediapipe/` request or camera prompt before enabling; `'starting'` then `'active'` with only same-origin requests; natural blinks ignored, 0.3 s and 1 s closures give dot and dash; face lost and back; denied permission and no camera statuses with keyboard still working; hidden tab turns the camera off within 0.5 s and visible reopens; disabling turns the camera off; no frame data in network, `localStorage` or console
    - _Requirements: 8.6, 9.1, 9.3, 9.6, 9.7, 9.9, 9.10, 9.12, 9.13, 10.2, 10.3_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Core implementation tasks are never optional.
- Every property sub-task uses `numRuns` of at least 200 and carries the tag comment `// Feature: input-sources, Property N: <title>`. Property 7 is split across `debounce.prop.test.ts` (3.5) and `blink/detector.prop.test.ts` (7.7) with the same tag.
- Tests under `src/lib/input/` run in the `node` environment with plain fakes. Only `browser.test.ts` and `useInputSources.test.tsx` use jsdom.
- No automated test uses a real camera, the MediaPipe runtime or the network.
- Task 17 is manual hardware verification requested for this spec; it is outside what a coding agent can run.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2"] },
    { "id": 2, "tasks": ["1.3", "2.3", "2.4", "3.1", "4.1", "5.1", "6.4"] },
    { "id": 3, "tasks": ["3.2", "4.2", "5.2", "5.3", "6.1", "6.5", "7.1", "9.1"] },
    { "id": 4, "tasks": ["3.3", "4.3", "6.2", "6.3", "7.2", "9.2", "9.3", "12.1", "14.1"] },
    { "id": 5, "tasks": ["3.4", "4.4", "7.3", "9.4", "10.1", "11.1", "14.3"] },
    { "id": 6, "tasks": ["3.5", "4.5", "9.5", "11.4", "13.1"] },
    { "id": 7, "tasks": ["4.6", "7.4", "10.2", "11.2", "11.3", "12.2", "13.2", "14.2", "14.4", "15.1"] },
    { "id": 8, "tasks": ["4.7", "7.5", "11.5", "12.3", "15.2"] },
    { "id": 9, "tasks": ["7.6", "7.8", "11.6", "15.3"] },
    { "id": 10, "tasks": ["7.7", "15.4"] },
    { "id": 11, "tasks": ["17.1", "17.2", "17.3"] }
  ]
}
```


## Review corrections: delayed blink frames and permission resume (review, 2026-11-11)

These corrections supersede earlier conflicting criteria in this document.

- [x] 19.1 Clamp blink events to the receiving engine last input time so delayed video timestamps never cause a press/release to be ignored as in the past.
  - Verified: `session-controller.prop.test.ts (real-engine delayed blink)`.
- [x] 19.2 Saved blink choice may resume without another partner action only when camera permission is already granted; never request camera access automatically for prompt/denied/unknown permission.
  - Verified: `SafetyNotices.test.tsx (granted/prompt/denied/unsupported)`.
