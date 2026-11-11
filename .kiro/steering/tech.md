---
inclusion: always
---

# Dit: tech steering

## Stack

| Concern | Choice |
| --- | --- |
| Runtime and package manager | Bun (1.4+). Use `bun install`, `bun add`, `bun run <script>`, `bunx`. |
| Framework | Next.js App Router, latest stable (16.x at time of writing). Server code only in `src/app/api/expand/route.ts`. |
| Language | TypeScript, `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. |
| UI | React 19, Tailwind CSS v4 (CSS-first `@theme` config in `globals.css`). |
| Validation | Zod 4 at every trust boundary: request body, model output, localStorage reads. |
| LLM | Any OpenAI-compatible chat-completions endpoint (default Fireworks serverless), called with plain `fetch`. No vendor SDK. ~4 s timeout, low `max_tokens`. Check Fireworks' current serverless model list before choosing the `DIT_MODEL` default. |
| Blink detection | `@mediapipe/tasks-vision` Face Landmarker with blendshapes, loaded lazily and only after the user opts in. |
| Tests | Vitest + fast-check. jsdom environment only for component tests; engine tests run in `node`. |
| Lint | ESLint flat config with `eslint-config-next` (includes `jsx-a11y`). |
| Deploy | Vercel. MIT license. |

## Commands

```bash
bun install            # install deps
bun run dev            # next dev (run manually; never from an agent shell)
bun run build          # next build
bun run typecheck      # tsc --noEmit
bun run lint           # eslint .
bun run test           # vitest run (all tests, single pass)
bun run test:engine    # vitest run src/lib/morse
bun run test:watch     # vitest (humans only)
```

Never run `bun test`: that invokes Bun's built-in runner, not Vitest. Always `bun run test`.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `DIT_LLM_API_KEY` | No | Enables server expansion. Absent → `/api/expand` returns 503 and the client uses the on-device expander. |
| `DIT_LLM_BASE_URL` | No | OpenAI-compatible base URL; default `https://api.fireworks.ai/inference/v1`. |
| `DIT_MODEL` | No | Model ID; default is a small, fast Fireworks serverless model chosen from Fireworks' current list at implementation time. |

Server-only. Never prefix with `NEXT_PUBLIC_`. Never commit `.env*` files; document variables in `.env.example` with empty values.

## Conventions

- **Pure core, thin shell.** Logic lives in framework-free modules under `src/lib/` (no DOM, no React, no `Date.now()`; time is passed in). React components and hooks adapt browser events to those modules.
- Named exports only; no default exports except where Next.js requires them (`page.tsx`, `layout.tsx`).
- Prefer discriminated unions and `readonly` types. No `any`; use `unknown` and narrow. No non-null assertions outside tests.
- Engine and expander functions are deterministic: same inputs → same outputs. Randomness, clocks and storage are injected.
- Client components are marked `'use client'` at the smallest boundary possible.
- Errors: never throw across the React boundary for expected failures. Return `Result`-style unions (`{ ok: true, value } | { ok: false, error }`) from lib functions that can fail.
- No `console.log` of user text, anywhere. The API route logs only status codes and latency.
- Accessible names on every control. Tailwind classes via design tokens, not raw hex values in components.

## Testing

- Every module in `src/lib/` has a `*.test.ts` (examples) and, where a design correctness property exists, a `*.prop.test.ts` (fast-check). Tag each property test with the property ID from the spec's design, e.g. `// Feature: morse-engine, Property 1: encode/decode roundtrip`.
- fast-check: `numRuns` at least 200 for engine properties; seed failures are reproducible via the printed seed.
- Component tests use Testing Library and assert on roles and accessible names, not class names.
- Web APIs (speechSynthesis, SpeechRecognition, getUserMedia, MediaPipe) are wrapped behind small interfaces so tests use fakes.

## Docs to consult

Use the `context7` MCP server for current library docs (Next.js, Zod, Tailwind v4, Vitest, fast-check, MediaPipe, Fireworks/OpenAI chat-completions) and `next-devtools` for Next.js runtime diagnostics while `bun run dev` is running.
