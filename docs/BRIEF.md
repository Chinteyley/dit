# Dit — product brief (Kiroween 2026, Resurrection track)

## One line

Morse code, resurrected as a voice: a free browser app that lets someone who can only make one movement (a blink, a finger twitch, a switch press) say full sentences out loud.

## Why it matters

- People with ALS/MND, locked-in syndrome, brainstem stroke, high spinal-cord injury or cerebral palsy often keep only one reliable movement. Dedicated AAC devices cost thousands of dollars; single-switch scanning keyboards run at a few words per minute.
- Morse code is a dead technology (FCC dropped the Morse test in 2007; maritime Morse ended in 1999) that happens to be the most efficient single-switch alphabet ever designed.
- Google's SpeakFaster (Nature Communications, 2024, doi:10.1038/s41467-024-53873-3) showed LLMs can expand heavily abbreviated text (word initials) using conversation context, saving 57% of motor actions vs. predictive keyboards and lifting text-entry speed 29–60% for eye-gaze users with ALS. Nobody ships that technique for single-switch Morse users in a free web app. Dit does.

## Hook for judges

"Type three letters. Say a whole sentence." The user keys `i w t g o` (initials) and Dit speaks "I want to go outside."

## Audience

1. The speaker: a person with severe motor impairment, using one input.
2. The partner: a caregiver, family member or nurse sitting next to them, who reads the big display and hears the voice.

## MVP scope (build all of it, nothing beyond it)

1. **One-input keyer.** A press is any of: Space, Enter, any key from a USB/Bluetooth switch (they emulate keys), a pointer press anywhere on the keying surface, or an opt-in webcam blink (MediaPipe Face Landmarker blendshapes `eyeBlinkLeft`/`eyeBlinkRight`, processed fully on-device). Press duration decides dot vs dash.
2. **Adaptive timing engine.** A pure TypeScript module: classify presses into dot/dash, detect letter gap (≈3 units) and word gap (≈7 units), and adapt the unit to the user's rhythm (e.g. running estimates of their short and long presses). Starts from a configurable speed (default about 6–8 WPM, slow on purpose). Deterministic, no DOM, injectable clock.
3. **Command codes** (Morse patterns that are not English letters), all reachable with the one input:
   - `.-.-.` (prosign AR, "end of message") → speak the highlighted suggestion, or the raw text when there is none.
   - `..--` → move the highlight to the next suggestion.
   - `----` → backspace (delete the last character).
   - `...---...` (SOS) → help alarm: a loud repeating chime plus a full-screen "I need help" card until any press dismisses it.
   An always-visible compact legend shows these. The partner can also tap suggestions directly.
4. **Abbreviation expansion.** If the typed text looks like initials (e.g. `iwtgo`) or a partial word/phrase, Dit asks the expansion API for up to 3 natural sentences, using the conversation context. Full words typed in Morse pass through and can still be completed.
5. **Conversation context.** Optional "Listen" toggle: Web Speech API speech recognition (where the browser supports it) transcribes what the partner says, shown as a partner bubble and sent as context. The partner can also type their line. The speaker's spoken lines become speaker bubbles.
6. **Speech.** Web Speech synthesis speaks the chosen sentence; voice and rate selectable. A history of what was said, persisted in localStorage only.
7. **Expansion backend.** A Next.js route handler `POST /api/expand` taking `{ text, context: Turn[] }` and returning `{ suggestions: string[] }` (max 3). Validate input with Zod (length caps, max turns). Provider: any OpenAI-compatible chat-completions endpoint, configured by `DIT_LLM_BASE_URL` (default `https://api.fireworks.ai/inference/v1`), `DIT_LLM_API_KEY` and `DIT_MODEL` (a small fast Fireworks serverless model; check Fireworks' current model list). Plain `fetch`, no vendor SDK; short timeout (~4 s) and a low `max_tokens`. The key is used server-side only. Because the endpoint is public, add a simple per-IP rate limit. No key or a failing call → the client falls back to an **on-device expander** (built-in phrase bank matched by initials + word completion from a frequency list), so the app is fully usable with no key and offline. The UI shows which one answered.
8. **Partner display.** A large, high-contrast readout of the current text and the last spoken sentence, readable from across a bed; a "flip" option rotates it 180° for a partner sitting opposite.
9. **Onboarding in under a minute.** First-run screen: pick your input (key/tap, switch, blink), do 5 practice presses to calibrate speed, see the command legend. A Morse cheat-sheet overlay is one press/tap away.

Out of scope: accounts, servers storing anything, native apps, eye-gaze cursor control, a Morse training game, multi-language.

## Product rules

- Every function reachable with the single input alone. Pointer/keyboard extras are for the partner.
- Privacy: no server storage, no analytics, camera frames never leave the device; only the typed text and recent context go to `/api/expand`.
- Accessibility: WCAG 2.2 AA minimum, large type, strong contrast, `prefers-reduced-motion` respected, works on a tablet in landscape and portrait.
- Design: dark, high contrast, near-white text, never muddy gray on gray. Calm and clinical-grade, not a Halloween costume. The live dot/dash stream is the visual signature of the app.

## Stack

Next.js App Router (latest stable), TypeScript strict, Tailwind CSS, Bun as the package manager and script runner, Vitest + fast-check for tests, `@mediapipe/tasks-vision` for blink detection, deploy target Vercel. MIT license.

## Tests that matter

- Property-based tests (fast-check) on the Morse engine: encode→decode roundtrip for every supported character; decoding survives ±30% timing jitter at a fixed speed; the adaptive unit converges when a user keys consistently faster or slower; command codes never collide with letters.
- Unit tests on the on-device expander and on `/api/expand` input validation.
