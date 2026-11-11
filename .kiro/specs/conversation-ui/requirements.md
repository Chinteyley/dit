# Requirements Document

## Introduction

Conversation UI is the part of Dit the speaker and the partner see and hear. It turns Engine_Events from the Morse engine into typed text, shows up to 3 suggestions from the expansion client, speaks the chosen sentence, keeps a conversation history, and gives the partner a large display, a Listen toggle, a typed-line field and a settings panel. It implements MVP items 3 (command effects other than SOS), 5, 6 and 8 of `docs/BRIEF.md`, and the UI side of items 1 and 4.

The feature has these parts:

1. A pure Session_Reducer in `src/lib/conversation/session.ts` that holds the current text, suggestions, highlight, turns and last spoken sentence.
2. Storage in `src/lib/conversation/storage.ts` that persists history and settings in localStorage only, with Zod-validated reads.
3. A Session_Hook in `src/hooks/useMorseSession.ts` that connects the Input_Arbiter, the Engine, the Session_Reducer, the expansion Client, speech output and the alarm handler.
4. React components in `src/components/`: Keying_Surface, Symbol_Stream, Stream_Band, Suggestion_List, Partner_Display, History_View, Listen_Toggle, Partner_Line_Form and Settings_Panel.
5. Speech wrappers in `src/lib/speech/` for Web Speech synthesis and recognition, behind interfaces so tests use fakes.

This spec depends on, and does not restate, three sibling specs:

- `morse-engine`: Engine_Event stream, `press(t)`, `release(t)`, `tick(t)`, `nextDeadline()`, `reset()`, and the engine configuration (starting WPM, Adaptive_Mode or Fixed_Speed_Mode, initial estimates).
- `input-sources`: the Press_Event stream from the Input_Arbiter, the Pending_Press signal, the Settings_Store interface that this layer implements, and the rule that the UI returns focus to the Keying_Surface after a partner control is activated.
- `expansion`: the Client, which takes typed text and context and delivers Expansion_Results `{ text, suggestions (0 to 3), source: 'ai' | 'on-device' }`.

A fourth sibling spec, `onboarding-and-safety`, owns first-run onboarding and calibration, the Command_Legend, the cheat-sheet overlay, and the SOS alarm. This spec only forwards `sos` commands and `unknown` patterns to that spec's Alarm_Handler and Unknown_Pattern_Handler, routes presses to the Alarm_Handler while the alarm is active, and reserves screen space for the Command_Legend.

Out of scope: anything the brief lists as out of scope, onboarding, the Command_Legend content, the cheat sheet, the alarm card and chime, Morse decoding, input sources and expansion logic.

Sources of truth: `docs/BRIEF.md` and `.kiro/steering/` (`product.md`, `accessibility.md`, `tech.md`, `structure.md`).

Requirements 24 to 28 come from a design polish pass on 2026-11-11, after a review of the main screen. They compose the screen around one Composer_Panel that is the Keying_Surface, show each press with a small Press_Indicator instead of a full-surface fill, give the live Morse tape the stage, turn the suggestions into numbered cards with one unmistakable highlighted card, and group the partner tools in a quiet Partner_Zone. Criteria 10.5, 10.6, 14.8, 14.9 and 23.5 were changed in place for this pass, and each change says so. Behaviour does not change: roles, accessible names, the Live_Region, focus return, press routing and expansion stay as they are.

## Glossary

- **Session_Reducer**: The pure function in `src/lib/conversation/session.ts` that takes a Session_State and a Session_Action and returns the next Session_State and an ordered list of Session_Effects.
- **Session_State**: The value held by the Session_Reducer: Current_Text, Current_Pattern, Suggestions, Suggestion_Source, Highlight, Turns, Last_Spoken and a Turn ID counter.
- **Current_Text**: The text the speaker has keyed since the last speak, as a string of 0 to 500 characters.
- **Trimmed_Text**: Current_Text with leading and trailing Whitespace removed.
- **Current_Pattern**: The dots (`.`) and dashes (`-`) received in `symbol` Engine_Events since the last `char`, `space`, `command` or `unknown` Engine_Event, or since the last engine reset.
- **Suggestions**: The list of 0 to 3 sentences in Session_State that answer the current Trimmed_Text.
- **Suggestion_Source**: The source of the current Suggestions, `'ai'`, `'on-device'`, or none when Suggestions is empty.
- **Highlight**: Either an index into Suggestions, or none. None means the raw Current_Text is selected.
- **Turn**: One conversation line `{ role: 'speaker' | 'partner', text }`, as defined by the `expansion` spec, plus a numeric ID unique within the Session_State.
- **Turns**: The ordered list of Turns in Session_State, oldest first, holding at most History_Cap Turns.
- **History_Cap**: 200 Turns.
- **Context_Window**: The most recent 10 or fewer Turns, oldest first, passed to the Client.
- **Last_Spoken**: The most recent sentence spoken by the speaker, or none.
- **Session_Action**: An input to the Session_Reducer, one of: an Engine_Event (`symbol`, `char`, `space`, `command`, `unknown`), Suggestions_Received (an Expansion_Result), Partner_Line (a text string), Partner_Pick (a suggestion index), Clear_History, or Hydrate (stored Turns).
- **Session_Effect**: An instruction returned by the Session_Reducer for the Session_Hook to carry out, one of: `{ type: 'speak', sentence }`, `{ type: 'reset-engine' }`, `{ type: 'alarm' }`, `{ type: 'unknown', pattern }`.
- **Speak_Step**: The Session_Reducer behavior shared by the `speak` command and Partner_Pick: append a speaker Turn, set Last_Spoken, clear Current_Text, Current_Pattern, Suggestions, Suggestion_Source and Highlight, and return a `speak` Session_Effect followed by a `reset-engine` Session_Effect.
- **Whitespace**: The characters space (U+0020), tab (U+0009), line feed (U+000A) and carriage return (U+000D).
- **Engine**: The Morse decoder from the `morse-engine` spec.
- **Engine_Event**: An Engine output as defined by the `morse-engine` spec.
- **Input_Arbiter**: The merged press stream from the `input-sources` spec.
- **Press_Event**: A `{ kind: 'down' | 'up', t, source }` value from the Input_Arbiter, as defined by the `input-sources` spec.
- **Pending_Press**: A press the Input_Arbiter reports as not yet confirmed, with the earliest Raw_Down timestamp, as defined by the `input-sources` spec.
- **Settings_Store**: The interface defined by the `input-sources` spec through which the Input_Layer reads and writes its settings; this spec implements it.
- **Client**: The expansion client from the `expansion` spec.
- **Expansion_Result**: A `{ text, suggestions, source }` value delivered by the Client, where `text` is the trimmed typed text the result answers.
- **Session_Hook**: The React hook in `src/hooks/useMorseSession.ts` that connects the Input_Arbiter, the Engine, the Session_Reducer, the Client, Speech_Output and the Alarm_Handler.
- **Clock**: A function returning `performance.now()` in milliseconds, the same time base the Input_Arbiter uses.
- **Tick_Timer**: The single timer the Session_Hook schedules to call the Engine's `tick(t)`.
- **Alarm_Handler**: The interface provided by the `onboarding-and-safety` spec that starts the SOS alarm, reports whether the alarm is active, and receives Press_Events while the alarm is active.
- **Unknown_Pattern_Handler**: The interface provided by the `onboarding-and-safety` spec that receives `unknown` patterns.
- **Command_Legend**: The always-visible compact list of command codes, owned by the `onboarding-and-safety` spec.
- **Keying_Surface**: The large on-screen element that accepts pointer presses and holds keyboard focus for keying. On the main screen it fills the Composer_Panel, so a press anywhere on the panel keys Morse.
- **Composer_Panel**: The stage of the main screen: one panel that is the Keying_Surface, with the Partner_Display and the Stream_Band drawn on it in a layer that lets presses through to the Keying_Surface.
- **Armed_Edge**: The solid near-white boundary, at least 2 CSS pixels thick, that the Keying_Surface shows as its focus indicator.
- **Symbol_Stream**: The live visual display of Current_Pattern as dot and dash shapes.
- **Letter_Trail**: The row that draws the last characters of Current_Text (at most 24) as Morse tape, each character as its group of dot and dash shapes with the character beneath it. It is hidden from assistive technology.
- **Stream_Band**: The row on the Composer_Panel that draws the Letter_Trail, the Symbol_Stream and the Press_Indicator, in that order, with one shared Stream_Unit.
- **Stream_Unit**: The length u that sizes every shape and gap of the Stream_Band: a dot is u across, a dash is 3.25u long, and shapes within a group are 1u apart. The base unit is the smaller of 1.5rem and the Stream_Band width divided by 28, and it fixes the Stream_Band height. The drawn unit is the smaller of the base unit and (W − 1rem) / span, where W is the Stream_Band width and the span is the length of Current_Pattern in units plus 2.
- **Press_Indicator**: The circle at the head of the Stream_Band, where the next symbol of Current_Pattern will appear, that shows whether a press is held: an outlined ring while idle, and an accent ring around a smaller accent disc while pressed. It is hidden from assistive technology.
- **Suggestion_List**: The UI list showing Suggestions, the Highlight and the Suggestion_Source label.
- **Suggestion_Card**: One suggestion in the Suggestion_List, drawn as a card that holds its Ordinal, its suggestion button and, when highlighted, the "Will be spoken" marker.
- **Ordinal**: The visible number 1, 2 or 3 on a Suggestion_Card, matching its position in Suggestions. It is hidden from assistive technology.
- **Empty_Slot**: A quiet place in the Suggestion_List, one for each of the 3 places that no Suggestion_Card fills, showing the Ordinal of that place. It holds no control and is hidden from assistive technology.
- **Selected_Fill**: The dark accent-tinted fill (`--color-selected`) of the highlighted Suggestion_Card.
- **Partner_Display**: The large high-contrast readout of Current_Text and Last_Spoken.
- **History_View**: The UI list of Turns shown as speaker and partner bubbles.
- **Listen_Toggle**: The partner control that turns Speech_Input on or off.
- **Partner_Line_Form**: The partner text field and submit button for typing a partner line.
- **Settings_Panel**: The partner dialog for voice, rate, Listen, flip, clearing history, starting speed and adaptation.
- **Partner_Zone**: The quiet panel on the main screen that holds the History_View and the "Partner controls" section, which holds the Partner_Line_Form, the Listen_Toggle and the "Settings" button.
- **Live_Region**: The single polite `aria-live` region that announces committed characters and new Suggestions.
- **Speech_Output**: The wrapper in `src/lib/speech/` around Web Speech synthesis that speaks sentences and lists voices.
- **Speech_Input**: The wrapper in `src/lib/speech/` around Web Speech recognition that delivers interim and final transcripts.
- **Storage**: The module in `src/lib/conversation/storage.ts` that reads and writes History_Record and Settings_Record in localStorage.
- **History_Record**: The persisted list of Turns.
- **Settings_Record**: The persisted partner settings: voice identifier, speech rate, flip state, starting WPM, adaptation on or off, and the Input_Layer settings written through the Settings_Store.
- **Speech_Rate**: A number from 0.5 to 2.0 inclusive, default 1.0.
- **Starting_WPM**: A number from 2 to 20 inclusive, default 6, passed to the Engine configuration.
- **Partner_Control**: Any button, toggle, link, select, slider or text field the partner uses, other than the Keying_Surface.
- **Reduced_Motion**: The state in which the `prefers-reduced-motion: reduce` media query matches.
- **Wide_Layout**: The main screen arrangement used while the viewport is at least 64rem wide (1024 CSS pixels at the default font size) and in landscape orientation.
- **One_Column_Layout**: The main screen arrangement used at every viewport where Wide_Layout does not apply, including tablets in portrait, phones and 200% browser zoom.

## Requirements

### Requirement 1: Character and space appends

**User Story:** As a speaker, I want each keyed character and word gap added to my text cleanly, so that the partner reads exactly what I meant.

#### Acceptance Criteria

1. WHEN the Session_Reducer receives a `char` Engine_Event and Current_Text has fewer than 500 characters, THE Session_Reducer SHALL append the event's character to the end of Current_Text, leave all other characters of Current_Text unchanged, and return no Session_Effects.
2. IF the Session_Reducer receives a `char` Engine_Event while Current_Text has 500 characters, THEN THE Session_Reducer SHALL leave Current_Text unchanged and return no Session_Effects.
3. WHEN the Session_Reducer receives a `space` Engine_Event while Current_Text is non-empty, does not end with a space (U+0020), and has fewer than 500 characters, THE Session_Reducer SHALL append exactly one space (U+0020) to the end of Current_Text and return no Session_Effects.
4. IF the Session_Reducer receives a `space` Engine_Event while Current_Text is empty, ends with a space (U+0020), or has 500 characters, THEN THE Session_Reducer SHALL leave Current_Text unchanged and return no Session_Effects.
5. WHEN the Session_Reducer receives a `symbol` Engine_Event, THE Session_Reducer SHALL append the event's symbol (`.` or `-`) to the end of Current_Pattern, leave Current_Text unchanged, and return no Session_Effects.
6. WHEN the Session_Reducer receives a `char`, `space`, `command` or `unknown` Engine_Event, THE Session_Reducer SHALL set Current_Pattern to the empty string, including when criteria 2 or 4 leave Current_Text unchanged.
7. WHEN the Session_Reducer receives an `unknown` Engine_Event, THE Session_Reducer SHALL leave Current_Text unchanged and return exactly one Session_Effect, `{ type: 'unknown', pattern }`, where `pattern` equals the event's pattern.
8. FOR ALL sequences of Session_Actions, THE Session_Reducer SHALL produce a Current_Text that has at most 500 characters, does not start with a space (U+0020), and contains no two consecutive spaces (U+0020) (spacing and length invariant).

### Requirement 2: Backspace command

**User Story:** As a speaker, I want a backspace code that removes my last character, so that I can fix mistakes with my one input.

#### Acceptance Criteria

1. WHEN the Session_Reducer receives a `command` Engine_Event with command `backspace` while Current_Text contains 1 to 500 characters, THE Session_Reducer SHALL return a Session_State whose Current_Text equals the input Current_Text with only its final character removed, whether that character is a Whitespace character or not.
2. WHEN the Session_Reducer receives a `command` Engine_Event with command `backspace` while Current_Text contains 1 to 500 characters, THE Session_Reducer SHALL return a Session_State whose Current_Pattern is empty and whose Turns, Last_Spoken and Turn ID counter equal those of the input Session_State, and SHALL return no Session_Effect.
3. IF the Session_Reducer receives a `command` Engine_Event with command `backspace` while Current_Text is empty, THEN THE Session_Reducer SHALL return a Session_State equal to the input Session_State except that Current_Pattern is empty, and SHALL return no Session_Effect.
4. FOR ALL Session_States whose Current_Text has 0 to 499 characters, and for all `char` Engine_Events, applying the `char` Engine_Event and then a `command` Engine_Event with command `backspace` SHALL produce a Current_Text equal to the original Current_Text and an empty Current_Pattern (backspace inverse property).
5. FOR ALL Session_States whose Current_Text has 0 to 499 characters, applying a `space` Engine_Event and then a `command` Engine_Event with command `backspace` SHALL produce a Current_Text equal to the original Current_Text, provided the `space` Engine_Event appended one character to Current_Text.

### Requirement 3: Suggestions and highlight

**User Story:** As a speaker, I want the best suggestion highlighted as soon as it arrives and a code to move to the next one, so that I can pick a sentence with few presses.

#### Acceptance Criteria

1. WHEN the Session_Reducer receives Suggestions_Received with an Expansion_Result whose `text` is exactly equal (case-sensitive, character-for-character) to the current Trimmed_Text and whose `suggestions` list has 1 or more entries, THE Session_Reducer SHALL set Suggestions to the first min(3, list length) entries of that list in their original order, set Suggestion_Source to the result's `source`, set Highlight to 0, leave Current_Text, Current_Pattern, Turns and Last_Spoken unchanged, and return an empty list of Session_Effects.
2. WHEN the Session_Reducer receives Suggestions_Received with an Expansion_Result whose `text` is exactly equal to the current Trimmed_Text and whose `suggestions` list has 0 entries, THE Session_Reducer SHALL set Suggestions to empty, Suggestion_Source to none and Highlight to none, leave Current_Text, Current_Pattern, Turns and Last_Spoken unchanged, and return an empty list of Session_Effects.
3. IF the Session_Reducer receives Suggestions_Received with an Expansion_Result whose `text` is not exactly equal to the current Trimmed_Text, THEN THE Session_Reducer SHALL return a Session_State equal to the input Session_State and an empty list of Session_Effects (stale result).
4. WHEN a Session_Action changes Current_Text so that the Trimmed_Text after the action is not exactly equal to the Trimmed_Text before the action, THE Session_Reducer SHALL set Suggestions to empty, Suggestion_Source to none and Highlight to none.
5. WHEN a Session_Action changes Current_Text only by adding or removing Whitespace at the start or end, so that the Trimmed_Text after the action is exactly equal to the Trimmed_Text before the action, THE Session_Reducer SHALL keep Suggestions, Suggestion_Source and Highlight unchanged.
6. WHEN the Session_Reducer receives a `command` Engine_Event with command `next` while Suggestions has N entries (N from 1 to 3), THE Session_Reducer SHALL set Highlight to i + 1 if Highlight is index i and i < N − 1, to none if Highlight is index N − 1, and to 0 if Highlight is none.
7. WHEN the Session_Reducer receives a `command` Engine_Event with command `next`, THE Session_Reducer SHALL leave Current_Text, Suggestions, Suggestion_Source, Turns and Last_Spoken unchanged and return an empty list of Session_Effects.
8. IF the Session_Reducer receives a `command` Engine_Event with command `next` while Suggestions is empty, THEN THE Session_Reducer SHALL leave Highlight as none.
9. FOR ALL sequences of Session_Actions, THE Session_Reducer SHALL keep Highlight either none or an integer from 0 to the length of Suggestions minus 1, SHALL keep Highlight none whenever Suggestions is empty, and SHALL keep Suggestion_Source none if and only if Suggestions is empty (highlight range invariant).
10. FOR ALL Session_States with N Suggestions (N from 1 to 3) and any starting Highlight, applying the `next` command N + 1 times in a row SHALL return Highlight to its starting value (highlight cycle property).

### Requirement 4: Speak command and partner pick

**User Story:** As a speaker, I want one code to speak the highlighted sentence, or my raw text when nothing is highlighted, so that I am heard and can start fresh.

#### Acceptance Criteria

1. WHEN the Session_Reducer receives a `command` Engine_Event with command `speak` while Highlight is an index from 0 to the length of Suggestions minus 1, THE Session_Reducer SHALL perform the Speak_Step with the sentence at that index of Suggestions as the spoken sentence, unchanged.
2. WHEN the Session_Reducer receives a `command` Engine_Event with command `speak` while Highlight is none and Trimmed_Text contains 1 or more characters, THE Session_Reducer SHALL perform the Speak_Step with Trimmed_Text as the spoken sentence.
3. IF the Session_Reducer receives a `command` Engine_Event with command `speak` while Highlight is none and Trimmed_Text is empty (Current_Text is empty or contains only Whitespace), THEN THE Session_Reducer SHALL return a Session_State equal to the input Session_State except that Current_Pattern is empty, and SHALL return exactly one Session_Effect, `{ type: 'reset-engine' }`, and no `speak` Session_Effect.
4. WHEN the Session_Reducer receives Partner_Pick with an integer index from 0 to the length of Suggestions minus 1, THE Session_Reducer SHALL perform the Speak_Step with the sentence at that index of Suggestions as the spoken sentence, whatever the Highlight and whatever the Current_Text.
5. IF the Session_Reducer receives Partner_Pick with an index that is negative, not an integer, or greater than or equal to the length of Suggestions (including any index when Suggestions is empty), THEN THE Session_Reducer SHALL return a Session_State equal to the input Session_State and an empty list of Session_Effects.
6. WHEN the Session_Reducer performs the Speak_Step, THE Session_Reducer SHALL append to the end of Turns a Turn with role `'speaker'`, the spoken sentence as its text, and an ID taken from the Turn ID counter that differs from the ID of every other Turn in Turns, SHALL advance the Turn ID counter, and SHALL set Last_Spoken to the spoken sentence.
7. WHEN the Session_Reducer performs the Speak_Step, THE Session_Reducer SHALL set Current_Text and Current_Pattern to empty, Suggestions to empty, Suggestion_Source to none and Highlight to none.
8. WHEN the Session_Reducer performs the Speak_Step, THE Session_Reducer SHALL return exactly two Session_Effects in this order: `{ type: 'speak', sentence }` with the spoken sentence, then `{ type: 'reset-engine' }`.
9. IF the Session_Reducer performs the Speak_Step while Turns already holds History_Cap Turns, THEN THE Session_Reducer SHALL remove the oldest Turn before appending the new speaker Turn, so that Turns holds exactly History_Cap Turns and keeps the remaining Turns in their original order.
10. FOR ALL Session_States and every Session_Action that triggers the Speak_Step, THE Session_Reducer SHALL produce a Session_State with empty Current_Text, empty Current_Pattern, empty Suggestions, Suggestion_Source none and Highlight none, with Turns one longer than the input Turns (or equal to History_Cap when the input Turns held History_Cap Turns), and with the last Turn's role equal to `'speaker'` and its text equal to Last_Spoken (speak clears state property).

### Requirement 5: SOS forwarding

**User Story:** As a speaker, I want my help code to raise the alarm at once, whatever else the app is doing, so that I can always get help.

#### Acceptance Criteria

1. WHEN the Session_Reducer receives a `command` Engine_Event with command `sos`, THE Session_Reducer SHALL return a Session_Effect list containing exactly one `{ type: 'alarm' }` Session_Effect and no other Session_Effect, and SHALL leave Current_Text, Suggestions, Suggestion_Source, Highlight, Turns and Last_Spoken unchanged.
2. WHEN the Session_Reducer receives a `command` Engine_Event with command `sos`, THE Session_Reducer SHALL set Current_Pattern to empty.
3. WHEN the Session_Hook receives an `alarm` Session_Effect, THE Session_Hook SHALL call the Alarm_Handler to start the alarm exactly once for that Session_Effect, in the same synchronous call that processes the Session_Effect, before processing any later Engine_Event, and without waiting for a pending Client request, a speech utterance or a Storage write to settle.
4. IF a Client request, Speech_Output call or Storage operation has failed or is pending when the Session_Hook receives an `alarm` Session_Effect, THEN THE Session_Hook SHALL still call the Alarm_Handler as stated in criterion 3, and SHALL NOT cancel or retry that Client request, Speech_Output call or Storage operation because of the alarm.
5. IF the Alarm_Handler throws an error when the Session_Hook calls it to start the alarm, THEN THE Session_Hook SHALL keep the Session_State unchanged by the error and SHALL continue processing later Engine_Events and Session_Effects.
6. WHEN the Session_Hook receives an `unknown` Session_Effect, THE Session_Hook SHALL pass the effect's pattern, unchanged, to the Unknown_Pattern_Handler exactly once for that Session_Effect.
7. WHEN the Session_Reducer returns more than one Session_Effect for a single Session_Action, THE Session_Hook SHALL carry out the Session_Effects in the order the Session_Reducer returned them.

### Requirement 6: Turns, partner lines and history limits

**User Story:** As a partner, I want my lines and the speaker's lines kept in order, so that the conversation is readable and gives the AI context.

#### Acceptance Criteria

1. WHEN the Session_Reducer receives Partner_Line with text whose Whitespace-trimmed value is non-empty, THE Session_Reducer SHALL append one Turn to the end of Turns, with role `'partner'` and text equal to the first 500 characters of the trimmed value, and SHALL leave Current_Text, Current_Pattern, Suggestions, Suggestion_Source, Highlight and Last_Spoken unchanged.
2. IF the Session_Reducer receives Partner_Line with text that is empty or contains only Whitespace, THEN THE Session_Reducer SHALL return a Session_State equal to the input Session_State and an empty list of Session_Effects.
3. WHEN appending a Turn would make Turns longer than History_Cap, whether the Turn comes from Partner_Line or from a Speak_Step, THE Session_Reducer SHALL remove the oldest Turns in the same transition so that Turns holds exactly History_Cap Turns and the newly appended Turn is the last entry.
4. WHEN the Session_Reducer appends a Turn, THE Session_Reducer SHALL give the Turn an ID greater than every Turn ID issued before in that Session_State, including IDs of Turns since removed by History_Cap, Clear_History or Hydrate.
5. WHEN the Session_Reducer receives Clear_History, THE Session_Reducer SHALL set Turns to empty and Last_Spoken to none, SHALL leave Current_Text, Current_Pattern, Suggestions, Suggestion_Source and Highlight unchanged, and SHALL NOT reset the Turn ID counter.
6. WHEN the Session_Reducer receives Hydrate with a list of 0 or more Turns, THE Session_Reducer SHALL replace Turns with the newest History_Cap valid entries of that list in their stored order, where an entry is valid only if its role is `'speaker'` or `'partner'` and its Whitespace-trimmed text is non-empty, with each kept entry's text set to the first 500 characters of its trimmed text. It SHALL give the kept entries IDs that increase strictly in stored order and are each greater than every Turn ID issued before, SHALL set Last_Spoken to the text of the newest kept Turn with role `'speaker'` (or none when no such Turn exists), and SHALL leave Current_Text, Current_Pattern, Suggestions, Suggestion_Source and Highlight unchanged.
7. WHEN the Session_Hook makes a request to the Client, THE Session_Hook SHALL pass the Context_Window as the most recent 10 Turns at the moment of the request, or all Turns when fewer than 10 exist, oldest first, as `{ role, text }` pairs without IDs, and SHALL pass an empty list when Turns is empty.
8. FOR ALL sequences of Session_Actions, THE Session_Reducer SHALL keep Turns at no more than History_Cap entries, with IDs strictly increasing from oldest to newest, with every Turn's role either `'speaker'` or `'partner'`, and with every Turn's text 1 to 500 characters long (turns invariant).

### Requirement 7: Reducer purity and determinism

**User Story:** As a developer, I want the session logic to be pure, so that property tests reproduce every failure from a seed.

#### Acceptance Criteria

1. THE Session_Reducer SHALL compute its returned Session_State and Session_Effect list only from the input Session_State and Session_Action, without reading a clock, random source, Storage, localStorage, DOM, network, timer or any other browser global, and without reading or writing any module-level mutable variable.
2. THE Session_Reducer SHALL leave the input Session_State and Session_Action deeply equal to their values before the call, at every nesting level, including the Turns list, each Turn, the Suggestions list and any array or object inside the Session_Action.
3. THE Session_Reducer SHALL return its next Session_State and Session_Effect list synchronously, as values rather than as a pending or deferred result, and SHALL carry out no Session_Effect itself.
4. FOR ALL valid Session_States and all sequences of 0 to 1,000 Session_Actions, applying the same sequence to two deeply equal Session_States SHALL produce deeply equal Session_States, including Turn IDs and the Turn ID counter, and deeply equal Session_Effect lists with the same Session_Effects in the same order, after every action (determinism property).
5. FOR ALL valid Session_States and Session_Actions, THE Session_Reducer SHALL return a Session_State and Session_Effect list without throwing.
6. THE modules in `src/lib/conversation/` SHALL contain no static or dynamic import of `react`, `next`, any subpath of `react` or `next`, or any module under `src/components` or `src/hooks`.

### Requirement 8: Engine glue and tick scheduling

**User Story:** As a speaker, I want my presses decoded on time without the app polling, so that characters appear right after my pause and battery use stays low.

#### Acceptance Criteria

1. WHILE the Alarm_Handler reports the alarm inactive, WHEN the Session_Hook receives a `down` Press_Event from the Input_Arbiter, THE Session_Hook SHALL call the current Engine's `press(t)` exactly once, with `t` equal to the event's `t`.
2. WHEN the Session_Hook calls an Engine input method (`press(t)`, `release(t)` or `tick(t)`), THE Session_Hook SHALL pass every Engine_Event returned by that call to the Session_Reducer as a Session_Action, one Session_Action per Engine_Event, in the order the Engine returned them, before it handles the next Press_Event or Tick_Timer firing.
3. WHEN the Session_Hook has finished processing an Engine input method call, an Engine `reset()` or an Engine replacement, THE Session_Hook SHALL cancel any scheduled Tick_Timer, then call `nextDeadline()` on the current Engine, and, if `nextDeadline()` returns a number, schedule exactly one Tick_Timer to fire at that deadline on the Clock, or after a 0 ms delay if that deadline is less than or equal to the current Clock value, so that at most one Tick_Timer is scheduled at any time and no Tick_Timer is scheduled when `nextDeadline()` returns no number.
4. WHEN the Tick_Timer fires and the Input_Arbiter reports no Pending_Press whose Raw_Down timestamp is earlier than the scheduled deadline, THE Session_Hook SHALL call the current Engine's `tick(t)` once, with `t` equal to the lesser of the current Clock value and the earliest Raw_Down timestamp of any Pending_Press the Input_Arbiter reports at that moment (the current Clock value when no Pending_Press is reported).
5. IF the Tick_Timer fires while the Input_Arbiter reports a Pending_Press whose Raw_Down timestamp is earlier than the scheduled deadline, THEN THE Session_Hook SHALL call no `tick(t)` for that firing and SHALL schedule the next Tick_Timer, for the same deadline, to fire 50 ms after the current Clock value, repeating this on each firing until the Input_Arbiter reports no such Pending_Press.
6. THE Session_Hook SHALL pass to `tick(t)` only timestamps less than or equal to the Raw_Down timestamp of every Pending_Press the Input_Arbiter reports at the moment of the call.
7. WHEN the Session_Hook receives a `reset-engine` Session_Effect, THE Session_Hook SHALL call the current Engine's `reset()` once, cancel any scheduled Tick_Timer, and then apply the scheduling rule in criterion 3.
8. WHEN the Session_Reducer returns a list of Session_Effects, THE Session_Hook SHALL start each Session_Effect in the order returned, starting each one only after the previous one has been started, and SHALL start all of them before it passes the next Session_Action to the Session_Reducer.
9. WHEN the partner changes Starting_WPM or adaptation in the Settings_Panel, or the `onboarding-and-safety` spec supplies calibrated initial estimates, THE Session_Hook SHALL create a new Engine with the new configuration, replace the old Engine so that no later Press_Event or Tick_Timer firing reaches the old Engine, clear Current_Pattern, and apply the scheduling rule in criterion 3 to the new Engine.
10. WHILE the Alarm_Handler reports the alarm active, THE Session_Hook SHALL pass every Press_Event to the Alarm_Handler, SHALL call no Engine input method, and SHALL keep no Tick_Timer scheduled.
11. WHEN the Alarm_Handler starts the alarm, THE Session_Hook SHALL call the current Engine's `reset()` once and cancel any scheduled Tick_Timer.
12. WHEN the Alarm_Handler starts the alarm while a `down` Press_Event has been passed to the Engine without its matching `up` Press_Event, THE Session_Hook SHALL withhold that matching `up` Press_Event from both the Alarm_Handler and the Engine.
13. WHEN the Session_Hook unmounts, THE Session_Hook SHALL cancel any scheduled Tick_Timer, unsubscribe from the Input_Arbiter, the Client and Speech_Input, and make no further Engine calls or Session_Reducer dispatches.
14. WHILE the Alarm_Handler reports the alarm inactive, WHEN the Session_Hook receives an `up` Press_Event from the Input_Arbiter, THE Session_Hook SHALL call the current Engine's `release(t)` exactly once, with `t` equal to the event's `t`.
15. IF the Session_Hook replaces the Engine while a `down` Press_Event has been passed to the old Engine without its matching `up` Press_Event, THEN THE Session_Hook SHALL withhold that matching `up` Press_Event from the new Engine.

### Requirement 9: Expansion requests

**User Story:** As a speaker, I want suggestions to follow what I key, so that a few letters become a sentence.

#### Acceptance Criteria

1. WHEN the Trimmed_Text changes from one value to a different non-empty value, THE Session_Hook SHALL pass the new Trimmed_Text and the Context_Window, as computed from the Turns after that change, to the Client exactly once.
2. WHEN a Session_Action changes Current_Text and the Trimmed_Text is unchanged, THE Session_Hook SHALL make no call to the Client. An example is appending a trailing Whitespace character.
3. WHEN a partner Turn is appended to Turns while the Trimmed_Text is non-empty, THE Session_Hook SHALL pass the unchanged Trimmed_Text and the Context_Window to the Client exactly once. That Context_Window SHALL include the new partner Turn as its last entry.
4. WHEN a partner Turn is appended to Turns while the Trimmed_Text is empty, THE Session_Hook SHALL make no call to the Client.
5. WHEN the Client delivers an Expansion_Result, THE Session_Hook SHALL pass that Expansion_Result to the Session_Reducer, unmodified, as a single Suggestions_Received Session_Action. Results SHALL be passed in the order the Client delivers them.
6. WHEN the Trimmed_Text changes from a non-empty value to empty, THE Session_Hook SHALL pass the empty text to the Client exactly once, so that the Client cancels any pending request. This includes Current_Text becoming empty after a Speak_Step and Current_Text becoming Whitespace only.

### Requirement 10: Keying_Surface

**User Story:** As a speaker, I want a huge area to press with clear feedback, so that I do not need to aim and I know my press counted.

#### Acceptance Criteria

1. THE Keying_Surface SHALL have a larger rendered area, in CSS pixels, than any other interactive element on the main screen, and SHALL measure at least 44 by 44 CSS pixels, at every viewport width from 320 CSS pixels upward, in portrait and landscape, and at 200% zoom.
2. THE Keying_Surface SHALL be focusable, expose role `button`, the accessible name "Keying surface" and an accessible description stating that a press keys Morse, and SHALL hold keyboard focus when the main screen first appears.
3. WHEN the Input_Arbiter emits a `down` Press_Event from any Press_Source, THE Keying_Surface SHALL show the pressed state by the next animation frame, and SHALL keep showing it until the Input_Arbiter emits the matching `up` Press_Event. This applies whether the alarm is active or inactive.
4. WHEN the Input_Arbiter emits an `up` Press_Event, THE Keying_Surface SHALL show the idle state by the next animation frame.
5. THE Keying_Surface SHALL show the idle and pressed states with the Press_Indicator, as Requirement 25 states: an outlined ring with an unfilled centre while idle, and an accent ring around a disc filled with the accent colour while pressed, so that the two states differ in fill and form and not only in colour. THE Keying_Surface SHALL keep the same fill, boundary and size in both states. (Changed on 2026-11-11 in the design polish pass: the pressed state filled the whole surface with the accent colour and thickened its border, so the largest area on screen changed brightness on every press. Changed again on 2026-11-11 in the visual iteration of task 17.7: the pressed state was a plain accent disc, which read as one more keyed dot.)
6. WHILE the Keying_Surface has focus, THE Keying_Surface SHALL show the Armed_Edge as its focus indicator: a solid boundary at least 2 CSS pixels thick in the near-white text colour, with a contrast ratio of at least 3:1 against the page background and against the Composer_Panel fill. The Armed_Edge SHALL look the same in the idle and pressed states and SHALL look different from both Press_Indicator states, so that focus never looks like a press. Partner_Controls keep the focus indicator of Requirement 22 criterion 6. (Changed on 2026-11-11 in the design polish pass: the Keying_Surface used the dashed amber ring that every control uses, and that ring had to differ from a pressed-state border that no longer exists.)
7. IF the speaker holds a pointer down on the Keying_Surface for any duration, including a long hold or a small movement within the surface, THEN THE Keying_Surface SHALL cause no text selection, no context menu, no page scroll and no zoom.
8. WHILE Reduced_Motion is active, THE Keying_Surface SHALL switch between the idle and pressed states with no movement, scaling or pulsing.

### Requirement 11: Symbol_Stream

**User Story:** As a speaker and partner, I want to see dots and dashes appear as I key, so that I can follow the character being built.

#### Acceptance Criteria

1. THE Symbol_Stream SHALL show each symbol of Current_Pattern in keyed order, left to right, with each dot drawn as a circle and each dash drawn as a bar whose width is at least 3 times the dot's diameter and whose height equals the dot's diameter, so that dots and dashes differ in shape and length and not only in color.
2. WHEN Current_Pattern changes, THE Symbol_Stream SHALL show the new Current_Pattern, with every symbol added and every removed symbol gone, within one animation frame of the change.
3. WHEN Current_Pattern becomes empty after a `char`, `space`, `command` or `unknown` Engine_Event or an engine reset, THE Symbol_Stream SHALL show zero symbols while keeping its height the same, so that the layout around it does not shift.
4. WHILE Current_Pattern holds 1 to 12 symbols, THE Symbol_Stream SHALL show every symbol in full within its bounds, with none clipped, wrapped to a second line or hidden.
5. WHILE Reduced_Motion is active, THE Symbol_Stream SHALL show each new symbol at its final position, size and opacity in the first frame it appears, with no movement, scaling, pulsing or fading.
6. THE Symbol_Stream SHALL hide its individual symbol shapes from assistive technology and expose Current_Pattern as one text alternative that names each symbol in keyed order as the word "dot" or "dash", and that is empty when Current_Pattern is empty.
7. THE Symbol_Stream SHALL keep its text alternative outside the Live_Region and SHALL NOT make it an `aria-live` region, so that symbol changes are not announced on each press.
8. THE Symbol_Stream SHALL draw every dot and dash with a contrast ratio of at least 3:1 against the background directly behind the symbol.

### Requirement 12: Live announcements

**User Story:** As a screen reader user on the partner side, I want committed characters and new suggestions announced without chatter, so that I follow the conversation by ear.

#### Acceptance Criteria

1. WHEN the Session_Reducer appends a character to Current_Text, THE Live_Region SHALL queue that character for announcement, or queue the word "space" when the appended character is a space (U+0020).
2. THE Live_Region SHALL make at most one announcement in any 1,000 ms interval, measured by the Clock from the start of the previous announcement.
3. WHEN an item is queued and the Live_Region has made no announcement in the preceding 1,000 ms, THE Live_Region SHALL announce the queued item within 100 ms.
4. IF an item is queued less than 1,000 ms after the previous announcement, THEN THE Live_Region SHALL hold the item and announce all held items as one announcement, in the order they were committed, 1,000 ms after the start of the previous announcement.
5. WHEN the Session_Reducer sets a Suggestions list of 1 to 3 sentences, THE Live_Region SHALL queue one suggestions item stating the number of Suggestions and, if Highlight is an index, the text of the highlighted suggestion; if Highlight is none, the item SHALL state the number of Suggestions only.
6. IF the Session_Reducer sets a new non-empty Suggestions list while an earlier suggestions item is still held, THEN THE Live_Region SHALL replace the held suggestions item with one for the new list, keep the held characters, and announce the characters before the suggestions item.
7. THE Live_Region SHALL announce nothing for `symbol` Engine_Events, `unknown` Engine_Events, Hydrate actions, or a Suggestions list that becomes empty.
8. THE main screen SHALL contain exactly one Live_Region, with `aria-live` set to `polite`.

### Requirement 13: Suggestion_List

**User Story:** As a speaker and partner, I want to see the suggestions, which one is highlighted, and who wrote them, so that we both know what will be spoken.

#### Acceptance Criteria

1. THE Suggestion_List SHALL show every entry of Suggestions (0 to 3) as one button per entry. Buttons SHALL appear in the same order as the Suggestions list, index 0 first. Each button's accessible name SHALL be exactly that suggestion's text, and each button SHALL show the full suggestion text without truncation.
2. WHILE Highlight is an index, THE Suggestion_List SHALL mark the suggestion at that index with all of the following: an outline at least 3 CSS pixels thick, a visible text marker stating that this suggestion will be spoken, and `aria-current="true"`. The text marker SHALL NOT change the button's accessible name.
3. WHILE Highlight is an index, THE Suggestion_List SHALL show no outline, text marker or `aria-current` attribute on any suggestion other than the highlighted one.
4. WHILE Highlight is none and Current_Text is non-empty, THE Suggestion_List SHALL show a text marker stating that the raw Current_Text will be spoken, and SHALL show no highlight outline, text marker or `aria-current` attribute on any suggestion button.
5. WHILE Suggestions is non-empty, THE Suggestion_List SHALL show the Suggestion_Source as a text label: "AI" when the source is `'ai'`, and "On-device" when the source is `'on-device'`.
6. WHILE Suggestions is empty, THE Suggestion_List SHALL show no Suggestion_Source label and no suggestion buttons.
7. WHEN the partner activates a suggestion button by pointer, Enter or Space, THE Session_Hook SHALL pass exactly one Partner_Pick to the Session_Reducer, carrying the index of that button in Suggestions.
8. WHILE Suggestions is empty and Current_Text is empty, THE Suggestion_List SHALL show the hint "Tap a suggestion to speak it" in muted text with a contrast ratio of at least 4.5:1 against its background.
9. IF Suggestions is non-empty or Current_Text is non-empty, THEN THE Suggestion_List SHALL hide the hint "Tap a suggestion to speak it".
10. WHEN Suggestions, Suggestion_Source or Highlight changes in Session_State, THE Suggestion_List SHALL show the new values within 100 milliseconds, and SHALL no longer show the replaced suggestions, label or marker.

### Requirement 14: Partner_Display

**User Story:** As a partner across the bed, I want the current text and last sentence shown large, so that I can read them from about 2 meters away.

#### Acceptance Criteria

1. THE Partner_Display SHALL show Current_Text and Last_Spoken in two separate areas, each with a visible text label ("Typing" for Current_Text and "Last said" for Last_Spoken) that has a contrast ratio of at least 4.5:1 against the background.
2. THE Partner_Display SHALL render Current_Text at a font size of at least 32 CSS pixels at all viewport widths from 320 CSS pixels up to 767 CSS pixels, and at least 48 CSS pixels at viewport widths of 768 CSS pixels or more.
3. THE Partner_Display SHALL render Last_Spoken at a font size of at least 24 CSS pixels at all viewport widths from 320 CSS pixels up to 767 CSS pixels, and at least 32 CSS pixels at viewport widths of 768 CSS pixels or more.
4. THE Partner_Display SHALL render Current_Text and Last_Spoken with a contrast ratio of at least 7:1 against the background.
5. WHERE the flip setting is on, THE Partner_Display SHALL rotate its content 180 degrees with a CSS transform and keep the DOM order of its content unchanged.
6. WHERE the flip setting is off, THE Partner_Display SHALL render its content with 0 degrees of rotation.
7. WHEN the partner activates the flip toggle, THE Settings_Panel SHALL switch the flip setting between on and off, and THE Storage SHALL write the new flip setting to the Settings_Record.
8. WHILE Current_Text is empty, THE Partner_Display SHALL show placeholder text in place of Current_Text in the muted colour, with a contrast ratio of at least 4.5:1 and a font size no larger than 1.25rem, and SHALL keep the Current_Text area at least one line of Current_Text high, so that the first character moves nothing below it. (Changed on 2026-11-11 in the design polish pass: the placeholder was set at the Current_Text size, so the largest element on an idle screen was a placeholder.)
9. WHILE Last_Spoken is none, THE Partner_Display SHALL show placeholder text in place of Last_Spoken in the muted colour, with a contrast ratio of at least 4.5:1 and a font size no larger than 1.25rem, and SHALL keep the Last_Spoken area at least one line of Last_Spoken high, so that the first spoken sentence moves nothing below it. (Changed on 2026-11-11 in the design polish pass, for the same reason as criterion 8.)
10. WHEN Current_Text or Last_Spoken changes in Session_State, THE Partner_Display SHALL show the new value within 100 milliseconds.
11. WHILE Current_Text or Last_Spoken holds up to 500 characters, THE Partner_Display SHALL wrap the text onto multiple lines so that every character is visible without truncation or horizontal scrolling at viewport widths of 320 CSS pixels or more.
12. WHILE Reduced_Motion is active, THE Partner_Display SHALL apply a change of the flip setting in a single step, with no rotation animation or transition.

### Requirement 15: History_View

**User Story:** As a partner, I want the conversation shown as bubbles labelled by speaker, so that I can scroll back over what was said.

#### Acceptance Criteria

1. THE History_View SHALL render exactly one bubble per Turn in Turns, in Turns order (oldest first), showing the full Turn text without truncation and a visible text label "Speaker" for Turns with role `speaker` or "Partner" for Turns with role `partner`, so that the role is not conveyed by color alone.
2. WHEN a Turn is appended to Turns, THE History_View SHALL scroll so that the bubble for the newest Turn is fully within the History_View's visible area within 500 milliseconds of the append, using smooth-scroll animation while Reduced_Motion is not active.
3. THE History_View SHALL expose the Turns as a list element with an accessible name of "Conversation history", in which each bubble is one list item.
4. WHEN the partner activates the clear-history control, THE Settings_Panel SHALL show a confirmation prompt with a confirm action and a cancel action, and SHALL NOT change Turns or the History_Record until the partner chooses one of them.
5. WHEN the partner confirms the clear-history prompt, THE Session_Hook SHALL pass Clear_History to the Session_Reducer, THE Storage SHALL remove the History_Record, and THE History_View SHALL render zero bubbles.
6. IF the partner cancels the clear-history prompt, THEN THE Session_Hook SHALL keep Turns unchanged and THE Storage SHALL keep the History_Record unchanged.
7. WHILE Reduced_Motion is active, WHEN a Turn is appended to Turns, THE History_View SHALL scroll the newest Turn's bubble fully into view within 500 milliseconds of the append, with no smooth-scroll animation.
8. IF Turns is empty, THEN THE History_View SHALL render the "Conversation history" list with zero list items and show a visible text message indicating that no conversation has taken place yet.
9. WHEN Hydrate supplies stored Turns to the Session_Reducer, THE History_View SHALL render one bubble per hydrated Turn in stored order and scroll the newest Turn's bubble fully into view, with no smooth-scroll animation.
10. IF appending a Turn makes Turns exceed History_Cap and the Session_Reducer drops the oldest Turn, THEN THE History_View SHALL stop rendering the bubble for the dropped Turn and SHALL show exactly History_Cap (200) bubbles.

### Requirement 16: Storage

**User Story:** As a speaker, I want my history and settings kept on this device only, so that the conversation stays private and survives a reload.

#### Acceptance Criteria

1. WHEN Turns changes because of a Speak_Step, a Partner_Line, a Clear_History or a Hydrate Session_Action, THE Storage SHALL write a History_Record that holds every Turn in Turns, in the same order, to localStorage before the next Session_Action is handled.
2. WHEN Clear_History is handled, THE Storage SHALL write an empty History_Record to localStorage, so that a reload afterwards shows no Turns in the History_View.
3. WHEN the partner changes the voice, Speech_Rate, flip state, Starting_WPM or adaptation setting in the Settings_Panel, or the Input_Layer writes a value through the Settings_Store, THE Storage SHALL write the updated Settings_Record to localStorage before the next Session_Action is handled.
4. WHEN the app loads, THE Storage SHALL read the History_Record and the Settings_Record from localStorage and validate each one with a Zod schema before any value from it is used.
5. WHEN the app loads and the History_Record passes validation, THE Session_Hook SHALL pass the stored Turns to the Session_Reducer as one Hydrate Session_Action before the Session_Hook handles any Engine_Event.
6. IF a stored History_Record that otherwise passes validation holds more than History_Cap Turns, THEN THE Storage SHALL keep only the most recent History_Cap Turns, oldest first.
7. IF a stored History_Record or Settings_Record is missing, is not valid JSON, or fails Zod validation (including a Speech_Rate outside 0.5 to 2.0 or a Starting_WPM outside 2 to 20), THEN THE Storage SHALL use an empty history or the default settings for that record only, leave the other record unaffected, and not throw.
8. IF a localStorage read or write throws (for example when storage is full or disabled), THEN THE Storage SHALL return a failed Result without throwing and SHALL leave the in-memory Session_State and settings unchanged.
9. IF the Storage returns a failed Result, THEN THE Session_Hook SHALL show one message saying that history or settings could not be saved on this device, SHALL not show a second copy while the first is visible, and SHALL keep accepting keying input.
10. THE Storage SHALL write history and settings only to localStorage, and THE Conversation UI SHALL send no Turn, setting or typed text to any endpoint other than the Client's expansion requests.
11. THE Storage SHALL implement the Settings_Store interface from the `input-sources` spec and SHALL validate each Input_Layer value it reads with Zod. If a value fails validation, the Storage SHALL return the default for that value instead.
12. FOR ALL valid History_Records of 0 to History_Cap Turns and all valid Settings_Records, writing a record and then reading it back SHALL produce an equal record (storage round-trip property).

### Requirement 17: Speech output

**User Story:** As a speaker, I want my chosen sentence spoken in a voice and speed I pick, so that my partner hears me.

#### Acceptance Criteria

1. WHEN the Session_Hook receives a `speak` Session_Effect, THE Speech_Output SHALL cancel any utterance in progress and then speak the Session_Effect's sentence, exactly once, with the selected voice and the current Speech_Rate.
2. IF no voice is selected or the selected voice is not in the current voice list when a `speak` Session_Effect is carried out, THEN THE Speech_Output SHALL speak the sentence with the browser's default voice and THE Settings_Panel SHALL keep the stored voice selection unchanged.
3. IF speech synthesis is unsupported or the voice list is empty when a `speak` Session_Effect is carried out, THEN THE Session_Hook SHALL show the message "No voice is available on this device. The sentence is shown on the display." without calling speech synthesis, and THE Session_Reducer SHALL still record the speaker Turn and Last_Spoken.
4. IF an utterance ends with a synthesis error, THEN THE Session_Hook SHALL show an error message stating that the sentence could not be spoken, THE Session_Reducer SHALL keep the speaker Turn and Last_Spoken unchanged, and THE Speech_Output SHALL NOT retry the utterance.
5. IF an utterance is cancelled because a newer `speak` Session_Effect arrived, THEN THE Session_Hook SHALL NOT show the error message from criterion 4 for the cancelled utterance.
6. WHILE a message from criterion 3 or criterion 4 is shown, THE Session_Hook SHALL keep it visible until the next `speak` Session_Effect is carried out or the partner dismisses it.
7. WHEN the voice list changes, THE Settings_Panel SHALL replace its voice options with the current voice list within 1 second, and SHALL show the browser default as the selected option if the stored voice is not in the current list.
8. WHEN the partner selects a voice or a valid Speech_Rate in the Settings_Panel, THE Storage SHALL write the selection to the Settings_Record before the next `speak` Session_Effect is carried out, and THE Speech_Output SHALL use the new selection for that and every later utterance.
9. IF the partner enters a Speech_Rate that is below 0.5, above 2.0, or not a number, THEN THE Settings_Panel SHALL keep and display the previous Speech_Rate, and THE Storage SHALL NOT write the rejected value.
10. WHEN the app loads, THE Session_Hook SHALL apply the voice identifier and Speech_Rate from the stored Settings_Record, and IF the stored Speech_Rate is missing, not a number, or outside 0.5 to 2.0, THEN THE Session_Hook SHALL use the default Speech_Rate of 1.0.

### Requirement 18: Listen toggle and speech input

**User Story:** As a partner, I want what I say transcribed into the conversation, so that the speaker's suggestions fit my question.

#### Acceptance Criteria

1. WHERE the browser provides speech recognition, THE Listen_Toggle SHALL be shown as a switch control labelled "Listen" whose checked state is on from the moment the partner turns it on until recognition is stopped by the partner or switched off by criterion 8 or criterion 11.
2. IF the browser provides no speech recognition, THEN THE Listen_Toggle SHALL be disabled, SHALL stay in the off state, and SHALL show the text "Listening is not supported in this browser. Type your line instead."
3. WHEN the partner turns the Listen_Toggle on, THE Speech_Input SHALL start recognition and THE Listen_Toggle SHALL clear any message previously shown by criterion 8 or criterion 11.
4. WHEN the Speech_Input delivers a final transcript whose Whitespace-trimmed value is non-empty, THE Session_Hook SHALL pass the trimmed transcript to the Session_Reducer as one Partner_Line and THE Listen_Toggle SHALL clear the shown interim transcript.
5. WHEN the Speech_Input delivers a final transcript whose Whitespace-trimmed value is empty, THE Session_Hook SHALL discard it without dispatching a Session_Action.
6. WHILE the Speech_Input is running, THE Listen_Toggle area SHALL show only the most recent interim transcript as text, replacing the previous one, without adding it to Turns.
7. WHILE the Speech_Output is speaking, THE Session_Hook SHALL discard final transcripts from the Speech_Input without dispatching a Partner_Line, so that the app's own voice does not become a partner Turn.
8. IF recognition reports a permission error or a missing-microphone error, THEN THE Speech_Input SHALL stop recognition without restarting, and THE Listen_Toggle SHALL switch off, clear the interim transcript, and show a message naming whether microphone permission was denied or no microphone was found.
9. IF recognition ends while the Listen_Toggle is on and either no error was reported or the reported error is a no-speech or aborted error, THEN THE Speech_Input SHALL restart recognition within 1000 milliseconds without changing the Listen_Toggle's checked state.
10. WHEN the app loads, THE Listen_Toggle SHALL start in the off state, regardless of its state in any earlier session.
11. IF recognition reports an error other than those named in criterion 8 and criterion 9, or a start or restart attempt fails, THEN THE Speech_Input SHALL stop recognition without restarting, and THE Listen_Toggle SHALL switch off, clear the interim transcript, and show a message saying that listening stopped and the partner can turn Listen on again or type a line.
12. WHEN the partner turns the Listen_Toggle off, THE Speech_Input SHALL stop recognition, THE Session_Hook SHALL discard any final transcript delivered after that point, and THE Listen_Toggle SHALL clear the interim transcript.

### Requirement 19: Partner_Line_Form

**User Story:** As a partner, I want to type my line, so that I can add context when speaking aloud is not practical.

#### Acceptance Criteria

1. THE Partner_Line_Form SHALL contain a text field with the visible label "Your line" and a submit button with the accessible name "Add line".
2. WHILE the text field has focus, THE Partner_Line_Form SHALL insert a space character into the text field when the partner presses Space, and THE Session_Hook SHALL produce no Press_Event for that key press.
3. WHILE the text field has focus, WHEN the partner presses Enter, THE Partner_Line_Form SHALL submit the form, and THE Session_Hook SHALL produce no Press_Event for that key press.
4. WHEN the partner submits the Partner_Line_Form by pressing Enter or activating the "Add line" button, and the text field value with leading and trailing Whitespace removed is non-empty, THE Session_Hook SHALL pass that trimmed value to the Session_Reducer as Partner_Line exactly once.
5. WHEN the Session_Hook passes a Partner_Line from the Partner_Line_Form, THE Partner_Line_Form SHALL clear the text field to an empty value, and focus SHALL move as stated in Requirement 21 criterion 2.
6. IF the partner submits the Partner_Line_Form while the text field value is empty or contains only Whitespace, THEN THE Partner_Line_Form SHALL pass no Partner_Line to the Session_Reducer, add no Turn, leave the text field value unchanged, and keep focus in the text field.
7. THE Partner_Line_Form SHALL accept at most 500 characters in the text field and SHALL ignore typed characters beyond the 500th.
8. IF the partner pastes text that would make the text field value longer than 500 characters, THEN THE Partner_Line_Form SHALL keep only the first 500 characters of the resulting value.

### Requirement 20: Settings_Panel

**User Story:** As a partner, I want one place to change voice, rate, listening, flip, history and speed, so that I can adjust the app without disturbing the speaker.

#### Acceptance Criteria

1. WHEN the partner activates the button with the accessible name "Settings" on the main screen, THE Settings_Panel SHALL open as a modal dialog with `aria-modal="true"` and the accessible name "Settings".
2. WHILE the Settings_Panel is open, WHEN the partner presses Escape or activates the button with the accessible name "Close settings", THE Settings_Panel SHALL close and keep every setting value that was valid and saved before the close.
3. THE Settings_Panel SHALL contain these Partner_Controls, each with a visible text label that is also its accessible name: a voice select, a Speech_Rate slider or number field limited to 0.5 to 2.0, the Listen_Toggle, a flip switch, a clear-history button, a Starting_WPM number field limited to 2 to 20, and an adaptation switch with on and off states.
4. WHEN the Settings_Panel opens, THE Settings_Panel SHALL show each control set to the current value in the Settings_Record (or the default when no value is stored), and SHALL move keyboard focus to the first focusable Partner_Control inside the dialog.
5. WHEN the partner commits a Starting_WPM from 2 to 20 inclusive that differs from the current Starting_WPM, or switches adaptation on or off, THE Storage SHALL persist the new value in the Settings_Record and THE Session_Hook SHALL replace the Engine under Requirement 8 criterion 9.
6. IF the partner commits a Starting_WPM that is outside 2 to 20, empty, or not a number, THEN THE Settings_Panel SHALL keep the previous Starting_WPM in the field, show visible text next to the field stating the allowed range of 2 to 20, write nothing to Storage, and leave the Engine unreplaced.
7. WHILE the Settings_Panel is open, THE Settings_Panel SHALL keep keyboard focus inside the dialog, moving focus from the last focusable Partner_Control to the first on Tab and from the first to the last on Shift+Tab.
8. WHEN the Settings_Panel closes by any path, THE Settings_Panel SHALL move keyboard focus to the Keying_Surface.
9. WHILE the Settings_Panel is open, THE Session_Hook SHALL keep the alarm path unchanged, so that a `sos` command decoded from any Press_Event still starts the alarm under Requirement 5.
10. IF Storage reports a failed write while the partner changes a setting in the Settings_Panel, THEN THE Settings_Panel SHALL keep the new value in effect for the current session and THE Session_Hook SHALL show the save-failure message under Requirement 16 criterion 9.

### Requirement 21: Focus return

**User Story:** As a speaker using Space or Enter, I want focus back on the keying surface after the partner taps a control, so that my next press keys Morse.

#### Acceptance Criteria

1. WHEN the partner activates a Partner_Control outside the Settings_Panel by pointer, Enter or Space, THE Conversation UI SHALL move keyboard focus to the Keying_Surface within 100 ms after the control's action is applied to the UI state. This criterion does not apply to the Partner_Line_Form text field, the Partner_Line_Form submit button, or a control that opens the Settings_Panel or the clear-history confirmation.
2. WHEN the partner submits the Partner_Line_Form with text containing at least one non-Whitespace character, THE Conversation UI SHALL move keyboard focus to the Keying_Surface within 100 ms after the Partner_Line is dispatched to the Session_Reducer.
3. IF the partner submits the Partner_Line_Form with empty or Whitespace-only text, THEN THE Conversation UI SHALL keep keyboard focus on the Partner_Line_Form text field.
4. WHEN the Settings_Panel closes by any means, including its close button, the Escape key or a pointer press outside the dialog, THE Conversation UI SHALL move keyboard focus to the Keying_Surface within 100 ms and SHALL NOT return focus to the control that opened the Settings_Panel.
5. WHEN the clear-history confirmation closes, whether confirmed or cancelled, THE Conversation UI SHALL move keyboard focus to the Keying_Surface within 100 ms and SHALL NOT return focus to the control that opened the confirmation.
6. WHEN the speaker presses Space or Enter after focus has moved to the Keying_Surface under criteria 1, 2, 4 or 5, THE Conversation UI SHALL deliver that press as a Press_Event to the Input_Arbiter and SHALL NOT activate the Partner_Control that was activated last.

### Requirement 22: Layout and accessibility

**User Story:** As a speaker and partner on a tablet, I want a calm, dark, high-contrast layout that works in any orientation and at large zoom, so that we can both use it comfortably.

#### Acceptance Criteria

1. THE Conversation UI SHALL use a page background with a WCAG relative luminance of at most 0.05, and SHALL render the Partner_Display text in a colour with a WCAG relative luminance of at least 0.85 and a contrast ratio of at least 7:1 against its background.
2. THE Conversation UI SHALL render all text outside the Partner_Display at a contrast ratio of at least 4.5:1 against its background, including placeholder text, disabled-control labels and the Suggestion_Source label.
3. THE Conversation UI SHALL render every Partner_Control boundary, the Keying_Surface boundary, the Symbol_Stream dot and dash shapes, and every focus indicator at a contrast ratio of at least 3:1 against the adjacent colours.
4. THE Conversation UI SHALL render with no horizontal scrollbar on the page, and with no text clipped, truncated without a means of revealing it, or overlapping other content, at every viewport width from 320 CSS pixels to 2560 CSS pixels, in both landscape and portrait orientation, and at browser zoom levels of 100% and 200%.
5. THE Conversation UI SHALL use a computed font size of at least 18 CSS pixels for all body text at 100% browser zoom, and SHALL size text in relative units so that text scales with the browser's default font size setting up to 200%.
6. THE Conversation UI SHALL give every Partner_Control a pointer target of at least 44 by 44 CSS pixels and SHALL show a focus indicator at least 2 CSS pixels thick around a Partner_Control whenever that control holds keyboard focus.
7. THE main screen SHALL reserve a region for the Command_Legend in which the entire Command_Legend is visible without scrolling at viewport sizes of 768 by 1024 and 1024 by 768 CSS pixels at 100% browser zoom, with the Keying_Surface also fully visible at those sizes.
8. THE main screen SHALL contain exactly one `h1` element, including while the Settings_Panel is open.
9. THE Conversation UI SHALL give every icon-only button a non-empty `aria-label` that names the button's action, and every form control in the Partner_Line_Form and the Settings_Panel a visible text label programmatically associated with that control.
10. WHILE Reduced_Motion is active, THE Conversation UI SHALL use no slide, scale or pulse transitions, and SHALL limit any remaining transition to an opacity change lasting no more than 200 milliseconds.
11. THE Conversation UI SHALL show no content that flashes more than 3 times in any 1-second period, including the alarm display and the Symbol_Stream.
12. WHEN the Input_Arbiter reports a Press_Source status other than `'off'` and `'active'`, THE Conversation UI SHALL show, within 500 milliseconds of the report, a text message naming the source and the status, and SHALL show one such message for each Press_Source that has such a status at the same time.
13. WHEN the Input_Arbiter reports that a Press_Source whose status message is shown has changed to `'off'` or `'active'`, THE Conversation UI SHALL remove that source's status message within 500 milliseconds of the report.
14. WHEN the viewport orientation or browser zoom level changes, THE Conversation UI SHALL keep Current_Text, Current_Pattern, Suggestions, Highlight and Turns unchanged and SHALL keep keyboard focus on the element that held it before the change.

### Requirement 23: Tests

**User Story:** As a developer, I want property tests on the reducer and role-based component tests, so that the conversation logic and accessibility stay correct.

#### Acceptance Criteria

1. THE Session_Reducer property tests SHALL use fast-check with at least 200 generated cases per property, and SHALL include one property test for each of the following: the spacing and length invariant (Requirement 1 criterion 8), the backspace inverse property (Requirement 2 criterion 4), the highlight range invariant (Requirement 3 criterion 9), the highlight cycle property (Requirement 3 criterion 10), the speak clears state property (Requirement 4 criterion 10), the turns invariant (Requirement 6 criterion 8) and the determinism property (Requirement 7 criterion 4). Each test's name SHALL contain the matching property ID from the design.
2. THE Session_Reducer property tests SHALL generate Session_Action sequences that include every Session_Action kind listed in the Glossary, with Current_Text lengths from 0 to 500 characters and Turns counts from 0 to History_Cap.
3. THE Storage property tests SHALL include a fast-check test of at least 200 generated cases for the storage round-trip property (Requirement 16 criterion 12). They SHALL also include fast-check tests of at least 200 generated cases each that pass invalid JSON strings and schema-invalid values to Storage, and assert that Storage returns an empty History_Record or the default Settings_Record and does not throw.
4. THE Session_Hook tests SHALL use a fake Clock, fake timers, a fake Input_Arbiter, a fake Client, a fake Speech_Output and a fake Alarm_Handler, and SHALL assert each of the following:
   - at no point during a test is more than one Tick_Timer scheduled;
   - while a Pending_Press is reported, no timestamp passed to the Engine's `tick(t)` is greater than that Pending_Press's earliest Raw_Down timestamp;
   - a `sos` command reaches the Alarm_Handler while a Client request is pending and unresolved;
   - while the Alarm_Handler reports the alarm as active, every Press_Event from the Input_Arbiter reaches the Alarm_Handler and none reaches the Engine.
5. THE component tests SHALL use Testing Library in the jsdom environment and SHALL locate elements only by role and accessible name. They SHALL assert each of the following (changed on 2026-11-11 in the design polish pass: the last five items were added; the visual iteration of task 17.7 extended the last two):
   - the Keying_Surface exposes its accessible name;
   - each Suggestion is rendered as a button, and exactly one element carries the `aria-current` marker, matching the Highlight;
   - the "AI" label appears when Suggestion_Source is `'ai'` and the "On-device" label appears when Suggestion_Source is `'on-device'`;
   - the Listen_Toggle is exposed as a switch, and the unsupported message appears when Speech_Input is unavailable;
   - a dialog named "Settings" opens, and pressing Escape closes it;
   - after the Settings dialog closes, keyboard focus is on the Keying_Surface;
   - the rendered page contains exactly one Live_Region with `aria-live="polite"`;
   - the element with role `button` and the name "Keying surface" does not contain the Partner_Display or the Stream_Band, and both are present on the main screen (Requirement 24 criterion 5);
   - the Partner_Display group, the "Suggestions" list, the "Commands" region and the "Partner controls" section follow each other in the DOM in the order of Requirement 24 criterion 1, and the "Conversation history" list comes before the "Partner controls" section (Requirement 28 criterion 4);
   - the Partner_Display headings appear in the order "Last said", "Typing" (Requirement 24 criterion 6);
   - the Press_Indicator is hidden from assistive technology, its state follows the pressed state, a held press adds a centre disc inside its ring, and the Stream_Band span follows Current_Pattern (Requirements 25 and 26);
   - each Suggestion_Card shows its Ordinal hidden from assistive technology, each suggestion button's accessible name and text content equal its suggestion, and exactly one "Will be spoken" marker shows, on the highlighted Suggestion_Card; each place that no Suggestion_Card fills shows an Empty_Slot with the next Ordinal, hidden from assistive technology and outside the "Suggestions" list (Requirement 27).
6. THE Speech_Output and Speech_Input tests SHALL use fakes for the Web Speech synthesis and recognition APIs and SHALL assert each of the following:
   - each speak request cancels any in-progress utterance before the new utterance starts;
   - the no-voices message appears when the voice list is empty;
   - the Session_Hook discards, and does not dispatch, any final transcript received while Speech_Output is speaking.
7. THE test suite SHALL complete in a single non-watch run with zero failing tests, without network access, and without calling the real Web Speech APIs.

### Requirement 24: Composed main screen

**User Story:** As a speaker, a partner or someone watching, I want one composed screen with a clear order of attention, so that the sentence, the live Morse and the suggestions read first and the partner tools stay out of the way.

Added on 2026-11-11 in the design polish pass.

#### Acceptance Criteria

1. THE main screen SHALL place, after the `h1` and the status messages, the Composer_Panel, the Suggestion_List, the "Commands" region that holds the Command_Legend, and the Partner_Zone, in this order in the DOM.
2. WHILE Wide_Layout applies, THE main screen SHALL show two columns: a primary column with the `h1`, the status messages, the Composer_Panel and then the Suggestion_List, and a secondary column at most 28rem wide with the "Commands" region at its top and the Partner_Zone below it.
3. WHILE Wide_Layout applies at a viewport of 1280 by 800 or 1024 by 768 CSS pixels at 100% browser zoom, THE main screen SHALL fit in the viewport with no page scroll while three Suggestions that each fit on one line are shown and Current_Text takes up to two lines.
4. WHILE One_Column_Layout applies, THE main screen SHALL show one column with the regions of criterion 1 from top to bottom in the same order.
5. THE Keying_Surface SHALL cover the whole Composer_Panel, and THE Partner_Display and the Stream_Band SHALL be drawn on top of it as siblings of the element with role `button`, not as its descendants, so that assistive technology reaches their headings and text and a pointer press anywhere on the Composer_Panel, including on that text, lands on the Keying_Surface with no text selection (Requirement 10 criterion 7).
6. THE Partner_Display SHALL place the Last_Spoken area above the Current_Text area in both DOM order and visual order, and THE Stream_Band SHALL follow the Current_Text area directly, with no other content between them.
7. THE main screen SHALL render Current_Text at a larger font size than Last_Spoken, and Last_Spoken at a font size at least as large as the Suggestion_Card text, so that the sentence leads, the suggestions follow and the partner tools (Requirement 28 criterion 3) come last.
8. WHEN the first character is appended to an empty Current_Text, Current_Pattern changes, or Last_Spoken changes from none to a sentence that fits on one line, THE main screen SHALL keep the Stream_Band, the Suggestion_List and every region after them at the same size and position (Requirement 11 criterion 3; Requirement 14 criteria 8 and 9), apart from the "Conversation history" list, which shows the Turn that the same speak action adds (Requirement 15 criterion 1) and so, in One_Column_Layout, grows and moves the "Partner controls" section below it. (Changed on 2026-11-11 in the headless check of task 17.7: in one column the new Turn of the first spoken sentence made the history list taller, as Requirement 15 requires, while nothing above the list moved.)
9. THE Suggestion_List SHALL keep at least the height of its label row and three one-line Suggestion_Cards whether it shows 0, 1, 2 or 3 Suggestion_Cards, so that the Composer_Panel and every region after the Suggestion_List keep their size and position when Suggestions arrive or clear.
10. WHILE the viewport is 1280 by 800, 820 by 1180 or 393 by 852 CSS pixels at 100% browser zoom and the page is scrolled to the top, THE main screen SHALL show no horizontal scroll and SHALL show the whole Composer_Panel inside the viewport.
11. WHILE the viewport is 768 by 1024 or 1024 by 768 CSS pixels at 100% browser zoom, THE main screen SHALL show the whole Command_Legend, including the "All codes" button, and the whole Keying_Surface inside the viewport without scrolling while three one-line Suggestions are shown (Requirement 22 criterion 7; `onboarding-and-safety` Requirement 8 criteria 6 and 8).

### Requirement 25: Calm press feedback and the Armed_Edge

**User Story:** As a speaker who looks at the screen all day, I want each press shown by a small, steady mark at the head of the Morse tape, and a calm edge that shows the keying area is ready, so that keying stays restful, is safe for people with photosensitivity and keeps the live stream as the focus.

Added on 2026-11-11 in the design polish pass.

#### Acceptance Criteria

1. WHILE no press is held, THE Press_Indicator SHALL be a ring at least 2 CSS pixels thick in the border colour with an unfilled centre, with a contrast ratio of at least 3:1 against the Composer_Panel fill.
2. WHILE a press is held, from a `down` Press_Event until its matching `up` Press_Event, THE Press_Indicator SHALL be a ring at least 2 CSS pixels thick in the accent colour around a disc filled with the accent colour, with the Composer_Panel fill showing between them, each with a contrast ratio of at least 3:1 against the Composer_Panel fill, so that a held press never looks like a keyed dot. (Changed on 2026-11-11 in the visual iteration of task 17.7: a plain accent disc one dot across, right after the accent newest symbol, read in the screenshots as one more keyed dot.)
3. THE Press_Indicator SHALL be a circle whose diameter is the larger of 1rem and the Stream_Unit, so that it is at least as wide as a dot of the Stream_Band, and SHALL be hidden from assistive technology.
4. WHEN the pressed state changes, THE Press_Indicator SHALL show the new state by the next animation frame (Requirement 10 criteria 3 and 4) in a single step, with no transition, animation, scaling or fading, whether or not Reduced_Motion is active.
5. WHEN the pressed state changes, THE main screen SHALL change the appearance of no element other than the Press_Indicator because of that change, and THE Keying_Surface SHALL keep its fill, boundary, size and position, so that no area larger than the Press_Indicator changes brightness with each press. Symbols that the Engine adds to Current_Pattern follow Requirement 11.
6. WHILE the Keying_Surface does not have focus, THE Keying_Surface SHALL show a boundary at least 1 CSS pixel thick in the border colour, with a contrast ratio of at least 3:1 against the page background and against the Composer_Panel fill (Requirement 22 criterion 3).
7. WHEN the Keying_Surface gains or loses focus, THE Keying_Surface SHALL switch between the boundary of criterion 6 and the Armed_Edge (Requirement 10 criterion 6) without changing its own size or position or the position of anything drawn on it, and THE Armed_Edge colour SHALL have a contrast ratio of at least 3:1 against the border colour.

### Requirement 26: Stream on stage

**User Story:** As a partner, or anyone watching, I want the live Morse tape large and rhythmic directly under the sentence, with each letter forming under its dots and dashes, so that the app's signature is what the eye follows.

Added on 2026-11-11 in the design polish pass.

#### Acceptance Criteria

1. THE Stream_Band SHALL draw, from left to right in one row: the Letter_Trail; a gap of 3 Stream_Units after the Letter_Trail when it shows at least one group; the Symbol_Stream; a gap of 1 Stream_Unit when Current_Pattern is not empty; and the Press_Indicator, so that the Press_Indicator marks the place where the next symbol of Current_Pattern will appear.
2. THE Stream_Band SHALL compute a base unit equal to the smaller of 1.5rem and its own width divided by 28, and SHALL keep its height equal to one glyph row of the base unit, a gap of 0.75 base units and one letter row, whatever Current_Text, Current_Pattern and the pressed state hold (Requirement 11 criterion 3).
3. THE Stream_Band SHALL draw its shapes and gaps with a Stream_Unit equal to the smaller of the base unit and (W − 1rem) / (P + 2), where W is the Stream_Band width and P is the length of Current_Pattern in units: 1 per dot, 3.25 per dash and 1 per gap between two symbols, or 0 when Current_Pattern is empty. P + 2 is the span: it covers the pattern, the 1-unit gap and one unit of the Press_Indicator, and the 1rem covers the rest of the Press_Indicator, which is never wider than 1rem plus one unit (Requirement 25 criterion 3). Every symbol and the Press_Indicator therefore stay inside the Stream_Band (Requirement 11 criterion 4), and wherever the Stream_Band is at least 12.5rem wide, every character code and command code of the `morse-engine` spec draws at the base unit, so only a longer pattern shrinks the band.
4. THE Stream_Band SHALL draw the Letter_Trail shapes and letters in the muted colour, every symbol of Current_Pattern except the newest in the near-white text colour, and the newest symbol in the accent colour, with a contrast ratio against the Composer_Panel fill of at least 3:1 for every shape and at least 4.5:1 for the Letter_Trail letters.
5. WHILE the Letter_Trail does not fit in the room that the Symbol_Stream and the Press_Indicator leave, THE Stream_Band SHALL clip the oldest Letter_Trail groups at its left edge and SHALL NOT shrink, wrap or clip the Symbol_Stream or the Press_Indicator. On the Composer_Panel the clip edge SHALL lie in the panel padding to the left of the Stream_Band, and the clipped groups SHALL fade out across that padding, so that no group ends at a hard edge and a group that starts at the Stream_Band's left edge is drawn in full. (Changed on 2026-11-11 in the visual iteration of task 17.7: the clip at the band's own edge left half shapes and half letters with a flat cut.)
6. THE Stream_Band SHALL have no fill or border of its own, so that it is drawn on the Composer_Panel fill.
7. WHILE Reduced_Motion is active, THE Letter_Trail SHALL show each new group at its final position, size and opacity in the first frame it appears, as Requirement 11 criterion 5 states for the symbols of the Symbol_Stream.

### Requirement 27: Suggestion_Cards

**User Story:** As a partner across the bed, and as a speaker who moves the highlight with `..--`, I want the suggestions as large numbered cards with one unmistakable highlighted card, so that we both know which sentence the speak command will say.

Added on 2026-11-11 in the design polish pass.

#### Acceptance Criteria

1. THE Suggestion_List SHALL present Suggestions as an ordered list named "Suggestions", with one Suggestion_Card per suggestion in Suggestions order.
2. THE Suggestion_List SHALL show each Suggestion_Card's Ordinal (1 for index 0, 2 for index 1 and 3 for index 2) as visible text that is hidden from assistive technology and placed outside the suggestion button, so that the button's accessible name and text content stay exactly the suggestion text (Requirement 13 criterion 1).
3. WHEN a pointer press lands anywhere on a Suggestion_Card, including on its Ordinal or its marker, THE Suggestion_List SHALL treat it as a press on that card's suggestion button (Requirement 13 criterion 7).
4. THE Suggestion_List SHALL make every Suggestion_Card at least 44 CSS pixels high and as wide as the Suggestion_List.
5. WHILE Highlight is an index, THE Suggestion_List SHALL draw the highlighted Suggestion_Card with all of the following: the Selected_Fill, an outline at least 3 CSS pixels thick in the accent colour, its Ordinal on a disc filled with the accent colour, and the visible text "Will be spoken" outside the suggestion button, with `aria-current="true"` on that button; and SHALL draw no other Suggestion_Card with any of them (Requirement 13 criteria 2 and 3).
6. THE Suggestion_List SHALL render the suggestion text in the near-white text colour at a font size of at least 1.5rem at viewport widths of 768 CSS pixels or more and at least 1.25rem below 768 CSS pixels, with a contrast ratio of at least 7:1 against both the Suggestion_Card fill and the Selected_Fill.
7. WHILE a suggestion button has keyboard focus, THE Suggestion_List SHALL draw a focus indicator around its whole Suggestion_Card, at least 2 CSS pixels thick and with a contrast ratio of at least 3:1 against the adjacent colours (Requirement 22 criteria 3 and 6).
8. WHEN a new non-empty Suggestions list replaces the shown one, THE Suggestion_List SHALL show the new Suggestion_Cards either in a single step or with a fade-in that changes only opacity, starts in the first frame and lasts at most 150 milliseconds.
9. WHILE Reduced_Motion is active, WHEN a new non-empty Suggestions list appears, THE Suggestion_List SHALL show its Suggestion_Cards in their final state in the first frame.
10. WHEN Highlight changes, THE Suggestion_List SHALL move the marks of criterion 5 to the newly highlighted Suggestion_Card, or remove them when Highlight becomes none, in a single step with no transition or animation.
11. WHILE Suggestions is non-empty, THE Suggestion_List SHALL show the Suggestion_Source label of Requirement 13 criterion 5 in a row above the Suggestion_Cards.
12. WHILE Suggestions holds fewer than 3 sentences, THE Suggestion_List SHALL show an Empty_Slot after the Suggestion_Cards for each place they leave, numbered with the Ordinal of that place, as high as a one-line Suggestion_Card and set apart by the panel fill with no border, outside the "Suggestions" list and hidden from assistive technology, so that the reserved area of Requirement 24 criterion 9 reads as three places waiting for sentences. An Empty_Slot SHALL hold no control and no text other than its Ordinal, and SHALL draw its Ordinal at a contrast ratio of at least 4.5:1 against its fill. (Added on 2026-11-11 in the visual iteration of task 17.7: with no suggestions, the reserve showed as an empty dark area under the hint.)

### Requirement 28: Partner_Zone

**User Story:** As a partner, I want the conversation history, my typed line, Listen and Settings grouped in one quiet place beside or below the speaker's panel, so that I find them quickly and they never compete with the speaker's sentence.

Added on 2026-11-11 in the design polish pass.

#### Acceptance Criteria

1. THE main screen SHALL hold the History_View and the "Partner controls" section in one Partner_Zone panel that is set apart from the page by its fill and has no border.
2. THE main screen SHALL draw the "Commands" region as a panel with the same fill and no border, holding the Command_Legend with its "All codes" button (`onboarding-and-safety` Requirement 8 criterion 8).
3. THE Partner_Zone and the "Commands" region SHALL render no text at a font size larger than the Suggestion_Card text, and no body text smaller than 18 CSS pixels (Requirement 22 criterion 5).
4. THE Partner_Zone SHALL place the History_View before the "Partner controls" section in both DOM order and visual order, in every layout.
5. WHILE Wide_Layout applies, THE Partner_Zone SHALL fill the secondary column below the "Commands" region, SHALL scroll the "Conversation history" list inside the panel when the Turns do not fit, and SHALL keep the "Partner controls" section at the bottom of the panel inside the viewport without page scroll.
6. WHILE One_Column_Layout applies, THE Partner_Zone SHALL follow the "Commands" region and SHALL limit the "Conversation history" list to a maximum height, beyond which the list scrolls inside itself.
7. THE Partner_Zone SHALL keep every accessible name and role that Requirements 15, 18, 19 and 20 give its contents: the list "Conversation history", the switch "Listen", the text field "Your line", and the buttons "Add line" and "Settings", inside a section named "Partner controls", each control with a pointer target of at least 44 by 44 CSS pixels (Requirement 22 criterion 6).


## Review corrections: timing, SOS, context and echo (review, 2026-11-11)

These corrections supersede earlier conflicting criteria in this document.

26.1. THE app SHALL satisfy: An explicit change to Starting WPM clears calibrated estimates in memory and the persisted onboarding record, retaining completion and input choice, before replacing the engine. Reload must use the new starting speed.
26.2. THE app SHALL satisfy: Raise SOS when the last typed word is exactly sos and a word gap or speak command follows; remove only that word, clear stale suggestions, preserve preceding text and do not speak it.
26.3. THE app SHALL satisfy: Notify expansion immediately whenever conversation context changes, including clear history; invalidate deleted context before any debounced request can send it.
26.4. THE app SHALL satisfy: Drop final Listen transcripts during speech, within 1500 ms after speech ends, or matching the last spoken sentence after case/whitespace/punctuation normalization.
26.5. THE app SHALL satisfy: Clamp incoming blink down/up timestamps to the engine last accepted input timestamp so delayed video frames cannot drop presses as past input.

Review integration detail: setup cancellation snapshots the session engine’s current adapted estimates through getEstimates(), rather than rereading storage. Practice and Legend are non-modal panels beside the keying surface; focus returns to that surface for Speak-code acceptance/Start. Learning a switch re-enables its source after a previous key/tap or blink choice disabled it.
