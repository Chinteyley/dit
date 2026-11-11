import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHIME_END_MS, chimeSchedule } from './chime-schedule';
import { LATE_LIMIT_MS, createChimePlayer } from './chime-player';
import { createFakeAudioPort, createFakePageVisibility, type FakeChimeRequest } from './fakes';
import { PROP_RUNS, arbChimePlayerCommands, createLateScheduler, type ChimePlayerCommand } from './test-support';

/**
 * Browsers fire a visible page's timers about on time (Chrome aligns some to 1 s) and a hidden
 * page's chained timers at most once a minute (Chrome intensive throttling), so the harness
 * clamps each command's lateness to those bounds. The 70 s hidden lookahead is sized for them.
 */
const VISIBLE_LATE_MAX_MS = 1_000;
const HIDDEN_LATE_MAX_MS = 60_000;

interface Episode {
  readonly s: number;
  stopAt: number | null;
  readonly firstRequest: number;
  lastRequest: number | null;
}

function runPlayer(commands: readonly ChimePlayerCommand[]) {
  let clock = 5_000;
  const port = createFakeAudioPort({ now: clock, state: 'running' });
  const page = createFakePageVisibility(false);
  const late = createLateScheduler(() => clock);
  const player = createChimePlayer({ audio: () => port, scheduler: () => late.scheduler, page: () => page });
  const episodes: Episode[] = [];
  let playing = false;
  let requestsWhileStopped = 0;

  const start = (): void => {
    if (!playing) {
      episodes.push({ s: clock, stopAt: null, firstRequest: port.requests.length, lastRequest: null });
      playing = true;
    }
    player.start();
  };
  const stop = (): void => {
    const current = episodes.at(-1);
    if (playing && current !== undefined) {
      current.stopAt = clock;
      current.lastRequest = port.requests.length;
      playing = false;
    }
    player.stop();
  };
  const advance = (ms: number, lateness: number): void => {
    const target = clock + ms;
    const bound = Math.min(lateness, page.hidden() ? HIDDEN_LATE_MAX_MS : VISIBLE_LATE_MAX_MS);
    for (;;) {
      const due = late.nextDue();
      if (due === null) break;
      const fireAt = Math.max(clock, due + bound);
      if (fireAt > target) break;
      clock = fireAt;
      port.setNow(clock);
      const before = port.requests.length;
      late.manual.runDue(clock);
      if (!playing) requestsWhileStopped += port.requests.length - before;
    }
    clock = target;
    port.setNow(clock);
  };

  start();
  for (const command of commands) {
    switch (command.kind) {
      case 'advance':
        advance(command.ms, command.lateness);
        break;
      case 'hide':
        page.setHidden(true);
        break;
      case 'show':
        page.setHidden(false);
        break;
      case 'start':
        start();
        break;
      case 'stop':
        stop();
        break;
    }
  }
  const last = episodes.at(-1);
  if (playing && last !== undefined) last.lastRequest = port.requests.length;
  return { requests: port.requests, episodes, endTime: clock, requestsWhileStopped };
}

describe('Chime_Player properties', () => {
  // Feature: onboarding-and-safety, Property 12: The Chime_Player plays each scheduled Chime once, on time, and nothing after stop
  it('P12 the chime player plays each scheduled chime once on time and nothing after stop', () => {
    fc.assert(
      fc.property(arbChimePlayerCommands({ max: 100 }), (commands) => {
        const run = runPlayer(commands);
        expect(run.requestsWhileStopped).toBe(0);
        let covered = 0;
        for (const episode of run.episodes) {
          const mine: readonly FakeChimeRequest[] = run.requests.slice(episode.firstRequest, episode.lastRequest ?? undefined);
          covered += mine.length;
          const times = mine.map((r) => r.t);
          // Once each, on the grid s + k × 1000 from the start, with no gap.
          expect(new Set(times).size).toBe(times.length);
          const last = times.length === 0 ? episode.s : Math.max(...times) + 1;
          expect([...times].sort((a, b) => a - b)).toEqual(chimeSchedule(episode.s, episode.s, last));
          // On time: requested while the audio clock is at most t + 50 ms.
          for (const r of mine) expect(r.at).toBeLessThanOrEqual(r.t + LATE_LIMIT_MS);
          // Every Chime before the stop (or the end of the run) was requested.
          const end = episode.stopAt ?? run.endTime;
          expect(times.filter((t) => t < end)).toEqual(chimeSchedule(episode.s, episode.s, end));
          for (const r of mine) {
            if (episode.stopAt === null) {
              expect(r.silenced).toEqual([]);
            } else if (r.t + CHIME_END_MS > episode.stopAt) {
              // Sounding or still to come at the stop: silenced at the stop time, once.
              expect(r.silenced).toEqual([episode.stopAt]);
            } else {
              expect(r.silenced.every((at) => at === episode.stopAt)).toBe(true);
            }
          }
        }
        expect(covered).toBe(run.requests.length);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
