import { createRateLimiter } from '@/lib/expansion/rate-limit';
import { handleTranscribe } from '@/lib/transcribe/handler';

export const runtime = 'nodejs';
const rateLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

export async function POST(request: Request): Promise<Response> {
  return handleTranscribe(request, {
    env: {
      // Its own key only: the chat key belongs to another provider and must not be sent here.
      apiKey: process.env.DIT_TRANSCRIBE_API_KEY,
      baseUrl: process.env.DIT_TRANSCRIBE_BASE_URL,
      model: process.env.DIT_TRANSCRIBE_MODEL,
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
