---
inclusion: fileMatch
fileMatchPattern: ["src/lib/morse/**", "src/lib/input/**", "src/hooks/useMorse*", "src/components/onboarding/**", "src/components/CheatSheet.tsx"]
---

# Dit: Morse engine steering

The engine is `src/lib/morse/`: pure TypeScript, no DOM, no React, no real clock. Every call receives a timestamp in milliseconds from the caller. Same input sequence → same output sequence.

## Timing model

- **Unit `u`** (ms) is the length of one dot. Conversion uses the PARIS standard: `u = 1200 / wpm`.
- **Default speed: 6 WPM → `u = 200 ms`.** Slow on purpose. Configurable from 2 WPM (600 ms) to 20 WPM (60 ms) as a starting speed.
- **Absolute bounds** for any adapted value: `MIN_UNIT = 60 ms`, `MAX_UNIT = 1500 ms` (blink users can be very slow).

Nominal element lengths, in units:

| Element | Nominal | Classified as |
| --- | --- | --- |
| Dot press | 1 | press duration `< dotDashThreshold` |
| Dash press | 3 | press duration `≥ dotDashThreshold` |
| Gap inside a character | 1 | silence `< letterGapThreshold` |
| Letter gap | 3 | silence `≥ letterGapThreshold` → commit the character |
| Word gap | 7 | silence `≥ wordGapThreshold` → emit one space |

The gap floor is the guarded calibrated dot at engine creation, or `1200 / startingWpm` without calibration. `gapUnit = max(dotEstimate, gap floor)`; adaptation may lengthen gaps but never shorten them below that baseline.

Thresholds (with the default, non-adapted estimator):

- `dotDashThreshold = (dotEstimate + dashEstimate) / 2` → **2u**
- `letterGapThreshold = 2 × gapUnit` → **2u**
- `wordGapThreshold = 4.5 × gapUnit` → **4.5u**

Why these values: with every element jittered by ±30% of its nominal length, dots fall in [0.7, 1.3]u and dashes in [2.1, 3.9]u; intra-character gaps in [0.7, 1.3]u, letter gaps in [2.1, 3.9]u and word gaps in [4.9, 9.1]u. Each threshold sits strictly between neighbouring ranges, so decoding at fixed speed survives ±30% jitter. This jitter argument applies when press and gap units agree; calibration supplies the gap floor, while uncalibrated input retains the Starting-WPM floor. Verify both paths with the jitter and calibrated-gap properties.

## Event model

The engine is a state machine driven by three inputs:

- `press(t)`: input went down at time `t`.
- `release(t)`: input went up; duration = `t − pressStart`. Durations `≤ 0` are ignored. (Debounce of very short presses is the input layer's job, not the engine's.)
- `tick(t)`: time advanced with the input up. The engine exposes `nextDeadline()` (the next time a gap threshold will be crossed, or `null`) so the UI schedules exactly one timer.

Outputs are a discriminated union:

```ts
type EngineEvent =
  | { type: 'symbol'; symbol: '.' | '-' }        // live dot/dash stream
  | { type: 'char'; char: string }               // committed character (lowercase letters)
  | { type: 'space' }                            // word gap
  | { type: 'command'; command: 'speak' | 'next' | 'backspace' | 'sos' }
  | { type: 'unknown'; pattern: string };        // pattern matched nothing
```

Rules:

- At a letter gap the buffered pattern is looked up in the **command table first**, then the character table. A miss emits `unknown`.
- A word gap emits at most one `space`, and only after a `char` was committed since the last space. Never two spaces in a row; never a space before any character. A `command` or `unknown` commit clears space eligibility, so a pause after backspace, speak or a mis-keyed pattern never inserts a stray space.
- A pattern longer than 9 symbols (the length of SOS) can never match; commit it as `unknown` as soon as the 10th symbol arrives.
- `reset()` clears the pattern buffer but keeps the adapted timing.

## Character set

Letters `a–z`, digits `0–9`, and `. , ? ' ! / - ( ) : = @ "` using ITU codes. Letters decode to lowercase.

**`+` is NOT supported**: its code `.-.-.` is the AR prosign, which Dit uses as the speak command. `encode('+')` must report the character as unsupported, never emit `.-.-.`.

## Command codes

| Code | Name | Action (performed by the conversation layer) |
| --- | --- | --- |
| `.-.-.` | AR, speak | Speak the highlighted suggestion, or the raw text if nothing is highlighted |
| `..--` | next | Move the highlight to the next suggestion (wraps through "no highlight" = raw text) |
| `----` | backspace | Delete the last character of the current text |
| `...---...` | SOS | Help alarm: repeating chime + full-screen "I need help" card until any press |

Invariant: **no command code equals any character code.** Enforced by a property test over the tables.

## Adaptation strategy

The engine keeps two running estimates, both exponential moving averages:

- `dotEstimate`, initialised to `u0`; updated by every press classified as a dot.
- `dashEstimate`, initialised to `3·u0`; updated by every press classified as a dash.
- Update: `est ← est + α·(duration − est)`, default `α = 0.15`.

Guards:

- Each observation is clamped to `[0.5, 2] × current estimate` before updating, so one stuck or interrupted press cannot drag the speed far.
- Both estimates are clamped to `[MIN_UNIT, 3·MAX_UNIT]` and `dotEstimate ≤ MAX_UNIT`.
- Separation is preserved: `dashEstimate ≥ 1.5 × dotEstimate`; if an update would break it, push `dashEstimate` up to the bound.
- Gaps are never used for adaptation (people pause to think).
- Adaptation can be switched off (fixed speed); then estimates stay at `u0` and `3·u0`.

Convergence expectation (tested): if the user keys consistently with a true unit `u*` in `[0.75, 1.75] × u0` (dots ≈ `u*`, dashes ≈ `3u*`, ±10% jitter), then after 40 presses containing at least 15 of each kind, `dotEstimate` is within 15% of `u*` and `dashEstimate` within 15% of `3u*` (worst case, with every jitter factor leaning the same way, is about 12.9%). The range is chosen so that, with ±10% jitter, every press is classified correctly by the initial 2u0 threshold (3·0.75·0.9 ≥ 2 and 1.75·1.1 < 2).

## Calibration

Onboarding asks for 5 practice presses: 3 short then 2 long. `calibrate(durations)` sets `dotEstimate = median(short)` and `dashEstimate = median(long)`, then applies the clamps and the separation guard. If the long presses are not at least 1.5× the short ones, it uses `dashEstimate = 3 × dotEstimate`. Calibration never fails: invalid input returns the defaults and a reason.

## Encoder

`encode(text, unit)` returns a timed press/release sequence for supported characters (used by tests, the cheat sheet and onboarding demos). Unsupported characters are reported in the result, not silently dropped. `decode(encode(x))` must equal `x` (lowercased, single-spaced) for every supported string.

## Required property tests (fast-check)

1. Encode→decode roundtrip for every supported character and for random strings over the charset.
2. Decoding a random supported string survives independent ±30% jitter on every element at fixed speed (adaptation off).
3. Adaptive estimates converge when the user keys consistently faster or slower (bounds above).
4. Command codes never collide with character codes, and the character table is injective.
5. Determinism: replaying the same event sequence yields identical outputs.
