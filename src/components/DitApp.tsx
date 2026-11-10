'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import {
  DEFAULT_ENABLED_SOURCES,
  inertAlarmHandler,
  inertUnknownPatternHandler,
  sessionOnlyRouter,
  type AlarmHandler,
  type EnabledSources,
  type PressRouter,
  type SourceControl,
  type UnknownPatternHandler,
} from '@/lib/conversation';
import { isFailureStatus, type PressEvent, type SourceKind, type SourceStatus, type Unsubscribe } from '@/lib/input';
import { performanceClock } from '@/lib/input/browser';
import { useInputSources } from '@/hooks/useInputSources';
import { useMorseSession, type SessionOverrides } from '@/hooks/useMorseSession';
import { HistoryView } from './HistoryView';
import { KeyingSurface } from './KeyingSurface';
import { LetterTrail } from './LetterTrail';
import { ListenToggle } from './ListenToggle';
import { LiveRegion } from './LiveRegion';
import { PartnerDisplay } from './PartnerDisplay';
import { PartnerLineForm } from './PartnerLineForm';
import { SessionApiContext, type SessionApiContextValue } from './session-api-context';
import { SettingsPanel } from './SettingsPanel';
import { StatusMessages } from './StatusMessages';
import { SuggestionList } from './SuggestionList';
import { SymbolStream } from './SymbolStream';

export interface CloseSettingsOptions {
  /** False closes the panel without moving focus (the caller moves it, for example into onboarding). */
  readonly focusKeyingSurface?: boolean;
}

export interface SettingsActionsApi {
  /** Closes the Settings_Panel; without options it then focuses the Keying_Surface, like its own close paths. */
  closeSettings(opts?: CloseSettingsOptions): void;
}

export interface DitAppProps {
  /** onboarding-and-safety plug-ins; each defaults to an inert stand-in. */
  readonly alarm?: AlarmHandler;
  readonly unknownPattern?: UnknownPatternHandler;
  /** Rendered inside <aside aria-label="Commands">, a box at least 7rem high (Req 22.7). */
  readonly legend?: ReactNode;
  /** Rendered last, after everything else (alarm card, cheat sheet). */
  readonly overlay?: ReactNode;
  /** Sits between the input layer and the session (onboarding O12.1); read once, at mount. */
  readonly pressRouter?: PressRouter;
  /** Extra Settings_Panel actions after "Clear history" (onboarding O11.6). */
  readonly extraSettingsActions?: (api: SettingsActionsApi) => ReactNode;
  /** Test seam: replaces the browser adapters behind the session; read once, at mount. */
  readonly sessionOverrides?: SessionOverrides;
}

const ALL_OFF: Readonly<Record<SourceKind, SourceStatus>> = Object.freeze({
  keyboard: 'off',
  switch: 'off',
  pointer: 'off',
  blink: 'off',
});

/** startBlink() must run inside a user action (input-sources Req 9.1); enforcing that is the caller's job. */
function warnWithoutUserActivation(): void {
  if (process.env.NODE_ENV === 'production') return;
  if (typeof navigator !== 'undefined' && navigator.userActivation?.isActive === false) {
    console.warn('Dit: call startBlink() from a click, keydown or pointerdown handler, or the camera may be refused.');
  }
}

interface SourceHub {
  readonly control: SourceControl;
  subscribeFlags(listener: () => void): Unsubscribe;
  flags(): EnabledSources;
  /** After each commit: keeps the rendered statuses and tells onChange listeners about any change. */
  publish(flags: EnabledSources, statuses: Readonly<Record<SourceKind, SourceStatus>>): void;
}

/**
 * The enabled flags for useInputSources and the SourceControl in SessionApiContext (design
 * "Integration points" 2). The flags are an external store, so enabled() is current right after
 * a setter runs and React renders the new flags straight away. Blink starts off: no camera
 * request on load (O11.12).
 */
function createSourceHub(): SourceHub {
  let flags: EnabledSources = DEFAULT_ENABLED_SOURCES;
  let statuses: Readonly<Record<SourceKind, SourceStatus>> = ALL_OFF;
  let published: { readonly flags: EnabledSources; readonly statuses: typeof statuses } = { flags, statuses };
  const flagListeners = new Set<() => void>();
  const changeListeners = new Set<() => void>();

  const setFlags = (next: EnabledSources): void => {
    if (
      next.keyboard === flags.keyboard &&
      next.switch === flags.switch &&
      next.pointer === flags.pointer &&
      next.blink === flags.blink
    ) {
      return;
    }
    flags = Object.freeze({ keyboard: next.keyboard, switch: next.switch, pointer: next.pointer, blink: next.blink });
    for (const listener of [...flagListeners]) listener();
  };

  const control: SourceControl = {
    enabled: () => flags,
    statuses: () => statuses,
    setEnabled(kind, on) {
      setFlags({ ...flags, [kind]: on });
    },
    startBlink() {
      warnWithoutUserActivation();
      if (flags.blink && isFailureStatus(statuses.blink)) {
        // "Try again" (O11.14): commit blink off first, so the source stops and then starts again.
        flushSync(() => setFlags({ ...flags, blink: false }));
      }
      setFlags({ ...flags, blink: true });
    },
    stopBlink() {
      setFlags({ ...flags, blink: false });
    },
    restore(next) {
      setFlags(next);
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
  };

  return {
    control,
    subscribeFlags(listener) {
      flagListeners.add(listener);
      return () => {
        flagListeners.delete(listener);
      };
    },
    flags: () => flags,
    publish(renderedFlags, renderedStatuses) {
      statuses = renderedStatuses;
      if (published.flags === renderedFlags && published.statuses === renderedStatuses) return;
      published = { flags: renderedFlags, statuses: renderedStatuses };
      for (const listener of [...changeListeners]) {
        try {
          listener();
        } catch {
          // One subscriber must not break the others.
        }
      }
    },
  };
}

/**
 * The client root (design "Components", task 13): wires the input layer, the optional
 * Press_Router and the session controller together, provides SessionApiContext, and lays out the
 * screen. One column below 1024 px or in portrait; at 1024 px and wider in landscape, a 3:2 grid
 * with the partner display, stream, suggestions and Keying_Surface on the left and the command
 * legend, history and partner controls on the right (design "Screen layout").
 */
export function DitApp(props: DitAppProps) {
  const { legend, overlay, extraSettingsActions } = props;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const surfaceId = useId();
  const [fallback] = useState(() => ({ alarm: inertAlarmHandler(), unknownPattern: inertUnknownPatternHandler() }));
  const [router] = useState(() => props.pressRouter ?? sessionOnlyRouter());
  const [hub] = useState(createSourceHub);
  const enabled = useSyncExternalStore(hub.subscribeFlags, hub.flags, hub.flags);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // One stable pendingSince for the controller and the context; it reads the input layer's latest.
  const pendingRef = useRef<() => number | null>(() => null);
  const pendingSince = useCallback((): number | null => pendingRef.current(), []);

  const { snapshot, controller, storage, ready } = useMorseSession({
    alarm: props.alarm ?? fallback.alarm,
    unknownPattern: props.unknownPattern ?? fallback.unknownPattern,
    pendingSince,
    clock: performanceClock,
    overrides: props.sessionOverrides,
  });

  const routePress = useCallback(
    (event: PressEvent) => {
      try {
        router.route(event);
      } catch {
        // The event is dropped and never reaches the session, so practice presses never type text.
      }
    },
    [router],
  );

  // The same storage object: the learned switch key lives inside the Settings_Record.
  const input = useInputSources({
    surfaceRef,
    enabled,
    settings: snapshot.settings.input,
    store: storage,
    onPress: routePress,
  });

  useEffect(() => {
    pendingRef.current = input.pendingSince;
  }, [input.pendingSince]);

  useEffect(
    () => router.connect({ handlePress: controller.handlePress, discardInput: controller.discardInput }),
    [router, controller],
  );

  useEffect(() => {
    controller.setSourceStatuses(input.statuses);
  }, [controller, input.statuses]);

  useEffect(() => {
    hub.publish(enabled, input.statuses);
  }, [hub, enabled, input.statuses]);

  const focusKeyingSurface = useCallback(() => {
    // After React commits, so the target is in place and no longer inert behind a dialog (Req 21).
    // Looked up by id, so this helper (and closeSettings, which a render prop receives) holds no ref.
    requestAnimationFrame(() => document.getElementById(surfaceId)?.focus({ preventScroll: true }));
  }, [surfaceId]);

  const closeSettings = useCallback(
    (opts?: CloseSettingsOptions) => {
      setSettingsOpen(false);
      if (opts?.focusKeyingSurface !== false) focusKeyingSurface();
    },
    [focusKeyingSurface],
  );

  const api = useMemo<SessionApiContextValue>(
    () => ({
      setInitialEstimates: controller.setInitialEstimates,
      focusKeyingSurface,
      controller,
      sources: hub.control,
      learner: input.learner,
      pendingSince,
    }),
    [controller, focusKeyingSurface, hub, input.learner, pendingSince],
  );

  const { session, settings } = snapshot;

  return (
    <SessionApiContext value={api}>
      <main className="mx-auto grid min-h-dvh w-full max-w-[120rem] grid-cols-1 gap-x-12 gap-y-6 px-5 py-6 [grid-template-areas:'header'_'primary'_'secondary'] sm:px-8 short:gap-y-4 short:py-4 wide:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] wide:grid-rows-[auto_minmax(0,1fr)] wide:px-12 wide:[grid-template-areas:'header_header'_'primary_secondary']">
        <div className="[grid-area:header]">
          <h1 className="text-2xl font-semibold tracking-tight text-text">
            Dit
            <span aria-hidden="true" className="ml-[0.1em] inline-block size-[0.3em] rounded-full bg-accent" />
          </h1>
        </div>

        <div className="flex min-w-0 flex-col gap-6 [grid-area:primary] short:gap-4">
          <StatusMessages messages={snapshot.messages} onDismiss={controller.dismissMessage} />
          <PartnerDisplay currentText={session.currentText} lastSpoken={session.lastSpoken} flip={settings.flip} />
          <div className="morse-scale rounded-3xl bg-surface px-6 py-4">
            <div className="flex h-[calc(var(--sym-u)*1.75+1.25rem)] items-start">
              <LetterTrail text={session.currentText} />
              <SymbolStream pattern={session.currentPattern} />
            </div>
          </div>
          <SuggestionList
            suggestions={session.suggestions}
            source={session.suggestionSource}
            highlight={session.highlight}
            currentText={session.currentText}
            onPick={controller.partnerPick}
          />
          <KeyingSurface id={surfaceId} pressed={snapshot.pressed} ref={surfaceRef} />
        </div>

        {/* Two columns: size-contained, so a long history scrolls inside instead of stretching the
            page; the inset padding keeps focus rings (3 px + 4 px offset) clear of the scroll clip. */}
        <div className="flex min-w-0 flex-col gap-8 [grid-area:secondary] wide:-m-2.5 wide:overflow-y-auto wide:p-2.5 wide:[contain:size]">
          <aside aria-label="Commands" className="min-h-28 shrink-0">
            {legend}
          </aside>
          <HistoryView turns={session.turns} hydrated={ready} />
          <section aria-label="Partner controls" className="flex w-full max-w-[min(100%,28rem)] shrink-0 flex-col gap-5">
            <ListenToggle listen={snapshot.listen} onToggle={controller.setListen} />
            <PartnerLineForm
              onSubmit={(text) => {
                controller.partnerLine(text);
                return true;
              }}
            />
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="min-h-(--size-target) self-start rounded-xl border border-border bg-raised px-5 text-lg font-medium text-text"
            >
              Settings
            </button>
          </section>
        </div>
      </main>

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        voices={snapshot.voices}
        listen={snapshot.listen}
        onClose={() => setSettingsOpen(false)}
        onPatch={controller.updateSettings}
        onListen={controller.setListen}
        onClearHistory={controller.clearHistory}
        extraActions={extraSettingsActions?.({ closeSettings })}
      />
      <LiveRegion announcement={snapshot.announcement} />
      {overlay}
    </SessionApiContext>
  );
}
