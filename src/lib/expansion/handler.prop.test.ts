import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classify } from './classify';
import { filterSuggestions } from './filter';
import { BODY_LIMIT_BYTES, checkOrigin, handleExpand } from './handler';
import { buildPrompt, parseModelOutput } from './prompt';
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from './provider';
import { ExpandRequestSchema, type ExpandRequest, type Turn } from './schema';
import { PROP_RUNS, contextArb, initialsLettersArb, knownWordArb, renderTokensArb, roleArb } from './test-support/arbitraries';
import { providerReply } from './test-support/fake-fetch';
import { ROUTE_URL, SAME_ORIGIN, countingLimiter, createRig, post, readResponse, streamOf } from './test-support/route-rig';

const encoder = new TextEncoder();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Shared generators

const hostLabelArb = fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), minLength: 1, maxLength: 10 });
const hostArb = fc.tuple(hostLabelArb, fc.constantFrom('test', 'example', 'dit.app')).map(([label, tld]) => `${label}.${tld}`);
const portArb = fc.option(fc.integer({ min: 1, max: 65_535 }), { nil: undefined });

const randomCase = (s: string): fc.Arbitrary<string> =>
  fc.array(fc.boolean(), { minLength: s.length, maxLength: s.length }).map((flags) =>
    s
      .split('')
      .map((ch, i) => (flags[i] === true ? ch.toUpperCase() : ch))
      .join(''),
  );

/** Schema-valid request bodies. */
const requestArb: fc.Arbitrary<ExpandRequest> = fc
  .tuple(
    fc.oneof(
      initialsLettersArb.chain((letters) => fc.oneof(renderTokensArb([letters]), renderTokensArb(letters.split('')))),
      fc.array(knownWordArb, { minLength: 1, maxLength: 6 }).chain(renderTokensArb),
    ),
    contextArb,
  )
  .map(([text, context]) => ExpandRequestSchema.safeParse({ text, context }))
  .filter((parsed) => parsed.success)
  .map((parsed) => (parsed.success ? parsed.data : { text: 'x', context: [] }))
  // Non-ASCII context can exceed the byte limit (design Open points); those requests are 413 cases.
  .filter((req) => encoder.encode(JSON.stringify(req)).byteLength <= BODY_LIMIT_BYTES);

const apiKeyArb = fc
  .string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), minLength: 12, maxLength: 40 })
  .map((s) => `test-${s}`);
const ipArb = fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map((parts) => parts.join('.'));

describe('route handler properties', () => {
  it('passes the origin check exactly for an absent Origin or one that names this server', () => {
    // Feature: expansion, Property 18: The origin check passes exactly same-origin or absent Origin
    const defaultPortOf = (scheme: string): number => (scheme === 'https' ? 443 : 80);
    /** A plain origin by its parts (effective port), or an absent or malformed header. */
    type OriginCase =
      | { readonly kind: 'absent'; readonly origin: null }
      | { readonly kind: 'malformed'; readonly origin: string }
      | {
          readonly kind: 'plain';
          readonly origin: string;
          readonly scheme: string;
          readonly host: string;
          readonly port: number;
          readonly matchesUrl: boolean;
        };
    const caseArb = fc
      .record({ scheme: fc.constantFrom('http', 'https'), host: hostArb, port: portArb })
      .chain(({ scheme, host, port }) => {
        const defaultPort = defaultPortOf(scheme);
        const effective = port ?? defaultPort;
        const url = `${scheme}://${host}${port === undefined ? '' : `:${port}`}/api/expand`;
        const plain = (origin: string, parts: { scheme: string; host: string; port: number }, matchesUrl: boolean): OriginCase => ({
          kind: 'plain',
          origin,
          ...parts,
          matchesUrl,
        });
        const sameArb = fc
          .tuple(randomCase(scheme), randomCase(host), fc.constantFrom('none', 'explicit', 'implicit'), fc.boolean())
          .map(([s, h, portStyle, slash]) => {
            const shownPort = portStyle === 'explicit' || effective !== defaultPort ? `:${effective}` : '';
            return plain(`${s}://${h}${shownPort}${slash ? '/' : ''}`, { scheme, host, port: effective }, true);
          });
        const otherScheme = scheme === 'https' ? 'http' : 'https';
        const differentArb = fc.oneof(
          fc.constant(plain(`${otherScheme}://${host}:${effective}`, { scheme: otherScheme, host, port: effective }, false)),
          hostArb.filter((h) => h !== host).map((h) => plain(`${scheme}://${h}:${effective}`, { scheme, host: h, port: effective }, false)),
          fc
            .integer({ min: 1, max: 65_535 })
            .filter((p) => p !== effective)
            .map((p) => plain(`${scheme}://${host}:${p}`, { scheme, host, port: p }, false)),
        );
        const malformedArb = fc.oneof(
          fc.constantFrom('/x', '/api/expand', '/?a=1', '/#f', '?q', '#frag').map((suffix) => `${scheme}://${host}:${effective}${suffix}`),
          fc.constant(`${scheme}://user:pw@${host}:${effective}`),
          fc.constantFrom('null', '', ' ', 'garbage', '://', 'file:///', 'data:text/plain,hi', `${host}`, `${scheme}:${host}`),
          fc.string().filter((s) => !s.includes('://')),
        ).map((origin): OriginCase => ({ kind: 'malformed', origin }));
        const originArb = fc.oneof(fc.constant<OriginCase>({ kind: 'absent', origin: null }), sameArb, differentArb, malformedArb);
        // The Host header a browser would send: a hostname with or without a port, built from parts.
        return originArb.chain((origin) => {
          const hostnames = [host, ...(origin.kind === 'plain' ? [origin.host] : [])];
          const ports = [effective, ...(origin.kind === 'plain' ? [origin.port] : [])];
          const hostHeaderArb = fc
            .record({
              hostname: fc.oneof(fc.constantFrom(...hostnames), hostArb).chain(randomCase),
              port: fc.option(fc.oneof(fc.constantFrom(...ports, 80, 443), fc.integer({ min: 1, max: 65_535 })), { nil: undefined }),
            })
            .map(({ hostname, port: p }) => ({ hostname, port: p, header: p === undefined ? hostname : `${hostname}:${p}` }));
          return fc.record({
            url: fc.constant(url),
            origin: fc.constant(origin),
            host: fc.option(hostHeaderArb, { nil: undefined, freq: 2 }),
            fetchSite: fc.option(fc.constantFrom('same-origin', 'SAME-ORIGIN', 'cross-site', 'same-site', 'none'), {
              nil: undefined,
              freq: 2,
            }),
          });
        });
      });
    fc.assert(
      fc.property(caseArb, ({ url, origin, host, fetchSite }) => {
        const headers = new Headers();
        if (host !== undefined) headers.set('host', host.header);
        if (fetchSite !== undefined) headers.set('sec-fetch-site', fetchSite);
        let expected: boolean;
        if (origin.kind === 'absent') expected = true;
        else if (origin.kind === 'malformed') expected = false;
        else if (fetchSite !== undefined) expected = fetchSite.toLowerCase() === 'same-origin';
        else
          expected =
            origin.matchesUrl ||
            (host !== undefined &&
              host.hostname.toLowerCase() === origin.host &&
              (host.port ?? defaultPortOf(origin.scheme)) === origin.port);
        expect(checkOrigin(origin.origin, url, headers)).toBe(expected);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('runs its checks in order and stops at the first failure', async () => {
    // Feature: expansion, Property 19: The route runs its checks in order and stops at the first failure
    const invalidBodyArb = fc.constantFrom<{ kind: string; bytes: Uint8Array }>(
      { kind: 'empty', bytes: new Uint8Array(0) },
      { kind: 'not-utf8', bytes: new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]) },
      { kind: 'not-json', bytes: encoder.encode('{"text": "hi", ') },
      { kind: 'empty-text', bytes: encoder.encode(JSON.stringify({ text: '   ', context: [] })) },
      { kind: 'text-201', bytes: encoder.encode(JSON.stringify({ text: 'a'.repeat(201), context: [] })) },
      { kind: 'turns-11', bytes: encoder.encode(JSON.stringify({ text: 'hi', context: Array.from({ length: 11 }, () => ({ role: 'speaker', text: 'x' })) })) },
      { kind: 'bad-role', bytes: encoder.encode(JSON.stringify({ text: 'hi', context: [{ role: 'nurse', text: 'x' }] })) },
      { kind: 'array', bytes: encoder.encode('[]') },
    );
    const caseArb = fc.record({
      crossOrigin: fc.boolean(),
      originHeader: fc.boolean(),
      rateFull: fc.boolean(),
      oversizedHeader: fc.boolean(),
      oversizedStream: fc.boolean(),
      invalid: fc.option(invalidBodyArb, { nil: undefined }),
      missingKey: fc.option(fc.constantFrom(undefined, ''), { nil: null }),
      exactLimit: fc.boolean(),
      transport: fc.constantFrom('string', 'stream'),
      request: requestArb,
      ip: ipArb,
    });
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const rig = createRig(c.missingKey === null ? {} : { apiKey: c.missingKey }, countingLimiter());
        rig.fake.autoRespond(() => ({ status: 200, body: providerReply('{"suggestions": []}') }));
        if (c.rateFull) for (let i = 0; i < 30; i += 1) rig.deps.rateLimiter.check(c.ip, Date.now());
        const before = rig.limiter.counted();

        const json = JSON.stringify(c.request);
        let bytes = c.invalid?.bytes ?? encoder.encode(json);
        if (c.exactLimit && c.invalid === undefined) {
          // Pad with spaces (valid JSON) to exactly 16,384 bytes.
          bytes = encoder.encode(json + ' '.repeat(BODY_LIMIT_BYTES - bytes.byteLength));
          expect(bytes.byteLength).toBe(BODY_LIMIT_BYTES);
        }
        if (c.oversizedStream) bytes = encoder.encode(json + ' '.repeat(BODY_LIMIT_BYTES + 1));
        const headers: Record<string, string> = { 'x-forwarded-for': c.ip };
        if (c.crossOrigin) headers.origin = 'https://evil.test';
        else if (c.originHeader) headers.origin = SAME_ORIGIN;
        const useStream = c.transport === 'stream' || c.oversizedStream;
        if (c.oversizedHeader) headers['content-length'] = String(BODY_LIMIT_BYTES + 1 + bytes.byteLength);
        else if (!useStream) headers['content-length'] = String(bytes.byteLength);
        const request = post(useStream ? streamOf(bytes) : bytes, headers);

        const expected = c.crossOrigin
          ? [403, 'forbidden_origin']
          : c.rateFull
            ? [429, 'rate_limited']
            : c.oversizedHeader || c.oversizedStream
              ? [413, 'payload_too_large']
              : c.invalid !== undefined
                ? [400, 'invalid_request']
                : c.missingKey !== null
                  ? [503, 'not_configured']
                  : [200, undefined];
        const response = await readResponse(await handleExpand(request, rig.deps));
        expect(response.status).toBe(expected[0]);
        if (expected[1] === undefined) {
          expect(response.body).toStrictEqual({ suggestions: [] });
          expect(rig.fake.calls).toHaveLength(1);
        } else {
          expect(response.body).toStrictEqual({ error: expected[1] });
          expect(rig.fake.calls).toHaveLength(0);
        }
        expect(rig.limiter.counted() - before).toBe(!c.crossOrigin && !c.rateFull ? 1 : 0);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('sends the provider exactly the specified request', async () => {
    // Feature: expansion, Property 20: The provider request has exactly the specified shape
    const caseArb = fc.record({
      request: requestArb,
      apiKey: apiKeyArb,
      baseUrl: fc.oneof(
        fc.constant(undefined),
        fc.constant(''),
        fc.tuple(hostArb, fc.integer({ min: 0, max: 3 })).map(([host, slashes]) => `https://${host}/v1${'/'.repeat(slashes)}`),
      ),
      model: fc.oneof(
        fc.constant(undefined),
        fc.constant(''),
        fc.constant(DEFAULT_MODEL),
        fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-/.'), minLength: 1, maxLength: 40 }),
      ),
      ip: ipArb,
      custom: fc.string({ unit: fc.constantFrom(...'abcdefghij'), minLength: 1, maxLength: 10 }),
    });
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const rig = createRig({ apiKey: c.apiKey, baseUrl: c.baseUrl, model: c.model });
        rig.fake.autoRespond(() => ({ status: 200, body: providerReply('{"suggestions": []}') }));
        const request = post(JSON.stringify(c.request), {
          cookie: `session=${c.custom}`,
          'x-forwarded-for': c.ip,
          'x-custom': c.custom,
          authorization: `Bearer ${c.custom}`,
          'user-agent': 'property-test',
        });
        const response = await handleExpand(request, rig.deps);
        expect(response.status).toBe(200);
        expect(rig.fake.calls).toHaveLength(1);
        const call = rig.fake.calls[0];
        const base = c.baseUrl !== undefined && c.baseUrl !== '' ? c.baseUrl : DEFAULT_BASE_URL;
        expect(call?.url).toBe(`${base.replace(/\/+$/, '')}/chat/completions`);
        expect(call?.init?.method).toBe('POST');
        expect([...new Headers(call?.init?.headers).entries()].sort()).toStrictEqual([
          ['authorization', `Bearer ${c.apiKey}`],
          ['content-type', 'application/json'],
        ]);
        const model = c.model !== undefined && c.model !== '' ? c.model : DEFAULT_MODEL;
        const body = call?.body as Record<string, unknown>;
        expect(Object.keys(body).sort()).toStrictEqual(
          model === DEFAULT_MODEL ? ['max_tokens', 'messages', 'model', 'reasoning_effort'] : ['max_tokens', 'messages', 'model'],
        );
        expect(body.model).toBe(model);
        expect(body.max_tokens).toBe(200);
        if (model === DEFAULT_MODEL) expect(body.reasoning_effort).toBe('none');
        expect(body.messages).toStrictEqual(JSON.parse(JSON.stringify(buildPrompt(c.request, classify(c.request.text)))));
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('maps provider outcomes to the specified statuses', async () => {
    // Feature: expansion, Property 21: Provider outcomes map to the specified statuses
    const contentArb = (req: ExpandRequest): fc.Arbitrary<string> => {
      const cls = classify(req.text);
      const matching = cls.kind === 'initials' ? cls.initials.split('').map((l) => `${l}x`).join(' ') : `${req.text} more`;
      return fc
        .tuple(fc.array(fc.oneof(fc.constant(matching), fc.constant('Not matching at all.'), fc.string({ maxLength: 30 })), { maxLength: 5 }), fc.string({ maxLength: 20 }))
        .map(([suggestions, prose]) => `${prose}${JSON.stringify({ suggestions })}`);
    };
    const bodyArb = (req: ExpandRequest): fc.Arbitrary<{ kind: string; text: string }> =>
      fc.oneof(
        { weight: 4, arbitrary: contentArb(req).map((content) => ({ kind: 'content', text: providerReply(content) })) },
        { weight: 1, arbitrary: fc.constant({ kind: 'bad', text: 'not json' }) },
        { weight: 1, arbitrary: fc.constant({ kind: 'bad', text: '{}' }) },
        { weight: 1, arbitrary: fc.constant({ kind: 'bad', text: '{"choices": []}' }) },
        { weight: 1, arbitrary: fc.constant({ kind: 'bad', text: '{"choices": [{"message": {"content": 7}}]}' }) },
      );
    const caseArb = requestArb.chain((request) =>
      fc.record({
        request: fc.constant(request),
        status: fc.oneof({ weight: 3, arbitrary: fc.integer({ min: 200, max: 299 }) }, { weight: 2, arbitrary: fc.integer({ min: 100, max: 599 }) }),
        body: bodyArb(request),
        rejects: fc.integer({ min: 0, max: 5 }).map((n) => n === 0),
        delay: fc.oneof(fc.integer({ min: 0, max: 3_999 }), fc.integer({ min: 4_001, max: 6_000 })),
        delayOn: fc.constantFrom('fetch', 'body'),
      }),
    );
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const rig = createRig();
        rig.fake.autoRespond((call) => {
          if (c.rejects) {
            setTimeout(() => call.reject(new TypeError('network down')), c.delay);
          } else if (c.delayOn === 'fetch') {
            setTimeout(() => call.resolve(c.status, c.body.text), c.delay);
          } else {
            call.resolve(c.status, c.body.text, { bodyDelayMs: c.delay });
          }
          return undefined;
        });
        const pending = handleExpand(post(JSON.stringify(c.request)), rig.deps);
        await vi.advanceTimersByTimeAsync(6_500);
        const response = await readResponse(await pending);
        const ok = c.status >= 200 && c.status <= 299;
        if (c.delay > 4_000 && !(c.delayOn === 'body' && !ok && !c.rejects)) {
          expect(response.status).toBe(504);
          expect(response.body).toStrictEqual({ error: 'upstream_timeout' });
          expect(rig.fake.calls[0]?.signal?.aborted).toBe(true);
        } else if (c.rejects || !ok || c.body.kind === 'bad') {
          expect(response.status).toBe(502);
          expect(response.body).toStrictEqual({ error: 'upstream_failed' });
        } else {
          const content = (JSON.parse(c.body.text) as { choices: [{ message: { content: string } }] }).choices[0].message.content;
          expect(response.status).toBe(200);
          expect(response.body).toStrictEqual({ suggestions: filterSuggestions(parseModelOutput(content), classify(c.request.text)) });
        }
        expect(rig.fake.calls).toHaveLength(1);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('never leaks request data, provider replies or secrets', async () => {
    // Feature: expansion, Property 22: Route responses and logs never leak request data or secrets
    const MARKER = 'zq7marker';
    const markedTurnArb: fc.Arbitrary<Turn> = fc
      .tuple(roleArb, fc.array(knownWordArb, { maxLength: 4 }))
      .map(([role, words]) => ({ role, text: [...words, MARKER].join(' ') }));
    const caseArb = fc.record({
      text: fc.array(knownWordArb, { maxLength: 4 }).map((words) => [MARKER, ...words].join(' ')),
      context: fc.array(markedTurnArb, { maxLength: 10 }),
      apiKey: fc.option(apiKeyArb, { nil: undefined }),
      ip: ipArb,
      origin: fc.constantFrom(undefined, SAME_ORIGIN, 'https://evil.test'),
      behaviour: fc.constantFrom('echo', 'error-status', 'bad-body', 'reject', 'hang'),
      status: fc.integer({ min: 400, max: 599 }),
      oversized: fc.boolean(),
    });
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const rig = createRig({ apiKey: c.apiKey });
        rig.fake.autoRespond((call) => {
          const echoed = JSON.stringify(call.body);
          switch (c.behaviour) {
            case 'echo':
              return { status: 200, body: providerReply(`{"suggestions": [${JSON.stringify(`${MARKER} echo`)}]} ${echoed}`) };
            case 'error-status':
              call.resolve(c.status, `{"error": ${JSON.stringify(`${MARKER} ${echoed}`)}}`, { statusText: `${MARKER} failure` });
              return undefined;
            case 'bad-body':
              return { status: 200, body: `${MARKER} ${echoed}` };
            case 'reject':
              call.reject(new Error(`${MARKER} ${echoed}`));
              return undefined;
            case 'hang':
              return undefined;
          }
        });
        const json = JSON.stringify({ text: c.text, context: c.context });
        const body = c.oversized ? json.padEnd(BODY_LIMIT_BYTES + 10, ' ') : json;
        const headers: Record<string, string> = { 'x-forwarded-for': c.ip, 'content-length': String(encoder.encode(body).byteLength) };
        if (c.origin !== undefined) headers.origin = c.origin;
        const pending = handleExpand(post(body, headers, ROUTE_URL), rig.deps);
        await vi.advanceTimersByTimeAsync(4_100);
        const response = await readResponse(await pending);

        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['content-type']).toBe('application/json');
        const keys = Object.keys(response.body as object);
        if (response.status === 200) {
          expect(keys).toStrictEqual(['suggestions']);
        } else {
          expect(keys).toStrictEqual(['error']);
          expect(response.text).not.toContain(MARKER);
          expect(response.text).not.toContain('failure');
        }
        const everything = response.text + JSON.stringify(response.headers);
        if (c.apiKey !== undefined) expect(everything).not.toContain(c.apiKey);
        expect(everything).not.toContain(c.ip);
        expect(rig.log).toHaveBeenCalledTimes(1);
        const entry = rig.log.mock.calls[0]?.[0];
        expect(Object.keys(entry ?? {}).sort()).toStrictEqual(['latencyMs', 'status']);
        expect(entry?.status).toBe(response.status);
        expect(Number.isInteger(entry?.latencyMs)).toBe(true);
        expect(entry?.latencyMs).toBeGreaterThanOrEqual(0);
        expect(JSON.stringify(entry)).not.toContain(MARKER);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
