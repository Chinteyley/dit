import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManualScheduler } from '@/lib/input';
import {
  LOOKAHEAD_HIDDEN_MS,
  LOOKAHEAD_VISIBLE_MS,
  SOUND_CHECK_MS,
  createChimePlayer,
  type AudioPort,
} from './chime-player';
import { createFakeAudioPort, createFakePageVisibility, type FakeAudioPort } from './fakes';

/** A player on a fake port whose audio clock and scheduler clock move together unless told otherwise. */
function rig(port: FakeAudioPort | null = createFakeAudioPort({ now: 1000 }), opts: { hidden?: boolean } = {}) {
  let wall = 0;
  const scheduler = createManualScheduler(() => wall);
  const page = createFakePageVisibility(opts.hidden ?? false);
  const player = createChimePlayer({ audio: () => port, scheduler: () => scheduler, page: () => page });
  let changes = 0;
  player.onSoundChange(() => {
    changes += 1;
  });
  return {
    port,
    page,
    player,
    scheduler,
    changes: () => changes,
    /** Moves the scheduler clock (and the audio clock while `audioToo`) and fires due timers. */
    advance(ms: number, audioToo = true) {
      for (let left = ms; left > 0; left -= 50) {
        const step = Math.min(50, left);
        wall += step;
        if (audioToo) port?.advance(step);
        scheduler.runDue(wall);
      }
    },
  };
}

const times = (port: FakeAudioPort | null): number[] => (port?.requests ?? []).map((r) => r.t);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createChimePlayer', () => {
  it('plays the first Chime at the start time, within 100 ms (Requirements 1.1, 4.4)', () => {
    const r = rig();
    r.player.start();
    const first = r.port?.requests[0];
    expect(first?.t).toBe(1000);
    expect(first?.at).toBe(1000);
    expect(times(r.port)).toEqual([1000, 2000]); // 1.5 s lookahead while visible
    expect(r.player.soundUnavailable()).toBe(false);
  });

  it('keeps one series per episode and refills on time (Requirements 4.5, 4.9)', () => {
    const r = rig();
    r.player.start();
    r.player.start();
    r.advance(5000);
    expect(times(r.port)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000]);
    for (const request of r.port?.requests ?? []) expect(request.at).toBeLessThanOrEqual(request.t);
  });

  it('schedules 70 s ahead once the page is hidden', () => {
    const r = rig();
    r.player.start();
    r.page.setHidden(true);
    expect(Math.max(...times(r.port))).toBe(1000 + Math.floor((LOOKAHEAD_HIDDEN_MS - 1) / 1000) * 1000);
    const before = times(r.port).length;
    r.page.setHidden(false);
    expect(times(r.port)).toHaveLength(before);
    expect(LOOKAHEAD_VISIBLE_MS).toBe(1500);
  });

  it('shows the sound note at once when there is no audio context (Requirement 6.5)', () => {
    const noPort = rig(null);
    noPort.player.start();
    expect(noPort.player.soundUnavailable()).toBe(true);
    expect(noPort.changes()).toBe(1);
    const unavailable = rig(createFakeAudioPort({ available: false }));
    unavailable.player.start();
    expect(unavailable.player.soundUnavailable()).toBe(true);
    expect(unavailable.port?.requests).toEqual([]);
  });

  it('resumes a suspended context once and shows the note after 1000 ms (Requirements 6.4, 6.5)', () => {
    const r = rig(createFakeAudioPort({ state: 'suspended', now: 1000 }));
    r.player.start();
    expect(r.port?.resumes).toBe(1);
    expect(r.port?.requests).toEqual([]);
    r.advance(SOUND_CHECK_MS - 50, false);
    expect(r.player.soundUnavailable()).toBe(false);
    r.advance(50, false);
    expect(r.player.soundUnavailable()).toBe(true);
    expect(r.port?.resumes).toBe(1);
  });

  it('removes the note and starts Chimes when the context starts running (Requirement 6.6)', () => {
    const r = rig(createFakeAudioPort({ state: 'suspended', now: 1000 }));
    r.player.start();
    r.advance(3000, false); // a suspended audio clock does not move
    expect(r.player.soundUnavailable()).toBe(true);
    r.port?.setState('running');
    expect(r.player.soundUnavailable()).toBe(false);
    expect(times(r.port)).toEqual([1000, 2000]);
  });

  it('starts from the next schedule time when the audio clock moved on meanwhile', () => {
    const r = rig(createFakeAudioPort({ state: 'interrupted', now: 1000 }));
    r.player.start();
    r.port?.advance(2300);
    r.port?.setState('running');
    expect(times(r.port)).toEqual([4000]);
  });

  it('plays nothing when the context starts running while idle or closing (Requirement 6.10)', () => {
    const r = rig(createFakeAudioPort({ state: 'suspended', now: 1000 }));
    r.port?.setState('running'); // idle: no episode
    r.advance(2000);
    expect(r.port?.requests).toEqual([]);
    r.port?.setState('suspended');
    r.player.start();
    r.player.stop(); // closing: the episode has ended
    r.port?.setState('running');
    r.advance(2000);
    expect(r.port?.requests).toEqual([]);
    expect(r.port?.listenerCount()).toBe(0);
  });

  it('shows the note and plays no more after Web Audio throws (Requirement 4.7)', () => {
    const r = rig(createFakeAudioPort({ now: 1000, throwOnPlay: 2 }));
    r.player.start();
    expect(r.player.soundUnavailable()).toBe(true);
    const attempts = r.port?.playAttempts;
    r.advance(10_000);
    expect(r.port?.playAttempts).toBe(attempts);
    expect(times(r.port)).toEqual([1000]);
    expect(r.scheduler.pending()).toBe(0);
  });

  it('clears the note when a new episode starts (Requirements 4.11, 6.9)', () => {
    const port = createFakeAudioPort({ now: 1000, available: false });
    const r = rig(port);
    r.player.start();
    expect(r.player.soundUnavailable()).toBe(true);
    r.player.stop();
    port.available = true;
    r.player.start();
    expect(r.player.soundUnavailable()).toBe(false);
    expect(times(port)).toEqual([1000, 2000]);
  });

  it('silences every voice at the stop time and requests nothing after (Requirement 4.6)', () => {
    const r = rig();
    r.player.start();
    r.advance(1200);
    r.player.stop();
    const stopAt = 2200;
    for (const request of r.port?.requests ?? []) {
      if (request.t + 360 > stopAt) expect(request.silenced).toEqual([stopAt]);
    }
    const count = r.port?.requests.length;
    r.advance(5000);
    expect(r.port?.requests.length).toBe(count);
    expect(r.scheduler.pending()).toBe(0);
  });

  it('never touches speech synthesis (Requirement 4.8)', () => {
    const touched: string[] = [];
    const spy = new Proxy({}, { get: (_target, key) => touched.push(String(key)) });
    vi.stubGlobal('speechSynthesis', spy);
    vi.stubGlobal('SpeechSynthesisUtterance', spy);
    const r = rig();
    r.player.start();
    r.advance(3000);
    r.player.stop();
    expect(touched).toEqual([]);
  });

  it('accepts any AudioPort, not only the fake', () => {
    const port: AudioPort = createFakeAudioPort({ now: 0 });
    const player = createChimePlayer({ audio: () => port, scheduler: () => null, page: () => null });
    player.start();
    expect(player.soundUnavailable()).toBe(false);
    player.stop();
  });
});
