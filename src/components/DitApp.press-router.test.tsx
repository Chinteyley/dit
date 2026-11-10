// @vitest-environment jsdom
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PressRouter, SessionPressTarget } from '@/lib/conversation';
import { pressEvent, type PressEvent } from '@/lib/input';
import { pressCalls, renderDitApp } from './dit-app.test-support';

afterEach(cleanup);

/** Records connect() and route() calls and forwards nothing by itself. */
function recordingRouter() {
  const routed: PressEvent[] = [];
  const targets: SessionPressTarget[] = [];
  let disconnects = 0;
  const router: PressRouter = {
    connect(session) {
      targets.push(session);
      return () => {
        disconnects += 1;
      };
    },
    route(event) {
      routed.push(event);
    },
  };
  return { router, routed, targets, disconnects: () => disconnects };
}

describe('DitApp with a pressRouter (onboarding O12.1, O12.10)', () => {
  it('connects once with a target that reaches the session controller', () => {
    const fake = recordingRouter();
    const rig = renderDitApp({ pressRouter: fake.router });
    expect(fake.targets).toHaveLength(1);
    const [target] = fake.targets;
    act(() => target?.handlePress(pressEvent('down', 1_000, 'keyboard')));
    expect(pressCalls(rig)).toStrictEqual(['press']);
    expect(rig.surface().dataset['pressed']).toBe('true');
    const resetsBefore = rig.engines.current().resets;
    act(() => target?.discardInput());
    expect(rig.engines.current().resets).toBe(resetsBefore + 1);
  });

  it('sends every Press_Event to route(), in order, and nothing to the session directly (Req 8.1)', async () => {
    const fake = recordingRouter();
    const rig = renderDitApp({ pressRouter: fake.router });
    await rig.user.keyboard(' ');
    expect(fake.routed.map((event) => event.kind)).toStrictEqual(['down', 'up']);
    expect(fake.routed.every((event) => event.source === 'keyboard')).toBe(true);
    expect(pressCalls(rig)).toStrictEqual([]);
  });

  it('disconnects on unmount', () => {
    const fake = recordingRouter();
    const rig = renderDitApp({ pressRouter: fake.router });
    expect(fake.disconnects()).toBe(0);
    rig.view.unmount();
    expect(fake.disconnects()).toBe(1);
  });

  it('drops an event whose routing throws, and keeps going', async () => {
    let throwing = true;
    const routed: PressEvent[] = [];
    let session: SessionPressTarget | null = null;
    const router: PressRouter = {
      connect(target) {
        session = target;
        return () => undefined;
      },
      route(event) {
        if (throwing) throw new Error('router failed');
        routed.push(event);
        session?.handlePress(event);
      },
    };
    const rig = renderDitApp({ pressRouter: router });
    await rig.user.keyboard(' ');
    expect(pressCalls(rig)).toStrictEqual([]);
    throwing = false;
    await rig.user.keyboard(' ');
    expect(routed.map((event) => event.kind)).toStrictEqual(['down', 'up']);
    expect(pressCalls(rig)).toStrictEqual(['press', 'release']);
    expect(screen.getByRole('button', { name: 'Keying surface' })).toBe(rig.surface());
  });

  it('without the prop, Space reaches the engine as before', async () => {
    const rig = renderDitApp();
    await rig.user.keyboard(' ');
    expect(pressCalls(rig)).toStrictEqual(['press', 'release']);
  });
});
