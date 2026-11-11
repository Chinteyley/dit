# Requirements Document

## Introduction

Input sources is the layer of Dit, in `src/lib/input/`, that turns one reliable movement into a single stream of timestamped press and release events. The movement can be a Space or Enter key press, a USB or Bluetooth switch that emulates a key, a pointer press on the keying surface, or an opt-in webcam blink. The stream feeds the Morse engine (spec `morse-engine`), which calls `press(t)` for each `down` event and `release(t)` for each `up` event.

This spec covers the Press_Source contract, the Press_Event shape, the Input_Arbiter that merges sources, the per-source debounce, the keyboard, switch, pointer and blink sources, the switch-key learning step, and the statuses each source reports. It does not cover Morse decoding, dot/dash classification, gap detection, calibration, or any UI layout. The engine owns those. The conversation layer owns where settings are stored and how statuses are shown.

Pure logic (the Input_Arbiter, the Debouncer, the Blink_Detector, key and target classification) has no DOM, React or real-clock dependency. Time comes from an injected Clock or from video frame timestamps, so the same inputs always produce the same outputs. Browser adapters (DOM listeners, `getUserMedia`, MediaPipe) sit behind small interfaces so tests use fakes.

Sources of truth: `docs/BRIEF.md`, `.kiro/steering/product.md`, `.kiro/steering/tech.md`, `.kiro/steering/structure.md`, `.kiro/steering/accessibility.md`, and `.kiro/steering/morse-engine.md` (which states that debouncing very short presses is the input layer's job).

## Glossary

- **Input_Layer**: The modules under `src/lib/input/` specified here.
- **Clock**: An injected function that returns the current time in milliseconds as a finite number, in the same time base for every source (the browser adapter uses `performance.now()`).
- **Press_Event**: A value `{ kind: 'down' | 'up', t: number, source: Source_Kind }`, where `t` is a timestamp in milliseconds in the Clock's time base.
- **Source_Kind**: One of `'keyboard'`, `'switch'`, `'pointer'`, `'blink'`.
- **Press_Source**: An object that implements the shared source contract: `start()`, `stop()`, a subscription that delivers Press_Events, and a subscription that delivers Source_Status changes, plus read access to the current Source_Status.
- **Source_Status**: The state a Press_Source reports, one of `'off'`, `'starting'`, `'active'`, `'face-lost'`, `'permission-denied'`, `'no-camera'`, `'unsupported'`, `'error'`. Only the Blink_Source uses `'starting'`, `'face-lost'`, `'permission-denied'`, `'no-camera'`, `'unsupported'` and `'error'`.
- **Held**: The state of a Press_Source, or of the Input_Arbiter, between an emitted `down` Press_Event and the matching `up` Press_Event.
- **Input_Arbiter**: The pure component that receives Press_Events from every enabled Press_Source and emits one merged Press_Event stream.
- **Holder**: The Source_Kind whose `down` Press_Event the Input_Arbiter most recently emitted while the Input_Arbiter is Held.
- **Output_Stream**: The ordered list of Press_Events emitted by the Input_Arbiter.
- **Debouncer**: The pure component, one instance per Press_Source, that withholds a press until the press has lasted Min_Press_Duration.
- **Min_Press_Duration**: The per-source debounce length in milliseconds. Defaults: keyboard 30 ms, switch 30 ms, pointer 30 ms, blink 200 ms. Valid range: 0 to 500 ms for keyboard, switch and pointer; 50 to 2000 ms for blink.
- **Raw_Down / Raw_Up**: The unfiltered start and end of a physical press as seen by a source adapter (a key going down or up, a pointer going down or up, an eye closure starting or ending), each with a timestamp.
- **Pending_Press**: A Raw_Down that the Debouncer has received but not yet confirmed, because the press has not yet lasted Min_Press_Duration.
- **Confirmed_Press**: A press that has lasted at least Min_Press_Duration since its Raw_Down.
- **Keyboard_Source**: The Press_Source that treats the Space and Enter keys as the input. Emits Source_Kind `'keyboard'`.
- **Switch_Source**: The Press_Source that treats the Learned_Switch_Key as the input. Emits Source_Kind `'switch'`.
- **Learned_Switch_Key**: The `KeyboardEvent.code` value recorded by the Switch_Learner, or none.
- **Switch_Learner**: The component that, when armed by the partner, records the `KeyboardEvent.code` of the next key press as the Learned_Switch_Key.
- **Reserved_Key**: The key codes `Space`, `Enter`, `NumpadEnter`, `Tab` and `Escape`. Space and Enter variants already belong to the Keyboard_Source; Tab and Escape stay free for partner keyboard navigation and closing dialogs.
- **Settings_Store**: An injected interface with which the Input_Layer reads and writes the Learned_Switch_Key and the per-source settings. The conversation layer implements the store and validates stored values with Zod.
- **Editable_Target**: A focused element that is an `input` element whose type accepts text entry (`text`, `search`, `email`, `url`, `tel`, `password`, `number`, and inputs with no type), a `textarea`, a `select`, an element with `contenteditable` set to a true value or a descendant of such an element, or any `input`, `select` or `textarea` element inside an open `dialog` element.
- **Keying_Surface**: The single large on-screen element that accepts pointer presses. The UI spec owns its appearance.
- **Pointer_Source**: The Press_Source that treats a primary pointer press on the Keying_Surface as the input. Emits Source_Kind `'pointer'`.
- **Blink_Source**: The opt-in Press_Source that treats a deliberate eye closure, detected from webcam video, as the input. Emits Source_Kind `'blink'`.
- **Face_Landmarker**: The MediaPipe Face Landmarker from `@mediapipe/tasks-vision`, run on-device with blendshape output enabled.
- **Blink_Frame**: The pure input to the Blink_Detector for one processed video frame: either `{ t, left, right }` where `left` is the `eyeBlinkLeft` blendshape score and `right` is the `eyeBlinkRight` score, or `{ t, face: 'lost' }` when the Face_Landmarker found no face. `t` is the frame's timestamp in the Clock's time base.
- **Blink_Detector**: The pure hysteresis component that converts a sequence of Blink_Frames into Press_Events and face status changes.
- **Close_Threshold**: The blendshape score at or above which both eyes count as closed. Default 0.5.
- **Open_Threshold**: The blendshape score below which both eyes count as open. Default 0.35.
- **Eye_State**: The Blink_Detector's state: `open` or `closed`.
- **Closure**: The interval from the Blink_Frame that moves Eye_State to `closed` until the Blink_Frame that moves Eye_State to `open`, or until the face is lost.
- **Self_Hosted_Assets**: The Face_Landmarker model file and the MediaPipe WebAssembly files, served from the app's own origin under `/public`.
- **Page_Hidden**: The state in which `document.visibilityState` is `'hidden'`.
- **Result**: A discriminated union `{ ok: true, value } | { ok: false, error }` used for operations that can fail.

## Requirements

### Requirement 1: Press_Event and Press_Source contract

**User Story:** As a developer wiring the Morse engine, I want every input to share one event shape and one source contract, so that the engine and UI treat all inputs the same way.

#### Acceptance Criteria

1. THE Input_Layer SHALL represent every press boundary as a Press_Event with exactly the three fields `kind` (`'down'` or `'up'`), `t` (a finite number of milliseconds, never `NaN` or `±Infinity`) and `source` (a Source_Kind equal to the Source_Kind of the Press_Source that emitted it), and with no other fields.
2. THE Input_Layer SHALL expose the Keyboard_Source, Switch_Source, Pointer_Source and Blink_Source through the Press_Source contract, so that the Input_Arbiter accepts any of them without source-specific code.
3. WHEN `start()` is called on a Press_Source whose Source_Status is `'off'`, including a Press_Source that was previously started and stopped, THE Press_Source SHALL begin listening for its input and, before `start()` returns, report Source_Status `'active'` for the Keyboard_Source, Switch_Source and Pointer_Source, or Source_Status `'starting'` for the Blink_Source.
4. WHEN `stop()` is called on a Press_Source whose Source_Status is not `'off'`, THE Press_Source SHALL, before `stop()` returns, remove every listener and timer it registered, release every device it opened, discard any Pending_Press without emitting a Press_Event for it, report Source_Status `'off'`, and emit no further Press_Event until `start()` is called again.
5. WHEN `stop()` is called on a Press_Source that is Held, THE Press_Source SHALL emit exactly one `up` Press_Event, with `t` equal to the Clock value at the moment of the call, before reporting Source_Status `'off'`.
6. IF `start()` is called on a Press_Source whose Source_Status is not `'off'`, or `stop()` is called on a Press_Source whose Source_Status is `'off'`, THEN THE Press_Source SHALL treat the call as having no effect, emitting no Press_Event, reporting no Source_Status change, and registering or releasing no listener, timer or device.
7. WHEN a Press_Source's Source_Status changes to a value different from its current Source_Status, THE Press_Source SHALL deliver the new Source_Status exactly once to every status subscriber registered at that moment, and SHALL deliver nothing when a report would leave the Source_Status unchanged.
8. THE Keyboard_Source, Switch_Source and Pointer_Source SHALL take every Press_Event timestamp from the injected Clock, and THE Blink_Source SHALL take every Press_Event timestamp from the `t` of the Blink_Frame that caused it, except for the `up` Press_Event emitted by `stop()` under criterion 5.
9. THE Press_Source SHALL emit Press_Events that strictly alternate between `down` and `up`, starting with `down` after each `start()`, with each Press_Event's `t` greater than or equal to the `t` of the previous Press_Event from the same Press_Source.
10. WHEN a Press_Event or Source_Status subscriber unsubscribes, THE Press_Source SHALL deliver no further Press_Events or Source_Status changes to that subscriber, and SHALL keep delivering to every other subscriber unchanged.

### Requirement 2: Input_Arbiter merging and alternation

**User Story:** As a speaker who may have more than one input enabled, I want the inputs merged into one clean stream, so that overlapping presses from two inputs never confuse the engine.

#### Acceptance Criteria

1. WHEN the Input_Arbiter receives a `down` Press_Event with a finite `t` while the Input_Arbiter is not Held, and the event's `t` is greater than or equal to the `t` of the last Press_Event in the Output_Stream (or the Output_Stream is empty), THE Input_Arbiter SHALL append that Press_Event unchanged to the Output_Stream, set the Holder to the event's `source`, and enter the Held state.
2. IF the Input_Arbiter receives a `down` Press_Event from a source other than the Holder while the Input_Arbiter is Held, THEN THE Input_Arbiter SHALL discard the event and mark that source so that the next `up` Press_Event from that source is discarded, holding at most one such mark per source no matter how many `down` Press_Events that source sends.
3. IF the Input_Arbiter receives a `down` Press_Event from the Holder while the Input_Arbiter is Held, THEN THE Input_Arbiter SHALL discard the event without marking the Holder, so that the Holder's next `up` Press_Event still ends the Held state.
4. WHEN the Input_Arbiter discards an `up` Press_Event from a source marked under criterion 2, THE Input_Arbiter SHALL clear that source's mark, so that the source's later `down` Press_Events are handled by criteria 1 to 3.
5. WHEN the Input_Arbiter receives an `up` Press_Event with a finite `t` from the Holder while the Input_Arbiter is Held, THE Input_Arbiter SHALL append an `up` Press_Event with `source` equal to the Holder to the Output_Stream, leave the Held state, and clear the Holder.
6. IF the Input_Arbiter receives an `up` Press_Event from a source that is not the Holder, or while the Input_Arbiter is not Held, THEN THE Input_Arbiter SHALL discard the event and leave the Output_Stream, the Held state and the Holder unchanged.
7. IF the Input_Arbiter receives an `up` Press_Event with a finite `t` from the Holder, and that `t` is less than the `t` of the last Press_Event in the Output_Stream, THEN THE Input_Arbiter SHALL append the `up` Press_Event with `t` set to the `t` of the last Press_Event in the Output_Stream.
8. IF the Input_Arbiter receives a `down` Press_Event whose `t` is less than the `t` of the last Press_Event in the Output_Stream, or any Press_Event whose `t` is `NaN`, `Infinity` or `-Infinity`, THEN THE Input_Arbiter SHALL discard the event and leave the Output_Stream, the Held state, the Holder and every source mark unchanged.
9. WHEN the Holder Press_Source is stopped or removed from the Input_Arbiter while the Input_Arbiter is Held, and the Holder has not already delivered its `up` Press_Event, THE Input_Arbiter SHALL append exactly one `up` Press_Event with `source` equal to the Holder and `t` equal to the larger of the Clock value at that moment and the `t` of the last Press_Event in the Output_Stream, then leave the Held state. If the stopping Press_Source emits its own `up` Press_Event (Requirement 1, criterion 5), THE Input_Arbiter SHALL append only that `up` and no second one.
10. WHEN a Press_Source that is not the Holder is stopped or removed from the Input_Arbiter, THE Input_Arbiter SHALL clear that source's mark from criterion 2 and leave the Output_Stream unchanged.
11. FOR ALL sequences of Press_Events from any mix of Source_Kinds, THE Input_Arbiter SHALL produce an Output_Stream that is empty or starts with a `down` Press_Event, strictly alternates `down` and `up`, has non-decreasing finite `t` values, and gives each `up` Press_Event the same `source` as the `down` Press_Event directly before it (alternation property).
12. FOR ALL sequences of Press_Events in which only one Source_Kind appears, the first event is a `down`, the events strictly alternate `down` and `up`, and every `t` is finite and non-decreasing, THE Input_Arbiter SHALL produce an Output_Stream equal to the input sequence, with every field of every event unchanged (single-source pass-through property).
13. THE Input_Arbiter SHALL expose, for its consumer, whether any connected Debouncer holds a Pending_Press and, if one does, the earliest Raw_Down timestamp among all Pending_Presses. This lets the consumer avoid advancing engine time past the timestamp of a `down` Press_Event that has not been emitted yet. When no Pending_Press exists, THE Input_Arbiter SHALL report none.

### Requirement 3: Per-source debounce

**User Story:** As a speaker whose switch chatters or whose hand trembles, I want very short contacts ignored, so that accidental touches do not become dots.

#### Acceptance Criteria

1. THE Debouncer SHALL apply the Min_Press_Duration configured for its own Press_Source, independently of every other Press_Source, so that changing one Press_Source's Min_Press_Duration does not change the `down`/`up` Press_Events emitted by any other Press_Source's Debouncer.
2. WHEN the Debouncer receives a Raw_Down while no Pending_Press or Confirmed_Press exists, THE Debouncer SHALL record a Pending_Press with the Raw_Down's timestamp and emit no Press_Event.
3. WHEN a Pending_Press reaches Min_Press_Duration, THE Debouncer SHALL emit exactly one `down` Press_Event whose `t` equals the Raw_Down's timestamp and SHALL mark the press as a Confirmed_Press. For the Keyboard_Source, Switch_Source and Pointer_Source, "reaches" means the Clock returns a value greater than or equal to `Raw_Down t + Min_Press_Duration`. For the Blink_Source, it means the Debouncer receives the first Blink_Frame whose `t` is greater than or equal to `Raw_Down t + Min_Press_Duration`.
4. IF the Debouncer receives a Raw_Up for a Pending_Press whose duration (`Raw_Up t − Raw_Down t`) is less than Min_Press_Duration, THEN THE Debouncer SHALL discard the Pending_Press, emit no Press_Event for that press, and return to the state where no Pending_Press or Confirmed_Press exists.
5. WHEN the Debouncer receives a Raw_Up for a Confirmed_Press, THE Debouncer SHALL emit exactly one `up` Press_Event whose `t` equals the Raw_Up's timestamp and SHALL return to the state where no Pending_Press or Confirmed_Press exists.
6. WHEN the Debouncer receives a Raw_Up for a Pending_Press whose duration is greater than or equal to Min_Press_Duration and the `down` Press_Event has not yet been emitted, THE Debouncer SHALL emit the `down` Press_Event with the Raw_Down's timestamp, then the `up` Press_Event with the Raw_Up's timestamp, in that order, and SHALL return to the state where no Pending_Press or Confirmed_Press exists.
7. WHERE Min_Press_Duration is 0 ms, THE Debouncer SHALL emit the `down` Press_Event, with `t` equal to the Raw_Down's timestamp, synchronously while processing that Raw_Down, and SHALL mark the press as a Confirmed_Press without recording a Pending_Press.
8. IF a Min_Press_Duration is supplied that is outside the inclusive valid range for its Source_Kind (0 to 500 ms for keyboard, switch and pointer; 50 to 2000 ms for blink) or that is not a finite number, THEN THE Input_Layer SHALL return a failed Result that names the Source_Kind and the invalid setting, and SHALL keep the previous Min_Press_Duration. WHEN a valid Min_Press_Duration is supplied while a Pending_Press or Confirmed_Press exists, THE Debouncer SHALL keep using the previous value for that press and SHALL apply the new value starting with the next Raw_Down.
9. IF the Debouncer receives a Raw_Down while a Pending_Press or Confirmed_Press already exists, THEN THE Debouncer SHALL ignore that Raw_Down, emit no Press_Event, and keep the existing press and its original Raw_Down timestamp unchanged.
10. IF the Debouncer receives a Raw_Up while no Pending_Press or Confirmed_Press exists, THEN THE Debouncer SHALL ignore that Raw_Up and emit no Press_Event.
11. IF the Debouncer receives a Raw_Up whose timestamp is earlier than the timestamp of the current Pending_Press's or Confirmed_Press's Raw_Down, THEN THE Debouncer SHALL treat the Raw_Up as if its timestamp equals the Raw_Down's timestamp (duration 0 ms) and SHALL apply criteria 4, 5 and 6 to it unchanged.
12. FOR ALL sequences of Raw_Down and Raw_Up inputs to one Debouncer, THE Debouncer SHALL emit Press_Events that strictly alternate `down`, `up`, `down`, `up`, starting with `down`. Every emitted pair SHALL have a duration (`up t − down t`) greater than or equal to Min_Press_Duration. THE Debouncer SHALL emit exactly one pair for every accepted Raw_Down and matching Raw_Up whose duration is greater than or equal to Min_Press_Duration (debounce property).

### Requirement 4: Keyboard_Source (Space and Enter)

**User Story:** As a speaker who can press one key, I want Space or Enter to key Morse, so that I can use a standard keyboard or a switch interface that sends those keys.

#### Acceptance Criteria

1. WHEN a `keydown` event with `code` `Space`, `Enter` or `NumpadEnter` and `repeat` false occurs, the Keyboard_Source is not Held, and the focused element (`document.activeElement`) is a Keying_Target, THE Keyboard_Source SHALL pass a Raw_Down with the Clock's current time to its Debouncer. In this requirement, a Keying_Target is any of the following: the document body; no focused element (`document.activeElement` is null); the Keying_Surface, even if the Keying_Surface has an interactive ARIA role or a `tabindex`; or any other element that is not an Interactive_Target. An Interactive_Target is any of the following: a `button` element; an `a` or `area` element with an `href` attribute; an `input` element of any type except `hidden`; a `select`, `textarea` or `summary` element; any Editable_Target; or an element whose `role` attribute is one of `button`, `link`, `checkbox`, `radio`, `switch`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `option`, `tab`, `textbox`, `searchbox`, `combobox`, `slider`, `spinbutton`, `listbox` or `treeitem`.
2. WHEN a `keyup` event occurs for the same key code that started the current press, THE Keyboard_Source SHALL pass a Raw_Up with the Clock's current time to its Debouncer and call `preventDefault()` on the event. This applies whichever element has focus at the time of the `keyup`, so a press always ends even if focus moved while the key was down.
3. IF a `keydown` event has `repeat` set to true, THEN THE Keyboard_Source SHALL pass no Raw_Down. If the event's `code` is the key holding the current press, THE Keyboard_Source SHALL also call `preventDefault()` on it.
4. IF a `keydown` event for Space, Enter or NumpadEnter occurs while a different one of those keys is holding the current press, THEN THE Keyboard_Source SHALL pass no Raw_Down for that keydown and no Raw_Up for the matching keyup. The current press SHALL stay Held until the key that started it is released.
5. WHEN the Keyboard_Source passes a Raw_Down for a `keydown` event for Space, Enter or NumpadEnter, or ignores such an event under criterion 3 or 4 while the focused element is a Keying_Target, THE Keyboard_Source SHALL call `preventDefault()` on the event, so that Space does not scroll the page and Enter does not activate anything.
6. IF a `keydown` event for Space, Enter or NumpadEnter occurs while the focused element is an Interactive_Target other than the Keying_Surface, THEN THE Keyboard_Source SHALL pass no Raw_Down and SHALL NOT call `preventDefault()` on that event or its matching `keyup`. The control keeps its native keyboard behavior, for example activating a button or link, toggling a checkbox, or typing a space into a text field.
7. IF a `keyup` event occurs for a key whose `keydown` the Keyboard_Source ignored, THEN THE Keyboard_Source SHALL pass no Raw_Up.
8. THE Keyboard_Source SHALL classify the focused element with a pure function. The function takes a description of the element: whether it is the body or absent, whether it is the Keying_Surface, its tag name, its input type, whether it has an `href`, its contenteditable state including inherited state, its `role` attribute, and whether it is inside an open `dialog`. The function SHALL return exactly one of `'keying'` (Keying_Target), `'editable'` (Editable_Target) or `'interactive'` (any other Interactive_Target). It SHALL return `'keying'` for the Keying_Surface before it checks any other rule.
9. WHERE Requirement 5 criterion 9 applies criteria 1 to 7 of this requirement to the Learned_Switch_Key, THE Switch_Source SHALL replace the Keying_Target and Interactive_Target conditions with one condition: the focused element is not an Editable_Target, meaning the classification function does not return `'editable'`. A learned switch key therefore keys Morse, with `preventDefault()` called, even when focus is on a button, link or other non-editable Interactive_Target.

**Dependency (conversation-ui spec):** After a partner activates a control, the UI must return focus to the Keying_Surface, so that the next Space or Enter press keys Morse again. This spec relies on that behavior but does not require it.

### Requirement 5: Switch_Source and switch-key learning

**User Story:** As a speaker with a USB or Bluetooth switch, I want the app to learn whichever key my switch sends, so that my switch works without remapping it.

#### Acceptance Criteria

1. WHEN the partner arms the Switch_Learner and a `keydown` event with `repeat` false occurs whose `code` is a non-empty string that is not a Reserved_Key, THE Switch_Learner SHALL call `preventDefault()` on the event, record that `code` as the Learned_Switch_Key, write the Learned_Switch_Key to the Settings_Store, disarm, and return a successful Result containing the code. This applies whichever element has focus, including an Editable_Target.
2. IF the Switch_Learner is armed and a `keydown` event with `repeat` false occurs whose `code` is `Space`, `Enter` or `NumpadEnter`, THEN THE Switch_Learner SHALL call `preventDefault()` on the event, disarm, leave the Learned_Switch_Key and the Settings_Store unchanged, and return a failed Result stating that this key already works as an input.
3. IF the Switch_Learner is armed and a `keydown` event occurs whose `code` is `Tab` or `Escape`, or a `keydown` event occurs with `repeat` set to true, THEN THE Switch_Learner SHALL leave the Learned_Switch_Key unchanged, stay armed, and not call `preventDefault()` on a `Tab` or `Escape` event, so that the partner can still move focus or close a dialog.
4. WHEN the partner cancels learning, THE Switch_Learner SHALL disarm, leave the Learned_Switch_Key and the Settings_Store unchanged, and return a failed Result stating that learning was cancelled.
5. WHILE the Switch_Learner is armed, THE Switch_Learner SHALL wait with no time limit. THE Input_Layer SHALL pass no Raw_Down or Raw_Up to any Debouncer for the key press used for learning. This covers the press's `keydown` and its matching `keyup`, including a `keyup` that arrives after the Switch_Learner has disarmed.
6. WHEN the partner clears the switch key, THE Input_Layer SHALL set the Learned_Switch_Key to none and remove it from the Settings_Store.
7. WHEN the Switch_Source starts, THE Switch_Source SHALL read the Learned_Switch_Key from the Settings_Store once and use that value until the Learned_Switch_Key is next learned or cleared.
8. IF the Settings_Store read fails, or returns a value for the Learned_Switch_Key that is not a non-empty string or that is a Reserved_Key, THEN THE Switch_Source SHALL treat the Learned_Switch_Key as none and SHALL NOT change the stored value.
9. WHILE a Learned_Switch_Key is set and the focused element is not an Editable_Target, THE Switch_Source SHALL handle `keydown` and `keyup` events whose `code` equals the Learned_Switch_Key, whichever element has focus (including buttons, links, the Keying_Surface, or no element). It SHALL ignore events with `repeat` true, call `preventDefault()` on each handled event, pass a Raw_Down or Raw_Up with the Clock's current time to its Debouncer, and pass no Raw_Up for a `keyup` whose `keydown` it ignored. The resulting Press_Events SHALL have Source_Kind `'switch'`.
10. WHILE no Learned_Switch_Key is set, THE Switch_Source SHALL pass no Raw_Down or Raw_Up.
11. WHILE focus is in an Editable_Target, THE Switch_Source SHALL leave events with the Learned_Switch_Key's `code` unhandled, pass no Raw_Down for them, and not call `preventDefault()` on them, so that the partner can type normally.
12. IF writing the Learned_Switch_Key to the Settings_Store fails during learning, THEN THE Switch_Learner SHALL disarm, keep the previous Learned_Switch_Key both in use and in the Settings_Store, and return a failed Result stating that the switch key could not be saved.
13. IF the Learned_Switch_Key is learned anew or cleared while the Switch_Source is Held, THEN THE Switch_Source SHALL pass a Raw_Up with the Clock's current time to its Debouncer and pass no Raw_Up for the later `keyup` of the previous key.

### Requirement 6: Pointer_Source

**User Story:** As a speaker who can touch or click, I want a press anywhere on the large keying surface to key Morse, so that I do not have to aim at a small button.

#### Acceptance Criteria

1. WHILE the Pointer_Source Source_Status is `'active'` and the Pointer_Source is not Held, WHEN a `pointerdown` event occurs whose target is the Keying_Surface or a descendant of the Keying_Surface, with `isPrimary` true, and, for a `pointerType` of `'mouse'`, with `button` equal to 0, THE Pointer_Source SHALL capture that pointer by its `pointerId`, become Held, and pass exactly one Raw_Down with the Clock's current time to its Debouncer.
2. IF a `pointerdown` event occurs with `isPrimary` false, with `pointerType` `'mouse'` and a `button` other than 0, with a target outside the Keying_Surface and its descendants, or while the Pointer_Source is already Held, THEN THE Pointer_Source SHALL pass no Raw_Down and SHALL leave the current press, if any, unchanged.
3. WHEN a `pointerup` event occurs for the `pointerId` that started the current press, THE Pointer_Source SHALL pass exactly one Raw_Up with the Clock's current time to its Debouncer and stop being Held, including when the pointer is outside the Keying_Surface at release.
4. WHEN a `pointercancel` or `lostpointercapture` event occurs for the `pointerId` that started the current press, THE Pointer_Source SHALL pass exactly one Raw_Up with the Clock's current time to its Debouncer and stop being Held, and SHALL pass no further Raw_Up for that press when a later `pointerup`, `pointercancel` or `lostpointercapture` event arrives for the same `pointerId`.
5. IF a `pointerup`, `pointercancel` or `lostpointercapture` event occurs for a `pointerId` other than the one that started the current press, or while the Pointer_Source is not Held, THEN THE Pointer_Source SHALL pass no Raw_Up and SHALL leave the current press, if any, unchanged.
6. WHEN a `contextmenu` event occurs on the Keying_Surface or a descendant of the Keying_Surface, THE Pointer_Source SHALL call `preventDefault()` on the event, so that a press held for 2000 ms shows no context menu.
7. WHILE the Pointer_Source Source_Status is `'active'`, THE Pointer_Source SHALL configure the Keying_Surface so that a touch, pen or mouse press held for 2000 ms or longer on the Keying_Surface produces no text selection, no touch long-press callout, no page scroll and no page zoom.
8. THE Pointer_Source SHALL listen for pointer events only on the Keying_Surface element and on the captured pointer, and SHALL pass no Raw_Down for pointer presses on any other element.
9. WHEN `start()` is called, THE Pointer_Source SHALL attach its listeners to the Keying_Surface and report Source_Status `'active'`; WHILE the Source_Status is `'off'`, THE Pointer_Source SHALL pass no Raw_Down or Raw_Up for any pointer event.
10. WHEN `stop()` is called while the Pointer_Source is Held, THE Pointer_Source SHALL release the pointer capture, pass exactly one Raw_Up with the Clock's current time to its Debouncer, stop being Held, remove its listeners, and report Source_Status `'off'`, so that the Output_Stream never ends with an unmatched `down` Press_Event from the `'pointer'` source.
11. IF capturing the pointer fails when a qualifying `pointerdown` occurs, THEN THE Pointer_Source SHALL still pass the Raw_Down and SHALL end the press on the first `pointerup` or `pointercancel` event for the same `pointerId` received anywhere in the document.

### Requirement 7: Focus loss and page visibility

**User Story:** As a speaker, I want a press to end when the window loses focus or the page is hidden, so that a missed key release never leaves the app stuck in a long dash.

#### Acceptance Criteria

1. WHEN the window fires a `blur` event while the Keyboard_Source, Switch_Source or Pointer_Source is Held, THE Press_Source that is Held SHALL emit exactly one `up` Press_Event with its own Source_Kind and with `t` equal to the value the Clock returns when the Press_Source handles the `blur` event.
2. WHEN `document.visibilityState` changes to `'hidden'` while any Press_Source, including the Blink_Source, is Held, THE Press_Source that is Held SHALL emit exactly one `up` Press_Event with its own Source_Kind and with `t` equal to the value the Clock returns when the Press_Source handles the visibility change.
3. WHEN the window fires a `blur` event while a Pending_Press exists in the Debouncer of the Keyboard_Source, Switch_Source or Pointer_Source, or the page becomes Page_Hidden while a Pending_Press exists in any Debouncer, THE Debouncer SHALL discard that Pending_Press and emit neither a `down` nor an `up` Press_Event for that press.
4. IF a `keyup` or `pointerup` event arrives for a press that was already ended or discarded under criterion 1, 2 or 3, THEN THE Press_Source SHALL pass no Raw_Up to its Debouncer and SHALL emit no Press_Event for that event.
5. WHEN a press is ended under criterion 1 or 2, or discarded under criterion 3, THE Press_Source SHALL keep its Source_Status unchanged and SHALL pass the next Raw_Down that occurs after that moment to its Debouncer as a new press.
6. WHEN the window fires a `blur` event while the Blink_Source is Held or has a Pending_Press, THE Blink_Source SHALL emit no Press_Event in response to the `blur` event and SHALL keep the press in its current state.
7. IF the window fires a `blur` event and the page becomes Page_Hidden for the same press, in either order, THEN THE Press_Source SHALL emit no more than one `up` Press_Event for that press.
8. IF the window fires a `blur` event or the page becomes Page_Hidden while a Press_Source is neither Held nor holding a Pending_Press, THEN THE Press_Source SHALL emit no Press_Event in response to that event.

### Requirement 8: Blink_Detector hysteresis and minimum closure

**User Story:** As a speaker who can only blink, I want deliberate eye closures to count as presses and natural blinks to be ignored, so that I can key Morse with my eyes.

#### Acceptance Criteria

1. WHILE Eye_State is `open`, WHEN the Blink_Detector receives a Blink_Frame with `min(left, right) ≥ Close_Threshold` (default 0.5), THE Blink_Detector SHALL set Eye_State to `closed` and start a Closure at the frame's `t`.
2. WHILE Eye_State is `closed`, WHEN the Blink_Detector receives a Blink_Frame with `max(left, right) < Open_Threshold` (default 0.35), THE Blink_Detector SHALL set Eye_State to `open` and end the Closure at the frame's `t`.
3. WHILE Eye_State is `open`, IF the Blink_Detector receives a Blink_Frame with `min(left, right) < Close_Threshold`, THEN THE Blink_Detector SHALL keep Eye_State `open` and emit no Press_Event for that frame; WHILE Eye_State is `closed`, IF the Blink_Detector receives a Blink_Frame with `max(left, right) ≥ Open_Threshold`, THEN THE Blink_Detector SHALL keep Eye_State `closed` and continue the current Closure.
4. WHEN the Blink_Detector processes a Blink_Frame accepted under criterion 11 during a Closure (including the frame that ends the Closure under criterion 2 or criterion 7), and that frame's `t` minus the Closure start is greater than or equal to the Min_Press_Duration for the Blink_Source (default 200 ms, valid range 50 to 2000 ms), and the Closure's `down` Press_Event has not yet been emitted, THE Blink_Detector SHALL emit exactly one `down` Press_Event with `t` equal to the Closure start and Source_Kind `'blink'`, before any `up` Press_Event for that Closure.
5. WHEN a Closure ends and its `down` Press_Event has been emitted (including a `down` emitted under criterion 4 while processing the ending frame), THE Blink_Detector SHALL emit exactly one `up` Press_Event with `t` equal to the Closure end and Source_Kind `'blink'`.
6. IF a Closure ends with a duration (Closure end minus Closure start) less than the Min_Press_Duration for the Blink_Source, THEN THE Blink_Detector SHALL emit no `down` and no `up` Press_Event for that Closure, so that natural blinks are rejected.
7. WHILE Eye_State is `closed`, WHEN the Blink_Detector receives a Blink_Frame `{ t, face: 'lost' }`, THE Blink_Detector SHALL end the Closure at that `t`, apply criteria 4 to 6 to that Closure, set Eye_State to `open`, and report face status `'face-lost'`.
8. WHILE Eye_State is `open`, WHEN the Blink_Detector receives a Blink_Frame `{ t, face: 'lost' }`, THE Blink_Detector SHALL report face status `'face-lost'` and emit no Press_Event.
9. WHILE the most recently reported face status is `'face-lost'`, WHEN the Blink_Detector receives a Blink_Frame with `left` and `right` scores that are finite numbers from 0 to 1 inclusive, THE Blink_Detector SHALL report face status `'active'` and then process that frame under criteria 1 to 3 starting from Eye_State `open`.
10. IF the Blink_Detector receives a Blink_Frame whose `left` or `right` is missing, is not a finite number, or is outside the range 0 to 1 inclusive, THEN THE Blink_Detector SHALL process the frame as `{ t, face: 'lost' }`.
11. IF the Blink_Detector receives a Blink_Frame whose `t` is not a finite number or is less than the `t` of the previous accepted Blink_Frame, THEN THE Blink_Detector SHALL ignore the frame, emit no Press_Event, report no face status change, and leave Eye_State and any open Closure unchanged. A frame whose `t` equals the previous accepted frame's `t` is accepted. Accepted frames include face-lost frames and frames treated as face-lost under criterion 10.
12. WHEN the partner submits Close_Threshold and Open_Threshold values that are both finite numbers with `0 < Open_Threshold < Close_Threshold ≤ 1`, THE Input_Layer SHALL return a successful Result and apply both values starting with the next Blink_Frame received, without changing the current Eye_State or ending an open Closure.
13. IF the partner submits a Close_Threshold or Open_Threshold value that is not a finite number or that violates `0 < Open_Threshold < Close_Threshold ≤ 1`, THEN THE Input_Layer SHALL return a failed Result that names each invalid threshold and keep both previous values in effect.
14. FOR ALL sequences of Blink_Frames, THE Blink_Detector SHALL change Eye_State only on frames that cross a threshold as defined in criteria 1 and 2, or on face-lost frames, so that scores staying at or above Open_Threshold and below Close_Threshold never toggle Eye_State (hysteresis property).
15. FOR ALL sequences of Blink_Frames, THE Blink_Detector SHALL emit Press_Events that strictly alternate `down` and `up`, starting with `down`, where every `down`/`up` pair has `up.t − down.t` greater than or equal to the Min_Press_Duration for the Blink_Source that was in effect at the Closure start (minimum-closure property).
16. THE Blink_Detector SHALL report a face status only when it differs from the most recently reported face status, so that consecutive face-lost frames produce one `'face-lost'` report and consecutive valid frames produce no repeated `'active'` report.

### Requirement 9: Blink_Source camera, model and privacy

**User Story:** As a speaker or partner, I want blink input to run only when I turn it on and to keep video on this device, so that my camera is never used or shared without my choice.

#### Acceptance Criteria

1. THE Blink_Source SHALL make no camera request and no request for the Face_Landmarker model file or MediaPipe WebAssembly files when it is created, when the page loads, or at any time before `start()` is called. The caller SHALL call `start()` only as the result of an explicit user action to enable blink input.
2. WHEN `start()` is called on the Blink_Source while its Source_Status is `'off'`, THE Blink_Source SHALL report Source_Status `'starting'` until the camera stream is open and the Face_Landmarker has finished loading. After both are ready, it SHALL report Source_Status `'active'` exactly once and SHALL emit no Press_Event while `'starting'`.
3. THE Blink_Source SHALL load the Face_Landmarker model file and the MediaPipe WebAssembly files only from the Self_Hosted_Assets. IF any of those files fails to load, THEN THE Blink_Source SHALL request no copy from any other origin and SHALL report the failure under Requirement 10 criterion 4, so that enabling blink input makes no request to any third-party origin.
4. THE Blink_Source SHALL run the Face_Landmarker in video mode with blendshape output enabled. For each processed frame it SHALL build a Blink_Frame from the `eyeBlinkLeft` and `eyeBlinkRight` blendshape scores of the first detected face. IF no face is detected, or either score is missing for the first detected face, THEN it SHALL build the Blink_Frame `{ t, face: 'lost' }`.
5. THE Blink_Source SHALL stamp each Blink_Frame with the timestamp of the video frame it was computed from, in the Clock's time base, and SHALL pass Blink_Frames to the Blink_Detector in the order the frames were captured.
6. THE Blink_Source SHALL process every camera frame in memory on the device. It SHALL send no frame, image, landmark or blendshape value to any network endpoint, and SHALL write none of them to any storage API (including the Settings_Store) or to any log.
7. WHEN `stop()` is called on the Blink_Source, THE Blink_Source SHALL stop every camera track it opened so that each track's `readyState` is `'ended'`, stop frame processing so that no further Blink_Frame reaches the Blink_Detector, and report Source_Status `'off'`.
8. IF `stop()` is called while the Blink_Source reports `'starting'`, THEN THE Blink_Source SHALL report Source_Status `'off'`. It SHALL stop every camera track as soon as the pending camera request opens one, SHALL never report `'active'` for that start, and SHALL emit no Press_Event.
9. WHEN the page becomes Page_Hidden while the Blink_Source's Source_Status is not `'off'`, THE Blink_Source SHALL stop every camera track and stop frame processing within 500 ms. It SHALL discard any Closure in progress (ending a Held press under Requirement 7 criterion 2) and reset Eye_State to `open`.
10. WHEN the page stops being Page_Hidden and `stop()` has not been called since the page became Page_Hidden, THE Blink_Source SHALL request the camera again and report `'starting'` then `'active'` under the same rules as criterion 2. IF that camera request fails, THEN THE Blink_Source SHALL report the matching failure status from Requirement 10.
11. IF the camera stream has opened but the Face_Landmarker is not ready within 30 seconds after that, THEN THE Blink_Source SHALL stop every camera track it opened and report Source_Status `'error'`. Time spent waiting for the user to answer a camera permission prompt SHALL NOT count toward the 30 seconds.
12. WHILE the Blink_Source's Source_Status is `'active'` or `'face-lost'`, WHEN the Blink_Detector reports face status `'face-lost'`, THE Blink_Source SHALL report Source_Status `'face-lost'` and keep the camera track open.
13. WHILE the Blink_Source's Source_Status is `'face-lost'`, WHEN the Blink_Detector reports face status `'active'`, THE Blink_Source SHALL report Source_Status `'active'`.

### Requirement 10: Blink_Source failure statuses

**User Story:** As a partner, I want a clear status when blink input cannot run, so that I know why and the speaker can keep using another input.

#### Acceptance Criteria

1. IF `start()` is called on the Blink_Source and `navigator.mediaDevices.getUserMedia` is not a function or the global `WebAssembly` object is absent, THEN THE Blink_Source SHALL report Source_Status `'unsupported'` without first reporting `'starting'`, and SHALL request no camera access and load no Self_Hosted_Assets.
2. IF the camera request made by `start()`, or by reopening the camera under Requirement 9 criterion 10, fails with a `NotAllowedError` or `SecurityError`, THEN THE Blink_Source SHALL report Source_Status `'permission-denied'`.
3. IF the camera request made by `start()`, or by reopening the camera under Requirement 9 criterion 10, fails with a `NotFoundError` or `OverconstrainedError`, THEN THE Blink_Source SHALL report Source_Status `'no-camera'`.
4. IF the Face_Landmarker or any Self_Hosted_Asset fails to load, the camera request fails with an error not listed in criteria 2 and 3, the Face_Landmarker throws while processing a frame, or a camera track ends while Source_Status is `'starting'`, `'active'` or `'face-lost'` and `stop()` was not called and the page is not Page_Hidden, THEN THE Blink_Source SHALL report Source_Status `'error'`.
5. IF the camera stream has opened but the Face_Landmarker is not ready within the limit in Requirement 9 criterion 11, THEN THE Blink_Source SHALL report Source_Status `'error'`, and SHALL stop at once any camera stream or Face_Landmarker that becomes ready after the timeout or after `stop()`, with no further Source_Status change.
6. WHEN the Blink_Source reports `'permission-denied'`, `'no-camera'` or `'error'`, THE Blink_Source SHALL first stop every camera track it opened, stop frame processing, and discard any Pending_Press, so that the camera is released in every failure status.
7. IF a failure under criteria 2 to 5 occurs while the Blink_Source is Held, THEN THE Blink_Source SHALL emit exactly one `up` Press_Event with `t` equal to the Clock's current time before it reports the failure Source_Status.
8. WHILE the Blink_Source's Source_Status is `'unsupported'`, `'permission-denied'`, `'no-camera'` or `'error'`, THE Blink_Source SHALL emit no Press_Event, SHALL not reopen the camera when the page becomes visible, SHALL keep that Source_Status until `start()` or `stop()` is called, and SHALL leave every other Press_Source and the Input_Arbiter running with their Source_Status and Held state unchanged.
9. WHEN `start()` is called while the Blink_Source's Source_Status is `'unsupported'`, `'permission-denied'`, `'no-camera'` or `'error'`, THE Blink_Source SHALL retry the full start sequence under Requirement 9 criterion 2 and criteria 1 to 5 of this requirement; WHEN `stop()` is called in one of these statuses, THE Blink_Source SHALL report Source_Status `'off'` and emit no Press_Event.
10. THE Input_Layer SHALL report every Blink_Source failure only through Source_Status, and SHALL throw no exception from `start()`, `stop()` or subscriber delivery and leave no unhandled promise rejection for these failures.

### Requirement 11: Determinism and purity

**User Story:** As a developer, I want the input logic to be deterministic with an injected clock, so that property tests reproduce every failure from a seed.

#### Acceptance Criteria

1. THE Input_Arbiter, Debouncer, Blink_Detector and focus classification modules SHALL NOT reference `Date`, `performance`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask`, `Math.random`, `crypto`, `window`, `document`, `navigator` or any DOM type or object, and SHALL import nothing from `react`, `next`, `src/components`, `src/hooks` or any Input_Layer adapter module.
2. THE Input_Arbiter, Debouncer and Blink_Detector SHALL take all time from Clock readings and Blink_Frame timestamps passed in by the caller, and the `t` of every Press_Event they emit SHALL equal one of the timestamps passed in.
3. THE focus classification function (Requirement 4 criterion 8) SHALL take a plain description of the focused element and SHALL return `'keying'`, `'editable'` or `'interactive'` based only on that description.
4. FOR ALL sequences of source inputs (Raw_Down, Raw_Up, Blink_Frames and Clock readings), WHEN the same sequence is fed in the same order to two freshly created Input_Arbiter instances built with identical Debouncer Min_Press_Duration values, identical Blink_Detector Close_Threshold and Open_Threshold values, and identical enabled Press_Sources, THE Input_Layer SHALL produce Output_Streams of equal length in which the Press_Events at each index have equal `kind`, `t` and `source` (determinism property).
5. FOR ALL sequences of source inputs, WHEN a sequence is fed to an Input_Arbiter, THE Input_Layer SHALL leave the input values unchanged (no mutation of Raw_Down, Raw_Up, Blink_Frame or Clock reading values).
6. THE Input_Layer SHALL keep all browser API access (DOM event listeners, `getUserMedia`, MediaPipe, `visibilitychange`, `blur`, `performance.now()`) in adapter modules that implement the Press_Source, Clock or Settings_Store interfaces, so that tests can run the pure components with fake sources, a fake Clock and synthetic Blink_Frames without a DOM.
7. THE Input_Layer SHALL write no key code, pointer coordinate, blendshape score or Press_Event field value to the console, to any logger, or to any network request.


## Review corrections: delayed blink frames and permission resume (review, 2026-11-11)

These corrections supersede earlier conflicting criteria in this document.

19.1. THE app SHALL satisfy: Clamp blink events to the receiving engine last input time so delayed video timestamps never cause a press/release to be ignored as in the past.
19.2. THE app SHALL satisfy: Saved blink choice may resume without another partner action only when camera permission is already granted; never request camera access automatically for prompt/denied/unknown permission.
