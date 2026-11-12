import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  HISTORY_KEY,
  SETTINGS_KEY,
  WPM_RANGE_MESSAGE,
  memoryBackend,
} from '@/lib/conversation';
import { throwingBackend } from '@/lib/conversation/test-support';
import { DEFAULT_INPUT_SETTINGS, safeTickTime } from '@/lib/input';
import { createEngine } from '@/lib/morse';
import { createFakeSpeechOutput } from '@/lib/speech/fakes';
import {
  LISTEN_RESTART_MS,
  NO_VOICE_TEXT,
  PENDING_RETRY_MS,
  SAVE_FAILED_TEXT,
  SPEAK_ERROR_TEXT,
  createSessionController,
  engineOrDefault,
  sourceStatusText,
} from './session-controller';
import { BACKSPACE, SOS, SPEAK, char, createControllerRig, symbol } from './session-controller.test-support';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Keys one character: a down/up pair whose release decodes `c`. */
function key(rig: ReturnType<typeof createControllerRig>, c: string): void {
  rig.down();
  rig.advance(10);
  rig.script(char(c));
  rig.up();
  rig.advance(10);
}

describe('construction', () => {
  it('hydrates the stored history before any press and builds the Engine from the settings', () => {
    const backend = memoryBackend({
      [HISTORY_KEY]: JSON.stringify({ v: 1, turns: [{ role: 'partner', text: 'Are you thirsty?' }] }),
      [SETTINGS_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, startingWpm: 10, adaptive: false }),
    });
    const rig = createControllerRig({ backend });
    const { session, settings } = rig.controller.getSnapshot();
    expect(session.turns).toEqual([{ id: 1, role: 'partner', text: 'Are you thirsty?' }]);
    expect(settings.startingWpm).toBe(10);
    expect(rig.engine().config).toEqual({ startingWpm: 10, mode: 'fixed' });
    expect(rig.engine().calls).toEqual([]);
    expect(rig.client.updates).toEqual([{ text: '', context: [{ role: 'partner', text: 'Are you thirsty?' }] }]);
    expect(rig.controller.getSnapshot().listen.on).toBe(false);
  });

  it('shows one save-failure message when storage cannot be read, and keying still works', () => {
    const rig = createControllerRig({ backend: throwingBackend({ get: true, set: true }) });
    expect(rig.controller.getSnapshot().messages).toEqual([{ id: 'save-failed', text: SAVE_FAILED_TEXT }]);
    key(rig, 'h');
    rig.controller.partnerLine('hello');
    expect(rig.controller.getSnapshot().session.currentText).toBe('h');
    expect(rig.controller.getSnapshot().messages.filter((m) => m.id === 'save-failed')).toHaveLength(1);
  });

  it('shows the save-failure message once from the start when storage is only in memory', () => {
    const rig = createControllerRig({ persistent: false });
    expect(rig.controller.getSnapshot().messages).toEqual([{ id: 'save-failed', text: SAVE_FAILED_TEXT }]);
    rig.controller.partnerLine('hello');
    expect(rig.controller.getSnapshot().messages).toHaveLength(1);
    expect(createControllerRig({ persistent: true }).controller.getSnapshot().messages).toEqual([]);
  });

  it('getSnapshot returns the same object until something changes', () => {
    const rig = createControllerRig();
    const first = rig.controller.getSnapshot();
    expect(rig.controller.getSnapshot()).toBe(first);
    rig.down();
    expect(rig.controller.getSnapshot()).not.toBe(first);
    expect(rig.controller.getSnapshot().pressed).toBe(true);
  });
});

describe('the alarm', () => {
  it('sos starts the alarm while a Client request is unresolved, without cancelling it', () => {
    const rig = createControllerRig();
    key(rig, 'h');
    expect(rig.client.updates).toEqual([{ text: 'h', context: [] }]);
    rig.down();
    rig.script(SOS);
    rig.up();
    expect(rig.alarm.starts).toBe(1);
    expect(rig.engine().resets).toBe(1);
    expect(rig.scheduler.pending()).toBe(0);
    expect(rig.client.disposed).toBe(false);
    expect(rig.client.updates).toHaveLength(1);
    expect(rig.controller.getSnapshot().alarmActive).toBe(true);
  });

  it('routes every press to the alarm while it is active, and none to the Engine', () => {
    const rig = createControllerRig();
    rig.down();
    rig.script(SOS);
    rig.up();
    const calls = rig.engine().calls.length;
    const down = rig.down();
    const up = rig.up();
    expect(rig.alarm.presses).toEqual([down, up]);
    expect(rig.engine().calls).toHaveLength(calls);
    expect(rig.controller.getSnapshot().pressed).toBe(false);
  });

  it('withholds the up of a press that was held when the alarm started', () => {
    const rig = createControllerRig();
    rig.down();
    rig.up();
    rig.script(SOS);
    rig.down(); // the next press decodes sos (the letter gap had passed) and is still held
    expect(rig.alarm.starts).toBe(1);
    rig.up();
    expect(rig.alarm.presses).toEqual([]);
    const next = rig.down();
    expect(rig.alarm.presses).toEqual([next]);
  });

  it('a throwing start() still resets the Engine, and later events are processed', () => {
    const rig = createControllerRig();
    rig.alarm.throwOnStart = true;
    rig.down();
    rig.script(SOS);
    rig.up();
    expect(rig.alarm.starts).toBe(1);
    expect(rig.engine().resets).toBe(1);
    key(rig, 'a');
    expect(rig.controller.getSnapshot().session.currentText).toBe('a');
  });

  it('resumes scheduling when the alarm ends', () => {
    const rig = createControllerRig();
    rig.down();
    rig.script(SOS);
    rig.up();
    rig.engine().deadline = rig.clock.now() + 300;
    rig.alarm.setActive(false);
    expect(rig.scheduler.live()).toEqual([{ due: rig.clock.now() + 300, delay: 300 }]);
    expect(rig.controller.getSnapshot().alarmActive).toBe(false);
  });
});

describe('effects and the Engine', () => {
  it('runs effects in the order the reducer returns them', () => {
    const rig = createControllerRig();
    key(rig, 'o');
    key(rig, 'k');
    const journal: string[] = [];
    const speak = rig.speechOutput.speak.bind(rig.speechOutput);
    rig.speechOutput.speak = (...args) => {
      journal.push('speak');
      speak(...args);
    };
    const engine = rig.engine();
    const reset = engine.reset.bind(engine);
    engine.reset = () => {
      journal.push('reset');
      reset();
    };
    rig.down();
    rig.script(SPEAK);
    rig.up();
    expect(journal).toEqual(['speak', 'reset']);
    expect(rig.speechOutput.calls.at(-1)).toEqual({ kind: 'speak', sentence: 'ok', voiceURI: null, rate: 1 });
  });

  it('passes every returned event to the reducer in order and reschedules after each call', () => {
    const rig = createControllerRig();
    rig.down();
    rig.engine().deadline = rig.clock.now() + 400;
    rig.script(symbol('.'), symbol('-'));
    rig.up();
    expect(rig.controller.getSnapshot().session.currentPattern).toBe('.-');
    expect(rig.scheduler.live()).toEqual([{ due: rig.clock.now() + 400, delay: 400 }]);
    rig.script(char('a'));
    rig.advance(400);
    expect(rig.engine().calls.at(-1)).toEqual({ kind: 'tick', t: rig.clock.now() });
    expect(rig.controller.getSnapshot().session).toMatchObject({ currentText: 'a', currentPattern: '' });
    expect(rig.scheduler.pending()).toBe(0);
  });

  it('does not tick past a pending press and retries 50 ms later for the same deadline', () => {
    const rig = createControllerRig();
    rig.down();
    rig.engine().deadline = rig.clock.now() + 400;
    rig.up();
    const deadline = rig.clock.now() + 400;
    rig.pending.push(deadline - 20);
    rig.advance(400);
    expect(rig.engine().calls.filter((c) => c.kind === 'tick')).toEqual([]);
    expect(rig.scheduler.live()).toEqual([{ due: rig.clock.now() + PENDING_RETRY_MS, delay: PENDING_RETRY_MS }]);
    rig.pending.length = 0;
    rig.pending.push(deadline + 100);
    rig.advance(PENDING_RETRY_MS);
    expect(rig.engine().calls.at(-1)).toEqual({ kind: 'tick', t: safeTickTime(rig.clock.now(), deadline + 100) });
  });

  it('replacing the Engine withholds the pending up and clears Current_Pattern', () => {
    const rig = createControllerRig();
    rig.down();
    rig.script(symbol('.'));
    rig.up();
    rig.down();
    const old = rig.engine();
    rig.controller.setInitialEstimates({ dotEstimate: 150, dashEstimate: 450 });
    expect(rig.engines.engines).toHaveLength(2);
    expect(rig.engine().config).toEqual({ startingWpm: 6, mode: 'adaptive', initialDotEstimate: 150, initialDashEstimate: 450 });
    expect(rig.controller.getSnapshot().session.currentPattern).toBe('');
    rig.up();
    expect(rig.engine().calls).toEqual([]);
    expect(old.calls.at(-1)).toEqual({ kind: 'press', t: rig.clock.now() });
    rig.down();
    expect(rig.engine().calls).toEqual([{ kind: 'press', t: rig.clock.now() }]);
  });

  it('setInitialEstimates(null) replaces the Engine once with the Starting_WPM defaults', () => {
    const rig = createControllerRig();
    rig.controller.setInitialEstimates(null);
    expect(rig.engines.engines).toHaveLength(2);
    expect(rig.engine().config).toEqual({ startingWpm: 6, mode: 'adaptive' });
  });

  it('getEstimates reports the calibration in effect, not the adapted estimates', () => {
    const rig = createControllerRig();
    expect(rig.controller.getEstimates()).toBeNull();
    rig.controller.setInitialEstimates({ dotEstimate: 150, dashEstimate: 450 });
    expect(rig.controller.getEstimates()).toEqual({ dotEstimate: 150, dashEstimate: 450 });
  });

  it('passes unknown patterns to the handler, ignoring its errors', () => {
    const rig = createControllerRig();
    rig.unknown.throwOnHandle = true;
    rig.down();
    rig.script({ type: 'unknown', pattern: '......' });
    rig.up();
    expect(rig.unknown.patterns).toEqual(['......']);
    key(rig, 'a');
    expect(rig.controller.getSnapshot().session.currentText).toBe('a');
  });
});

describe('the Client', () => {
  it('sends Trimmed_Text changes, partner Turns, and the empty text after a speak', () => {
    const rig = createControllerRig();
    key(rig, 'h');
    key(rig, 'i');
    rig.down();
    rig.script({ type: 'space' });
    rig.up();
    rig.controller.partnerLine('  Are you ok? ');
    rig.down();
    rig.script(SPEAK);
    rig.up();
    rig.controller.partnerLine('Good.');
    expect(rig.client.updates).toEqual([
      { text: 'h', context: [] },
      { text: 'hi', context: [] },
      { text: 'hi', context: [{ role: 'partner', text: 'Are you ok?' }] },
      { text: '', context: [{ role: 'partner', text: 'Are you ok?' }, { role: 'speaker', text: 'hi' }] },
      { text: '', context: [{ role: 'partner', text: 'Are you ok?' }, { role: 'speaker', text: 'hi' }, { role: 'partner', text: 'Good.' }] },
    ]);
  });

  it('applies delivered results unmodified and in order', () => {
    const rig = createControllerRig();
    key(rig, 'i');
    rig.client.deliver({ text: 'i', suggestions: ['I am cold.', 'I am fine.'], source: 'on-device' });
    rig.client.deliver({ text: 'x', suggestions: ['stale'], source: 'ai' });
    expect(rig.controller.getSnapshot().session).toMatchObject({
      suggestions: ['I am cold.', 'I am fine.'],
      suggestionSource: 'on-device',
      highlight: 0,
    });
  });

  it('never calls fetch itself', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const rig = createControllerRig();
    key(rig, 'a');
    rig.controller.partnerLine('hello');
    rig.client.deliver({ text: 'a', suggestions: ['A.'], source: 'ai' });
    rig.controller.partnerPick(0);
    rig.controller.setListen(true);
    rig.advance(5_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('storage', () => {
  it('saves history before the next action, and an empty record on Clear_History', () => {
    const rig = createControllerRig();
    rig.controller.partnerLine('Are you thirsty?');
    expect(JSON.parse(rig.backend.getItem(HISTORY_KEY) ?? '')).toEqual({
      v: 1,
      turns: [{ role: 'partner', text: 'Are you thirsty?' }],
    });
    rig.controller.clearHistory();
    expect(JSON.parse(rig.backend.getItem(HISTORY_KEY) ?? '')).toEqual({ v: 1, turns: [] });
    rig.backend.setItem(HISTORY_KEY, 'stale');
    rig.controller.clearHistory();
    expect(rig.backend.getItem(HISTORY_KEY)).toBe('{"v":1,"turns":[]}');
  });

  it('saves settings, replaces the Engine on a speed or adaptation change, and rejects bad values', () => {
    const rig = createControllerRig();
    expect(rig.controller.updateSettings({ speechRate: 1.5 }).ok).toBe(true);
    expect(rig.engines.engines).toHaveLength(1);
    expect(JSON.parse(rig.backend.getItem(SETTINGS_KEY) ?? '')).toMatchObject({ speechRate: 1.5 });
    rig.controller.updateSettings({ startingWpm: 9 });
    expect(rig.engines.engines).toHaveLength(2);
    expect(rig.engine().config).toEqual({ startingWpm: 9, mode: 'adaptive' });
    rig.controller.updateSettings({ adaptive: false });
    expect(rig.engines.engines).toHaveLength(3);
    const rejected = rig.controller.updateSettings({ startingWpm: 30 });
    expect(rejected).toEqual({ ok: false, error: [{ field: 'startingWpm', value: 30, message: WPM_RANGE_MESSAGE }] });
    expect(rig.controller.getSnapshot().settings.startingWpm).toBe(9);
    expect(rig.engines.engines).toHaveLength(3);
  });

  it('keeps a setting in effect and shows the save-failure message once when the write fails', () => {
    const rig = createControllerRig({ backend: throwingBackend({ set: true }) });
    rig.controller.updateSettings({ flip: true });
    rig.controller.updateSettings({ speechRate: 0.8 });
    const { settings, messages } = rig.controller.getSnapshot();
    expect(settings).toMatchObject({ flip: true, speechRate: 0.8 });
    expect(messages).toEqual([{ id: 'save-failed', text: SAVE_FAILED_TEXT }]);
    rig.controller.dismissMessage('save-failed');
    expect(rig.controller.getSnapshot().messages).toEqual([]);
  });

  it('keeps the learned switch key when partner settings change', () => {
    const rig = createControllerRig();
    rig.storage.writeSwitchKey('KeyJ');
    rig.controller.updateSettings({ speechRate: 1.2 });
    rig.controller.updateInputSettings({ ...DEFAULT_INPUT_SETTINGS, closeThreshold: 0.6, openThreshold: 0.3 });
    expect(rig.storage.readSwitchKey()).toEqual({ ok: true, value: 'KeyJ' });
    expect(JSON.parse(rig.backend.getItem(SETTINGS_KEY) ?? '')).toMatchObject({
      switchKey: 'KeyJ',
      speechRate: 1.2,
      input: { closeThreshold: 0.6, openThreshold: 0.3 },
    });
  });
});

describe('speech output', () => {
  it('shows the no-voice message without calling speak when no voice is available', () => {
    const speechOutput = createFakeSpeechOutput({ voices: [] });
    const rig = createControllerRig({ speechOutput });
    key(rig, 'o');
    rig.down();
    rig.script(SPEAK);
    rig.up();
    expect(speechOutput.calls).toEqual([]);
    expect(rig.controller.getSnapshot().messages).toEqual([{ id: 'no-voice', text: NO_VOICE_TEXT }]);
    expect(rig.controller.getSnapshot().session.lastSpoken).toBe('o');
  });

  it('shows the speak-error message for an error, nothing for a cancelled utterance, and clears it on the next speak', () => {
    const rig = createControllerRig();
    rig.controller.partnerLine('x');
    const speakNow = (c: string) => {
      key(rig, c);
      rig.down();
      rig.script(SPEAK);
      rig.up();
    };
    speakNow('a');
    rig.speechOutput.finish('error');
    expect(rig.controller.getSnapshot().messages).toEqual([{ id: 'speak-error', text: SPEAK_ERROR_TEXT }]);
    speakNow('b');
    expect(rig.controller.getSnapshot().messages).toEqual([]);
    speakNow('c'); // cuts off "b", which ends as cancelled
    expect(rig.controller.getSnapshot().messages).toEqual([]);
  });

  it('uses the newly selected voice and rate for the next utterance', () => {
    const rig = createControllerRig();
    rig.controller.updateSettings({ voiceURI: 'fake-voice-b', speechRate: 1.7 });
    key(rig, 'y');
    rig.down();
    rig.script(SPEAK);
    rig.up();
    expect(rig.speechOutput.calls.at(-1)).toEqual({ kind: 'speak', sentence: 'y', voiceURI: 'fake-voice-b', rate: 1.7 });
  });

  it('follows voice list changes', () => {
    const rig = createControllerRig();
    rig.speechOutput.setVoices([]);
    expect(rig.controller.getSnapshot().voices).toEqual([]);
  });
});

describe('Listen', () => {
  it('turns a final transcript into a partner Turn, and discards it while speaking, while off and when blank', () => {
    const rig = createControllerRig();
    rig.speechInput.emitFinal('ignored while off');
    rig.controller.setListen(true);
    expect(rig.speechInput.calls).toEqual(['start']);
    rig.speechInput.emitInterim('are you');
    expect(rig.controller.getSnapshot().listen.interim).toBe('are you');
    rig.speechInput.emitFinal(' Are you thirsty? ');
    rig.speechInput.emitFinal('  \t ');
    rig.speechOutput.speaking = true;
    rig.speechInput.emitFinal('our own voice');
    rig.speechOutput.speaking = false;
    const { session, listen } = rig.controller.getSnapshot();
    expect(session.turns.map((t) => t.text)).toEqual(['Are you thirsty?']);
    expect(listen.interim).toBe('');
    rig.controller.setListen(false);
    expect(rig.speechInput.calls).toEqual(['start', 'stop']);
    rig.speechInput.emitFinal('after off');
    expect(rig.controller.getSnapshot().session.turns).toHaveLength(1);
  });

  it('restarts within 1 second after recognition ends on its own, until switched off', () => {
    const rig = createControllerRig();
    rig.controller.setListen(true);
    rig.speechInput.emitError('no-speech');
    rig.speechInput.emitEnd();
    expect(rig.controller.getSnapshot().listen.on).toBe(true);
    rig.advance(LISTEN_RESTART_MS);
    expect(LISTEN_RESTART_MS).toBeLessThanOrEqual(1_000);
    expect(rig.speechInput.calls).toEqual(['start', 'start']);
    rig.speechInput.emitEnd();
    rig.controller.setListen(false);
    rig.advance(1_000);
    expect(rig.speechInput.calls).toEqual(['start', 'start', 'stop']);
  });

  it('switches off with a message on a permission error or a failed start', () => {
    const rig = createControllerRig();
    rig.controller.setListen(true);
    rig.speechInput.emitError('permission-denied');
    expect(rig.controller.getSnapshot().listen).toMatchObject({ on: false, message: 'permission-denied' });
    rig.speechInput.nextStart = { ok: false, error: 'other' };
    rig.controller.setListen(true);
    expect(rig.controller.getSnapshot().listen).toMatchObject({ on: false, message: 'stopped' });
  });
});

describe('source statuses', () => {
  it('adds one message per failing source and removes it when the source recovers', () => {
    const rig = createControllerRig();
    const statuses = { keyboard: 'active', switch: 'off', pointer: 'active', blink: 'permission-denied' } as const;
    rig.controller.setSourceStatuses(statuses);
    rig.controller.setSourceStatuses(statuses);
    expect(rig.controller.getSnapshot().messages).toEqual([
      { id: 'source-blink', text: 'Blink input: camera permission denied.' },
    ]);
    rig.controller.setSourceStatuses({ ...statuses, blink: 'face-lost', pointer: 'error' });
    // One message per id, in insertion order; a changed status updates its message in place.
    expect(rig.controller.getSnapshot().messages).toEqual([
      { id: 'source-blink', text: 'Blink input: face not found.' },
      { id: 'source-pointer', text: sourceStatusText('pointer', 'error') },
    ]);
    rig.controller.setSourceStatuses({ ...statuses, blink: 'active' });
    expect(rig.controller.getSnapshot().messages).toEqual([]);
  });
});

describe('dispose', () => {
  it('cancels every timer, unsubscribes everything and ignores late callbacks', () => {
    const rig = createControllerRig();
    let notified = 0;
    rig.controller.subscribe(() => notified++);
    rig.controller.setListen(true);
    key(rig, 'h');
    key(rig, 'i'); // held for the Live_Region throttle
    rig.down();
    rig.engine().deadline = rig.clock.now() + 500;
    rig.up();
    rig.speechInput.emitEnd(); // restart pending
    expect(rig.scheduler.pending()).toBe(1);
    expect(rig.ui.pending()).toBeGreaterThan(0);
    rig.controller.dispose();
    expect(rig.scheduler.pending()).toBe(0);
    expect(rig.ui.pending()).toBe(0);
    expect(rig.client.disposed).toBe(true);
    expect(rig.speechInput.listenerCount()).toBe(0);
    expect(rig.speechOutput.listenerCount()).toBe(0);
    expect(rig.alarm.listenerCount()).toBe(0);
    expect(rig.speechInput.calls.at(-1)).toBe('stop');
    const calls = rig.engine().calls.length;
    const seen = notified;
    rig.down();
    rig.up();
    rig.client.deliver({ text: 'hi', suggestions: ['Hi.'], source: 'ai' });
    rig.controller.discardInput();
    rig.advance(5_000);
    expect(rig.engine().calls).toHaveLength(calls);
    expect(notified).toBe(seen);
  });
});

describe('live announcements', () => {
  it('announces committed characters at most once per second, and new suggestions', () => {
    const rig = createControllerRig();
    key(rig, 'h');
    expect(rig.controller.getSnapshot().announcement).toEqual({ seq: 1, text: 'h' });
    key(rig, 'i');
    expect(rig.controller.getSnapshot().announcement?.seq).toBe(1);
    rig.client.deliver({ text: 'hi', suggestions: ['Hi there.'], source: 'ai' });
    rig.advance(1_000);
    expect(rig.controller.getSnapshot().announcement).toEqual({ seq: 2, text: 'i, 1 suggestion. Highlighted: Hi there.' });
    rig.down();
    rig.script(BACKSPACE);
    rig.up();
    rig.advance(1_000);
    expect(rig.controller.getSnapshot().announcement?.seq).toBe(2);
  });

  it('works with a single shared scheduler, as in production', () => {
    const rig = createControllerRig({ sharedScheduler: true });
    key(rig, 'h');
    key(rig, 'i');
    rig.advance(1_000);
    expect(rig.controller.getSnapshot().announcement?.text).toBe('i');
  });
});

describe('engineOrDefault', () => {
  it('falls back to the default configuration when the given one is invalid', () => {
    const build = engineOrDefault(createEngine);
    expect(build({ startingWpm: 99 }).estimates()).toEqual(build({}).estimates());
    expect(build({ startingWpm: 12, mode: 'fixed' }).mode).toBe('fixed');
  });
});

describe('createSessionController without a Press_Router', () => {
  it('is a plain object with the documented methods', () => {
    const rig = createControllerRig();
    expect(typeof createSessionController).toBe('function');
    for (const method of [
      'handlePress',
      'partnerPick',
      'partnerLine',
      'clearHistory',
      'updateSettings',
      'updateInputSettings',
      'setInitialEstimates',
      'getEstimates',
      'setListen',
      'setSourceStatuses',
      'dismissMessage',
      'discardInput',
      'onCodeCommitted',
      'getSnapshot',
      'subscribe',
      'dispose',
    ]) {
      expect(typeof (rig.controller as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });
});
