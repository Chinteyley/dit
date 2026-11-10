// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_VOICE_TEXT, SAVE_FAILED_TEXT, type StatusMessage } from '@/hooks/session-controller';
import { INERT_SESSION_API, SessionApiContext } from './session-api-context';
import { StatusMessages } from './StatusMessages';

afterEach(cleanup);

const MESSAGES: readonly StatusMessage[] = [
  { id: 'save-failed', text: SAVE_FAILED_TEXT },
  { id: 'no-voice', text: NO_VOICE_TEXT },
  { id: 'source-blink', text: 'Blink input: camera permission denied.' },
];

function renderMessages(messages: readonly StatusMessage[] = MESSAGES) {
  const onDismiss = vi.fn();
  const focusKeyingSurface = vi.fn();
  render(
    <SessionApiContext value={{ ...INERT_SESSION_API, focusKeyingSurface }}>
      <StatusMessages messages={messages} onDismiss={onDismiss} />
    </SessionApiContext>,
  );
  return { onDismiss, focusKeyingSurface };
}

describe('StatusMessages', () => {
  it('lists each message once under "Status" (Req 16.9, 22.12)', () => {
    renderMessages();
    const items = within(screen.getByRole('list', { name: 'Status' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    for (const message of MESSAGES) expect(screen.getAllByText(message.text)).toHaveLength(1);
  });

  it('dismisses a message by id and returns focus to the Keying_Surface (Req 17.6, 21.1)', async () => {
    const user = userEvent.setup();
    const { onDismiss, focusKeyingSurface } = renderMessages();
    const buttons = screen.getAllByRole('button', { name: 'Dismiss' });
    expect(buttons).toHaveLength(3);
    await user.click(buttons[2] as HTMLElement);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('source-blink');
    expect(focusKeyingSurface).toHaveBeenCalledTimes(1);
  });

  it('describes each Dismiss button with its message', () => {
    renderMessages([{ id: 'no-voice', text: NO_VOICE_TEXT }]);
    const button = screen.getByRole('button', { name: 'Dismiss' });
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe(NO_VOICE_TEXT);
  });

  it('is not a live region and has no status role (Req 12.8)', () => {
    renderMessages();
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(0);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders nothing without messages', () => {
    renderMessages([]);
    expect(screen.queryByRole('list', { name: 'Status' })).toBeNull();
  });
});
