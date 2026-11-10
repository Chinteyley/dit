/**
 * Test rig for DitApp (test-only, never imported by app code): every browser adapter behind the
 * session is a fake (FakeEngine, FakeClient, speech fakes, a manual scheduler and in-memory
 * storage), while the real input layer listens to jsdom key and pointer events. The stored
 * settings set every minimum press duration to 0, so a keydown and keyup in the same tick make a
 * down and an up Press_Event.
 */
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  createConversationStorage,
  memoryBackend,
  type ConversationStorage,
  type SettingsRecord,
} from '@/lib/conversation';
import { createFakeClient, fakeEngineFactory, type FakeClient } from '@/lib/conversation/test-support';
import { createManualScheduler, type ManualScheduler } from '@/lib/input';
import { performanceClock } from '@/lib/input/browser';
import { createFakeSpeechInput, createFakeSpeechOutput, type FakeSpeechInput, type FakeSpeechOutput } from '@/lib/speech/fakes';
import { DitApp, type DitAppProps } from './DitApp';

export const ZERO_MIN_SETTINGS: SettingsRecord = Object.freeze({
  ...DEFAULT_SETTINGS,
  input: Object.freeze({
    ...DEFAULT_SETTINGS.input,
    minPressDuration: Object.freeze({ keyboard: 0, switch: 0, pointer: 0, blink: 200 }),
  }),
});

export interface DitAppRig {
  readonly engines: ReturnType<typeof fakeEngineFactory>;
  readonly client: FakeClient;
  readonly speechOutput: FakeSpeechOutput;
  readonly speechInput: FakeSpeechInput;
  readonly scheduler: ManualScheduler;
  readonly storage: ConversationStorage;
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly view: ReturnType<typeof render>;
  /** The Keying_Surface, found by role and name. */
  surface(): HTMLElement;
  /** Renders the same DitApp element again (the session stays mounted). */
  rerender(): void;
}

export function renderDitApp(props: Omit<DitAppProps, 'sessionOverrides'> = {}): DitAppRig {
  const engines = fakeEngineFactory();
  const client = createFakeClient();
  const speechOutput = createFakeSpeechOutput();
  const speechInput = createFakeSpeechInput();
  const scheduler = createManualScheduler(performanceClock);
  const storage = createConversationStorage(memoryBackend({ [SETTINGS_KEY]: JSON.stringify(ZERO_MIN_SETTINGS) }));
  const user = userEvent.setup();
  const overrides = {
    scheduler,
    createEngine: engines.create,
    createClient: client.create,
    speechOutput,
    speechInput,
    storage,
  };
  // A fresh element each time, so a rerender really renders DitApp again.
  const element = () => <DitApp {...props} sessionOverrides={overrides} />;
  const view = render(element());
  return {
    engines,
    client,
    speechOutput,
    speechInput,
    scheduler,
    storage,
    user,
    view,
    surface: () => screen.getByRole('button', { name: 'Keying surface' }),
    rerender: () => view.rerender(element()),
  };
}

/** Engine calls other than reset, as kinds in order. */
export function pressCalls(rig: DitAppRig): string[] {
  return rig.engines.current().calls.flatMap((call) => (call.kind === 'press' || call.kind === 'release' ? [call.kind] : []));
}

/** Waits for two animation frames, long enough for any focusKeyingSurface() to have run. */
export async function nextFrames(): Promise<void> {
  for (let i = 0; i < 2; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
