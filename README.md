# dit
Morse code, resurrected as a voice. One-switch AAC with LLM sentence expansion. Kiroween 2026.

## What Dit is

Dit is a free browser app for someone who can make only one reliable movement: a blink, a finger twitch or a switch press. They key Morse code with that one movement, Dit turns short abbreviations into full sentences, and the sentence is spoken aloud. Keying `i w t g o` says "I want to go outside."

It is for two people:

- **The speaker**, a person with severe motor impairment (for example ALS or MND, locked-in syndrome, a brainstem stroke, a high spinal-cord injury or cerebral palsy) who has one input.
- **The partner**, a caregiver, family member or nurse next to them, who reads the large display, hears the voice, talks back and changes settings.

Every speaker function works with the one input alone. The partner uses ordinary taps and keys.

## Features

- **One-input keyer.** Space, Enter, a switch, a tap on the keying area or an opt-in webcam blink; how long you press decides dot or dash.
- **Adaptive timing engine.** Reads dots, dashes and pauses at the speaker's own pace, starting slow at 6 words per minute and following their rhythm as they key.
- **Command codes.** Morse patterns that speak, pick the next suggestion, delete a letter or sound a help alarm, with a legend always on screen and a sheet of every code one tap or one unknown pattern away.
- **Abbreviation expansion.** Initials or partial words become up to 3 full sentences that fit the conversation; the partner can tap one to speak it.
- **Conversation context.** An optional Listen toggle or a typed line from the partner gives the expansion context, and every spoken line joins the conversation history.
- **Speech.** The chosen sentence is spoken aloud in a voice and rate you pick; the history stays on this device.
- **Expansion backend.** `POST /api/expand` asks an OpenAI-compatible model, an on-device expander answers when there is no key or no network, and the screen says which one answered.
- **Partner display.** A large, high-contrast view of the current text and the last sentence, readable across a bed and able to flip 180°.
- **Onboarding.** Pick an input, make 5 practice presses to set the speed and learn the commands in under a minute.

### Pending manual checks

- Real switch, touch tablet and webcam checks (input-sources task 17).
- A live expansion check with a model key (expansion task 13.4).
- Tablet, zoom, reduced-motion and contrast checks (conversation-ui task 16).
- Alarm volume, blink alarm, tablet layout and screen reader checks (onboarding-and-safety task 23).

## How to run

You need [Bun](https://bun.sh) 1.4 or later.

```bash
bun install            # install dependencies; also copies the MediaPipe files into public/
bun run dev            # start the app at http://localhost:3000
bun run build          # production build
bun run test           # all unit and property tests (Vitest, one pass)
bun run test:engine    # only the Morse engine tests
bun run typecheck      # tsc --noEmit
bun run lint           # ESLint
```

Always use `bun run test`. Plain `bun test` starts Bun's own test runner, which does not run these tests.

`bun install` runs `scripts/mediapipe-assets.ts`. It copies the MediaPipe WebAssembly files from `node_modules` into `public/mediapipe/1.2.2/wasm/` and checks the committed blink model `public/mediapipe/1.2.2/face_landmarker.task` against its SHA-256. Maintainers can download the model again with `bun run assets:mediapipe -- --fetch-model`.

## Environment variables

All three are optional and server-only. Copy `.env.example` to `.env.local` and fill in what you need. Never prefix them with `NEXT_PUBLIC_`.

| Name | Default | Purpose |
| --- | --- | --- |
| `DIT_LLM_API_KEY` | none | Turns on server expansion. Without it, `/api/expand` answers 503 and the on-device expander answers instead. |
| `DIT_LLM_BASE_URL` | `https://api.fireworks.ai/inference/v1` | Any OpenAI-compatible chat-completions endpoint. |
| `DIT_MODEL` | `accounts/fireworks/models/deepseek-v4p1-flash-1017` | The model ID. |

With no key, or with no network, the app still works fully. Each set of suggestions is labelled "Source: AI" or "Source: On-device", so you always know which one answered.

The default model is DeepSeek V4.1 Flash 1017 on Fireworks serverless, chosen on 2026-11-10. Expansion needs a fast answer with no thinking step. Fireworks' serverless list had no chat model without a thinking step, and the spec's earlier candidate, Qwen3 8B, is no longer offered serverless. Fireworks recommends DeepSeek V4.1 Flash 1017 for fast extraction, classification and low-latency use, and its thinking can be switched off. Requests to the default model therefore send `reasoning_effort: "none"`. A model set with `DIT_MODEL` gets exactly `model`, `messages` and `max_tokens`, with no `reasoning_effort`. A live check of the prompt with a real key is still pending (expansion task 13.4).

How the expansion call works:

- The browser waits 300 ms after the last change, then calls `/api/expand` with a 5 s timeout, and falls back to the on-device expander on any failure.
- The route checks that the request comes from the same origin, caps the body at 16 KB, validates it with Zod, calls the model with a 4 s timeout and `max_tokens` 200, and limits each IP address to 30 requests per 60 s.

## Limitations

- The `/api/expand` rate limit lives in the memory of each server instance. On Vercel, separate instances do not share their counts, and a cold start resets them. It stops casual abuse, not a determined attacker.
- Listen (speech recognition for the partner's voice) works only in browsers that offer the Web Speech recognition API.

## Privacy

- No server storage, no accounts, no analytics, no cookies and no third-party trackers.
- Settings, conversation history and the setup choice stay in this browser's localStorage.
- Camera frames for blink input are processed on the device and never leave it. The camera starts only when the partner turns it on.
- Only the typed text and the last 10 conversation turns go to `/api/expand`, and the route logs only the status code and latency, never the text.
- The MediaPipe files and the font (Atkinson Hyperlegible Next, through `next/font`) are served from this app. MediaPipe's built-in usage telemetry is switched off, and every page has a `Content-Security-Policy: connect-src 'self'` header, so the browser blocks requests to other sites.
- The optional Listen toggle uses the browser's own speech recognition. In Chrome, that sends microphone audio to Google's speech service.

## Credits

- The word list in `src/lib/expansion/word-freq.ts` comes from [hackerb9/gwordlist](https://github.com/hackerb9/gwordlist), based on the Google Books Ngram data, under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).
- The blink model `face_landmarker.task` is Google's MediaPipe Face Landmarker model, under the Apache License 2.0.
- Atkinson Hyperlegible Next is by the Braille Institute, under the SIL Open Font License.

## How Kiro was used

Dit was built with [Kiro](https://kiro.dev), spec first.

- **Specs.** Five specs in `.kiro/specs/`, each with `requirements.md` (EARS acceptance criteria), `design.md` and `tasks.md`: `morse-engine`, `input-sources`, `expansion`, `conversation-ui` and `onboarding-and-safety`. They were built in that order, one task at a time, and each finished spec became one commit. Deviations found while building are recorded in each design's "Implementation notes".
- **Steering.** `.kiro/steering/product.md`, `tech.md` and `structure.md` are always included. `morse-engine.md` and `accessibility.md` are included when a matching file is open (the engine and input code, and the UI files). `docs/BRIEF.md` defines the scope.
- **Hooks** in `.kiro/hooks/`:
  - `a11y-review`: after a component or page is saved, the agent reviews it against the accessibility checklist.
  - `morse-engine-tests`: after an engine file is saved, runs `bun run test:engine`.
  - `privacy-review`: after network, storage or camera code is saved, the agent checks it against the privacy rules.
  - `readme-feature-sync`: after a `tasks.md` changes, the agent updates the README feature list to what is built.
  - `secret-guard`: blocks any agent write whose content looks like an API key.
  - `task-verify`: after a spec task is marked done, runs `bun run typecheck` and `bun run test`.
  - `typecheck-lint`: after a TypeScript file is saved, runs `bun run typecheck` and `bun run lint`.
- **Custom agent.** `.kiro/agents/dit-builder.json` implements one spec task at a time. Its shell is limited to Bun, Vitest, tsc, ESLint and read-only git commands; `git push`, `git reset --hard`, `git clean`, `vercel`, `rm -rf`, `sudo` and `bun test` are denied. It may write source, config, the README and `tasks.md` files, and may not touch `.env` files, steering, hooks, agents, settings or the brief.
- **MCP.** `.kiro/settings/mcp.json` adds `context7` for current library docs and `next-devtools` for Next.js runtime diagnostics.
- **Property-based testing.** Every correctness property in a design has its own [fast-check](https://fast-check.dev) test with at least 200 runs, tagged with its property ID: 23 for `morse-engine`, 17 for `input-sources`, 27 for `expansion`, 21 for `conversation-ui` and 28 for `onboarding-and-safety`. Some of the key ones:
  - encoding any supported text and decoding it gives the text back;
  - decoding survives ±30% jitter on every press and gap;
  - the adaptive speed converges on a speaker who keys consistently faster or slower;
  - no command code collides with a letter code;
  - no press reaches the session while the help alarm is active, and each alarm ends exactly once;
  - the alarm chime schedule never repeats or skips a chime, however the window is split;
  - onboarding steps only move forward, and only the first 5 practice presses count.

## License

MIT. See [LICENSE](LICENSE).
