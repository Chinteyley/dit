import { afterEach, describe, expect, it } from 'vitest';
import {
  SILENCE_RAMP_MS,
  browserPageVisibility,
  installAudioUnlock,
  webAudioPort,
  type AudioWindow,
  type UnlockTarget,
  type VisibilityDocument,
} from './browser';
import { createFakeAudioPort, createFakeAudioWindow, type FakeAudioContext, type FakeAudioContextOptions } from './fakes';

function setup(opts: FakeAudioContextOptions & { readonly ctor?: 'standard' | 'webkit' | 'none' } = {}) {
  const fake = createFakeAudioWindow(opts);
  const port = webAudioPort(fake.win as unknown as AudioWindow);
  const unlock = installAudioUnlock(fake.win as unknown as UnlockTarget, port);
  return { ...fake, port, unlock, ctx: (): FakeAudioContext | undefined => fake.contexts[0] };
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

const rejections: unknown[] = [];
const onRejection = (reason: unknown): void => {
  rejections.push(reason);
};

afterEach(() => {
  process.off('unhandledRejection', onRejection);
  rejections.length = 0;
});

describe('webAudioPort playChime', () => {
  function chime(atMs = 1000) {
    const s = setup({ state: 'running' });
    expect(s.port.ensureContext()).toBe(true);
    const voice = s.port.playChime(atMs);
    const ctx = s.ctx();
    if (ctx === undefined) throw new Error('no context');
    return { ...s, voice, ctx };
  }

  it('builds two sine tones: 880 Hz at +0 ms and 660 Hz at +200 ms, 150 ms each (Requirements 4.1, 4.2)', () => {
    const { ctx } = chime(1000);
    expect(ctx.oscillators.map((o) => [o.type, o.frequency.value])).toEqual([
      ['sine', 880],
      ['sine', 660],
    ]);
    expect(ctx.oscillators.map((o) => o.startTimes)).toEqual([[1.0], [1.2]]);
    const [first, second] = ctx.gains;
    const lastRamp = (calls: typeof ctx.gains[number]['gain']['calls']) =>
      calls.filter((c) => c.method === 'linearRampToValueAtTime').at(-1);
    expect(near(lastRamp(first?.gain.calls ?? [])?.time ?? 0, 1.15)).toBe(true);
    expect(near(lastRamp(second?.gain.calls ?? [])?.time ?? 0, 1.35)).toBe(true);
    expect(ctx.buffers).toEqual([]); // no audio file
  });

  it('peaks at 0.8 with 10 ms attack and release ramps (Requirement 4.3)', () => {
    const { ctx } = chime(1000);
    const calls = ctx.gains[0]?.gain.calls ?? [];
    expect(calls.map((c) => c.method)).toEqual([
      'setValueAtTime',
      'linearRampToValueAtTime',
      'setValueAtTime',
      'linearRampToValueAtTime',
    ]);
    const values = calls.map((c) => ('value' in c ? c.value : null));
    expect(values).toEqual([0, 0.8, 0.8, 0]);
    const times = calls.map((c) => c.time);
    expect(near((times[1] ?? 0) - (times[0] ?? 0), 0.01)).toBe(true);
    expect(near((times[3] ?? 0) - (times[2] ?? 0), 0.01)).toBe(true);
  });

  it('stops both oscillators by 400 ms after the Chime start (Requirement 4.2)', () => {
    const { ctx } = chime(1000);
    for (const osc of ctx.oscillators) {
      expect(osc.stopTimes).toHaveLength(1);
      expect(osc.stopTimes[0] ?? Infinity).toBeLessThanOrEqual(1.4);
    }
    expect(ctx.oscillators[0]?.connections[0]).toBe(ctx.gains[0]);
    expect(ctx.gains[0]?.connections[0]).toBe(ctx.destination);
  });

  it('silence ramps a sounding tone to 0 within 20 ms and cancels tones that have not started (Requirement 4.6)', () => {
    const { ctx, voice } = chime(1000);
    voice.silence(1100); // 100 ms into the first tone, before the second
    const [firstGain, secondGain] = ctx.gains;
    const firstCalls = (firstGain?.gain.calls ?? []).slice(4);
    expect(firstCalls[0]).toEqual({ method: 'cancelScheduledValues', time: 1.1 });
    expect(firstCalls[1]).toMatchObject({ method: 'setValueAtTime', value: 0.8 });
    const ramp = firstCalls[2];
    expect(ramp).toMatchObject({ method: 'linearRampToValueAtTime', value: 0 });
    expect((ramp?.time ?? Infinity) - 1.1).toBeLessThanOrEqual(0.02);
    expect(SILENCE_RAMP_MS).toBeLessThanOrEqual(20);
    expect(ctx.oscillators[0]?.stopTimes.at(-1) ?? Infinity).toBeLessThanOrEqual(1.1 + 0.02 + 1e-9);
    // The second tone would start at 1.2 s: stopping it at 1.1 s means it never plays.
    expect((secondGain?.gain.calls ?? []).slice(4)).toEqual([
      { method: 'cancelScheduledValues', time: 1.1 },
      { method: 'setValueAtTime', value: 0, time: 1.1 },
    ]);
    expect(ctx.oscillators[1]?.stopTimes.at(-1)).toBe(1.1);
  });

  it('holds the envelope value it cuts from, so the cut does not jump', () => {
    const { ctx, voice } = chime(1000);
    voice.silence(1005); // halfway up the 10 ms attack
    const held = (ctx.gains[0]?.gain.calls ?? []).slice(4)[1];
    expect(held?.method).toBe('setValueAtTime');
    expect(near(held && 'value' in held ? held.value : -1, 0.4)).toBe(true);
  });

  it('never extends an oscillator past its own stop time', () => {
    const { ctx, voice } = chime(1000);
    voice.silence(1355);
    expect(ctx.oscillators.every((o) => (o.stopTimes.at(-1) ?? Infinity) <= 1.36 + 1e-9)).toBe(true);
  });

  it('throws when there is no context, and stops the tones it made if Web Audio fails', () => {
    const none = setup({ ctor: 'none' });
    expect(() => none.port.playChime(0)).toThrow();
    const s = setup({ state: 'running' });
    s.port.ensureContext();
    const ctx = s.ctx();
    if (ctx === undefined) throw new Error('no context');
    let made = 0;
    const original = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => {
      made += 1;
      if (made === 2) throw new Error('out of nodes');
      return original();
    };
    expect(() => s.port.playChime(0)).toThrow('out of nodes');
    expect(ctx.oscillators[0]?.stopTimes.at(-1)).toBe(0);
  });
});

describe('webAudioPort context and state', () => {
  it('creates at most one context and maps its state, including interrupted (Requirement 6.3)', () => {
    const s = setup({ state: 'suspended' });
    expect(s.port.state()).toBe('none');
    expect(s.port.now()).toBeNull();
    expect(s.port.ensureContext()).toBe(true);
    expect(s.port.ensureContext()).toBe(true);
    expect(s.contexts).toHaveLength(1);
    expect(s.port.state()).toBe('suspended');
    const seen: string[] = [];
    s.port.onStateChange((state) => seen.push(state));
    s.ctx()?.setState('interrupted');
    s.ctx()?.setState('running');
    expect(seen).toEqual(['interrupted', 'running']);
    const ctx = s.ctx();
    if (ctx !== undefined) ctx.currentTime = 2.5;
    expect(s.port.now()).toBe(2500);
  });

  it('uses webkitAudioContext when it is the only constructor', () => {
    const s = setup({ ctor: 'webkit' });
    expect(s.port.ensureContext()).toBe(true);
    expect(s.contexts).toHaveLength(1);
  });

  it('reports no context when the constructor is missing or throws', () => {
    expect(setup({ ctor: 'none' }).port.ensureContext()).toBe(false);
    const throwing = setup({ throwOnCreate: true });
    expect(throwing.port.ensureContext()).toBe(false);
    expect(throwing.port.state()).toBe('none');
    expect(() => throwing.dispatch('click')).not.toThrow();
  });

  it('never throws from resume(), and leaves no unhandled rejection (Requirement 6.8)', async () => {
    process.on('unhandledRejection', onRejection);
    const rejecting = setup({ resume: 'reject' });
    rejecting.port.ensureContext();
    expect(() => rejecting.port.resume()).not.toThrow();
    rejecting.dispatch('keydown');
    const throwing = setup({ resume: 'throw' });
    throwing.port.ensureContext();
    expect(() => throwing.port.resume()).not.toThrow();
    expect(() => throwing.dispatch('pointerdown')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rejections).toEqual([]);
    expect(rejecting.ctx()?.resumeCalls).toBe(2);
  });
});

describe('installAudioUnlock', () => {
  it.each(['keydown', 'pointerdown', 'click'])('unlocks silently on the first %s (Requirements 6.1, 6.7)', (type) => {
    const s = setup({ state: 'suspended' });
    const event = s.dispatch(type);
    const ctx = s.ctx();
    expect(s.contexts).toHaveLength(1);
    expect(ctx?.resumeCalls).toBe(1);
    expect(ctx?.state).toBe('running');
    expect(ctx?.buffers).toEqual([{ numberOfChannels: 1, length: 1, sampleRate: 48_000 }]);
    expect(ctx?.bufferSources).toHaveLength(1);
    expect(ctx?.bufferSources[0]?.startTimes).toEqual([0]);
    expect(ctx?.bufferSources[0]?.connections[0]).toBe(ctx?.destination);
    expect(ctx?.gains).toEqual([]); // nothing above gain 0 reaches the destination
    expect(event.defaultPrevented).toBe(false);
    expect(event.propagationStopped).toBe(false);
  });

  it('resumes on every later gesture while still suspended, with one context and one silent buffer (6.2, 6.3)', () => {
    const s = setup({ state: 'suspended', resume: 'stay' });
    s.dispatch('keydown');
    s.dispatch('click');
    s.dispatch('pointerdown');
    expect(s.contexts).toHaveLength(1);
    expect(s.ctx()?.resumeCalls).toBe(3);
    expect(s.ctx()?.bufferSources).toHaveLength(1);
  });

  it('does nothing once the context runs', () => {
    const s = setup({ state: 'running' });
    s.dispatch('click');
    s.dispatch('click');
    expect(s.ctx()?.resumeCalls).toBe(0);
    expect(s.ctx()?.bufferSources).toHaveLength(1);
  });

  it('listens in the capture phase without blocking, and removes its listeners', () => {
    const s = setup();
    expect(s.registrations.map((r) => [r.type, r.options])).toEqual([
      ['keydown', { capture: true, passive: true }],
      ['pointerdown', { capture: true, passive: true }],
      ['click', { capture: true, passive: true }],
    ]);
    s.unlock();
    expect(s.registrations).toEqual([]);
  });

  it('keeps the gesture going when the port throws', () => {
    const fake = createFakeAudioWindow();
    const port = createFakeAudioPort({ state: 'suspended' });
    port.unlockSilently = () => {
      throw new Error('unlock failed');
    };
    installAudioUnlock(fake.win as unknown as UnlockTarget, port);
    expect(() => fake.dispatch('keydown')).not.toThrow();
  });
});

describe('browserPageVisibility', () => {
  it('reads visibilityState and follows visibilitychange', () => {
    const listeners = new Set<() => void>();
    const doc = {
      visibilityState: 'visible',
      addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
    };
    const page = browserPageVisibility(doc as unknown as VisibilityDocument);
    let changes = 0;
    const off = page.onChange(() => {
      changes += 1;
    });
    expect(page.hidden()).toBe(false);
    doc.visibilityState = 'hidden';
    for (const fn of listeners) fn();
    expect(page.hidden()).toBe(true);
    expect(changes).toBe(1);
    off();
    expect(listeners.size).toBe(0);
  });
});
