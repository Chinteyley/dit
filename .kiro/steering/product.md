---
inclusion: always
---

# Dit: product steering

Source of truth for scope: #[[file:docs/BRIEF.md]]. If this file and the brief disagree, the brief wins. Do not build anything the brief lists as out of scope.

## What Dit is

A free browser app that turns one reliable movement (a blink, a finger twitch, a switch press) into Morse code, expands abbreviated input into full sentences, and speaks them aloud. Pitch: "Type three letters. Say a whole sentence." Keying `i w t g o` speaks "I want to go outside."

## Users

- **Speaker.** A person with severe motor impairment (ALS/MND, locked-in syndrome, brainstem stroke, high spinal-cord injury, cerebral palsy) who has one input. They may tire quickly, key slowly and inconsistently, and cannot use a pointer or keyboard.
- **Partner.** A caregiver, family member or nurse beside the speaker. They read the large display, hear the voice, can talk back (Listen) or type their line, tap suggestions, and change settings.

## Problem

Dedicated AAC devices cost thousands of dollars. Single-switch scanning keyboards reach a few words per minute. Morse is the most efficient single-switch alphabet, and LLM abbreviation expansion (Google SpeakFaster, Nature Communications 2024) saves over half the motor actions. No free web app combines them for single-switch users.

## MVP features (complete list)

1. One-input keyer: Space, Enter, switch keys, pointer press on the keying surface, opt-in webcam blink. Press duration decides dot vs dash.
2. Adaptive timing engine (pure TypeScript; see `morse-engine.md`).
3. Command codes: AR `.-.-.` speak, `..--` next suggestion, `----` backspace, `...---...` SOS alarm. Always-visible compact legend. Partner can tap suggestions.
4. Abbreviation expansion: initials or partial words → up to 3 sentences using conversation context. Full words pass through and can be completed.
5. Conversation context: optional Listen toggle (Web Speech recognition) for partner speech; partner can also type. Spoken speaker lines become speaker bubbles.
6. Speech: Web Speech synthesis, selectable voice and rate. History persisted in localStorage only.
7. `POST /api/expand` route handler (Zod-validated; any OpenAI-compatible chat-completions endpoint via plain `fetch`, Fireworks by default; ~4 s timeout; per-IP rate limit). No key or failure → on-device expander. UI shows which source answered.
8. Partner display: large high-contrast readout of current text and last spoken sentence; flip 180° option.
9. Onboarding under a minute: pick input, 5 practice presses to calibrate, see legend. Morse cheat-sheet overlay one press/tap away.

Out of scope: accounts, server-side storage, native apps, eye-gaze cursor control, Morse training games, languages other than English.

## Product rules (non-negotiable)

- **Single-input rule.** Every speaker function (typing, choosing a suggestion, speaking, backspace, help alarm, opening the cheat sheet) must work with the one input alone. Pointer and keyboard extras (settings, typing a partner line, flip, Listen) are for the partner.
- **Privacy.** No server storage, no analytics, no third-party trackers, no cookies. Camera frames never leave the device. Only the typed text and recent context are sent to `/api/expand`, and the route never logs them.
- **Works with no key and offline.** The on-device expander must make the app fully usable without `DIT_LLM_API_KEY` or a network.
- **Public endpoint hygiene.** `/api/expand` is public, so it enforces a simple per-IP rate limit, size caps and a same-origin check; the key stays server-side.
- **Accessibility.** WCAG 2.2 AA minimum; see `accessibility.md`.
- **Design.** Dark, high contrast, near-white text; never muddy gray on gray. Calm and clinical-grade, not a Halloween costume. The live dot/dash stream is the app's visual signature.
- **Safety.** The SOS alarm must never be blocked by another overlay, a pending network call, or an error state.

## Voice and copy

Plain, short, kind. Address the partner in UI chrome ("Tap a suggestion to speak it"). Never patronise the speaker. No spooky theming in the product itself.
