# dit
Morse code, resurrected as a voice. One-switch AAC with LLM sentence expansion. Kiroween 2026.

## Features

- **Adaptive timing engine.** Reads dots, dashes and pauses at the speaker's own pace, starting slow at 6 words per minute and following their rhythm as they key.

### In progress

- **One-input keyer.** Space, Enter, a switch, a tap on the keying area or an opt-in webcam blink; how long you press decides dot or dash.
- **Command codes.** Morse patterns that speak, pick the next suggestion, delete a letter or sound a help alarm, with a legend always on screen.
- **Abbreviation expansion.** Initials or partial words become up to 3 full sentences that fit the conversation.
- **Conversation context.** An optional Listen toggle or a typed line from the partner gives the expansion context.
- **Speech.** The chosen sentence is spoken aloud in a voice and rate you pick; the history stays on this device.
- **Expansion backend.** `POST /api/expand` asks an OpenAI-compatible model, and an on-device expander answers when there is no key or no network.
- **Partner display.** A large, high-contrast view of the current text and the last sentence, readable across a bed and able to flip 180°.
- **Onboarding.** Pick an input, make 5 practice presses to set the speed and learn the commands in under a minute.
