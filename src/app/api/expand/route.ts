import { handleExpand } from '@/lib/expansion/handler';
import { createRateLimiter } from '@/lib/expansion/rate-limit';

export const runtime = 'nodejs';

/**
 * 30 requests per client IP in any 60 s window, counted in this server instance's memory only.
 * Separate instances (for example on Vercel) keep separate counts.
 */
const rateLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

/**
 * POST /api/expand: the only server code. It reads the server-only environment on every request
 * (never NEXT_PUBLIC_), binds the platform fetch, timers and clock, and logs one line per request
 * with only the status and latency. All checks and the Provider call live in handleExpand.
 */
export async function POST(request: Request): Promise<Response> {
  return handleExpand(request, {
    env: {
      apiKey: process.env.DIT_LLM_API_KEY,
      baseUrl: process.env.DIT_LLM_BASE_URL,
      model: process.env.DIT_MODEL,
    },
    fetch: (input, init) => fetch(input, init),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    now: () => Date.now(),
    rateLimiter,
    log: ({ status, latencyMs }) => console.info(JSON.stringify({ status, latencyMs })),
  });
}
