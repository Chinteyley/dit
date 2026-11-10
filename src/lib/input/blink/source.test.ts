import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createArbiter } from '../arbiter';
import { createManualClock, createManualScheduler } from '../clock';
import {
  createFakeBlinkDevices,
  createFakeLandmarker,
  createFakePage,
  createFakePressSource,
  createFakeStream,
  flushPromises,
  plain,
} from '../test-support';
import { pressEvent, type PressEvent, type SourceStatus } from '../types';
import { LANDMARKER_READY_LIMIT_MS, cameraFailureStatus, createBlinkSource } from './source';

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});

afterEach(async () => {
  await flushPromises();
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled).toStrictEqual([]);
});

const OPEN = { left: 0.05, right: 0.05 };
const CLOSED = { left: 0.9, right: 0.9 };

function setup(config?: { readonly minPressDuration?: number }) {
  const clock = createManualClock(0);
  const scheduler = createManualScheduler(clock.now);
  const page = createFakePage();
  const devices = createFakeBlinkDevices();
  const source = createBlinkSource({ devices, clock: clock.now, scheduler, page, ...(config ? { config } : {}) });
  const statuses: SourceStatus[] = [];
  const presses: PressEvent[] = [];
  source.onStatus((status) => statuses.push(status));
  source.onPress((event) => presses.push(event));
  const landmarker = createFakeLandmarker();

  /** Opens the camera and the model for the newest requests. */
  const ready = async () => {
    const stream = createFakeStream();
    devices.cameraRequests.at(-1)?.resolve(stream);
    await flushPromises();
    devices.landmarkerRequests.at(-1)?.resolve(landmarker);
    await flushPromises();
    return stream;
  };
  return { clock, scheduler, page, devices, source, statuses, presses, landmarker, ready };
}

describe('Blink_Source start sequence', () => {
  it("reports 'starting' and then 'active' once, and asks for the model only after the camera (Req 9.2)", async () => {
    const rig = setup();
    rig.source.start();
    expect(rig.statuses).toStrictEqual(['starting']);
    expect(rig.devices.cameraRequests).toHaveLength(1);
    expect(rig.devices.landmarkerRequests).toHaveLength(0);

    rig.devices.cameraRequests[0]?.resolve(createFakeStream());
    await flushPromises();
    expect(rig.devices.landmarkerRequests).toHaveLength(1);
    expect(rig.statuses).toStrictEqual(['starting']);

    rig.devices.landmarkerRequests[0]?.resolve(rig.landmarker);
    await flushPromises();
    expect(rig.statuses).toStrictEqual(['starting', 'active']);
    expect(rig.scheduler.pending()).toBe(0);
    rig.source.start();
    expect(rig.statuses).toStrictEqual(['starting', 'active']);
  });

  it("reports 'unsupported' without 'starting' and asks for nothing (Req 10.1)", () => {
    const rig = setup();
    rig.devices.supported = false;
    rig.source.start();
    expect(rig.statuses).toStrictEqual(['unsupported']);
    expect(rig.devices.cameraRequests).toHaveLength(0);
    expect(rig.devices.landmarkerRequests).toHaveLength(0);
  });

  it('keys a deliberate closure from frame timestamps (Req 1.8, 8.4, 8.5)', async () => {
    const rig = setup();
    rig.source.start();
    await rig.ready();
    rig.landmarker.scores = CLOSED;
    rig.devices.frame(100);
    rig.devices.frame(200);
    rig.devices.frame(310);
    rig.landmarker.scores = OPEN;
    rig.clock.set(9999);
    rig.devices.frame(400);
    expect(plain(rig.presses)).toStrictEqual([
      { kind: 'down', t: 100, source: 'blink' },
      { kind: 'up', t: 400, source: 'blink' },
    ]);
    expect(rig.landmarker.detected).toStrictEqual([100, 200, 310, 400]);
  });

  it('ignores frames while starting (Req 9.2)', async () => {
    const rig = setup();
    rig.source.start();
    rig.devices.cameraRequests[0]?.resolve(createFakeStream());
    await flushPromises();
    rig.devices.frame(10);
    expect(rig.landmarker.detected).toStrictEqual([]);
  });

  it('stop while starting turns a late camera off at once and never reports active (Req 9.8)', async () => {
    const rig = setup();
    rig.source.start();
    rig.source.stop();
    expect(rig.statuses).toStrictEqual(['starting', 'off']);
    const late = createFakeStream();
    rig.devices.cameraRequests[0]?.resolve(late);
    await flushPromises();
    expect(late.tracks[0]?.readyState).toBe('ended');
    expect(rig.devices.landmarkerRequests).toHaveLength(0);
    expect(rig.statuses).toStrictEqual(['starting', 'off']);
    expect(rig.presses).toStrictEqual([]);
  });

  it('stop while the model loads closes the late model (Req 10.5)', async () => {
    const rig = setup();
    rig.source.start();
    const stream = createFakeStream();
    rig.devices.cameraRequests[0]?.resolve(stream);
    await flushPromises();
    rig.source.stop();
    expect(stream.tracks[0]?.readyState).toBe('ended');
    rig.devices.landmarkerRequests[0]?.resolve(rig.landmarker);
    await flushPromises();
    expect(rig.landmarker.closes).toBe(1);
    expect(rig.statuses).toStrictEqual(['starting', 'off']);
  });

  it('stop turns every track off and stops frames (Req 9.7)', async () => {
    const rig = setup();
    rig.source.start();
    const stream = await rig.ready();
    rig.source.stop();
    expect(stream.tracks.every((track) => track.readyState === 'ended')).toBe(true);
    expect(rig.devices.loops[0]?.stopped).toBe(true);
    expect(rig.landmarker.closes).toBe(1);
    expect(rig.statuses).toStrictEqual(['starting', 'active', 'off']);
    expect(rig.page.listenerCount()).toBe(0);
    expect(stream.tracks[0]?.listenerCount()).toBe(0);
  });
});

describe('Blink_Source readiness limit', () => {
  it('fails 30 s after the stream opens; the permission wait does not count (Req 9.11)', async () => {
    const rig = setup();
    rig.source.start();
    // The permission prompt stays open for a minute.
    rig.clock.set(60_000);
    rig.scheduler.runDue(60_000);
    expect(rig.statuses).toStrictEqual(['starting']);

    const stream = createFakeStream();
    rig.devices.cameraRequests[0]?.resolve(stream);
    await flushPromises();
    rig.clock.set(60_000 + LANDMARKER_READY_LIMIT_MS - 1);
    rig.scheduler.runDue(rig.clock.now());
    expect(rig.statuses).toStrictEqual(['starting']);
    rig.clock.set(60_000 + LANDMARKER_READY_LIMIT_MS);
    rig.scheduler.runDue(rig.clock.now());
    expect(rig.statuses).toStrictEqual(['starting', 'error']);
    expect(stream.tracks[0]?.readyState).toBe('ended');

    // The late model is closed with no further status (Req 10.5).
    rig.devices.landmarkerRequests[0]?.resolve(rig.landmarker);
    await flushPromises();
    expect(rig.landmarker.closes).toBe(1);
    expect(rig.statuses).toStrictEqual(['starting', 'error']);
  });
});

describe('Blink_Source visibility and focus', () => {
  it('hide turns the camera off synchronously and visible reopens it (Req 9.9, 9.10)', async () => {
    const rig = setup();
    rig.source.start();
    const first = await rig.ready();
    rig.page.hide();
    expect(first.tracks[0]?.readyState).toBe('ended');
    expect(rig.devices.loops[0]?.stopped).toBe(true);
    expect(rig.landmarker.closes).toBe(1);
    expect(rig.statuses).toStrictEqual(['starting', 'active']);

    rig.page.show();
    expect(rig.statuses).toStrictEqual(['starting', 'active', 'starting']);
    expect(rig.devices.cameraRequests).toHaveLength(2);
    await rig.ready();
    expect(rig.statuses).toStrictEqual(['starting', 'active', 'starting', 'active']);
  });

  it('hide ends a held press with one up at the clock and discards the Closure (Req 7.2, 9.9)', async () => {
    const rig = setup();
    rig.source.start();
    await rig.ready();
    rig.landmarker.scores = CLOSED;
    rig.devices.frame(100);
    rig.devices.frame(350);
    rig.clock.set(500);
    rig.page.hide();
    expect(plain(rig.presses)).toStrictEqual([
      { kind: 'down', t: 100, source: 'blink' },
      { kind: 'up', t: 500, source: 'blink' },
    ]);
  });

  it('a track ending because of hide is not a failure', async () => {
    const rig = setup();
    rig.source.start();
    const stream = await rig.ready();
    rig.page.hide();
    stream.tracks[0]?.end();
    expect(rig.statuses).toStrictEqual(['starting', 'active']);
  });

  it('ignores window blur, even while Held (Req 7.6)', async () => {
    const rig = setup();
    rig.source.start();
    await rig.ready();
    rig.landmarker.scores = CLOSED;
    rig.devices.frame(0);
    rig.devices.frame(300);
    rig.page.blur();
    expect(plain(rig.presses)).toStrictEqual([{ kind: 'down', t: 0, source: 'blink' }]);
    expect(rig.source.status()).toBe('active');
  });
});

describe('Blink_Source face status', () => {
  it("reports 'face-lost' with the camera open and 'active' when the face returns (Req 9.12, 9.13)", async () => {
    const rig = setup();
    rig.source.start();
    const stream = await rig.ready();
    rig.landmarker.scores = null;
    rig.devices.frame(10);
    rig.devices.frame(20);
    expect(rig.statuses).toStrictEqual(['starting', 'active', 'face-lost']);
    expect(stream.tracks[0]?.readyState).toBe('live');
    rig.landmarker.scores = { left: 0.1, right: undefined };
    rig.devices.frame(30);
    expect(rig.statuses).toStrictEqual(['starting', 'active', 'face-lost']);
    rig.landmarker.scores = OPEN;
    rig.devices.frame(40);
    expect(rig.statuses).toStrictEqual(['starting', 'active', 'face-lost', 'active']);
  });
});

describe('Blink_Source failures', () => {
  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'no-camera'],
    ['OverconstrainedError', 'no-camera'],
    ['NotReadableError', 'error'],
    ['AbortError', 'error'],
  ] as const)('maps a camera %s to %s (Req 10.2 to 10.4)', async (name, status) => {
    const rig = setup();
    rig.source.start();
    rig.devices.cameraRequests[0]?.reject(new DOMException('camera', name));
    await flushPromises();
    expect(rig.statuses).toStrictEqual(['starting', status]);
    expect(rig.devices.landmarkerRequests).toHaveLength(0);
  });

  it('maps errors without a name to error', () => {
    expect(cameraFailureStatus('nope')).toBe('error');
    expect(cameraFailureStatus(null)).toBe('error');
    expect(cameraFailureStatus({ name: 'NotAllowedError' })).toBe('permission-denied');
  });

  it('a model load failure releases the camera and reports error (Req 9.3, 10.4, 10.6)', async () => {
    const rig = setup();
    rig.source.start();
    const stream = createFakeStream(2);
    rig.devices.cameraRequests[0]?.resolve(stream);
    await flushPromises();
    rig.devices.landmarkerRequests[0]?.reject(new Error('404 face_landmarker.task'));
    await flushPromises();
    expect(rig.statuses).toStrictEqual(['starting', 'error']);
    expect(stream.tracks.map((track) => track.readyState)).toStrictEqual(['ended', 'ended']);
    expect(rig.scheduler.pending()).toBe(0);
  });

  it('detect throwing fails with error', async () => {
    const rig = setup();
    rig.source.start();
    const stream = await rig.ready();
    rig.landmarker.throwOnDetect = true;
    rig.devices.frame(5);
    expect(rig.statuses).toStrictEqual(['starting', 'active', 'error']);
    expect(stream.tracks[0]?.readyState).toBe('ended');
    expect(rig.devices.loops[0]?.stopped).toBe(true);
  });

  it('a track that ends by itself fails with error (Req 10.4)', async () => {
    const rig = setup();
    rig.source.start();
    const stream = await rig.ready();
    stream.tracks[0]?.end();
    expect(rig.statuses).toStrictEqual(['starting', 'active', 'error']);
  });

  it('a failure while Held emits one up at the clock before the status (Req 10.6, 10.7)', async () => {
    const rig = setup();
    const order: string[] = [];
    rig.source.onPress((event) => order.push(`${event.kind}@${event.t}`));
    rig.source.onStatus((status) => order.push(status));
    rig.source.start();
    const stream = await rig.ready();
    rig.landmarker.scores = CLOSED;
    rig.devices.frame(100);
    rig.devices.frame(400);
    rig.clock.set(777);
    stream.tracks[0]?.end();
    expect(order).toStrictEqual(['starting', 'active', 'down@100', 'up@777', 'error']);
  });

  it('a failure status is sticky across visibility and leaves other sources alone (Req 10.8)', async () => {
    const rig = setup();
    const arbiter = createArbiter(rig.clock.now);
    const keyboard = createFakePressSource('keyboard');
    arbiter.connect(rig.source);
    arbiter.connect(keyboard);
    keyboard.emit(pressEvent('down', 0, 'keyboard'));

    rig.source.start();
    rig.devices.cameraRequests[0]?.reject(new DOMException('denied', 'NotAllowedError'));
    await flushPromises();
    rig.page.hide();
    rig.page.show();
    expect(rig.devices.cameraRequests).toHaveLength(1);
    expect(rig.source.status()).toBe('permission-denied');
    expect(arbiter.holder()).toBe('keyboard');
    rig.devices.frame(50);
    expect(rig.presses).toStrictEqual([]);
  });

  it('start retries from a failure and stop turns it off (Req 10.9)', async () => {
    const rig = setup();
    rig.source.start();
    rig.devices.cameraRequests[0]?.reject(new DOMException('none', 'NotFoundError'));
    await flushPromises();
    rig.source.start();
    expect(rig.statuses).toStrictEqual(['starting', 'no-camera', 'starting']);
    rig.devices.cameraRequests[1]?.reject(new DOMException('none', 'NotFoundError'));
    await flushPromises();
    rig.source.stop();
    expect(rig.statuses).toStrictEqual(['starting', 'no-camera', 'starting', 'no-camera', 'off']);
    expect(rig.presses).toStrictEqual([]);
  });

  it('a throwing status subscriber does not break the source (Req 10.10)', async () => {
    const rig = setup();
    rig.source.onStatus(() => {
      throw new Error('subscriber failure');
    });
    expect(() => rig.source.start()).not.toThrow();
    await rig.ready();
    expect(rig.source.status()).toBe('active');
    expect(() => rig.source.stop()).not.toThrow();
  });

  it('applies valid settings and rejects invalid ones', () => {
    const rig = setup();
    expect(rig.source.setMinPressDuration(500)).toStrictEqual({ ok: true, value: 500 });
    expect(rig.source.setMinPressDuration(10).ok).toBe(false);
    expect(rig.source.setThresholds(0.6, 0.3)).toStrictEqual({ ok: true, value: { close: 0.6, open: 0.3 } });
    expect(rig.source.setThresholds(0.3, 0.6).ok).toBe(false);
  });
});
