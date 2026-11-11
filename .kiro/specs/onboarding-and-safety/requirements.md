# Requirements Document

## Introduction

This spec covers MVP items 3 and 9 of `docs/BRIEF.md` that the sibling specs leave open: the SOS help alarm, the always-visible Command_Legend, the Morse Cheat_Sheet overlay, and first-run Onboarding with speed calibration.

It builds on three sibling specs and does not restate their interfaces:

- `morse-engine`: Character_Table, Command_Table, `calibrate()`, `unitToWpm()`, `createEngine()` and Engine_Events.
- `input-sources`: Press_Events, Source_Kinds, Source_Statuses, the Switch_Learner and blink opt-in rules (Requirement 9 criterion 1 of that spec: blink starts only from an explicit user action).
- `conversation-ui`: the Alarm_Handler and Unknown_Pattern_Handler interfaces, the reserved Command_Legend slot (Requirement 22 criterion 7 of that spec), the overlay slot, the Settings_Panel, the Settings_Record and the Engine replacement path for calibrated estimates (`setInitialEstimates`, Requirement 8 criterion 9 of that spec).

This spec needs four integration points that the current `conversation-ui` design does not yet expose. The design phase of this spec defines them as additive hooks and does not change any existing `conversation-ui` behavior:

1. A Press_Router that receives the Input_Arbiter Output_Stream before the Session_Controller, so that Onboarding can take practice presses.
2. Control over which Press_Sources are enabled (blink opt-in and fallback).
3. An entry in the Settings_Panel that re-opens Onboarding.
4. A notification when the session commits a `char` Engine_Event, so that an auto-opened Cheat_Sheet can close.

Out of scope: anything the brief lists as out of scope (including a Morse training game), Morse decoding rules, input source internals, expansion, speech output, and conversation layout outside the Command_Legend slot and the overlay slot.

## Glossary

- **Speaker**: The person with severe motor impairment who uses one input to key Morse.
- **Partner**: The caregiver, family member or nurse next to the Speaker, who uses ordinary pointer and keyboard controls.
- **Engine**: The `morse-engine` decoder. **Session_Engine** is the Engine owned by the `conversation-ui` Session_Controller.
- **Session_Controller**: The `conversation-ui` controller that turns Press_Events into Engine calls and Session_State changes.
- **Character_Table**: The `morse-engine` mapping of the 49 Supported_Characters to their ITU codes.
- **Command_Table**: The `morse-engine` mapping of the 4 Command_Codes (`.-.-.` speak, `..--` next, `----` backspace, `...---...` sos) to command names.
- **Press_Event**: An `input-sources` value `{ kind: 'down' | 'up', t, source }` from the Input_Arbiter Output_Stream.
- **Press_Pair**: A `down` Press_Event and the next `up` Press_Event in the Output_Stream.
- **Keying_Surface**: The large `conversation-ui` element that accepts pointer presses and keyboard focus for keying.
- **Press_Router**: The component in this spec that receives every Press_Event from the Output_Stream and delivers the Press_Event to exactly one Press_Consumer.
- **Press_Consumer**: One of the Alarm_Handler, the Onboarding_Flow, or the Session_Controller.
- **Alarm_Handler**: This spec's implementation of the `conversation-ui` AlarmHandler interface (`start`, `isActive`, `handlePress`, `onActiveChange`).
- **Alarm_Machine**: The pure state machine inside the Alarm_Handler with states `idle`, `ringing` and `closing`.
- **Ringing**: The Alarm_Machine state `ringing`: the Alarm_Card is shown and the Chime plays.
- **Closing**: The Alarm_Machine state `closing`: the alarm has been dismissed by a `down` Press_Event and the Alarm_Machine waits for the matching `up` Press_Event, which the Alarm_Machine also consumes.
- **Alarm_Episode**: The interval from an Alarm_Machine transition out of `idle` to the next transition back to `idle`.
- **Dismissal**: The single event that ends Ringing in an Alarm_Episode: a `down` Press_Event, a Partner activation of the dismiss button, or Escape.
- **Alarm_Card**: The full-screen card with `role="alertdialog"` that reads "I need help".
- **Chime**: One short two-tone sound generated with the Web Audio API, with no audio file.
- **Chime_Period**: The constant time between the start of one Chime and the start of the next Chime: 1000 ms.
- **Chime_Schedule**: The pure function that, given the alarm start time, a window start, a window end and an optional stop time, returns the start times of the Chimes that fall in the window.
- **Chime_Player**: The component that plays Chimes from the Chime_Schedule on an AudioContext, using an injected audio clock and scheduler.
- **Audio_Unlock**: The act of creating or resuming the shared AudioContext inside a user gesture handler so that later sound can play without a gesture.
- **User_Gesture**: A `keydown`, `pointerdown` or `click` event that the browser treats as user activation. A blink is not a User_Gesture.
- **Command_Legend**: The always-visible compact list of the 4 Command_Codes, rendered in the `conversation-ui` legend slot.
- **Glyph**: The visual mark for one Morse symbol. A dot Glyph is a filled circle; a dash Glyph is a filled bar at least 3 times as wide as the dot Glyph and the same height.
- **Spoken_Code**: The text alternative of a code: each symbol written as the word "dot" or "dash", separated by spaces (for `.-.-.`: "dot dash dot dash dot").
- **Cheat_Sheet**: The non-modal overlay that lists every Supported_Character and every Command_Code with its code.
- **Cheat_Sheet_Model**: The pure data the Cheat_Sheet renders: ordered groups of `{ label, code }` entries.
- **Legend_Model**: The pure data the Command_Legend renders: an ordered list of `{ command, code, label }` entries.
- **Open_Reason**: Why the Cheat_Sheet is open: `partner` (opened with the Partner button) or `unknown` (opened automatically by an `unknown` pattern).
- **Onboarding_Flow**: The first-run setup flow with the steps Input_Step, Practice_Step, Legend_Step and Done.
- **Onboarding_Reducer**: The pure reducer that holds the Onboarding_Flow state and handles its actions.
- **Input_Step**: The Onboarding step in which the Partner picks the input: Key_Tap, Switch or Blink.
- **Input_Choice**: One of `key-tap`, `switch` or `blink`. Keyboard and pointer input stay enabled for every Input_Choice.
- **Practice_Step**: The Onboarding step that collects 5 Practice_Presses: 3 short, then 2 long.
- **Practice_Press**: A Press_Pair received by the Onboarding_Flow during the Practice_Step whose `down` Press_Event arrived after the Practice_Step started. Its duration is the `up` timestamp minus the `down` timestamp.
- **Calibration_Result**: The output of `calibrate()` for the 5 Practice_Press durations.
- **Speed_Text**: The plain-words speed shown to the Partner: "about N words per minute", where N is `unitToWpm(dotEstimate)` rounded to the nearest whole number, and at least 1.
- **Legend_Step**: The Onboarding step that shows each command with one explanatory sentence.
- **Guard_Engine**: A separate Engine instance used only while the Onboarding_Flow is open, whose sole purpose is to detect the `sos` command.
- **Onboarding_Record**: A localStorage entry, separate from the `conversation-ui` Settings_Record and History_Record, holding `{ v: 1, complete, inputChoice, estimates }`, where `estimates` is `{ dotEstimate, dashEstimate }` or null.
- **Reduced_Motion**: The state in which `prefers-reduced-motion: reduce` matches.

## Requirements

### Requirement 1: Alarm start and Alarm_Card

**User Story:** As a Speaker, I want my help code to show "I need help" at once over everything, so that anyone nearby knows I need them.

#### Acceptance Criteria

1. WHEN the Alarm_Handler `start()` method is called while the Alarm_Machine is `idle`, THE Alarm_Handler SHALL move the Alarm_Machine to `ringing`, show the Alarm_Card, start the Chime_Player with the alarm start time set to the audio clock time at the call, make `isActive()` return true, and notify every `onActiveChange` listener exactly once with the value true, all within the same synchronous call.
2. WHEN the Alarm_Handler `start()` method is called while the Alarm_Machine is `ringing` or `closing`, THE Alarm_Handler SHALL leave the Alarm_Machine state, the Alarm_Card, the Chime_Player and the alarm start time unchanged, and SHALL not notify any `onActiveChange` listener.
3. WHILE the Alarm_Machine is `ringing`, THE Alarm_Card SHALL cover 100% of the viewport width and height, show the text "I need help" on one or more lines with no truncation or clipping at every viewport width from 320 to 3840 CSS pixels, in type at least 48 CSS pixels high, and show a button labelled "Dismiss" that is at least 44 by 44 CSS pixels and lies fully within the viewport.
4. THE Alarm_Card SHALL have `role="alertdialog"`, `aria-modal="true"`, an accessible name of "I need help", and an accessible description that names each of the 3 ways to make a Dismissal: pressing the Speaker's input, activating the Dismiss button, and pressing Escape.
5. WHILE the Alarm_Machine is `ringing`, THE Alarm_Card SHALL be rendered above every other element of the app, including an open modal dialog, the Settings_Panel, the Cheat_Sheet and the Onboarding_Flow, so that a hit test at any point of the viewport returns the Alarm_Card or one of its descendants.
6. WHEN the Alarm_Card is shown, THE Alarm_Card SHALL move keyboard focus to the Dismiss button within the same synchronous call to `start()` or before the next animation frame, regardless of which element held focus before.
7. THE Alarm_Card SHALL keep the text "I need help" at a contrast ratio of at least 7:1 against its background, measured at every moment of any animation.
8. THE Alarm_Card SHALL change its luminance at most 1 time in any 1000 ms window, so that nothing on the Alarm_Card flashes more than 3 times in any 1-second period.
9. WHILE Reduced_Motion is active, THE Alarm_Card SHALL show no animation, pulse, scale or slide change, and IF Reduced_Motion becomes active while the Alarm_Machine is `ringing`, THEN THE Alarm_Card SHALL stop all animation within 100 ms and stay in its static appearance.
10. WHEN the Alarm_Card is shown, THE Alarm_Card SHALL be announced by assistive technology through its `alertdialog` role and focus move, independently of the `conversation-ui` Live_Region.
11. IF the Chime_Player cannot play sound when `start()` is called, because no AudioContext exists, the AudioContext is suspended without an Audio_Unlock, or the Web Audio API is unavailable, THEN THE Alarm_Handler SHALL still move the Alarm_Machine to `ringing` and show the Alarm_Card as stated in criteria 1, 3 and 6, and SHALL not throw an error from `start()`.
12. WHILE the Alarm_Machine is `ringing`, THE Alarm_Card SHALL keep keyboard focus inside the Alarm_Card, so that pressing Tab or Shift+Tab never moves focus to an element outside the Alarm_Card, and elements outside the Alarm_Card SHALL not respond to pointer activation.

### Requirement 2: Alarm dismissal and press consumption

**User Story:** As a Speaker, I want any press to stop the alarm without typing anything, so that stopping the alarm never changes my message.

#### Acceptance Criteria

1. WHILE the Alarm_Machine is `ringing`, WHEN the Alarm_Handler receives a `down` Press_Event from any Source_Kind, THE Alarm_Handler SHALL consume the `down` Press_Event, move the Alarm_Machine to `closing`, remove the Alarm_Card from display within 100 ms, and stop the Chime_Player so that no Chime starts at or after the `down` Press_Event timestamp.
2. WHILE the Alarm_Machine is `closing`, WHEN the Alarm_Handler receives an `up` Press_Event, THE Alarm_Handler SHALL consume the `up` Press_Event and move the Alarm_Machine to `idle`.
3. WHILE the Alarm_Machine is `ringing`, WHEN the Alarm_Handler receives an `up` Press_Event, THE Alarm_Handler SHALL consume the `up` Press_Event and keep the Alarm_Machine `ringing`, with the Alarm_Card shown and the Chime_Player playing.
4. WHILE the Alarm_Machine is `ringing`, WHEN the Partner activates the Dismiss button with a keyboard activation (Enter or Space), THE Alarm_Handler SHALL move the Alarm_Machine directly to `idle`, remove the Alarm_Card from display within 100 ms, and stop the Chime_Player so that no Chime starts at or after the activation time, without producing any Press_Event for the activating key.
5. WHILE the Alarm_Machine is `ringing`, WHEN the Partner presses Escape, THE Alarm_Handler SHALL move the Alarm_Machine directly to `idle`, remove the Alarm_Card from display within 100 ms, and stop the Chime_Player so that no Chime starts at or after the Escape `keydown` time, without producing any Press_Event for the Escape key.
6. WHILE the Alarm_Machine is `ringing`, WHEN a primary-button `pointerdown` event occurs anywhere on the Alarm_Card, including on the Dismiss button, THE Alarm_Handler SHALL treat the event as the Dismissal with the same effects as criterion 1, and SHALL consume the `pointerup` and `click` events with the same pointer identifier that follow it, so that no element under the Alarm_Card and no Press_Consumer other than the Alarm_Handler receives them.
7. THE Alarm_Handler `isActive()` method SHALL return true while the Alarm_Machine is `ringing` or `closing`, and false while the Alarm_Machine is `idle`.
8. WHEN the Alarm_Machine moves from `idle` to `ringing`, and WHEN the Alarm_Machine moves to `idle`, THE Alarm_Handler SHALL notify every `onActiveChange` listener exactly once with the new value of `isActive()`, and THE Alarm_Handler SHALL NOT notify `onActiveChange` listeners on the move from `ringing` to `closing`.
9. WHILE the Alarm_Machine is `ringing` or `closing`, THE Press_Router SHALL deliver every Press_Event to the Alarm_Handler only, so that no Press_Event reaches the Session_Engine, the Guard_Engine or the Onboarding_Flow.
10. WHEN the Alarm_Machine returns to `idle`, THE Alarm_Handler SHALL move keyboard focus to the Keying_Surface within 100 ms.
11. WHEN the Alarm_Machine returns to `idle`, THE Alarm_Handler SHALL leave the Session_State, the Onboarding_Flow state and the Cheat_Sheet state equal to their values at the moment the Alarm_Machine left `idle`, with no characters, commands or Press_Pairs added by any Press_Event received during the Alarm_Episode.
12. IF the Alarm_Handler receives a `down` Press_Event while the Alarm_Machine is `closing`, THEN THE Alarm_Handler SHALL consume the `down` Press_Event and keep the Alarm_Machine `closing`, with the Alarm_Card hidden and no Chime started.
13. IF a second Dismissal input (a `down` Press_Event, a Dismiss button activation, Escape or an Alarm_Card `pointerdown`) occurs in the same Alarm_Episode after the Dismissal, THEN THE Alarm_Handler SHALL leave the Chime_Player stopped, leave the Alarm_Card hidden, and send no additional `onActiveChange` notification beyond those in criterion 8.

### Requirement 3: Alarm_Machine purity and properties

**User Story:** As a developer, I want the alarm logic to be a pure state machine, so that I can prove with property tests that no press leaks and every alarm ends exactly once.

#### Acceptance Criteria

1. THE Alarm_Machine SHALL be a pure function that takes its current state (`idle`, `ringing` or `closing`) and exactly one input (`start`, `down`, `up` or `partner-dismiss`) and returns three things: the next state, a boolean consumed flag, and an ordered list of zero or more effects drawn from `show-card`, `hide-card`, `start-chime`, `stop-chime` and `active-change` (carrying a boolean value). It SHALL NOT read or write the DOM, timers, audio, storage, the clock or any state outside its arguments, and it SHALL NOT mutate its input state.
2. FOR ALL input sequences of 0 to 200 inputs that begin in `idle`, THE Alarm_Machine SHALL return a consumed flag of true for every `down` and `up` input received while the state is `ringing` or `closing`. It SHALL return a consumed flag of false for every `down` and `up` input received while the state is `idle`.
3. FOR ALL input sequences of 0 to 200 inputs that begin in `idle`, THE Alarm_Machine SHALL produce exactly one Dismissal, exactly one `hide-card` effect and exactly one `stop-chime` effect in every Alarm_Episode that returns to `idle`. It SHALL emit the `hide-card` and `stop-chime` effects in the same step as the Dismissal. It SHALL produce at most one Dismissal, one `hide-card` effect and one `stop-chime` effect in an Alarm_Episode that has not yet returned to `idle` when the sequence ends.
4. FOR ALL input sequences of 0 to 200 inputs routed through the Press_Router model, THE Press_Router SHALL deliver no Press_Event to the Session_Engine or the Guard_Engine in the following span: from the first Press_Event the Alarm_Machine receives after a `start` input that moves it out of `idle`, up to and including the Press_Event or `partner-dismiss` input that returns the Alarm_Machine to `idle`.
5. FOR ALL input sequences of 0 to 200 inputs that begin in `idle`, THE Alarm_Machine SHALL emit `active-change` effects whose values alternate between true and false, starting with true. It SHALL emit `active-change` true only in the step that moves the state from `idle` to `ringing`, and `active-change` false only in the step that moves the state from `ringing` or `closing` to `idle`.
6. FOR ALL input sequences of 0 to 200 inputs, THE Alarm_Machine SHALL produce identical states, consumed flags and effect lists, element for element and in the same order, each time the same input sequence is replayed from `idle`.
7. THE Alarm_Machine SHALL apply these transitions:
   - `start` in `idle` moves to `ringing` and emits, in order, `show-card`, `start-chime` and `active-change` true.
   - `down` in `ringing` is a Dismissal. It moves to `closing` and emits, in order, `hide-card` and `stop-chime`.
   - `partner-dismiss` in `ringing` is a Dismissal. It moves to `idle` and emits, in order, `hide-card`, `stop-chime` and `active-change` false.
   - `up` in `closing` moves to `idle` and emits `active-change` false.
8. IF the Alarm_Machine receives any input not listed in criterion 7, THEN THE Alarm_Machine SHALL return the unchanged current state and an empty effect list, with the consumed flag set as criterion 2 defines for `down` and `up`, and set to false for `start` and `partner-dismiss`. Inputs not listed include:
   - `start` in `ringing` or `closing`
   - `up` in `ringing`
   - `down` or `partner-dismiss` in `closing`
   - `down`, `up` or `partner-dismiss` in `idle`

### Requirement 4: Chime sound

**User Story:** As a Partner, I want a loud repeating chime when the Speaker raises the alarm, so that I hear it from another room.

#### Acceptance Criteria

1. THE Chime_Player SHALL generate every Chime with Web Audio oscillator and gain nodes, and SHALL load no audio file.
2. THE Chime_Player SHALL build each Chime from 2 tones: a first tone at 880 Hz lasting 150 ms that starts at the Chime start, and a second tone at 660 Hz lasting 150 ms that starts 200 ms after the Chime start. Each Chime SHALL end, including release, no later than 400 ms after the Chime start.
3. THE Chime_Player SHALL play each tone at a peak gain of 0.8 of full scale. Each tone SHALL have an attack ramp from 0 to peak gain and a release ramp from peak gain to 0, and each ramp SHALL last from 5 ms to 20 ms.
4. WHEN the Chime_Player starts, THE Chime_Player SHALL start the first Chime within 100 ms of the start call, measured on the audio clock.
5. WHILE the Alarm_Machine is `ringing`, THE Chime_Player SHALL start each Chime within 50 ms of the start time that the Chime_Schedule returns for it, measured on the audio clock. THE Chime_Player SHALL skip no Chime and SHALL duplicate no Chime, including while the page is hidden.
6. WHEN the Chime_Player stops, THE Chime_Player SHALL bring the gain of every playing tone to 0 within 100 ms, measured on the audio clock, and SHALL cancel every tone scheduled to start after the stop time, so that no Chime starts after the stop time.
7. IF the Web Audio API throws while the Chime_Player starts or plays a Chime, THEN THE Chime_Player SHALL catch the error, mark sound as unavailable for the current Alarm_Episode, and schedule no more Chimes in that Alarm_Episode. The Alarm_Card SHALL stay shown and the Alarm_Machine state SHALL stay unchanged.
8. THE Chime_Player SHALL play Chimes independently of the `conversation-ui` speech voice, speech rate and speech queue. Starting, playing or stopping Chimes SHALL leave the speech voice, speech rate and queued utterances unchanged.
9. WHEN the Chime_Player is started while it is already playing Chimes for the current Alarm_Episode, THE Chime_Player SHALL keep the existing Chime_Schedule and SHALL start no second, overlapping series of Chimes.
10. IF the shared AudioContext is not in the running state when the Chime_Player starts, THEN THE Chime_Player SHALL request a resume of the AudioContext as stated in Requirement 6 criterion 4, and the sound-unavailable decision SHALL follow Requirement 6 criterion 5. The Alarm_Card SHALL stay shown in every case.
11. WHEN a new Alarm_Episode starts after a previous Alarm_Episode marked sound as unavailable, THE Chime_Player SHALL clear the unavailable mark and attempt to play Chimes again.

### Requirement 5: Chime_Schedule properties

**User Story:** As a developer, I want the chime timing to be a pure function of the alarm start time, so that I can test interval bounds and stopping without real audio.

#### Acceptance Criteria

1. THE Chime_Schedule SHALL treat an input as valid when the alarm start time `s`, the window start `from` and the window end `to` are finite numbers in milliseconds, `from` is less than `to`, and the stop time `x` is either absent or a finite number in milliseconds.
2. WHEN the Chime_Schedule receives valid inputs without a stop time, THE Chime_Schedule SHALL return, in ascending order, every time `s + k × Chime_Period`, computed directly from `s` and `k`, for every integer `k ≥ 0` with `from ≤ s + k × Chime_Period < to`. The list SHALL have no other entries and no duplicates.
3. WHEN the Chime_Schedule receives valid inputs with a stop time `x`, THE Chime_Schedule SHALL return the list defined in criterion 2 with every time greater than or equal to `x` removed. If `x` is less than or equal to `s` or to `from`, the list SHALL be empty.
4. FOR ALL valid inputs, THE Chime_Schedule SHALL use a Chime_Period of exactly 1000 ms, and any two consecutive returned times SHALL differ from 1000 ms by no more than 0.001 ms.
5. FOR ALL valid inputs, THE Chime_Schedule SHALL return no time less than `s`, no time less than `from`, no time greater than or equal to `to`, and, when `x` is given, no time greater than or equal to `x`.
6. FOR ALL valid inputs and every `b` with `from ≤ b ≤ to`, THE Chime_Schedule SHALL return the same list of Chime start times for the window `[from, to)` as the concatenation, in order, of its results for the windows `[from, b)` and `[b, to)` with the same `s` and `x`. A window with `b` equal to `from` or `to` counts as empty for this property. This guarantees that refilling the schedule in steps never repeats or skips a Chime.
7. IF the Chime_Schedule receives an `s`, `from`, `to` or given `x` that is `NaN`, positive infinity or negative infinity, or a `to` less than or equal to `from`, THEN THE Chime_Schedule SHALL return an empty list without throwing an error.
8. THE Chime_Player SHALL read the current time only from its injected audio clock and SHALL schedule refills only through its injected scheduler, so that a test using a fake clock and a fake scheduler controls every Chime start time the Chime_Player schedules.

### Requirement 6: Audio unlock and sound-unavailable note

**User Story:** As a Speaker who uses blink input, I want the alarm to make sound even though a blink cannot unlock audio, so that my alarm is heard.

#### Acceptance Criteria

1. WHEN the first User_Gesture occurs anywhere in the app after page load, including a User_Gesture inside the Onboarding_Flow, THE Chime_Player SHALL perform Audio_Unlock synchronously inside that gesture's event handler, before the handler returns.
2. WHEN a User_Gesture occurs while the shared AudioContext state is `suspended`, THE Chime_Player SHALL call `resume()` on the AudioContext synchronously inside that gesture's event handler.
3. THE Chime_Player SHALL create at most one AudioContext per page load and SHALL reuse the AudioContext for every Alarm_Episode, including after an Alarm_Episode in which sound was marked unavailable.
4. WHEN the Chime_Player starts while the AudioContext state is not `running`, THE Chime_Player SHALL call `resume()` exactly once per start without awaiting it, so that the `start()` call returns synchronously.
5. IF the AudioContext is not `running` 1000 ms after the Chime_Player starts (measured by the injected scheduler, not the audio clock), or the browser provides no AudioContext, or sound is marked unavailable under Requirement 4 criterion 7, THEN THE Alarm_Card SHALL show the text "Sound is unavailable on this device right now." inside the Alarm_Card, directly below the "I need help" text. The text SHALL stay shown until the Alarm_Episode ends, unless criterion 6 removes it.
6. IF the AudioContext state changes to `running` while the Alarm_Machine is `ringing` and sound was not marked unavailable under Requirement 4 criterion 7, THEN THE Chime_Player SHALL start Chimes from the first Chime_Schedule start time after the current audio clock time, and THE Alarm_Card SHALL remove the sound-unavailable text within 100 ms of the state change.
7. THE Chime_Player SHALL perform Audio_Unlock with a silent operation: during Audio_Unlock, THE Chime_Player SHALL connect no node with a gain above 0 to the AudioContext destination.
8. IF creating the AudioContext throws, or a `resume()` call throws or its promise rejects, during Audio_Unlock or Chime_Player start, THEN THE Chime_Player SHALL catch the error, leave no unhandled promise rejection, and let the User_Gesture or the alarm start finish its normal handling, including Press_Event delivery to the Press_Router.
9. WHEN an Alarm_Episode starts, THE Alarm_Card SHALL begin without the sound-unavailable text and SHALL decide again under criterion 5 whether to show it, whatever was shown in any earlier Alarm_Episode.
10. IF the AudioContext state changes to `running` while the Alarm_Machine is `idle` or `closing`, THEN THE Chime_Player SHALL play no Chime.

### Requirement 7: Alarm precedence and safety

**User Story:** As a Speaker, I want nothing in the app to block my alarm, so that I can always get help.

#### Acceptance Criteria

1. THE Alarm_Handler `start()` method SHALL do all of its work in one synchronous call. It SHALL return without awaiting any promise, network request, storage operation, speech call or timer. When `start()` returns, the Alarm_Machine SHALL be in `ringing` and `isActive()` SHALL return true.
2. WHEN the Alarm_Handler `start()` method is called while the Alarm_Machine is `idle`, THE Alarm_Handler SHALL start the alarm as stated in Requirement 1 criterion 1, in each of these cases: a Client request is pending; a Client, speech or storage error was thrown earlier in the session; the Settings_Panel is open; the Cheat_Sheet is open (with either Open_Reason); the Onboarding_Flow is open at any step; or two or more of these cases hold together.
3. IF an error is thrown while showing the Alarm_Card, THEN THE Alarm_Handler SHALL catch the error, still start the Chime_Player, keep the Alarm_Machine in `ringing`, keep `isActive()` true, and keep accepting all 3 kinds of Dismissal.
4. IF an error is thrown while starting the Chime_Player, or the shared AudioContext is missing or suspended because no Audio_Unlock has happened, THEN THE Alarm_Handler SHALL catch any error, still show the Alarm_Card, keep the Alarm_Machine in `ringing`, keep `isActive()` true, and keep accepting all 3 kinds of Dismissal.
5. IF an error thrown inside the Alarm_Handler `start()` method is caught as stated in criteria 3 and 4, THEN THE Alarm_Handler SHALL not rethrow the error to the caller of `start()`.
6. WHEN the Guard_Engine emits a `command` Engine_Event with command `sos`, THE Onboarding_Flow SHALL call the Alarm_Handler `start()` method exactly once for that Engine_Event, synchronously, before the Press_Router handles the next Press_Event.
7. WHEN the Guard_Engine emits a `command` Engine_Event with command `sos` while the Alarm_Machine is `ringing` or `closing`, THE Alarm_Handler SHALL leave the Alarm_Machine state, the Alarm_Card and the Chime_Player unchanged, as stated in Requirement 1 criterion 2.
8. WHILE the Alarm_Machine is `ringing`, THE app SHALL show no overlay, dialog, toast or message above the Alarm_Card. This covers overlays already open when the alarm started and any overlay that a Press_Event, timer, Client response or error would open during Ringing, including an automatic Cheat_Sheet open with Open_Reason `unknown`.
9. WHEN the Alarm_Machine returns to `idle` at the end of an Alarm_Episode, THE app SHALL keep the open or closed state of the Settings_Panel, the Cheat_Sheet and its Open_Reason, and the Onboarding_Flow step as they were when `start()` was called.

### Requirement 8: Command_Legend

**User Story:** As a Speaker, I want the four command codes always on screen, so that I never have to remember them.

#### Acceptance Criteria

1. THE Command_Legend SHALL build the Legend_Model from the Command_Table at run time, without a hard-coded copy of any code. The Legend_Model SHALL have exactly 4 entries, in the order speak, next, backspace, sos.
2. FOR ALL entries in the Command_Table, THE Legend_Model SHALL contain exactly one entry whose code equals the Command_Table code and whose command equals the Command_Table command name, and SHALL contain no other entry.
3. THE Command_Legend SHALL show each Legend_Model entry with its label and its code. The label SHALL be "Speak" for speak, "Next suggestion" for next, "Delete last letter" for backspace and "Help alarm" for sos. The code SHALL be drawn as one Glyph per symbol, in code order, with no symbols added or left out.
4. THE Command_Legend SHALL give each entry an accessible text made of the label, a colon, a space and the Spoken_Code, for example "Speak: dot dash dot dash dot". THE Command_Legend SHALL hide every Glyph from assistive technology, so that no screen reader announces the Glyphs separately from the accessible text.
5. THE Command_Legend SHALL draw every Glyph at a contrast ratio of at least 3:1 against its background, and SHALL draw label text at a contrast ratio of at least 4.5:1 against its background. These ratios SHALL hold in every color scheme the `conversation-ui` supports.
6. THE Command_Legend SHALL render inside the `conversation-ui` legend slot. At viewport sizes of 768 by 1024 and 1024 by 768 CSS pixels at 100% browser zoom, every entry label, every Glyph and the "All codes" button SHALL be fully inside the viewport with no scrolling and no clipping.
7. WHILE the viewport is 320 CSS pixels wide at 100% browser zoom, or the browser zoom is 200% at a 1280 CSS pixel wide viewport, THE Command_Legend SHALL wrap its entries so that the page has no horizontal scroll. The Glyphs of a single code SHALL stay on one line and SHALL NOT be clipped.
8. THE Command_Legend SHALL include a Partner button labelled "All codes" with a pointer target of at least 44 by 44 CSS pixels. The button SHALL be reachable with Tab and SHALL activate with Enter, Space or a pointer click.
9. WHEN the Partner activates the "All codes" button, THE Command_Legend SHALL open the Cheat_Sheet with Open_Reason `partner`. If the Cheat_Sheet is already open with Open_Reason `unknown`, THE Command_Legend SHALL change the Open_Reason to `partner` and SHALL NOT open a second Cheat_Sheet.
10. WHEN the Partner activates the "All codes" button, THE Command_Legend SHALL NOT produce a Press_Event and SHALL NOT change the Session_Engine state or the Session_State.
11. WHILE the Onboarding_Flow is open or the Alarm_Machine is `ringing`, THE Command_Legend SHALL keep its content unchanged: the same 4 entries, in the same order, with the same labels, codes and accessible texts.

### Requirement 9: Cheat_Sheet content

**User Story:** As a Speaker, I want a list of every code, so that I can look up a character I have forgotten.

#### Acceptance Criteria

1. THE Cheat_Sheet SHALL build the Cheat_Sheet_Model from the Character_Table and the Command_Table each time the Cheat_Sheet opens, with no hard-coded copy of either table, and the Cheat_Sheet_Model SHALL contain exactly four groups in this order: "Commands", "Letters", "Digits", "Punctuation".
2. THE Cheat_Sheet_Model SHALL list the 26 letters `a` to `z` in alphabetical order in "Letters", the 10 digits `0` to `9` in ascending order in "Digits", the 13 punctuation characters in "Punctuation" in the same order as the Character_Table, and the 4 Command_Codes in "Commands" in the order speak, next, backspace, sos.
3. FOR ALL entries in the Character_Table, THE Cheat_Sheet_Model SHALL contain exactly one character entry whose character and code equal that Character_Table entry, and the Cheat_Sheet_Model SHALL contain exactly 49 character entries across "Letters", "Digits" and "Punctuation".
4. FOR ALL entries in the Command_Table, THE Cheat_Sheet_Model SHALL contain exactly one "Commands" entry whose code and command equal that Command_Table entry, and SHALL contain no other "Commands" entry.
5. THE Cheat_Sheet SHALL show each character entry with its character, with letters shown in uppercase, and with its code drawn as one Glyph per symbol in code order.
6. THE Cheat_Sheet SHALL give each character entry an accessible text made of the character name followed by the Spoken_Code, where the character name is the uppercase letter for a letter, the digit for a digit, and a spoken word name for a punctuation character (for example "period" for `.`), and no two punctuation characters SHALL share a character name.
7. THE Cheat_Sheet SHALL show each "Commands" entry with the same label as the Command_Legend ("Speak", "Next suggestion", "Delete last letter", "Help alarm") and its code drawn as one Glyph per symbol, SHALL give each "Commands" entry an accessible text of the label followed by the Spoken_Code, and SHALL hide all Glyphs in the Cheat_Sheet from assistive technology.
8. THE Cheat_Sheet_Model SHALL contain no entry for `+`, and SHALL contain no entry outside "Commands" whose code equals a Command_Code.
9. WHEN the Cheat_Sheet is opened with Open_Reason `unknown`, THE Cheat_Sheet SHALL show the line "Not a code:" above the four groups, followed by the unknown pattern drawn as one Glyph per symbol and written as its Spoken_Code.
10. WHILE the Cheat_Sheet is open with Open_Reason `partner`, THE Cheat_Sheet SHALL show no "Not a code:" line.

### Requirement 10: Cheat_Sheet opening, closing and keying

**User Story:** As a Speaker, I want the cheat sheet to appear by itself when I key something that is not a code and to go away when I get the next letter right, so that I can use it with my one input.

#### Acceptance Criteria

1. WHEN the Unknown_Pattern_Handler receives a pattern while the Cheat_Sheet is closed and the Onboarding_Flow is closed, THE Cheat_Sheet SHALL open within 100 ms with Open_Reason `unknown`, show that pattern in the "Not a code:" line as stated in Requirement 9 criterion 9, and leave keyboard focus where it was.
2. WHEN the Unknown_Pattern_Handler receives a pattern while the Cheat_Sheet is open and the Onboarding_Flow is closed, THE Cheat_Sheet SHALL keep its current Open_Reason, stay open, and within 100 ms show the "Not a code:" line with only the new pattern, drawn as Glyphs and written as its Spoken_Code, whether the Open_Reason is `unknown` or `partner`.
3. WHILE the Cheat_Sheet is open with Open_Reason `unknown`, WHEN the session commits a `char` Engine_Event, THE Cheat_Sheet SHALL close within 100 ms. If keyboard focus was on a Cheat_Sheet control at that moment, THE app SHALL move keyboard focus to the Keying_Surface within 100 ms.
4. WHILE the Cheat_Sheet is open with any Open_Reason, WHEN the session commits an Engine_Event other than `char`, including a `command` Engine_Event, or WHEN the Unknown_Pattern_Handler receives another pattern, THE Cheat_Sheet SHALL stay open. WHILE the Cheat_Sheet is open with Open_Reason `partner`, WHEN the session commits a `char` Engine_Event, THE Cheat_Sheet SHALL stay open.
5. WHEN the Partner activates the "All codes" button while the Cheat_Sheet is closed, THE Cheat_Sheet SHALL open within 100 ms with Open_Reason `partner` and no "Not a code:" line, and THE app SHALL move keyboard focus to the Keying_Surface within 100 ms.
6. WHILE the Cheat_Sheet is open, THE Cheat_Sheet SHALL show a visible Partner button labelled "Close codes", with a pointer target of at least 44 by 44 CSS pixels.
7. WHILE the Alarm_Machine is `idle`, WHEN the Partner activates the "Close codes" button, or presses Escape while the Cheat_Sheet is open and no modal dialog is open above the Cheat_Sheet, THE Cheat_Sheet SHALL close within 100 ms, and THE app SHALL move keyboard focus to the Keying_Surface within 100 ms.
8. WHILE the Cheat_Sheet is open, the Alarm_Machine is `idle`, and the Onboarding_Flow is closed, THE Press_Router SHALL deliver every Press_Event to the Session_Controller, the same as when the Cheat_Sheet is closed, so that keying continues and Press_Events produce the same Engine_Events as with the Cheat_Sheet closed.
9. WHILE the Cheat_Sheet is open, THE Cheat_Sheet SHALL leave the whole Keying_Surface area accepting pointer presses. A primary `pointerdown` anywhere on the Keying_Surface SHALL produce a `down` Press_Event. THE Cheat_Sheet SHALL not move keyboard focus to its own controls when it opens or when its content updates. Focus SHALL reach Cheat_Sheet controls only when the Partner moves it there by Tab or pointer.
10. THE Cheat_Sheet SHALL be non-modal. It SHALL not set `aria-modal="true"` and SHALL not trap focus, so Tab and Shift+Tab can move focus out of the Cheat_Sheet. It SHALL not make any other part of the page inert or `aria-hidden`.
11. WHEN the Unknown_Pattern_Handler receives a pattern while the Onboarding_Flow is open, THE Cheat_Sheet SHALL stay closed and SHALL not show that pattern after the Onboarding_Flow closes.
12. WHEN the Partner activates the "All codes" button while the Cheat_Sheet is open with Open_Reason `unknown`, THE Cheat_Sheet SHALL stay open, change its Open_Reason to `partner`, and keep the current "Not a code:" line.
13. WHEN the Cheat_Sheet closes, THE Cheat_Sheet SHALL discard the "Not a code:" pattern. The next time the Cheat_Sheet opens, it SHALL show only the pattern given by that opening, or no "Not a code:" line when Open_Reason is `partner`.
14. IF the Partner presses Escape while the Alarm_Machine is `ringing` or `closing`, THEN THE Cheat_Sheet SHALL keep its open or closed state, its Open_Reason and its "Not a code:" line unchanged, as stated in Requirement 2 criterion 11.

### Requirement 11: Onboarding entry and persistence

**User Story:** As a Partner, I want setup to appear on first use and be available again later, so that I can set the app up once and redo it when things change.

#### Acceptance Criteria

1. THE app SHALL treat an Onboarding_Record as valid only if all of the following hold: it parses as JSON, `v` equals 1, `complete` is a boolean, `inputChoice` is one of `key-tap`, `switch` or `blink`, and `estimates` is either null or an object whose `dotEstimate` and `dashEstimate` are both finite numbers greater than 0.
2. WHEN the app loads and the Onboarding_Record is missing, is not valid JSON, is not valid under criterion 1, or has `complete` false, THE Onboarding_Flow SHALL open at the Input_Step with no Input_Choice selected before the Press_Router routes the first Press_Event, and THE app SHALL leave the stored entry unchanged until an Onboarding_Record is written under Requirement 16 criterion 4.
3. WHEN the app loads and the Onboarding_Record is valid with `complete` true, THE Onboarding_Flow SHALL stay closed, and THE Press_Router SHALL route the first Press_Event under Requirement 12 criterion 1 with the Onboarding_Flow closed.
4. WHEN the app loads and the Onboarding_Record is valid with `complete` true, THE app SHALL call the Session_Controller `setInitialEstimates` exactly once before the Press_Router routes the first Press_Event: with the stored `dotEstimate` and `dashEstimate` if `estimates` is non-null, or with null if `estimates` is null.
5. IF reading the Onboarding_Record from localStorage throws, THEN THE app SHALL treat the Onboarding_Record as missing under criterion 2, SHALL catch the error so that app load completes, and SHALL not call `setInitialEstimates` for that load.
6. THE Settings_Panel SHALL include a Partner button labelled "Run setup again", with a pointer target of at least 44 by 44 CSS pixels.
7. WHEN the Partner activates "Run setup again", THE app SHALL close the Settings_Panel, open the Onboarding_Flow at the Input_Step with the Input_Choice in effect for the current page load selected (from the valid Onboarding_Record, or from the most recent Onboarding_Flow completed in this page load if the write failed), and move keyboard focus to the selected choice within 100 ms.
8. WHILE the Onboarding_Flow was opened with "Run setup again" and has not reached Done, THE Onboarding_Flow SHALL show a Partner button labelled "Cancel setup", with a pointer target of at least 44 by 44 CSS pixels, at every step.
9. WHEN the Partner activates "Cancel setup", THE Onboarding_Flow SHALL close and move keyboard focus to the Keying_Surface within 100 ms. THE app SHALL leave the stored Onboarding_Record and the Session_Engine estimates unchanged, and SHALL return every Press_Source, including the Blink_Source, to the enabled or stopped state it had when "Run setup again" was activated.
10. WHILE the Onboarding_Flow is open after "Run setup again", THE app SHALL write no Onboarding_Record until the Partner activates "Start" under Requirement 16 criterion 4.
11. THE Onboarding_Record SHALL contain only the fields `v`, `complete`, `inputChoice` and `estimates`. It SHALL store no camera frame, image, landmark, blendshape value, Practice_Press timestamp, Practice_Press duration or typed text.
12. WHEN the app loads with a valid Onboarding_Record with `complete` true and `inputChoice` `blink`, THE app SHALL keep the Blink_Source `'off'`, make no camera request, keep keyboard and pointer input enabled, and show a Partner button labelled "Turn on camera for blink input" with a pointer target of at least 44 by 44 CSS pixels.
13. WHEN the Partner activates "Turn on camera for blink input", THE app SHALL start the Blink_Source once and hide the button while the Blink_Source status is `'starting'`, `'active'` or `'face-lost'`.
14. IF the Blink_Source reports `'permission-denied'`, `'no-camera'`, `'unsupported'` or `'error'` after the Partner activates "Turn on camera for blink input", THEN THE app SHALL show a plain-words reason for that status, keep keyboard and pointer input enabled, and, for every status except `'unsupported'`, show the "Turn on camera for blink input" button again so the Partner can retry.

### Requirement 12: Press routing during Onboarding

**User Story:** As a Speaker, I want my practice presses to never type text, and my help code to still work during setup, so that setup is safe.

#### Acceptance Criteria

1. WHEN the Press_Router receives a Press_Event from the Output_Stream, THE Press_Router SHALL deliver that Press_Event to exactly one Press_Consumer, except for the case in criterion 8. THE Press_Router SHALL choose the Press_Consumer at the moment the Press_Event arrives, in this order: the Alarm_Handler if `isActive()` returns true; else the Onboarding_Flow if the Onboarding_Flow is open; else the Session_Controller.
2. WHILE the Onboarding_Flow is open, THE Press_Router SHALL deliver no Press_Event to the Session_Controller. Current_Text, Current_Pattern and the Session_Engine `dotEstimate` and `dashEstimate` SHALL keep the values they had when the Onboarding_Flow opened, whatever presses are made during Onboarding.
3. WHILE the Onboarding_Flow is open, WHEN the Onboarding_Flow receives a Press_Event, THE Onboarding_Flow SHALL pass that Press_Event to the Guard_Engine before it handles the Press_Event for the current Onboarding step. THE Onboarding_Flow SHALL then replace any pending Guard_Engine timer with one timer set to the Guard_Engine `nextDeadline()`, or SHALL leave no timer pending if `nextDeadline()` returns no deadline. At no time SHALL more than 1 Guard_Engine timer be pending.
4. WHEN a pending Guard_Engine timer fires, THE Onboarding_Flow SHALL call the Guard_Engine tick with the current time. THE Onboarding_Flow SHALL then schedule the next timer from `nextDeadline()` under the same at-most-1-timer rule as criterion 3.
5. WHEN the Onboarding_Flow opens, THE Onboarding_Flow SHALL create a new Guard_Engine with the same Engine configuration the Session_Controller would build from the current Settings_Record and the stored estimates. If no estimates are stored, THE Onboarding_Flow SHALL use the Engine default estimates.
6. WHEN the Guard_Engine emits a `command` Engine_Event with command `sos`, THE Onboarding_Flow SHALL call the Alarm_Handler `start` exactly once for that Engine_Event. THE Onboarding_Flow SHALL keep its current step and collected Practice_Presses unchanged.
7. WHEN the Guard_Engine emits any Engine_Event other than a `command` with command `sos`, THE Onboarding_Flow SHALL discard that Engine_Event. Discarding SHALL have no effect on the Onboarding_Flow state, Current_Text, Current_Pattern or any spoken output.
8. IF the Press_Consumer chosen under criterion 1 for an `up` Press_Event differs from the Press_Consumer that received the matching `down` Press_Event, THEN THE Press_Router SHALL deliver that `up` Press_Event to no Press_Consumer, and the new Press_Consumer SHALL not record a Press_Pair for it.
9. WHEN the Onboarding_Flow closes, THE Onboarding_Flow SHALL cancel any pending Guard_Engine timer and discard the Guard_Engine. After the close, no Guard_Engine tick and no Guard_Engine Engine_Event SHALL occur.
10. WHEN the Onboarding_Flow opens or closes, THE Session_Controller SHALL leave the Session_Engine with an empty Pattern_Buffer and no unmatched `down` Press_Event. THE Session_Controller SHALL discard any symbols that were buffered when the Onboarding_Flow opened without decoding them, so Current_Text keeps its value from the moment the Onboarding_Flow opened.

### Requirement 13: Input_Step

**User Story:** As a Partner, I want to pick how the Speaker presses, so that the app listens to the right input.

#### Acceptance Criteria

1. THE Input_Step SHALL show three choices labelled "Key or tap", "Switch" and "Blink", each with a pointer target of at least 44 by 44 CSS pixels, each reachable and activatable with the keyboard, and with the most recently chosen choice exposed to assistive technology as selected.
2. WHEN the Input_Step opens, THE Onboarding_Flow SHALL show no choice as selected, leave the Input_Choice unset, show the Continue button disabled, make no camera request, and leave the Switch_Learner unarmed.
3. WHEN the Partner chooses "Key or tap", THE Onboarding_Flow SHALL disarm the Switch_Learner if it is armed, stop the Blink_Source if the Blink_Source status is not `'off'`, set the Input_Choice to `key-tap`, and enable the Continue button.
4. WHEN the Partner chooses "Switch", THE Onboarding_Flow SHALL stop the Blink_Source if the Blink_Source status is not `'off'`, clear any previous Input_Choice, disable the Continue button, arm the Switch_Learner, and show "Press the switch now."
5. WHEN the Switch_Learner returns a successful Result, THE Onboarding_Flow SHALL set the Input_Choice to `switch`, show "Switch learned." with the learned key code, and enable the Continue button.
6. IF the Switch_Learner returns a failed Result, THEN THE Onboarding_Flow SHALL keep the Continue button disabled, leave the Input_Choice unset, and show the Switch_Learner message, a "Try again" button that re-arms the Switch_Learner and shows "Press the switch now." again, and a "Use key or tap instead" button.
7. WHEN the Partner chooses "Blink", THE Onboarding_Flow SHALL disarm the Switch_Learner if it is armed, clear any previous Input_Choice, disable the Continue button, and show the text "Dit uses the camera to see when the eyes close. Video stays on this device. It is never sent or saved." with a button labelled "Turn on camera". THE Onboarding_Flow SHALL make no camera request before the Partner activates that button.
8. WHEN the Partner activates "Turn on camera", THE Onboarding_Flow SHALL start the Blink_Source and show the Blink_Source status in plain words: "Starting camera…" for `'starting'`, "Camera on. Blinks now count as presses." for `'active'`, and "Can't see a face. Move the camera or the light." for `'face-lost'`. The shown text SHALL change whenever the Blink_Source status changes.
9. WHILE the Blink choice is selected and the Blink_Source status is `'active'` or `'face-lost'`, THE Onboarding_Flow SHALL set the Input_Choice to `blink` and enable the Continue button.
10. IF the Blink_Source reports `'permission-denied'`, `'no-camera'`, `'unsupported'` or `'error'`, including after it was `'active'` or `'face-lost'`, THEN THE Onboarding_Flow SHALL clear the Input_Choice, disable the Continue button, and show a plain-words reason for that status: for `'permission-denied'`, that camera permission was refused and must be allowed in the browser; for `'no-camera'`, that no camera was found; for `'unsupported'`, that this browser cannot use blink input; for `'error'`, that the camera could not start. THE Onboarding_Flow SHALL also show a "Use key or tap instead" button and, for every status except `'unsupported'`, a "Try again" button that calls the Blink_Source `start()` again.
11. WHEN the Partner activates "Use key or tap instead", THE Onboarding_Flow SHALL apply criterion 3 and show "Key or tap" as the selected choice.
12. WHEN the Partner activates the enabled Continue button on the Input_Step, THE Onboarding_Flow SHALL move to the Practice_Step with the current Input_Choice. The Onboarding_Flow SHALL keep the Blink_Source running if the Input_Choice is `blink`.
13. IF the Continue button is disabled, THEN THE Onboarding_Flow SHALL stay on the Input_Step when the Partner tries to activate Continue by pointer or keyboard.

### Requirement 14: Practice_Step

**User Story:** As a Speaker, I want five practice presses with clear feedback, so that Dit learns my speed.

#### Acceptance Criteria

1. WHEN the Practice_Step starts, THE Onboarding_Flow SHALL clear the collected Practice_Press durations, remove every Glyph from the practice row, hide the held indicator, show the prompt "Press short" with the count "Press 1 of 5", and move keyboard focus to the Keying_Surface within 100 ms.
2. WHILE the Practice_Step is shown, THE Onboarding_Flow SHALL keep the whole Keying_Surface inside the viewport, with no Onboarding_Flow element overlapping it, and accepting pointer presses.
3. WHEN the Onboarding_Flow receives a Practice_Press while fewer than 5 durations are collected, THE Onboarding_Flow SHALL append the Practice_Press duration, which is the `up` timestamp minus the `down` timestamp in milliseconds, including a duration of 0 ms, to the collected durations.
4. WHEN the Onboarding_Flow appends the Nth Practice_Press duration, THE Onboarding_Flow SHALL show exactly N Glyphs in the practice row, in press order, where Glyphs 1 to 3 are dot Glyphs and Glyphs 4 and 5 are dash Glyphs, and the Glyph type depends only on the press position, not on the press duration.
5. WHEN the Onboarding_Flow appends the Nth Practice_Press duration and N is 1, 2 or 4, THE Onboarding_Flow SHALL change the count to "Press N+1 of 5" and keep the current prompt.
6. WHEN 3 durations are collected, THE Onboarding_Flow SHALL change the prompt to "Press long" and the count to "Press 4 of 5".
7. WHILE a `down` Press_Event has arrived during the Practice_Step without its matching `up` Press_Event and fewer than 5 durations are collected, THE Onboarding_Flow SHALL show a held indicator next to the practice row, and SHALL hide the held indicator within 100 ms of the matching `up` Press_Event.
8. IF an `up` Press_Event arrives during the Practice_Step without a matching `down` Press_Event received during the Practice_Step, THEN THE Onboarding_Flow SHALL ignore that `up` Press_Event for practice, leaving the collected durations, Glyphs, prompt and count unchanged.
9. WHILE 5 durations are collected, THE Onboarding_Flow SHALL ignore further Press_Pairs for practice, leaving the collected durations, the 5 Glyphs and the held indicator hidden.
10. THE Practice_Step SHALL show a Partner button labelled "Use default speed" from the start of the Practice_Step until the Onboarding_Flow leaves the Practice_Step, whether 0, 1 to 4, or 5 durations are collected.
11. WHEN the Partner activates "Use default speed", THE Onboarding_Flow SHALL set the result to the default estimates (null), discard any stored Calibration_Result, show "Default speed: about N words per minute", where N is the Starting_WPM in the Settings_Record, and enable Continue.
12. WHEN the Partner activates "Use default speed", THE Onboarding_Flow SHALL NOT count that activation as a Practice_Press and SHALL NOT append a duration.
13. WHILE Reduced_Motion is active, THE Practice_Step SHALL show and hide the held indicator, show new Glyphs and change the prompt and count with no animation or transition.

### Requirement 15: Calibration result

**User Story:** As a Partner, I want to see the measured speed in plain words and apply it, so that I know Dit is set to the Speaker's pace.

#### Acceptance Criteria

1. WHEN the fifth Practice_Press duration is collected, THE Onboarding_Flow SHALL call `calibrate()` exactly once with the 5 durations in the order collected (3 short, then 2 long) and store the returned Calibration_Result.
2. WHEN a Calibration_Result with a null reason is stored, THE Onboarding_Flow SHALL show, within 100 ms, the Speed_Text for the Calibration_Result `dotEstimate`, a "Use this speed" button and a "Practice again" button.
3. IF a Calibration_Result with a null reason is stored and the mean of the 2 long Practice_Press durations is less than 1.5 times the median of the 3 short Practice_Press durations, THEN THE Onboarding_Flow SHALL also show "The long presses were close to the short ones, so Dit set long to 3 times short." next to the Speed_Text.
4. IF a Calibration_Result with a non-null reason is stored, THEN THE Onboarding_Flow SHALL set the result to the default estimates (null), show the default speed text from Requirement 14 criterion 11 in place of any Speed_Text, show a "Practice again" button and enable Continue, and SHALL NOT show the "Use this speed" button or the criterion 3 sentence.
5. WHEN the Partner activates "Practice again", THE Onboarding_Flow SHALL discard the stored Calibration_Result without calling the Session_Controller `setInitialEstimates`, and restart the Practice_Step under Requirement 14 criterion 1.
6. WHEN the Partner activates "Use this speed", THE Onboarding_Flow SHALL pass the Calibration_Result `dotEstimate` and `dashEstimate` to the Session_Controller `setInitialEstimates` exactly once, and then move to the Legend_Step.
7. WHEN the Partner activates Continue while the result is the default estimates (null), whether set by "Use default speed" (Requirement 14 criterion 11) or by criterion 4, THE Onboarding_Flow SHALL pass null to the Session_Controller `setInitialEstimates` exactly once, and then move to the Legend_Step.
8. IF the Partner activates "Use this speed" or Continue again before the Legend_Step is shown, THEN THE Onboarding_Flow SHALL ignore the repeated activation and SHALL NOT call the Session_Controller `setInitialEstimates` a second time.
9. THE Onboarding_Flow SHALL apply estimates to the Session_Engine only through the Session_Controller `setInitialEstimates` path, and SHALL NOT call `setInitialEstimates` before the Partner activates "Use this speed" or Continue.

### Requirement 16: Legend_Step and finish

**User Story:** As a Partner, I want a short explanation of the commands before we start, so that the Speaker knows how to speak, choose, delete and call for help.

#### Acceptance Criteria

1. WHEN the Onboarding_Flow moves to the Legend_Step, THE Legend_Step SHALL show the 4 Legend_Model entries in Legend_Model order. Each entry SHALL show its code as Glyphs, its label, its Spoken_Code as the text alternative of the Glyphs, and exactly one sentence: speak "Says the highlighted suggestion, or the typed text when nothing is highlighted.", next "Moves the highlight to the next suggestion.", backspace "Deletes the last letter.", sos "Sounds an alarm and shows I need help until any press."
2. WHILE the Legend_Step is shown, THE Legend_Step SHALL show the sentence "Tap All codes, or key a pattern that is not a code, to see every letter." below the 4 Legend_Model entries.
3. WHILE the Legend_Step is shown, THE Legend_Step SHALL show a Partner button labelled "Start" with a pointer target of at least 44 by 44 CSS pixels.
4. WHEN the Partner activates "Start", THE Onboarding_Flow SHALL write one Onboarding_Record with `v` 1, `complete` true, `inputChoice` set to the chosen Input_Choice, and `estimates` set to the `{ dotEstimate, dashEstimate }` passed to the Session_Controller `setInitialEstimates` under Requirement 15, or null when null was passed.
5. WHEN the Partner activates "Start", THE Onboarding_Flow SHALL close and move keyboard focus to the Keying_Surface within 100 ms of the activation, whether or not the Onboarding_Record write succeeded.
6. IF writing the Onboarding_Record throws or the record cannot be read back, THEN THE app SHALL keep the chosen Input_Choice and the applied estimates in effect until the page unloads, leave any Onboarding_Record stored before this setup run unchanged, and show the message "Setup could not be saved on this device. It will show again next time." for at least 10 seconds after the Onboarding_Flow closes.
7. IF the Partner activates "Start" again before the Onboarding_Flow has closed, THEN THE Onboarding_Flow SHALL write no second Onboarding_Record, make no second `setInitialEstimates` call, and show no second save-failure message.
8. THE Onboarding_Flow SHALL let the Partner finish the `key-tap` path with at most 4 Partner activations ("Key or tap", Continue on the Input_Step, "Use this speed", and "Start") and exactly 5 Practice_Presses. The Onboarding_Flow SHALL add no timed delay, countdown or minimum wait before any of these activations or presses is accepted.

### Requirement 17: Onboarding_Reducer properties

**User Story:** As a developer, I want the onboarding flow to be a pure reducer, so that I can prove its step order and practice counting with property tests.

#### Acceptance Criteria

1. THE Onboarding_Reducer SHALL be a pure function of its state and one action: it SHALL return its next state using only those two arguments, SHALL leave the input state unmodified, and SHALL perform no DOM, storage, timer, camera, audio or Engine access.
2. FOR ALL action sequences, THE Onboarding_Reducer SHALL visit steps only in the order Input_Step, Practice_Step, Legend_Step, Done. Each action SHALL either keep the current step or move to the next step in that order. There are two exceptions. "Practice again" is the only transition that returns to the start of the Practice_Step, and it applies only while a Calibration_Result is held. "Cancel setup" is the only transition that closes the Onboarding_Flow before Done, and it applies only when the Onboarding_Flow was opened with "Run setup again".
3. FOR ALL action sequences, THE Onboarding_Reducer SHALL hold at most 5 Practice_Press durations. Once 5 or more Practice_Presses have been received after the most recent Practice_Step start, THE Onboarding_Reducer SHALL hold exactly the first 5 of those durations, in the order received. Each duration SHALL be the `up` timestamp minus the `down` timestamp. The Onboarding_Reducer SHALL not count any `up` Press_Event whose matching `down` Press_Event arrived before that Practice_Step start.
4. FOR ALL action sequences in which 5 Practice_Presses are collected, THE Onboarding_Reducer SHALL hold a Calibration_Result equal to `calibrate()` applied to those 5 durations in the order collected. FOR ALL action sequences in which fewer than 5 Practice_Presses are collected since the most recent Practice_Step start, THE Onboarding_Reducer SHALL hold no Calibration_Result.
5. FOR ALL states in the Practice_Step, WHEN the Onboarding_Reducer receives "Use default speed", THE Onboarding_Reducer SHALL hold null estimates. On Done, it SHALL report null estimates for `setInitialEstimates` and for the Onboarding_Record. FOR ALL Calibration_Results that have a non-null reason, THE Onboarding_Reducer SHALL treat the result the same way.
6. FOR ALL action sequences, THE Onboarding_Reducer SHALL reach the Legend_Step only through one of two transitions: "Use this speed" while it holds a Calibration_Result with a null reason, or Continue while it holds the default estimates (null).
7. FOR ALL action sequences, replaying the same action sequence from the initial state SHALL produce states that are deeply equal after every action.
8. FOR ALL states, IF the Onboarding_Reducer receives an action that is not valid in the current step, THEN THE Onboarding_Reducer SHALL return a state deeply equal to the current state and SHALL not throw. Examples are "Practice again" while no Calibration_Result is held, a Practice_Press outside the Practice_Step, or any action after Done.
9. FOR ALL action sequences that reach Done, THE Onboarding_Reducer SHALL report three values: the Input_Choice selected at the Input_Step, the applied estimates, and `complete` true. The applied estimates SHALL be either the `dotEstimate` and `dashEstimate` of the Calibration_Result accepted with "Use this speed", or null. THE Onboarding_Reducer SHALL report these values exactly once per Onboarding_Flow.

### Requirement 18: Accessibility of this spec's UI

**User Story:** As a Partner or Speaker using assistive technology, I want the alarm, legend, cheat sheet and setup to meet the app's accessibility rules, so that everyone can use them.

#### Acceptance Criteria

1. THE Onboarding_Flow, the Cheat_Sheet, the Command_Legend and the Alarm_Card SHALL render all body text at a computed font size of at least 18 CSS pixels, with a contrast ratio of at least 4.5:1 against the background directly behind it. Every control boundary, every focus indicator and every Glyph SHALL have a contrast ratio of at least 3:1 against the adjacent background.
2. THE Onboarding_Flow SHALL give each of the Input_Step, the Practice_Step, the Legend_Step and Done exactly one visible `h2` heading that names the step, and SHALL add no `h1` element to the page.
3. WHEN the Onboarding_Flow changes step, or the number of Practice_Presses collected in the Practice_Step changes, THE Onboarding_Flow SHALL announce the new step heading or the new count (for example "3 of 5") through one polite `aria-live` region that exists for the whole time the Onboarding_Flow is open. THE Onboarding_Flow SHALL make no announcement for individual `down` or `up` Press_Events or for individual Morse symbols.
4. THE Onboarding_Flow, the Cheat_Sheet and the Alarm_Card SHALL give every interactive control an accessible name taken from its visible label or from an `aria-label`, a focus indicator that is visible while the control has keyboard focus, and a pointer target of at least 44 by 44 CSS pixels.
5. WHILE the viewport is 320 CSS pixels wide, or the browser zoom is 200% on a 1280 CSS pixel wide viewport, THE Onboarding_Flow, the Cheat_Sheet and the Alarm_Card SHALL show all text and controls without horizontal page scrolling, without clipping, and without content overlapping other content.
6. THE Onboarding_Flow, the Cheat_Sheet and the Command_Legend SHALL draw dot Glyphs and dash Glyphs with the shapes and width ratio defined for Glyph, and SHALL convey no meaning (symbol type, command, state or selection) by color alone.
7. THE Onboarding_Flow, the Cheat_Sheet and the Command_Legend SHALL give every rendered code a text alternative equal to its Spoken_Code, and SHALL hide the individual Glyphs from assistive technology so that each code is read once as its Spoken_Code.
8. WHILE Reduced_Motion is active, THE Onboarding_Flow, the Cheat_Sheet, the Command_Legend and the Alarm_Card SHALL use no slide, scale or pulse transitions. Any remaining transition SHALL be an opacity change of no more than 200 ms or an instant change.
9. WHEN the Alarm_Machine enters Ringing, THE Alarm_Handler SHALL show the Alarm_Card with the accessible name "I need help" and SHALL move keyboard focus to the Alarm_Card's dismiss button. WHEN the Alarm_Episode ends, THE Alarm_Handler SHALL move keyboard focus to the Keying_Surface as stated in Requirement 2 criterion 10, so that the next Space or Enter press keys Morse.
10. THE Onboarding_Flow SHALL show all text and controls of every step without horizontal page scrolling or clipping, with every control operable by pointer and keyboard, on viewports of 768 by 1024 CSS pixels (portrait) and 1024 by 768 CSS pixels (landscape), and SHALL NOT lock the screen orientation.
11. WHEN the viewport orientation changes while the Onboarding_Flow is open, THE Onboarding_Flow SHALL keep the current step, the selected Input_Choice and the Practice_Presses collected so far without change.


## Review corrections: single-input reachability and cancellation (review, 2026-11-11)

These corrections supersede earlier conflicting criteria in this document.

24.1. WHEN any character or command commits, THE Cheat_Sheet SHALL close regardless of open reason; WHEN codes exceed the available panel space, THE sheet SHALL provide single-input paging so every code is reachable at 1280×800, 820×1180 and 393×852 without scrolling.
24.2. WHEN a measured or default practice result is chosen and Speak commits or a further press reaches a letter gap, THE Onboarding_Controller SHALL accept that result after checking SOS; WHEN timing is accepted, THE controller SHALL rebuild the guard with that timing so Speak can finish the legend; WHILE a result is chosen, THE reducer SHALL stop recording durations and preserve the five-duration cap.
24.3. WHEN Key/tap or Blink is selected in the input step, THE Onboarding_Controller SHALL immediately disable switch input and clear its active and persisted learned key; WHEN a completed non-switch record is restored, THE controller SHALL apply the same source selection.
24.4. WHEN re-run setup is cancelled, THE Onboarding_Controller SHALL restore pre-setup timing, source flags, active switch key and persisted switch key and leave the onboarding record unchanged.
24.5. WHEN a saved Blink choice loads and camera permission is granted, THE Input_Layer SHALL resume the camera; IF permission is prompt, denied or unsupported, THE app SHALL retain the explicit camera action.

Review integration detail: setup cancellation snapshots the session engine’s current adapted estimates through getEstimates(), rather than rereading storage. Practice and Legend are non-modal panels beside the keying surface; focus returns to that surface for Speak-code acceptance/Start. Learning a switch re-enables its source after a previous key/tap or blink choice disabled it.

### Requirement 25: Round-2 setup safety and code access

25.1. WHEN the guard commits s, o, s as its last characters, including intervening word gaps, THE Onboarding_Controller SHALL raise the alarm before applying confirmation and clear its SOS tracking after the alarm or setup closes.
25.2. WHEN Use default speed is chosen, THE flow SHALL focus the keying surface, stop practice recording, hide the practice prompt and allow single-input acceptance even with fewer than five durations.
25.3. WHILE Practice or Legend is non-modal, THE onboarding panel SHALL stack above the cheat sheet; WHEN Escape is pressed during either step of a re-run without an active modal, THE flow SHALL cancel setup.
25.4. WHEN the cheat sheet opens, THE sheet SHALL list Commands first in Speak, Next suggestion, Delete, SOS order, size pages to the available panel without an eight-entry cap, and show all codes together when they fit.
25.5. WHILE the cheat sheet is open, THE sheet SHALL provide visible Previous and Next buttons and a polite live announcement of Page X of Y, and SHALL retain six-dot single-input paging.
