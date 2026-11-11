import { describe, expect, it } from 'vitest';
import nextConfig from './next.config';

describe('next.config headers', () => {
  it('limits page connections to this origin on every route and caches the MediaPipe files for a year', async () => {
    expect(nextConfig.headers).toBeTypeOf('function');
    const rules = await nextConfig.headers?.();
    expect(rules).toStrictEqual([
      { source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "connect-src 'self'" }] },
      { source: '/mediapipe/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ]);
  });

  it('hides the development indicator', () => {
    expect(nextConfig.devIndicators).toBe(false);
  });

  it('restricts only connect-src, so scripts, styles, fonts and images load as before', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const policies = rules.flatMap((rule) => rule.headers.filter((header) => header.key === 'Content-Security-Policy'));
    expect(policies.map((header) => header.value)).toStrictEqual(["connect-src 'self'"]);
  });
});
