# Requirements Document

## Introduction

The Morse engine is the pure TypeScript core of Dit, in `src/lib/morse/`. It turns a stream of timestamped press, release and tick inputs from a single switch into Morse symbols, committed characters, word spaces and command codes. It adapts to the user's keying rhythm, supports a fixed-speed mode, computes starting estimates from 5 calibration presses, and encodes text back into a timed press sequence for tests, the cheat sheet and onboarding demos.

The engine has no DOM, React or real clock dependency: every input carries a caller-supplied timestamp in milliseconds, and the same inputs always produce the same outputs. Input devices, UI, abbreviation expansion and the effect of commands (speaking, moving the highlight, deleting, sounding the alarm) are out of scope. The engine only emits commands.

The source of truth for numbers and behaviour is `.kiro/steering/morse-engine.md` and `docs/BRIEF.md`.

## Glossary

- **Engine**: The decoder state machine in `src/lib/morse/` that consumes Press, Release and Tick inputs and emits Engine_Events.
- **Encoder**: The function `encode(text, unit)` in `src/lib/morse/` that converts text into an Encoded_Sequence.
- **Calibrator**: The function `calibrate(durations)` in `src/lib/morse/` that computes starting Dot_Estimate and Dash_Estimate values from practice presses.
- **Press**: An Engine input `press(t)` stating that the switch went down at timestamp `t` (milliseconds).
- **Release**: An Engine input `release(t)` stating that the switch went up at timestamp `t`.
- **Tick**: An Engine input `tick(t)` stating that time advanced to timestamp `t`.
- **Press_Duration**: For a Release, the value `t − t_press`, where `t_press` is the timestamp of the Press that started the current press.
- **Silence**: For a timestamp `t` while the switch is up, the value `t − t_release`, where `t_release` is the timestamp of the most recent accepted Release.
- **WPM**: Words per minute under the PARIS standard.
- **Unit**: The length of one dot in milliseconds. Converted from WPM as `Unit = 1200 / WPM`.
- **Starting_Unit (u0)**: The Unit derived from the configured starting WPM. Default 6 WPM, which is 200 ms.
- **MIN_UNIT**: 60 ms.
- **MAX_UNIT**: 1500 ms.
- **Dot_Estimate**: The Engine's current estimate, in milliseconds, of the user's dot press length.
- **Dash_Estimate**: The Engine's current estimate, in milliseconds, of the user's dash press length.
- **Dot_Dash_Threshold**: `(Dot_Estimate + Dash_Estimate) / 2`.
- **Letter_Gap_Threshold**: `2 × Dot_Estimate`.
- **Word_Gap_Threshold**: `4.5 × Dot_Estimate`.
- **Estimate_Guards**: The rules applied, in this order, whenever Dot_Estimate or Dash_Estimate is set: (1) clamp both estimates to `[MIN_UNIT, 3 × MAX_UNIT]`; (2) clamp Dot_Estimate to at most MAX_UNIT; (3) if `Dash_Estimate < 1.5 × Dot_Estimate`, set `Dash_Estimate = 1.5 × Dot_Estimate`.
- **Adaptation_Rate (α)**: The exponential-moving-average weight used in adaptation. Default 0.15.
- **Adaptive_Mode**: The Engine mode in which Dot_Estimate and Dash_Estimate are updated from classified presses. The default mode.
- **Fixed_Speed_Mode**: The Engine mode in which Dot_Estimate and Dash_Estimate keep their initial values.
- **Pattern_Buffer**: The ordered dot (`.`) and dash (`-`) symbols keyed since the last commit.
- **Commit**: Looking up the Pattern_Buffer contents, emitting the matching Engine_Event, and clearing the Pattern_Buffer.
- **Space_Eligible**: An Engine flag that becomes true when a `char` Engine_Event is emitted, and becomes false when a `space`, `command` or `unknown` Engine_Event is emitted, at Engine creation, and on `reset()`.
- **Character_Table**: The mapping from Supported_Characters to their ITU Morse codes, listed in Requirement 3.
- **Command_Table**: The mapping from Command_Codes to command names, listed in Requirement 4.
- **Command_Code**: One of the patterns `.-.-.` (speak), `..--` (next), `----` (backspace), `...---...` (sos).
- **Supported_Character**: A character in the Character_Table: letters `a`–`z`, digits `0`–`9`, and the punctuation `. , ? ' ! / - ( ) : = @ "`. Uppercase letters `A`–`Z` are accepted by the Encoder as their lowercase forms.
- **Whitespace**: The characters space (U+0020), tab (U+0009), line feed (U+000A) and carriage return (U+000D).
- **Supported_String**: A string whose characters are all Supported_Characters, uppercase letters, or Whitespace, and which contains at least one non-Whitespace character.
- **Normalized_Text**: For a Supported_String, the string lowercased, with leading and trailing Whitespace removed, and each run of Whitespace replaced by one space (U+0020).
- **Engine_Event**: One output of the Engine, one of: `{ type: 'symbol', symbol: '.' | '-' }`, `{ type: 'char', char }`, `{ type: 'space' }`, `{ type: 'command', command: 'speak' | 'next' | 'backspace' | 'sos' }`, `{ type: 'unknown', pattern }`.
- **Decoded_Text**: The string formed by concatenating, in emission order, the `char` value of every `char` Engine_Event and one space (U+0020) for every `space` Engine_Event.
- **Encoded_Sequence**: The Encoder's successful output: an ordered list of Press and Release inputs with timestamps, plus an End_Time.
- **End_Time**: The timestamp in an Encoded_Sequence at which a Tick commits the final character without producing a word gap.
- **Jitter_Factor**: A multiplier in `[0.7, 1.3]` applied independently to the length of each press and each gap in an Encoded_Sequence.
- **Result**: A discriminated union `{ ok: true, value } | { ok: false, error }` used for operations that can fail.

## Requirements

### Requirement 1: Timing model and speed configuration

**User Story:** As a speaker with a slow, single movement, I want the engine to start at a slow, configurable speed, so that my first presses are read correctly.

#### Acceptance Criteria

1. THE Engine SHALL convert a finite, positive WPM value to a Unit as `1200 / WPM` milliseconds, and a finite, positive Unit to WPM as `1200 / Unit`, so that 2 WPM converts to 600 ms, 6 WPM to 200 ms and 20 WPM to 60 ms.
2. WHEN the Engine is created without a starting WPM, THE Engine SHALL use a Starting_Unit of 200 ms (6 WPM).
3. WHEN the Engine is created with a starting WPM that is a finite number in the range 2 to 20 inclusive (non-integer values allowed), THE Engine SHALL use a Starting_Unit of `1200 / WPM` milliseconds, a value in the range 60 ms to 600 ms inclusive.
4. IF the Engine is created with a starting WPM that is not a finite number in the range 2 to 20 inclusive (including NaN, ±Infinity, values below 2 and values above 20), THEN THE Engine creation SHALL return a failed Result that names the starting WPM as the invalid setting, and SHALL NOT return an Engine.
5. IF the Engine is created with an Adaptation_Rate that is not a finite number greater than 0 and at most 1, THEN THE Engine creation SHALL return a failed Result that names the Adaptation_Rate as the invalid setting, and SHALL NOT return an Engine.
6. WHEN the Engine is created without initial estimates, THE Engine SHALL set Dot_Estimate to Starting_Unit and Dash_Estimate to `3 × Starting_Unit`.
7. WHEN the Engine is created with initial Dot_Estimate and Dash_Estimate values that are both finite numbers greater than 0, THE Engine SHALL set the estimates to those values and then apply the Estimate_Guards before processing any Press, Release or Tick.
8. IF the Engine is created with only one of the two initial estimates, or with an initial Dot_Estimate or Dash_Estimate that is not a finite number greater than 0, THEN THE Engine creation SHALL return a failed Result that names each invalid estimate setting, and SHALL NOT return an Engine.
9. WHEN the Engine is created without a mode setting, THE Engine SHALL operate in Adaptive_Mode; WHEN the Engine is created with Fixed_Speed_Mode selected, THE Engine SHALL keep Dot_Estimate and Dash_Estimate equal to their post-creation values (from criterion 6 or 7) for the Engine's lifetime, including across `reset()`.
10. THE Engine SHALL compute Dot_Dash_Threshold, Letter_Gap_Threshold and Word_Gap_Threshold from the Dot_Estimate and Dash_Estimate in effect at the moment of each classification, where the classification of a Release uses the estimates in effect before any adaptation update caused by that same Release.
11. THE Engine SHALL expose read-only access to the current Dot_Estimate, Dash_Estimate, Dot_Dash_Threshold, Letter_Gap_Threshold and Word_Gap_Threshold, where each returned value reflects every Press, Release and Tick processed so far, and reading these values SHALL NOT change any estimate, threshold or later Engine_Event.

### Requirement 2: Press classification

**User Story:** As a speaker, I want short presses read as dots and long presses read as dashes, so that I can key any Morse pattern with one input.

#### Acceptance Criteria

1. WHEN a Release is received while the switch is down with a Press_Duration greater than 0 and less than Dot_Dash_Threshold, THE Engine SHALL append `.` to the Pattern_Buffer and emit exactly one `{ type: 'symbol', symbol: '.' }` Engine_Event. The Engine SHALL compute Dot_Dash_Threshold from the Dot_Estimate and Dash_Estimate values in effect before this press updates them.
2. WHEN a Release is received while the switch is down with a Press_Duration greater than or equal to Dot_Dash_Threshold, THE Engine SHALL append `-` to the Pattern_Buffer and emit exactly one `{ type: 'symbol', symbol: '-' }` Engine_Event. The Engine SHALL compute Dot_Dash_Threshold from the Dot_Estimate and Dash_Estimate values in effect before this press updates them.
3. IF a Release is received while the switch is down with a Press_Duration less than or equal to 0, THEN THE Engine SHALL set the switch to up, discard the press, emit no Engine_Event, and leave the Pattern_Buffer, Dot_Estimate and Dash_Estimate unchanged. The Engine SHALL also keep measuring Silence from the timestamp of the previous accepted Release.
4. IF a Press is received while the switch is already down, THEN THE Engine SHALL ignore the Press, emit no Engine_Event, and keep the timestamp of the original Press as the start of the current press.
5. IF a Release is received while the switch is up, THEN THE Engine SHALL ignore the Release, emit no Engine_Event, and leave the Pattern_Buffer, Dot_Estimate, Dash_Estimate and Silence measurement unchanged.
6. IF a Press, Release or Tick is received with a timestamp earlier than the timestamp of the last accepted input, THEN THE Engine SHALL ignore the input, emit no Engine_Event, and leave the switch state, Pattern_Buffer, Dot_Estimate and Dash_Estimate unchanged. An input whose timestamp equals the timestamp of the last accepted input SHALL NOT be ignored under this criterion. Here, the last accepted input is the most recent input that was not ignored under criteria 4, 5, 6 or 8.
7. WHEN a Release appends the 10th symbol to the Pattern_Buffer, THE Engine SHALL emit, in this order, the `symbol` Engine_Event and then `{ type: 'unknown', pattern }` with the 10-symbol pattern. The Engine SHALL then clear the Pattern_Buffer, emit no `char` or `command` Engine_Event for that pattern, and set Space_Eligible to false.
8. IF a Press, Release or Tick is received with a timestamp that is not a finite number, THEN THE Engine SHALL ignore the input, emit no Engine_Event, and leave the switch state, Pattern_Buffer, Dot_Estimate and Dash_Estimate unchanged.

### Requirement 3: Character table

**User Story:** As a speaker, I want letters, digits and common punctuation decoded with standard ITU codes, so that existing Morse knowledge and cheat sheets apply.

#### Acceptance Criteria

1. THE Character_Table SHALL map the 26 lowercase letters to these codes: a `.-`, b `-...`, c `-.-.`, d `-..`, e `.`, f `..-.`, g `--.`, h `....`, i `..`, j `.---`, k `-.-`, l `.-..`, m `--`, n `-.`, o `---`, p `.--.`, q `--.-`, r `.-.`, s `...`, t `-`, u `..-`, v `...-`, w `.--`, x `-..-`, y `-.--`, z `--..`.
2. THE Character_Table SHALL map the 10 digits to these codes: 0 `-----`, 1 `.----`, 2 `..---`, 3 `...--`, 4 `....-`, 5 `.....`, 6 `-....`, 7 `--...`, 8 `---..`, 9 `----.`.
3. THE Character_Table SHALL map the 13 punctuation characters to these codes: `.` `.-.-.-`, `,` `--..--`, `?` `..--..`, `'` `.----.`, `!` `-.-.--`, `/` `-..-.`, `-` `-....-`, `(` `-.--.`, `)` `-.--.-`, `:` `---...`, `=` `-...-`, `@` `.--.-.`, `"` `.-..-.`.
4. THE Character_Table SHALL contain exactly the 49 Supported_Characters listed in criteria 1 to 3 (26 letters, 10 digits, 13 punctuation characters) and no other entries, including no uppercase letter entries.
5. THE Character_Table SHALL map distinct Supported_Characters to distinct codes (injective mapping), and no Character_Table code SHALL equal any Command_Code.
6. WHEN a Commit occurs and the Pattern_Buffer contents equal a Character_Table code and do not equal any Command_Code, THE Engine SHALL emit exactly one `char` Engine_Event whose `char` value is the Supported_Character mapped to that code, with letters emitted as their lowercase form (`a`–`z`) and digits and punctuation emitted as the exact character listed in criteria 2 and 3.
7. THE Character_Table SHALL exclude the character `+`, because the ITU code for `+` (`.-.-.`) is the speak Command_Code.
8. WHEN a Commit occurs and the Pattern_Buffer contents equal a Command_Code, THE Engine SHALL look up the Command_Table before the Character_Table and SHALL emit no `char` Engine_Event for that Commit.
9. IF the Encoder receives text containing the character `+`, THEN THE Encoder SHALL return a Result with `ok: false` whose error identifies `+` as an unsupported character, and SHALL NOT produce the pattern `.-.-.` for that character.

### Requirement 4: Command codes

**User Story:** As a speaker, I want Morse patterns that are not letters to trigger speak, next, backspace and help, so that every function is reachable with my one input.

#### Acceptance Criteria

1. THE Command_Table SHALL map `.-.-.` to `speak`, `..--` to `next`, `----` to `backspace`, and `...---...` to `sos`, and SHALL contain exactly these 4 entries.
2. THE Command_Table and the Character_Table SHALL share no code, so that no Command_Code equals any Character_Table code.
3. WHEN the Engine commits a Pattern_Buffer whose contents equal a Command_Code, THE Engine SHALL emit exactly one `{ type: 'command', command }` Engine_Event with the command name mapped by the Command_Table, SHALL emit no `char` or `unknown` Engine_Event for that pattern, and SHALL leave the Pattern_Buffer empty.
4. WHEN the Engine commits the pattern `.-.-.`, THE Engine SHALL emit `{ type: 'command', command: 'speak' }`.
5. WHEN the Engine emits a `command` Engine_Event, THE Engine SHALL set Space_Eligible to false, whatever its value was before the command.
6. WHEN the Engine has committed a Command_Code and the Silence after the Release that ended the command's last symbol reaches or exceeds Word_Gap_Threshold with no intervening Press, THE Engine SHALL emit no `space` Engine_Event for that Silence period.
7. WHEN the Engine emits a `command` Engine_Event, THE Engine SHALL leave Decoded_Text unchanged, because the command's action (speaking, moving the highlight, deleting a character, or raising the help alarm) belongs to the conversation layer and not the Engine.

### Requirement 5: Letter gap and commit

**User Story:** As a speaker, I want a short pause to finish a character, so that I can key letters one after another without extra actions.

#### Acceptance Criteria

1. WHEN a Tick is received while the switch is up, the Pattern_Buffer is non-empty, and Silence at the Tick timestamp is greater than or equal to the current Letter_Gap_Threshold, THE Engine SHALL commit the Pattern_Buffer exactly once.
2. WHEN a Press is received while the Pattern_Buffer is non-empty and Silence at the Press timestamp is greater than or equal to the current Letter_Gap_Threshold, THE Engine SHALL commit the Pattern_Buffer and emit the commit's Engine_Event before any Engine_Event produced by the new press, so that the new press's symbol becomes the first symbol of an empty Pattern_Buffer.
3. IF a Press is received while the Pattern_Buffer is non-empty and Silence at the Press timestamp is less than the current Letter_Gap_Threshold, THEN THE Engine SHALL keep the Pattern_Buffer contents and append the symbol classified at that press's Release to the end of the existing contents.
4. IF a Tick is received while Silence at the Tick timestamp is less than the current Letter_Gap_Threshold, THEN THE Engine SHALL emit no Engine_Event and leave the Pattern_Buffer contents unchanged.
5. WHEN the Engine commits a Pattern_Buffer, THE Engine SHALL look up the contents in the Command_Table before the Character_Table.
6. WHEN the Engine commits a Pattern_Buffer whose contents exactly match a Command_Code, THE Engine SHALL emit `{ type: 'command', command }` with the mapped command name and set Space_Eligible to false.
7. WHEN the Engine commits a Pattern_Buffer whose contents exactly match a Character_Table code and no Command_Code, THE Engine SHALL emit `{ type: 'char', char }` with the mapped lowercase character and set Space_Eligible to true.
8. IF the Engine commits a Pattern_Buffer whose contents match neither table, THEN THE Engine SHALL emit `{ type: 'unknown', pattern }` with the buffered pattern as a string of `.` and `-` symbols in keyed order, and set Space_Eligible to false.
9. WHEN the Engine commits a Pattern_Buffer, THE Engine SHALL emit exactly one `command`, `char` or `unknown` Engine_Event for that commit and clear the Pattern_Buffer to empty.
10. IF the Pattern_Buffer is empty when a Tick or Press is received, THEN THE Engine SHALL perform no commit and emit no `command`, `char` or `unknown` Engine_Event for that input.

### Requirement 6: Word gap and spaces

**User Story:** As a speaker, I want a longer pause to insert one space between words, so that my text reads as separate words.

#### Acceptance Criteria

1. WHEN a Tick or Press is received at timestamp `t` while the switch is up, and Silence at `t` is greater than or equal to Word_Gap_Threshold, and Space_Eligible is true after any Commit triggered by that same input has been applied, THE Engine SHALL emit exactly one `{ type: 'space' }` Engine_Event, ordered after every Engine_Event produced by that Commit and before any Engine_Event produced by the Press itself, and SHALL set Space_Eligible to false.
2. THE Engine SHALL emit at most one `space` Engine_Event per Silence period, where a Silence period is the interval from an accepted Release (a Release with Press_Duration greater than 0) to the next Press.
3. WHILE Space_Eligible is false, THE Engine SHALL emit no `space` Engine_Event, including when Silence is greater than or equal to Word_Gap_Threshold.
4. THE Engine SHALL emit no `space` Engine_Event after Engine construction or after the most recent `reset()` until at least one `char` Engine_Event has been emitted.
5. THE Engine SHALL emit no two `space` Engine_Events without a `char` Engine_Event emitted between them. `symbol`, `command` and `unknown` Engine_Events between two `space` Engine_Events do not satisfy this requirement.
6. WHEN the Engine emits a `char` Engine_Event, THE Engine SHALL set Space_Eligible to true.
7. WHEN the Engine emits a `command` or `unknown` Engine_Event, THE Engine SHALL set Space_Eligible to false, so that a word gap after that Commit emits no `space` Engine_Event.
8. WHEN `reset()` is called, THE Engine SHALL set Space_Eligible to false and keep Dot_Estimate, Dash_Estimate and Word_Gap_Threshold unchanged.

### Requirement 7: Scheduling deadline and tick handling

**User Story:** As a UI developer, I want the engine to tell me when the next gap threshold will be crossed, so that I schedule exactly one timer instead of polling.

#### Acceptance Criteria

1. WHILE the switch is up and the Pattern_Buffer is non-empty, THE Engine SHALL return `t_release + Letter_Gap_Threshold` from `nextDeadline()`, where `t_release` is the timestamp of the most recent accepted Release and Letter_Gap_Threshold uses the Dot_Estimate in effect at the time of the call.
2. WHILE the switch is up, the Pattern_Buffer is empty, Space_Eligible is true, and no `space` Engine_Event has been emitted since the most recent accepted Release, THE Engine SHALL return `t_release + Word_Gap_Threshold` from `nextDeadline()`, where Word_Gap_Threshold uses the Dot_Estimate in effect at the time of the call.
3. WHILE the switch is up and neither criterion 1 nor criterion 2 applies (including the initial state before any accepted Release, and the state after `reset()` with an empty Pattern_Buffer), THE Engine SHALL return `null` from `nextDeadline()`.
4. WHILE the switch is down, THE Engine SHALL return `null` from `nextDeadline()` and SHALL return an empty Engine_Event list for every Tick, whatever its timestamp.
5. WHEN a Tick is received with a timestamp strictly less than the non-null value returned by `nextDeadline()` immediately before that Tick, THE Engine SHALL return an empty Engine_Event list and leave the Pattern_Buffer, Space_Eligible, Dot_Estimate and Dash_Estimate unchanged.
6. WHILE the switch is up and `nextDeadline()` returns `null`, THE Engine SHALL return an empty Engine_Event list for every Tick and leave the Pattern_Buffer, Space_Eligible, Dot_Estimate and Dash_Estimate unchanged.
7. WHEN `nextDeadline()` is called, THE Engine SHALL leave its state unchanged and emit no Engine_Event, so that two consecutive calls with no input between them return the same value.
8. WHEN any Press, Release or Tick is processed, THE Engine SHALL return the Engine_Events produced by that input as an ordered list in emission order, which is an empty list when no Engine_Event is produced.

### Requirement 8: Adaptive timing

**User Story:** As a speaker whose speed changes with fatigue, I want the engine to follow my rhythm, so that I am not forced to key at a fixed tempo.

#### Acceptance Criteria

1. WHILE the Engine is in Adaptive_Mode, WHEN a Release with Press_Duration greater than 0 ms is classified as a dot, THE Engine SHALL set Dot_Estimate to `Dot_Estimate + α × (d − Dot_Estimate)`, where `Dot_Estimate` is the value held before this Release and `d` is the Press_Duration clamped to `[0.5 × Dot_Estimate, 2 × Dot_Estimate]` using that same prior value.
2. WHILE the Engine is in Adaptive_Mode, WHEN a Release with Press_Duration greater than 0 ms is classified as a dash, THE Engine SHALL set Dash_Estimate to `Dash_Estimate + α × (d − Dash_Estimate)`, where `Dash_Estimate` is the value held before this Release and `d` is the Press_Duration clamped to `[0.5 × Dash_Estimate, 2 × Dash_Estimate]` using that same prior value.
3. WHEN the Engine updates Dot_Estimate or Dash_Estimate under criterion 1 or 2, THE Engine SHALL apply the Estimate_Guards to both estimates after the moving-average update and before processing the next input.
4. THE Engine SHALL classify each press by comparing its Press_Duration with the Dot_Dash_Threshold computed from the Dot_Estimate and Dash_Estimate held before that press's Release, and SHALL use the post-update estimates for every threshold applied to inputs after that Release.
5. THE Engine SHALL change Dot_Estimate and Dash_Estimate only under criteria 1–3, so that Press inputs, Tick inputs, Silence durations, and Releases with Press_Duration less than or equal to 0 ms leave both estimates unchanged.
6. WHILE the Engine is in Adaptive_Mode, WHEN the Engine starts with Dot_Estimate = u0 and Dash_Estimate = `3 × u0` and receives 40 presses that include at least 15 dots and at least 15 dashes, where the true unit `u*` is in `[0.75 × u0, 1.75 × u0]` with `u* ≥ MIN_UNIT`, each dot lasts `u* × f` and each dash lasts `3 × u* × f` with `f` drawn independently per press from `[0.9, 1.1]`, THE Engine SHALL hold a Dot_Estimate within 15% of `u*` and a Dash_Estimate within 15% of `3 × u*` immediately after the 40th Release (convergence property).
7. WHILE the Engine is in Adaptive_Mode, THE Engine SHALL keep Dot_Estimate and Dash_Estimate within `[MIN_UNIT, 3 × MAX_UNIT]`, Dot_Estimate at most MAX_UNIT, and Dash_Estimate at least `1.5 × Dot_Estimate` after every Press, Release and Tick input (invariant property).
8. WHILE the Engine is in Fixed_Speed_Mode, THE Engine SHALL keep Dot_Estimate and Dash_Estimate equal to their initial values after every Press, Release and Tick input.
9. WHEN the Engine is reset, THE Engine SHALL keep the Dot_Estimate and Dash_Estimate values it held before the reset.

### Requirement 9: Fixed-speed mode

**User Story:** As a speaker or partner, I want to switch adaptation off, so that the speed stays exactly where it was set.

#### Acceptance Criteria

1. WHERE Fixed_Speed_Mode is configured, WHEN the Engine is created with supplied initial Dot_Estimate and Dash_Estimate values, THE Engine SHALL set its initial estimates to the supplied values after applying Estimate_Guards.
2. WHERE Fixed_Speed_Mode is configured, WHEN the Engine is created without supplied initial estimates, THE Engine SHALL set its initial Dot_Estimate to u0 and its initial Dash_Estimate to `3 × u0` after applying Estimate_Guards. With the default starting WPM of 6, these values are 200 ms and 600 ms.
3. WHERE Fixed_Speed_Mode is configured, THE Engine SHALL keep Dot_Estimate and Dash_Estimate exactly equal to their initial values after every Press, Release and Tick input. This includes inputs that emit no Engine_Event, inputs that produce an `unknown` Engine_Event, and presses of any Press_Duration.
4. WHERE Fixed_Speed_Mode is configured, THE Engine SHALL classify each Release with Dot_Dash_Threshold, and each Silence with Letter_Gap_Threshold and Word_Gap_Threshold, using the same classification rules as Adaptive_Mode, with each threshold computed from the fixed Dot_Estimate and Dash_Estimate.
5. WHERE Fixed_Speed_Mode is configured, WHEN the same sequence of Press, Release and Tick inputs is fed to two Engines created with identical initial estimates, THE Engine SHALL emit an identical sequence of Engine_Events from both.

### Requirement 10: Reset

**User Story:** As the conversation layer, I want to clear an in-progress character without losing the learned speed, so that a cleared screen starts clean.

#### Acceptance Criteria

1. WHEN `reset()` is called, THE Engine SHALL empty the Pattern_Buffer, clear the switch-down state so that the switch is treated as up with no pending Press, discard the timestamp of the most recent accepted Release, and set Space_Eligible to false. This applies whatever the Engine's state was before the call, including while the switch is down or while the Pattern_Buffer holds 1 or more symbols.
2. WHEN `reset()` is called, THE Engine SHALL leave the current Dot_Estimate, Dash_Estimate, Adaptation_Rate, and the selected mode (Adaptive_Mode or Fixed_Speed_Mode) unchanged, and SHALL NOT restore them to their initial or calibrated values.
3. WHEN `reset()` is called, THE Engine SHALL emit 0 Engine_Events. This includes emitting no `char`, `command`, or `unknown` Engine_Event for any symbols that were in the Pattern_Buffer before the call.
4. WHILE no Release has been accepted since the most recent `reset()` call, THE Engine SHALL return `null` from `nextDeadline()`.
5. WHILE no Press has been accepted since the most recent `reset()` call, WHEN `tick(t)` is called with any timestamp `t`, THE Engine SHALL emit 0 Engine_Events and leave the Pattern_Buffer and Space_Eligible unchanged.
6. IF `release(t)` is called after `reset()` and no Press has been accepted since that `reset()` call, THEN THE Engine SHALL ignore the Release: emit 0 Engine_Events, leave Dot_Estimate and Dash_Estimate unchanged, and not treat it as an accepted Release.
7. WHEN `press(t)` is called after `reset()`, THE Engine SHALL treat it as the first press of a new character. When this press is classified and committed, the resulting `char` Engine_Event SHALL NOT be preceded by a `space` Engine_Event caused by the time between the last input before the reset and this Press.

### Requirement 11: Calibration

**User Story:** As a new speaker, I want 5 practice presses to set my starting speed, so that the engine matches my movement within a minute.

#### Acceptance Criteria

1. WHEN the Calibrator receives a list of exactly 5 Press_Durations, each a finite number greater than 0 ms, THE Calibrator SHALL treat the durations at positions 1–3 (input order) as the short presses and the durations at positions 4–5 as the long presses, and SHALL compute the raw Dot_Estimate as the median of the 3 short presses and the raw Dash_Estimate as the mean of the 2 long presses.
2. IF the raw Dash_Estimate from criterion 1 is strictly less than `1.5 ×` the raw Dot_Estimate, THEN THE Calibrator SHALL replace the raw Dash_Estimate with `3 ×` the raw Dot_Estimate before any Estimate_Guards are applied. A raw Dash_Estimate exactly equal to `1.5 ×` the raw Dot_Estimate SHALL be kept.
3. WHEN the Calibrator has computed the raw Dot_Estimate and raw Dash_Estimate (after criterion 2, if it applies), THE Calibrator SHALL apply the Estimate_Guards once, in their defined order, and SHALL return the guarded values as Dot_Estimate and Dash_Estimate with no reason.
4. IF the Calibrator receives an input that is not a list, a list whose length is not exactly 5, or a list with any element that is not a finite number greater than 0 (including 0, negative numbers, NaN, positive or negative Infinity, and non-number values), THEN THE Calibrator SHALL return Dot_Estimate equal to u0, Dash_Estimate equal to `3 × u0`, and a reason. The reason SHALL state the received length when the length is wrong, or the position of the first invalid duration when a duration is invalid.
5. THE Calibrator SHALL return a Dot_Estimate and a Dash_Estimate for every input, including invalid input, without throwing, without modifying the input list, and with identical output for identical input.
6. WHEN the Engine is created with the Calibrator's Dot_Estimate and Dash_Estimate as initial estimates, THE Engine SHALL set its initial Dot_Estimate and Dash_Estimate exactly equal to those values in both Adaptive_Mode and Fixed_Speed_Mode, and SHALL derive its initial Dot_Dash_Threshold, Letter_Gap_Threshold and Word_Gap_Threshold from them.

### Requirement 12: Encoder

**User Story:** As a developer building tests, the cheat sheet and onboarding demos, I want to turn text into a timed press sequence, so that I can drive and demonstrate the engine with exact Morse timing.

#### Acceptance Criteria

1. WHEN the Encoder receives a Supported_String and a Unit that is a finite number in `[MIN_UNIT, MAX_UNIT]`, THE Encoder SHALL return a successful Result containing an Encoded_Sequence for the Normalized_Text.
2. WHEN the Encoder returns a successful Result, THE Encoder SHALL produce an Encoded_Sequence that starts with a Press at timestamp 0, alternates strictly between Press and Release with strictly increasing timestamps, ends with a Release, and contains exactly one Press and one Release for each dot or dash of each character's Character_Table code, in text order and code order.
3. WHEN the Encoder returns a successful Result, THE Encoder SHALL give each dot press a length of exactly 1 Unit and each dash press a length of exactly 3 Units, each measured from a Press to the next Release, with every timestamp equal to a whole number of Units multiplied by Unit and not rounded to whole milliseconds.
4. WHEN the Encoder returns a successful Result, THE Encoder SHALL separate symbols inside one character by exactly 1 Unit, consecutive characters inside one word by exactly 3 Units, and consecutive words by exactly 7 Units, each measured from a Release to the next Press, and SHALL produce no Press or Release for the space characters in the Normalized_Text.
5. WHEN the Encoder returns a successful Result, THE Encoder SHALL set End_Time to exactly 3 Units after the timestamp of the last Release.
6. WHEN the Encoder receives an uppercase letter `A`–`Z`, THE Encoder SHALL encode it with the Character_Table code of the matching lowercase letter.
7. IF the Encoder receives text that contains characters that are neither Supported_Characters, uppercase letters, nor Whitespace, THEN THE Encoder SHALL return a failed Result that contains no Encoded_Sequence and lists every occurrence of each such character with its zero-based index in the original input text, in ascending index order.
8. IF the Encoder receives text that contains the character `+`, THEN THE Encoder SHALL return a failed Result that lists each `+` as unsupported with its zero-based index and contains no Encoded_Sequence and no `.-.-.` pattern.
9. IF the Encoder receives text that is the empty string or contains only Whitespace, THEN THE Encoder SHALL return a failed Result that contains no Encoded_Sequence and states that the text is empty.
10. IF the Encoder receives a Unit that is not a finite number in `[MIN_UNIT, MAX_UNIT]` (including `NaN`, `Infinity`, `-Infinity`, values below 60 ms and values above 1500 ms), THEN THE Encoder SHALL return a failed Result that contains no Encoded_Sequence and names the invalid Unit value.
11. IF the Encoder receives both an invalid Unit and text that fails criterion 7, 8 or 9, THEN THE Encoder SHALL return one failed Result that reports both the invalid Unit and the text error.
12. WHEN an Engine in Fixed_Speed_Mode, created with initial Dot_Estimate equal to the Unit passed to the Encoder and initial Dash_Estimate equal to 3 × that Unit, is fed every Press and Release of a successful Encoded_Sequence in order followed by a Tick at End_Time, THE Engine SHALL produce a Decoded_Text equal to the Normalized_Text of the encoded string.
13. WHEN the Encoder is called twice with the same text and the same Unit, THE Encoder SHALL return identical Results.

### Requirement 13: Encode–decode roundtrip

**User Story:** As a developer, I want encoding then decoding to give back the original text, so that the tables, encoder and decoder are proven consistent.

#### Acceptance Criteria

1. FOR ALL Supported_Characters `c`, all uppercase letters `c` in `A`–`Z`, and all Units `u` in `[MIN_UNIT, MAX_UNIT]`, `encode(c, u)` SHALL return a Result with `ok: true`, and feeding its Encoded_Sequence in order into a new Engine in Fixed_Speed_Mode with Dot_Estimate = `u` and Dash_Estimate = `3 × u`, followed by one Tick at End_Time, SHALL produce Decoded_Text equal to the lowercase form of `c` (roundtrip property).
2. FOR ALL Supported_Strings `x` of 1 to 200 characters and all Units `u` in `[MIN_UNIT, MAX_UNIT]`, `encode(x, u)` SHALL return a Result with `ok: true`, and feeding its Encoded_Sequence in order into a new Engine in Fixed_Speed_Mode with Dot_Estimate = `u` and Dash_Estimate = `3 × u`, followed by one Tick at End_Time, SHALL produce Decoded_Text equal to the Normalized_Text of `x` (roundtrip property).
3. FOR ALL Supported_Strings `x` and Units `u` as in criterion 2, decoding the Encoded_Sequence of `x` as in criterion 2 SHALL emit zero `unknown` Engine_Events and zero `command` Engine_Events.
4. FOR ALL Supported_Strings `x` and Units `u` as in criterion 2, inserting any number of extra Ticks between consecutive inputs of the Encoded_Sequence, with timestamps that never decrease and never exceed End_Time, SHALL produce the same Decoded_Text as criterion 2 (Tick-insensitivity property).
5. FOR ALL Supported_Strings `x` and Units `u` as in criterion 2, decoding the Encoded_Sequence as in criterion 2 SHALL emit exactly one `symbol` Engine_Event per Press, and each symbol SHALL match, in order, the dots and dashes of the Character_Table codes of the non-space characters of the Normalized_Text of `x`.

### Requirement 14: Jitter tolerance at fixed speed

**User Story:** As a speaker whose movement is imprecise, I want decoding to tolerate uneven timing, so that small timing errors do not change my words.

#### Acceptance Criteria

1. FOR ALL Supported_Strings `x`, all Units `u` that are finite numbers in `[MIN_UNIT, MAX_UNIT]`, and all assignments of an independent Jitter_Factor, drawn from the closed interval `[0.7, 1.3]` with both endpoints allowed, to every press length and every gap length in the Encoded_Sequence of `x` at Unit `u`, THE jittered sequence SHALL be built as follows. Each gap length means every 1-Unit gap inside a character, every 3-Unit gap between characters, every 7-Unit gap between words, and the final 3-Unit gap between the last Release and End_Time. Each press length and each gap length is multiplied by its own Jitter_Factor. The first Press keeps timestamp 0. Every later Press and Release timestamp is rebuilt as the running sum of the jittered lengths that come before it, so the order of Press and Release inputs is unchanged. The jittered End_Time is the last jittered Release timestamp plus `3 × u` multiplied by the Jitter_Factor of the final gap.
2. FOR ALL jittered sequences built as in criterion 1, feeding the Press and Release inputs in order into a new Engine in Fixed_Speed_Mode, created with initial Dot_Estimate `u` and Dash_Estimate `3 × u`, followed by exactly one Tick at the jittered End_Time, SHALL produce Decoded_Text equal to the Normalized_Text of `x`, with no trailing space (jitter property).
3. FOR ALL jittered sequences built as in criterion 1, decoding as in criterion 2 SHALL produce the same ordered list of Engine_Events as decoding the unjittered Encoded_Sequence of `x` as in Requirement 13 criterion 2. That list contains no `unknown` and no `command` Engine_Event (jitter event-equivalence property).

### Requirement 15: Determinism and injected time

**User Story:** As a developer, I want the engine to depend only on its inputs, so that every run and every test is reproducible.

#### Acceptance Criteria

1. THE Engine SHALL compute every Press_Duration, every Silence and every threshold comparison only from the timestamps passed to Press, Release and Tick, the Engine configuration, and the Engine's own state.
2. THE Engine, the Encoder and the Calibrator SHALL read no system clock (including `Date`, `performance` and timer functions), no random number source (including `Math.random` and `crypto`), no storage, no DOM and no browser global.
3. FOR ALL configurations and input sequences, replaying the same sequence of Press, Release, Tick and `reset()` calls, with the same timestamps, on two new Engines with the same configuration SHALL produce, after every call, Engine_Event lists that are deeply equal and Dot_Estimate and Dash_Estimate values that are strictly equal (`===`) (determinism property).
4. FOR ALL inputs, calling the Encoder twice with the same text and Unit, or calling the Calibrator twice with the same durations, SHALL return deeply equal Results (determinism property).
5. FOR ALL input sequences that contain no `reset()` call and end with the switch up, inserting any number of extra Ticks, each with a timestamp at or after the preceding input's timestamp and at or before the following input's timestamp, SHALL leave unchanged both the concatenation, in call order, of the Engine_Event lists returned by all calls and the final Dot_Estimate and Dash_Estimate values. This holds provided both sequences end with a Tick whose timestamp is at or after the final deadline, where the final deadline is the timestamp of the last Release plus the Word_Gap_Threshold in effect after that Release (tick-independence property).
6. THE modules in `src/lib/morse/` SHALL import nothing from `react`, `next`, `src/components` or `src/hooks`, either directly or through other modules.
