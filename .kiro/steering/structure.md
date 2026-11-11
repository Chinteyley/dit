---
inclusion: always
---

# Dit: structure steering

## Layout

```
dit/
├── docs/BRIEF.md                 # product brief (scope source of truth)
├── public/                       # static assets; public/mediapipe/<version>/ holds self-hosted blink model + wasm
├── scripts/                      # build helpers (mediapipe asset copy)
├── src/
│   ├── app/
│   │   ├── layout.tsx            # html lang="en", dark theme, fonts, metadata
│   │   ├── page.tsx              # renders <DitRoot/> (client root)
│   │   ├── globals.css           # Tailwind v4 @theme tokens (colors, type scale, motion)
│   │   └── api/expand/route.ts   # POST /api/expand (the only server code)
│   ├── lib/                      # framework-free, DOM-free, deterministic
│   │   ├── morse/                # spec: morse-engine
│   │   │   ├── codes.ts          # character table + command table
│   │   │   ├── timing.ts         # unit, thresholds, WPM conversion
│   │   │   ├── adapt.ts          # adaptive unit estimator
│   │   │   ├── decoder.ts        # event → state machine (press/release/tick)
│   │   │   ├── encode.ts         # text → timed press sequence (tests, cheat sheet, demo)
│   │   │   └── index.ts          # public API barrel
│   │   ├── input/                # spec: input-sources
│   │   │   ├── types.ts          # PressSource interface, PressEvent
│   │   │   ├── keyboard.ts       # Space/Enter/switch keys
│   │   │   ├── pointer.ts        # pointer press on keying surface
│   │   │   └── blink/            # blink detector (pure hysteresis) + MediaPipe adapter
│   │   ├── expansion/            # spec: expansion
│   │   │   ├── schema.ts         # Zod schemas: Turn, ExpandRequest, ExpandResponse
│   │   │   ├── classify.ts       # initials vs partial vs words
│   │   │   ├── on-device.ts      # phrase bank + word completion expander
│   │   │   ├── phrase-bank.ts    # data
│   │   │   ├── word-freq.ts      # data
│   │   │   ├── prompt.ts         # server prompt builder + output parser
│   │   │   └── client.ts         # fetch /api/expand with timeout + fallback
│   │   ├── conversation/         # spec: conversation-ui (pure reducers)
│   │   │   ├── session.ts        # current text, suggestions, highlight, turns
│   │   │   ├── live-queue.ts     # throttled screen-reader announcements
│   │   │   └── storage.ts        # localStorage history/settings (Zod-validated)
│   │   ├── speech/               # spec: conversation-ui; synthesis + recognition interfaces + browser impls
│   │   ├── safety/               # spec: onboarding-and-safety; alarm machine, chime schedule, chime player, press router
│   │   └── onboarding/           # spec: onboarding-and-safety; flow reducer, record schema, legend + cheat-sheet models
│   ├── components/               # React UI (conversation-ui; onboarding-and-safety adds AlarmCard, CommandLegend, CheatSheet, onboarding/)
│   └── hooks/                    # React hooks + framework-free controllers gluing lib/ to the DOM (useInputSources, session-controller, useMorseSession)
├── .kiro/                        # steering, specs, hooks, agents, settings
├── .env.example                  # documented env vars, empty values
├── package.json · tsconfig.json · vitest.config.ts · eslint.config.mjs · next.config.ts
└── README.md · LICENSE (MIT)
```

## Rules

- Tests sit next to the code: `foo.ts`, `foo.test.ts`, `foo.prop.test.ts`.
- `src/lib/**` must not import from `react`, `next`, `src/components`, `src/hooks`, or touch `window`/`document`. Browser API adapters live in `src/lib/*/browser.ts` files behind interfaces and are the only lib files allowed to reference globals.
- `src/components/**` never imports from `src/app/api/**`. The client reaches the server only through `src/lib/expansion/client.ts`.
- One component per file, PascalCase filename matching the export (`KeyingSurface.tsx`).
- Data files (`phrase-bank.ts`, `word-freq.ts`) are plain typed constants, no runtime fetching.
- Each spec under `.kiro/specs/<name>/` owns the folders named in its design; cross-spec dependencies go through the public `index.ts` of a lib module.
