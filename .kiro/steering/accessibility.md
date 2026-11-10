---
inclusion: fileMatch
fileMatchPattern: ["src/components/**/*.tsx", "src/app/**/*.tsx", "src/hooks/**/*.ts", "src/app/globals.css"]
---

# Dit: accessibility steering

Target: **WCAG 2.2 AA minimum** everywhere, AAA contrast for the partner display and keying surface text. These rules apply to every UI change.

## Single-input rule

- Every speaker function works with the one input alone: keying characters, choosing a suggestion (`..--`), speaking (`.-.-.`), backspace (`----`), help alarm (`...---...`), and opening the cheat sheet. If a new speaker-facing feature cannot be driven by presses, it is a bug.
- Partner-only extras (settings, Listen, flip, typing a partner line, tapping a suggestion) are ordinary keyboard- and pointer-accessible controls.
- When focus is in a text field, Space and Enter type normally and are never treated as Morse presses.
- No time-limited interactions for the speaker other than Morse timing itself, and that timing is adjustable (WCAG 2.2.1).

## Contrast and color

- Body text ≥ 4.5:1, large text ≥ 3:1, UI component boundaries and focus indicators ≥ 3:1 against adjacent colors (1.4.3, 1.4.11).
- Partner display and current text: aim ≥ 7:1 (near-white on near-black).
- Never use gray text on a gray surface. Muted text stays ≥ 4.5:1.
- Never encode meaning by color alone: dots and dashes differ in shape and length; the highlighted suggestion has an outline and a text marker, not only a tint; AI vs on-device source is a text label.

## Type and layout

- Base font ≥ 18px; partner display text scales with `clamp()` to stay readable from ~2 m.
- Works on a tablet in landscape and portrait, 320 CSS px wide minimum, with 200% zoom and no horizontal scroll (1.4.4, 1.4.10).
- Pointer targets ≥ 44×44 CSS px (above the 2.2 minimum of 24×24, 2.5.8). The keying surface is the largest target on screen.
- Flipped partner display keeps reading order correct for assistive tech (rotate with CSS transform, do not reorder DOM).

## Motion and sound

- Respect `prefers-reduced-motion: reduce`: no slide/scale transitions, no pulsing; the dot/dash stream appears without animation; the SOS card does not flash. Use opacity or instant changes.
- Nothing flashes more than 3 times per second (2.3.1), including the SOS alarm.
- Every sound has a visual equivalent (SOS card, keying feedback). The SOS chime is the one sound that plays without opt-in.

## Semantics

- Use native elements first (`button`, `input`, `dialog`). One `h1` per page.
- Live regions: committed characters and new suggestions announce via a single polite `aria-live` region (throttled, no per-dot chatter); the SOS alarm uses `role="alertdialog"`.
- Visible focus on every focusable element (2.4.7, 2.4.11 focus not obscured). Focus is not trapped except in modal dialogs, which close on Escape. When a partner control or dialog finishes, focus returns to the keying surface (not the opener) so the next Space/Enter press keys Morse; see the input-sources spec.
- Form controls have visible labels. Icons-only buttons have `aria-label`.
- Camera use is opt-in with a clear explanation that frames stay on the device.

## Review checklist (use in reviews and the a11y hook)

1. Can the speaker do this with presses alone?
2. Contrast pairs measured and noted?
3. Reduced motion honored?
4. Accessible names, roles, and live-region behavior correct?
5. Target sizes ≥ 44 px; works at 320 px and 200% zoom?
6. No meaning by color alone; no flashing > 3/s?
