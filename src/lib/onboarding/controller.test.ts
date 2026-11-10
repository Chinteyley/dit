import { describe, expect, it } from 'vitest';
import { DEFAULT_ENABLED_SOURCES, DEFAULT_SETTINGS, engineConfigOf, type KeyValueBackend } from '@/lib/conversation';
import { throwingBackend } from '@/lib/conversation/test-support';
import { createManualClock, createManualScheduler, ok, pressEvent, type SwitchLearner } from '@/lib/input';
import { calibrate, type EngineEvent } from '@/lib/morse';
import { createOnboardingController, type OnboardingSessionApi } from './controller';
import { createFakeEngineFactory, createFakeSourceControl, createFakeSwitchLearner, type FakeSourceControl } from './fakes';
import { ONBOARDING_KEY, serializeOnboardingRecord, type OnboardingRecord } from './record';
import { BLINK_FAILURE_TEXT, SWITCH_UNAVAILABLE_TEXT } from './strings';
import type { OnboardingAction } from './types';

const SOS: readonly EngineEvent[] = [{ type: 'command', command: 'sos' }];
const SHORT_LONG = [180, 200, 220, 600, 640];
const COMPLETE: OnboardingRecord = {
  v: 1,
  complete: true,
  inputChoice: 'switch',
  estimates: { dotEstimate: 180, dashEstimate: 560 },
};

/** Lets promise callbacks (the Switch_Learner result) run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function rig(
  opts: {
    readonly stored?: OnboardingRecord | string;
    readonly backend?: KeyValueBackend | null;
    readonly learner?: SwitchLearner | null;
    readonly sources?: FakeSourceControl;
  } = {},
) {
  const clock = createManualClock(0);
  const scheduler = createManualScheduler(clock.now);
  const engines = createFakeEngineFactory();
  const alarmStarts: number[] = [];
  let openChanges = 0;
  const raw = opts.stored === undefined ? undefined : typeof opts.stored === 'string' ? opts.stored : serializeOnboardingRecord(opts.stored);
  const backend =
    opts.backend !== undefined ? opts.backend : throwingBackend({ initial: raw === undefined ? {} : { [ONBOARDING_KEY]: raw } });
  const controller = createOnboardingController({
    backend: () => backend,
    clock: () => clock.now,
    scheduler: () => scheduler,
    createEngine: engines.create,
    alarm: { start: () => alarmStarts.push(clock.now()) },
    router: {
      onOnboardingOpenChange: () => {
        openChanges += 1;
      },
    },
  });
  const sources = opts.sources ?? createFakeSourceControl();
  const learner = opts.learner === undefined ? createFakeSwitchLearner() : opts.learner;
  const log: string[] = [];
  let pending: number | null = null;
  const api: OnboardingSessionApi = {
    setInitialEstimates: (e) => log.push(`estimates:${JSON.stringify(e)}`),
    focusKeyingSurface: () => log.push('focus-surface'),
    focusSelectedChoice: () => log.push('focus-choice'),
    settings: () => DEFAULT_SETTINGS,
    sources,
    learner,
    pendingSince: () => pending,
  };
  const r = {
    clock,
    scheduler,
    engines,
    alarmStarts,
    backend,
    controller,
    sources,
    learner,
    log,
    api,
    openChanges: () => openChanges,
    setPending(p: number | null) {
      pending = p;
    },
    attach: () => controller.attach(api),
    state: () => controller.getView().state,
    act: (...actions: OnboardingAction[]) => {
      for (const action of actions) controller.dispatch(action);
    },
    press(kind: 'down' | 'up', t: number) {
      clock.set(t);
      scheduler.runDue(t);
      controller.handlePress(pressEvent(kind, t, 'keyboard'));
    },
    /** Moves the clock and fires due timers. */
    advance(to: number) {
      clock.set(to);
      scheduler.runDue(to);
    },
    /** Five practice presses with the given lengths, 1 s apart. */
    practice(durations: readonly number[], start = 10_000) {
      durations.forEach((d, i) => {
        const t = start + i * 1000;
        r.press('down', t);
        r.press('up', t + d);
      });
    },
  };
  return r;
}

const writesOf = (backend: KeyValueBackend | null): readonly (readonly [string, string])[] =>
  backend !== null && 'writes' in backend ? (backend.writes as readonly (readonly [string, string])[]) : [];

describe('load decision', () => {
  it('opens at the Input_Step with nothing chosen when no record is stored (Requirement 11.2)', () => {
    const r = rig();
    r.attach();
    expect(r.controller.isOpen()).toBe(true);
    expect(r.state()).toMatchObject({ step: 'input', origin: 'first-run', selected: null, inputChoice: null });
    expect(r.log).toEqual([]);
    expect(writesOf(r.backend)).toEqual([]);
    expect(r.openChanges()).toBe(1);
  });

  it('opens without applying estimates when reading throws or there is no storage (Requirement 11.5)', () => {
    for (const backend of [throwingBackend({ get: true }), null]) {
      const r = rig({ backend });
      expect(() => r.attach()).not.toThrow();
      expect(r.controller.isOpen()).toBe(true);
      expect(r.log).toEqual([]);
    }
  });

  it('stays closed and applies the stored estimates once for a complete record (Requirements 11.3, 11.4)', () => {
    const r = rig({ stored: COMPLETE });
    r.attach();
    expect(r.controller.isOpen()).toBe(false);
    expect(r.log).toEqual(['estimates:{"dotEstimate":180,"dashEstimate":560}']);
    expect(r.controller.getView().inputChoiceInEffect).toBe('switch');
    const skipped = rig({ stored: { ...COMPLETE, estimates: null } });
    skipped.attach();
    expect(skipped.log).toEqual(['estimates:null']);
  });

  it('opens for an incomplete or invalid record and leaves it as it was (Requirement 11.2)', () => {
    for (const stored of [{ ...COMPLETE, complete: false }, '{"v":1}', 'not json']) {
      const r = rig({ stored });
      r.attach();
      expect(r.controller.isOpen()).toBe(true);
      expect(writesOf(r.backend)).toEqual([]);
    }
  });

  it('decides once per page load, even when the host attaches again', () => {
    const r = rig({ stored: COMPLETE });
    const detach = r.attach();
    detach();
    r.attach();
    expect(r.log).toEqual(['estimates:{"dotEstimate":180,"dashEstimate":560}']);
    const open = rig();
    open.attach()();
    open.attach();
    expect(open.engines.engines).toHaveLength(1);
    expect(open.controller.isOpen()).toBe(true);
  });

  it('keeps blink off for a Blink record and offers the resume button (Requirement 11.12)', () => {
    const r = rig({ stored: { ...COMPLETE, inputChoice: 'blink' } });
    r.attach();
    expect(r.controller.isOpen()).toBe(false);
    expect(r.sources.calls).toEqual([]);
    expect(r.controller.getView().blinkResume).toEqual({ visible: true, reason: null });
  });
});

describe('Guard_Engine', () => {
  const toPractice = (r: ReturnType<typeof rig>): void => {
    r.attach();
    r.act({ type: 'choose', choice: 'key-tap' }, { type: 'continue' });
  };

  it('is built like the session Engine from the settings and the estimates in effect (Requirement 12.5)', () => {
    const r = rig();
    r.attach();
    expect(r.engines.current().config).toEqual(engineConfigOf(DEFAULT_SETTINGS, null));
  });

  it('rebuilds an unused Guard_Engine at the first press when the settings arrived after opening', () => {
    const r = rig();
    let settings = DEFAULT_SETTINGS; // the session has not read the stored settings yet
    const detach = r.controller.attach({ ...r.api, settings: () => settings });
    expect(r.engines.engines).toHaveLength(1);
    settings = { ...DEFAULT_SETTINGS, startingWpm: 3 };
    r.press('down', 100);
    r.press('up', 200);
    expect(r.engines.engines).toHaveLength(2);
    expect(r.engines.current().config).toEqual(engineConfigOf(settings, null));
    expect(r.engines.current().calls).toEqual([
      { kind: 'press', t: 100 },
      { kind: 'release', t: 200 },
    ]);
    settings = { ...DEFAULT_SETTINGS, startingWpm: 4 };
    r.press('down', 300);
    expect(r.engines.engines).toHaveLength(2); // a Guard_Engine that has seen presses is kept
    detach();
  });

  it('keeps the Guard_Engine when the settings did not change', () => {
    const r = rig();
    r.attach();
    r.press('down', 100);
    expect(r.engines.engines).toHaveLength(1);
  });

  it('gets each press before the Practice_Step does (Requirement 12.3)', () => {
    const r = rig();
    toPractice(r);
    const seen: (number | null | undefined)[] = [];
    r.engines.current().onCall = () => seen.push(r.state()?.heldDownT);
    r.press('down', 100);
    r.press('up', 300);
    expect(seen).toEqual([null, 100]);
    expect(r.engines.current().calls).toEqual([
      { kind: 'press', t: 100 },
      { kind: 'release', t: 300 },
    ]);
    expect(r.state()?.durations).toEqual([200]);
  });

  it('keeps at most one timer, set to the deadline, and ticks when it fires (Requirements 12.3, 12.4)', () => {
    const r = rig();
    toPractice(r);
    const engine = r.engines.current();
    r.press('down', 100);
    expect(r.scheduler.pending()).toBe(0);
    engine.deadline = 700;
    r.press('up', 300);
    expect(r.scheduler.pending()).toBe(1);
    r.press('down', 500);
    engine.deadline = 1100;
    r.press('up', 600);
    expect(r.scheduler.pending()).toBe(1);
    r.advance(1099);
    expect(engine.calls.filter((c) => c.kind === 'tick')).toEqual([]);
    r.advance(1100);
    expect(engine.calls.filter((c) => c.kind === 'tick')).toEqual([{ kind: 'tick', t: 1100 }]);
    expect(r.scheduler.pending()).toBe(0);
  });

  it('re-arms for 50 ms while a press is pending, without ticking past it', () => {
    const r = rig();
    toPractice(r);
    const engine = r.engines.current();
    engine.deadline = 700;
    r.press('down', 100);
    r.press('up', 300);
    r.setPending(650);
    r.advance(700);
    expect(engine.calls.some((c) => c.kind === 'tick')).toBe(false);
    expect(r.scheduler.pending()).toBe(1);
    r.setPending(null);
    r.advance(750);
    expect(engine.calls.filter((c) => c.kind === 'tick')).toEqual([{ kind: 'tick', t: 750 }]);
  });

  it('starts the alarm once on SOS from a press and keeps the step and presses (Requirements 7.6, 12.6)', () => {
    const r = rig();
    toPractice(r);
    r.practice([180, 200]);
    const before = r.state();
    r.engines.current().script('press', SOS);
    r.press('down', 20_000);
    expect(r.alarmStarts).toEqual([20_000]);
    expect(r.state()).toBe(before);
    expect(r.engines.current().calls.at(-1)).toEqual({ kind: 'reset' });
  });

  it('starts the alarm once on SOS from a tick and keeps the step (Requirement 12.6)', () => {
    const r = rig();
    toPractice(r);
    const engine = r.engines.current();
    engine.deadline = 900;
    r.press('down', 100);
    r.press('up', 400);
    const before = r.state();
    engine.script('tick', SOS);
    r.advance(900);
    expect(r.alarmStarts).toEqual([900]);
    expect(r.state()).toBe(before);
    expect(r.scheduler.pending()).toBe(0);
  });

  it('discards every other Engine_Event (Requirement 12.7)', () => {
    const r = rig();
    toPractice(r);
    const engine = r.engines.current();
    engine.script('press', [{ type: 'char', char: 'e' }, { type: 'space' }]);
    engine.script('release', [{ type: 'symbol', symbol: '.' }]);
    engine.script('tick', [{ type: 'unknown', pattern: '..-.-' }, { type: 'command', command: 'speak' }]);
    engine.deadline = 500;
    const logged = r.log.length;
    r.press('down', 100);
    r.press('up', 200);
    r.advance(500);
    expect(r.alarmStarts).toEqual([]);
    expect(r.state()).toMatchObject({ step: 'practice', durations: [100] });
    expect(r.log.slice(logged)).toEqual([]);
  });

  it('cancels the timer and drops the Guard_Engine on close (Requirement 12.9)', () => {
    const r = rig();
    toPractice(r);
    r.practice(SHORT_LONG);
    r.act({ type: 'use-this-speed' });
    const engine = r.engines.current();
    engine.deadline = 99_000;
    r.press('down', 98_000); // legend step: the press still reaches the Guard_Engine
    r.press('up', 98_100);
    expect(r.scheduler.pending()).toBe(1);
    r.act({ type: 'start' });
    expect(r.controller.isOpen()).toBe(false);
    expect(r.scheduler.pending()).toBe(0);
    const calls = engine.calls.length;
    r.advance(200_000);
    r.press('down', 200_100);
    expect(engine.calls).toHaveLength(calls);
  });
});

describe('Practice to Start', () => {
  it('applies the measured estimates once, writes the record once, closes and focuses (15.6, 16.4, 16.5, 16.7)', () => {
    const r = rig();
    r.attach();
    r.act({ type: 'choose', choice: 'key-tap' }, { type: 'continue' });
    r.practice(SHORT_LONG);
    r.act({ type: 'use-this-speed' }, { type: 'use-this-speed' });
    const { dotEstimate, dashEstimate } = calibrate(SHORT_LONG);
    expect(r.log).toEqual(['focus-surface', `estimates:${JSON.stringify({ dotEstimate, dashEstimate })}`]);
    r.act({ type: 'start' }, { type: 'start' });
    expect(r.controller.isOpen()).toBe(false);
    expect(r.log.at(-1)).toBe('focus-surface');
    expect(writesOf(r.backend)).toEqual([
      [ONBOARDING_KEY, serializeOnboardingRecord({ v: 1, complete: true, inputChoice: 'key-tap', estimates: { dotEstimate, dashEstimate } })],
    ]);
    expect(r.controller.getView()).toMatchObject({ saveFailed: false, inputChoiceInEffect: 'key-tap', state: null });
    expect(r.openChanges()).toBe(2);
  });

  it('keeps the choice and estimates and shows the save note when the write fails (Requirement 16.6)', () => {
    const stale: KeyValueBackend = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    for (const backend of [throwingBackend({ set: true }), stale]) {
      const r = rig({ backend });
      r.attach();
      r.act({ type: 'choose', choice: 'key-tap' }, { type: 'continue' }, { type: 'use-default' }, { type: 'continue' });
      r.act({ type: 'start' });
      expect(r.controller.getView()).toMatchObject({ saveFailed: true, inputChoiceInEffect: 'key-tap', state: null });
      expect(r.log.filter((entry) => entry.startsWith('estimates'))).toEqual(['estimates:null']);
      expect(r.log.at(-1)).toBe('focus-surface');
    }
  });
});

describe('Run setup again and Cancel setup', () => {
  it('selects the choice in effect, focuses it and writes nothing until Start (Requirements 11.7, 11.10)', () => {
    const r = rig({ stored: COMPLETE });
    r.attach();
    r.controller.runSetupAgain();
    expect(r.state()).toMatchObject({ step: 'input', origin: 'rerun', selected: 'switch', inputChoice: 'switch' });
    expect(r.log.at(-1)).toBe('focus-choice');
    r.act({ type: 'continue' }, { type: 'use-default' }, { type: 'continue' });
    expect(writesOf(r.backend)).toEqual([]);
    r.act({ type: 'start' });
    expect(writesOf(r.backend)).toHaveLength(1);
  });

  it('uses the choice from this page load when the earlier write failed', () => {
    const r = rig({ backend: throwingBackend({ set: true }) });
    r.attach();
    r.act({ type: 'choose', choice: 'key-tap' }, { type: 'continue' }, { type: 'use-default' }, { type: 'continue' });
    r.act({ type: 'start' });
    r.controller.runSetupAgain();
    expect(r.state()).toMatchObject({ selected: 'key-tap', inputChoice: 'key-tap' });
  });

  it('restores the sources and leaves storage and estimates untouched on Cancel setup (Requirement 11.9)', () => {
    const sources = createFakeSourceControl({ flags: { ...DEFAULT_ENABLED_SOURCES, blink: true }, statuses: { blink: 'active' } });
    const r = rig({ stored: { ...COMPLETE, inputChoice: 'blink' }, sources });
    r.attach();
    const estimateCalls = r.log.length;
    r.controller.runSetupAgain();
    expect(r.state()).toMatchObject({ selected: 'blink', inputChoice: 'blink' });
    r.act({ type: 'choose', choice: 'key-tap' }); // stops the camera
    expect(sources.calls).toEqual([{ kind: 'stopBlink' }]);
    r.act({ type: 'cancel' });
    expect(sources.calls.at(-1)).toEqual({ kind: 'restore', flags: { ...DEFAULT_ENABLED_SOURCES, blink: true } });
    expect(r.controller.isOpen()).toBe(false);
    expect(r.log.slice(estimateCalls)).toEqual(['focus-choice', 'focus-surface']);
    expect(writesOf(r.backend)).toEqual([]);
  });

  it('does nothing while the flow is already open', () => {
    const r = rig();
    r.attach();
    const state = r.state();
    r.controller.runSetupAgain();
    expect(r.state()).toBe(state);
  });
});

describe('Switch and Blink choices', () => {
  it('arms the learner and confirms Switch with the learned key (Requirements 13.4, 13.5)', async () => {
    const learner = createFakeSwitchLearner();
    const r = rig({ learner });
    r.attach();
    r.act({ type: 'choose', choice: 'switch' });
    expect(learner.arms).toBe(1);
    learner.resolve(ok('KeyF'));
    await settle();
    expect(r.state()).toMatchObject({ inputChoice: 'switch', switchPhase: { kind: 'learned', code: 'KeyF' } });
  });

  it('drops the result of a learner arm that was cancelled (Requirement 13.3)', async () => {
    const learner = createFakeSwitchLearner();
    const r = rig({ learner });
    r.attach();
    r.act({ type: 'choose', choice: 'switch' }, { type: 'choose', choice: 'key-tap' });
    expect(learner.cancels).toBe(1);
    await settle();
    expect(r.state()).toMatchObject({ selected: 'key-tap', inputChoice: 'key-tap', switchPhase: { kind: 'idle' } });
  });

  it('shows that switch setup is unavailable when the session has no learner', async () => {
    const r = rig({ learner: null });
    r.attach();
    r.act({ type: 'choose', choice: 'switch' });
    await settle();
    expect(r.state()?.switchPhase).toEqual({ kind: 'failed', message: SWITCH_UNAVAILABLE_TEXT });
    expect(r.state()?.inputChoice).toBeNull();
  });

  it('starts the camera inside the action and follows the blink status (Requirements 13.8, 13.9)', () => {
    const r = rig();
    r.attach();
    r.act({ type: 'choose', choice: 'blink' });
    expect(r.sources.calls).toEqual([]);
    r.act({ type: 'camera-on' });
    expect(r.sources.calls).toEqual([{ kind: 'startBlink' }]);
    r.sources.setStatus('blink', 'starting');
    r.sources.setStatus('blink', 'active');
    expect(r.state()).toMatchObject({ inputChoice: 'blink', blinkPhase: { kind: 'started', status: 'active' } });
    r.sources.setStatus('blink', 'permission-denied');
    expect(r.state()?.inputChoice).toBeNull();
  });

  it('shows the blink resume button and reason for each status after setup (Requirements 11.13, 11.14)', () => {
    const r = rig({ stored: { ...COMPLETE, inputChoice: 'blink' } });
    r.attach();
    r.controller.turnOnBlinkCamera();
    expect(r.sources.calls).toEqual([{ kind: 'startBlink' }]);
    const cases = [
      ['starting', false, null],
      ['active', false, null],
      ['face-lost', false, null],
      ['permission-denied', true, BLINK_FAILURE_TEXT['permission-denied']],
      ['no-camera', true, BLINK_FAILURE_TEXT['no-camera']],
      ['error', true, BLINK_FAILURE_TEXT.error],
      ['unsupported', false, BLINK_FAILURE_TEXT.unsupported],
      ['off', true, null],
    ] as const;
    for (const [status, visible, reason] of cases) {
      r.sources.setStatus('blink', status);
      expect(r.controller.getView().blinkResume).toEqual({ visible, reason });
    }
  });

  it('never shows the blink resume button for another choice or while the flow is open', () => {
    const keyTap = rig({ stored: { ...COMPLETE, inputChoice: 'key-tap' } });
    keyTap.attach();
    keyTap.sources.setStatus('blink', 'error');
    expect(keyTap.controller.getView().blinkResume.visible).toBe(false);
    const blink = rig({ stored: { ...COMPLETE, inputChoice: 'blink' } });
    blink.attach();
    blink.controller.runSetupAgain();
    expect(blink.controller.getView().blinkResume).toEqual({ visible: false, reason: null });
  });

  it('notifies subscribers once per visible change', () => {
    const r = rig();
    r.attach();
    let notified = 0;
    r.controller.subscribe(() => {
      notified += 1;
    });
    r.act({ type: 'choose', choice: 'key-tap' });
    r.act({ type: 'choose', choice: 'key-tap' }); // no change
    r.sources.emit(); // nothing visible changed
    expect(notified).toBe(1);
    const view = r.controller.getView();
    expect(r.controller.getView()).toBe(view);
  });
});
