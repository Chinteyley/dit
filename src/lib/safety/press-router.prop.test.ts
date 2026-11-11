import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PressEvent } from '@/lib/input';
import { createAlarmHandler } from './alarm-handler';
import { createFakeCardView, createFakeChimePlayer } from './fakes';
import { INITIAL_ROUTER, createPressRouter, routePress, type Consumer, type RouteContext, type RouterState } from './press-router';
import { PROP_RUNS_HEAVY, arbRoutedPresses, arbRouterCommands } from './test-support';

interface Delivery {
  readonly to: Consumer;
  readonly event: PressEvent;
}

/** A runtime router with recording consumers whose flags the test sets before each event. */
function recordingRouter() {
  let ctx: RouteContext = { alarmActive: false, onboardingOpen: false };
  const deliveries: Delivery[] = [];
  const router = createPressRouter({
    alarm: { isActive: () => ctx.alarmActive, handlePress: (event) => deliveries.push({ to: 'alarm', event }) },
    onboarding: { isOpen: () => ctx.onboardingOpen, handlePress: (event) => deliveries.push({ to: 'onboarding', event }) },
  });
  router.connect({
    handlePress: (event) => deliveries.push({ to: 'session', event }),
    discardInput: () => undefined,
  });
  return {
    deliveries,
    route(event: PressEvent, next: RouteContext): void {
      ctx = next;
      router.route(event);
    },
  };
}

const priority = (ctx: RouteContext): Consumer =>
  ctx.alarmActive ? 'alarm' : ctx.onboardingOpen ? 'onboarding' : 'session';

describe('Press_Router properties', () => {
  // Feature: onboarding-and-safety, Property 5: No Press_Event reaches the Session_Engine or Guard_Engine while the alarm is active
  it('P5 no press reaches the session or guard engine while the alarm is active', () => {
    fc.assert(
      fc.property(arbRouterCommands({ max: 200 }), (commands) => {
        const card = createFakeCardView();
        const chime = createFakeChimePlayer();
        const handler = createAlarmHandler({ chime });
        handler.setView(card);
        let onboardingOpen = false;
        const deliveries: Delivery[] = [];
        const router = createPressRouter({
          alarm: {
            isActive: () => handler.isActive(),
            handlePress: (event) => {
              deliveries.push({ to: 'alarm', event });
              handler.handlePress(event);
            },
          },
          onboarding: { isOpen: () => onboardingOpen, handlePress: (event) => deliveries.push({ to: 'onboarding', event }) },
        });
        router.connect({
          handlePress: (event) => deliveries.push({ to: 'session', event }),
          discardInput: () => undefined,
        });
        /** Who received the latest down, as Requirement 12.8 defines it. */
        let owner: Consumer | null = null;
        let episodes = 0;
        for (const command of commands) {
          switch (command.kind) {
            case 'start':
              if (!handler.isActive()) episodes += 1;
              handler.start();
              break;
            case 'partner-dismiss':
              handler.partnerDismiss();
              break;
            case 'onboarding-open':
            case 'onboarding-close':
              onboardingOpen = command.kind === 'onboarding-open';
              router.onOnboardingOpenChange();
              break;
            case 'press': {
              const { event } = command;
              const active = handler.isActive();
              const before = deliveries.length;
              router.route(event);
              const delivered = deliveries.slice(before);
              if (active) {
                // From the first press after start up to the one that ends the episode: the
                // Alarm_Handler only. The one exception is an up whose down went to another
                // consumer before the alarm started; Requirement 12.8 drops it for everyone.
                const crossUp = event.kind === 'up' && owner !== null && owner !== 'alarm';
                expect(delivered).toEqual(crossUp ? [] : [{ to: 'alarm', event }]);
              }
              if (event.kind === 'down') owner = active ? 'alarm' : onboardingOpen ? 'onboarding' : 'session';
              else owner = null;
              break;
            }
          }
        }
        // Each episode shows and hides the card at most once, and the chime follows it.
        expect(card.calls.filter((call) => call === 'show')).toHaveLength(episodes);
        expect(chime.calls.filter((call) => call === 'start')).toHaveLength(episodes);
      }),
      { numRuns: PROP_RUNS_HEAVY },
    );
  });

  // Feature: onboarding-and-safety, Property 6: Each Press_Event goes to at most one consumer, chosen by priority at arrival
  it('P6 each press goes to at most one consumer chosen by priority at arrival', () => {
    fc.assert(
      fc.property(arbRoutedPresses({ order: 'mixed' }), (presses) => {
        const runtime = recordingRouter();
        let state: RouterState = INITIAL_ROUTER;
        for (const { event, ctx } of presses) {
          const before = runtime.deliveries.length;
          const routed = routePress(state, event, ctx);
          state = routed.state;
          if (routed.to === null) {
            expect(event.kind).toBe('up');
          } else {
            expect(routed.to).toBe(priority(ctx));
          }
          runtime.route(event, ctx);
          const delivered = runtime.deliveries.slice(before);
          if (routed.to === null) {
            expect(delivered).toEqual([]);
          } else {
            expect(delivered).toEqual([{ to: routed.to, event }]);
          }
        }
      }),
      { numRuns: PROP_RUNS_HEAVY },
    );
  });

  // Feature: onboarding-and-safety, Property 7: Cross-consumer ups are dropped and same-consumer pairs are kept
  it('P7 cross-consumer ups are dropped and same-consumer pairs are kept', () => {
    fc.assert(
      fc.property(arbRoutedPresses({ order: 'alternating' }), (presses) => {
        const runtime = recordingRouter();
        let state: RouterState = INITIAL_ROUTER;
        /** Consumer of the latest delivered down since the last up, or null. */
        let lastDown: Consumer | null = null;
        for (const { event, ctx } of presses) {
          const before = runtime.deliveries.length;
          runtime.route(event, ctx);
          const delivered = runtime.deliveries.slice(before);
          const routed = routePress(state, event, ctx);
          state = routed.state;
          if (event.kind === 'down') {
            expect(delivered).toEqual([{ to: priority(ctx), event }]);
            lastDown = priority(ctx);
          } else {
            const keep = lastDown === null || lastDown === priority(ctx);
            expect(delivered).toEqual(keep ? [{ to: priority(ctx), event }] : []);
            expect(routed.to).toBe(keep ? priority(ctx) : null);
            expect(state).toEqual({ downOwner: null });
            lastDown = null;
          }
        }
      }),
      { numRuns: PROP_RUNS_HEAVY },
    );
  });
});
