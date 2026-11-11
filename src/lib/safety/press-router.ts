/**
 * The Press_Router (design "lib/safety/press-router.ts", Requirement 12): a pure decision that
 * picks the one consumer of each Press_Event (alarm, then onboarding, then session), plus a small
 * runtime that implements the conversation-ui PressRouter seam.
 */
import type { PressRouter, SessionPressTarget } from '@/lib/conversation';
import type { PressEvent } from '@/lib/input';

export type Consumer = 'alarm' | 'onboarding' | 'session';

export interface RouterState {
  /** The consumer that received the latest `down`, until the next `up`. */
  readonly downOwner: Consumer | null;
}

export const INITIAL_ROUTER: RouterState = Object.freeze({ downOwner: null });

export interface RouteContext {
  readonly alarmActive: boolean;
  readonly onboardingOpen: boolean;
}

export interface RouteResult {
  readonly state: RouterState;
  /** null only for an `up` whose `down` went to a different consumer (Requirement 12.8). */
  readonly to: Consumer | null;
}

const OWNED: Readonly<Record<Consumer, RouterState>> = Object.freeze({
  alarm: Object.freeze({ downOwner: 'alarm' }),
  onboarding: Object.freeze({ downOwner: 'onboarding' }),
  session: Object.freeze({ downOwner: 'session' }),
});

/** Priority at arrival: the alarm while active, else onboarding while open, else the session (12.1). */
export function consumerFor(ctx: RouteContext): Consumer {
  if (ctx.alarmActive) return 'alarm';
  return ctx.onboardingOpen ? 'onboarding' : 'session';
}

/** Pure. A `down` always goes to the priority consumer; an `up` only to the consumer of its `down`. */
export function routePress(s: RouterState, e: PressEvent, ctx: RouteContext): RouteResult {
  const target = consumerFor(ctx);
  if (e.kind === 'down') return { state: OWNED[target], to: target };
  const to = s.downOwner === null || s.downOwner === target ? target : null;
  return { state: INITIAL_ROUTER, to };
}

export interface SafetyPressRouter extends PressRouter {
  /** Called synchronously by the Onboarding controller whenever isOpen() changes (Requirement 12.10). */
  onOnboardingOpenChange(): void;
}

export interface PressConsumer {
  handlePress(e: PressEvent): void;
}

export function createPressRouter(deps: {
  readonly alarm: PressConsumer & { isActive(): boolean };
  readonly onboarding: PressConsumer & { isOpen(): boolean };
}): SafetyPressRouter {
  let state: RouterState = INITIAL_ROUTER;
  let session: SessionPressTarget | null = null;

  return {
    connect(target) {
      session = target;
      return () => {
        if (session === target) session = null;
      };
    },
    route(e) {
      // Defensive: DitApp connects before any source starts, so this drop never happens in the app.
      const target = session;
      if (target === null) return;
      // Read both flags when the event arrives (Requirement 12.1); the alarm wins without asking onboarding.
      const alarmActive = deps.alarm.isActive();
      const ctx: RouteContext = { alarmActive, onboardingOpen: !alarmActive && deps.onboarding.isOpen() };
      const routed = routePress(state, e, ctx);
      state = routed.state;
      switch (routed.to) {
        case 'alarm':
          deps.alarm.handlePress(e);
          return;
        case 'onboarding':
          deps.onboarding.handlePress(e);
          return;
        case 'session':
          target.handlePress(e);
          return;
        case null:
          return;
      }
    },
    onOnboardingOpenChange() {
      try {
        session?.discardInput();
      } catch {
        // The session keeps working; a failed discard must not block opening or closing the flow.
      }
    },
  };
}
