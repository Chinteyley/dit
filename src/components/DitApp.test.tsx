// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextFrames, pressCalls, renderDitApp } from './dit-app.test-support';
import { SessionApiContext } from './session-api-context';

const mediapipe = vi.hoisted(() => ({ imports: 0 }));
vi.mock('@mediapipe/tasks-vision', () => {
  mediapipe.imports += 1;
  return {};
});

afterEach(cleanup);

/** Starts blink from a click, as onboarding-and-safety's "Turn on camera" button will. */
function StartBlinkButton() {
  const { sources } = useContext(SessionApiContext);
  return (
    <button type="button" onClick={() => sources.startBlink()}>
      Start blink
    </button>
  );
}

describe('DitApp', () => {
  it('has exactly one polite live region (Req 12.8)', () => {
    renderDitApp();
    const regions = document.querySelectorAll('[aria-live]');
    expect(regions).toHaveLength(1);
    expect(regions[0]?.getAttribute('aria-live')).toBe('polite');
  });

  it('has exactly one h1 "Dit", also while the Settings dialog is open (Req 22.8)', async () => {
    const rig = renderDitApp();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Dit' })).toBeDefined();
    await rig.user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('starts with focus on the Keying_Surface (Req 10.2)', () => {
    const rig = renderDitApp();
    expect(document.activeElement).toBe(rig.surface());
  });

  it('opens Settings, closes it with Escape and returns focus to the Keying_Surface (Req 20.1, 20.2, 20.8, 21.4)', async () => {
    const rig = renderDitApp();
    await rig.user.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    await rig.user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(rig.surface()));
  });

  it('keys Morse with Space on the Keying_Surface, and the pressed state follows (Req 10.3, 10.4)', async () => {
    const rig = renderDitApp();
    await rig.user.keyboard('[Space>]');
    expect(rig.surface().dataset['pressed']).toBe('true');
    await rig.user.keyboard('[/Space]');
    expect(rig.surface().dataset['pressed']).toBe('false');
    expect(pressCalls(rig)).toStrictEqual(['press', 'release']);
  });

  it('after a suggestion is clicked, Space keys Morse and does not activate it again (Req 13.7, 21.1, 21.6)', async () => {
    const rig = renderDitApp();
    rig.engines.script.push([{ type: 'char', char: 'h' }]);
    await rig.user.keyboard(' ');
    expect(screen.getByRole('region', { name: 'Typing' }).textContent).toContain('h');
    expect(rig.client.updates.at(-1)?.text).toBe('h');
    act(() => rig.client.deliver({ text: 'h', suggestions: ['Hello.', 'Help me.'], source: 'on-device' }));
    expect(screen.getByText('Source: On-device')).toBeDefined();

    await rig.user.click(screen.getByRole('button', { name: 'Help me.' }));
    expect(rig.speechOutput.calls.filter((call) => call.kind === 'speak')).toStrictEqual([
      { kind: 'speak', sentence: 'Help me.', voiceURI: null, rate: 1 },
    ]);
    await waitFor(() => expect(document.activeElement).toBe(rig.surface()));

    const before = pressCalls(rig).length;
    await rig.user.keyboard(' ');
    expect(pressCalls(rig).slice(before)).toStrictEqual(['press', 'release']);
    const history = screen.getByRole('list', { name: 'Conversation history' });
    expect(within(history).getAllByRole('listitem')).toHaveLength(1);
    expect(rig.speechOutput.calls.filter((call) => call.kind === 'speak')).toHaveLength(1);
  });

  it('adds a submitted partner line to the conversation history (Req 6.1, 19.4, 21.2)', async () => {
    const rig = renderDitApp();
    await rig.user.type(screen.getByRole('textbox', { name: 'Your line' }), 'Are you warm enough?{Enter}');
    const history = screen.getByRole('list', { name: 'Conversation history' });
    const [item] = within(history).getAllByRole('listitem');
    expect(within(item as HTMLElement).getByText('Partner')).toBeDefined();
    expect(within(item as HTMLElement).getByText('Are you warm enough?')).toBeDefined();
    expect(pressCalls(rig)).toStrictEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(rig.surface()));
  });

  it('shows a message for a failing input source (Req 22.12)', async () => {
    const rig = renderDitApp({ overlay: <StartBlinkButton /> });
    expect(screen.queryByRole('list', { name: 'Status' })).toBeNull();
    // jsdom has no camera API, so the Blink_Source reports 'unsupported'.
    await rig.user.click(screen.getByRole('button', { name: 'Start blink' }));
    const status = await screen.findByRole('list', { name: 'Status' });
    expect(within(status).getByText('Blink input: not supported in this browser.')).toBeDefined();
    expect(mediapipe.imports).toBe(0);
  });

  it('puts the legend inside the Commands box and renders the overlay', () => {
    renderDitApp({ legend: <p>AR speak</p>, overlay: <p>An overlay</p> });
    expect(within(screen.getByRole('complementary', { name: 'Commands' })).getByText('AR speak')).toBeDefined();
    expect(screen.getByText('An overlay')).toBeDefined();
  });

  it('lets the partner turn Listen on from the main screen and returns focus (Req 18.3, 21.1)', async () => {
    const rig = renderDitApp();
    await rig.user.click(screen.getByRole('switch', { name: 'Listen' }));
    expect(rig.speechInput.calls).toStrictEqual(['start']);
    expect(screen.getByRole('switch', { name: 'Listen' }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(rig.surface()));
  });

  it('dismisses a status message and returns focus to the Keying_Surface', async () => {
    const rig = renderDitApp({ overlay: <StartBlinkButton /> });
    await rig.user.click(screen.getByRole('button', { name: 'Start blink' }));
    await rig.user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('list', { name: 'Status' })).toBeNull();
    await nextFrames();
    expect(document.activeElement).toBe(rig.surface());
  });

  it('draws the Partner_Display and the Stream_Band on the Composer_Panel, outside the Keying_Surface (Req 24.5)', () => {
    const rig = renderDitApp();
    const display = screen.getByRole('group', { name: 'Partner display' });
    const indicator = screen.getByRole('img', { name: 'Press indicator', hidden: true });
    expect(rig.surface().contains(display)).toBe(false);
    expect(rig.surface().contains(indicator)).toBe(false);
    expect(within(display).getByRole('heading', { name: 'Typing' })).toBeDefined();
    expect(document.activeElement).toBe(rig.surface());
  });

  it('shows the pressed state on the Press_Indicator while a press is held (Req 10.3, 10.4, 25.2)', async () => {
    const rig = renderDitApp();
    const state = (): string | undefined => screen.getByRole('img', { name: 'Press indicator', hidden: true }).dataset['state'];
    expect(state()).toBe('idle');
    await rig.user.keyboard('[Space>]');
    expect(state()).toBe('pressed');
    await rig.user.keyboard('[/Space]');
    expect(state()).toBe('idle');
  });

  it('puts the regions in reading order, with the history before the partner controls (Req 24.1, 28.4)', () => {
    renderDitApp({ legend: <p>AR speak</p> });
    const regions = [
      screen.getByRole('group', { name: 'Partner display' }),
      screen.getByRole('list', { name: 'Suggestions' }),
      screen.getByRole('complementary', { name: 'Commands' }),
      screen.getByRole('region', { name: 'Partner controls' }),
    ];
    regions.slice(1).forEach((region, index) => {
      const before = regions[index] as HTMLElement;
      expect(before.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING, region.tagName).toBeTruthy();
      expect(before.contains(region)).toBe(false);
    });
    const history = screen.getByRole('list', { name: 'Conversation history' });
    const controls = screen.getByRole('region', { name: 'Partner controls' });
    expect(history.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(controls.contains(history)).toBe(false);
  });
});
