import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DEFAULT_MODEL } from '@/lib/expansion/provider';
import { createFakeFetch, providerReply } from '@/lib/expansion/test-support/fake-fetch';
import { TEST_API_KEY } from '@/lib/expansion/test-support/route-rig';
import { POST, runtime } from './route';

const body = JSON.stringify({ text: 'iwtgo', context: [{ role: 'partner', text: 'Do you need anything?' }] });
const request = (headers: Record<string, string> = {}): Request =>
  new Request('https://dit.test/api/expand', { method: 'POST', headers: { origin: 'https://dit.test', 'content-type': 'application/json', ...headers }, body });

let info: MockInstance<typeof console.info>;

beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/expand', () => {
  it('runs on the Node.js runtime', () => {
    expect(runtime).toBe('nodejs');
  });

  it('answers 503 not_configured, never cached, when DIT_LLM_API_KEY is unset', async () => {
    vi.stubEnv('DIT_LLM_API_KEY', undefined);
    const response = await POST(request({ 'x-forwarded-for': '203.0.113.10' }));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toStrictEqual({ error: 'not_configured' });
  });

  it('accepts a same-origin page opened by LAN address, where Next.js sets request.url to localhost', async () => {
    vi.stubEnv('DIT_LLM_API_KEY', undefined);
    // What `next start` and `next dev` hand the route outside Vercel: the internal URL, the real Host.
    const lan = (origin: string): Request =>
      new Request('http://localhost:3000/api/expand', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '192.168.1.20:3000', origin, 'x-forwarded-for': '192.168.1.30' },
        body,
      });
    const same = await POST(lan('http://192.168.1.20:3000'));
    expect(same.status).toBe(503);
    expect(await same.json()).toStrictEqual({ error: 'not_configured' });
    const cross = await POST(lan('https://evil.test'));
    expect(cross.status).toBe(403);
    expect(await cross.json()).toStrictEqual({ error: 'forbidden_origin' });
  });

  it('logs one line with only the status and latency', async () => {
    vi.stubEnv('DIT_LLM_API_KEY', '');
    await POST(request({ 'x-forwarded-for': '203.0.113.11' }));
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]?.[0]);
    const entry = JSON.parse(line) as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toStrictEqual(['latencyMs', 'status']);
    expect(entry.status).toBe(503);
    expect(Number.isInteger(entry.latencyMs)).toBe(true);
    expect(line).not.toContain('iwtgo');
    expect(line).not.toContain('203.0.113.11');
  });

  it('reads the environment per request and calls the platform fetch', async () => {
    const fake = createFakeFetch();
    fake.autoRespond(() => ({ status: 200, body: providerReply('{"suggestions": ["I want to go outside."]}') }));
    vi.stubGlobal('fetch', fake.fetch);
    vi.stubEnv('DIT_LLM_API_KEY', TEST_API_KEY);
    vi.stubEnv('DIT_LLM_BASE_URL', '');
    vi.stubEnv('DIT_MODEL', '');
    const response = await POST(request({ 'x-forwarded-for': '203.0.113.12', origin: 'https://dit.test' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ suggestions: ['I want to go outside.'] });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe('https://api.fireworks.ai/inference/v1/chat/completions');
    expect(fake.calls[0]?.body).toMatchObject({ model: DEFAULT_MODEL, max_tokens: 200, reasoning_effort: 'none' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify([...response.headers.entries()])).not.toContain(TEST_API_KEY);
  });
});
