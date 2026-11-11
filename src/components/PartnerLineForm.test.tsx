// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INERT_SESSION_API, SessionApiContext } from './session-api-context';
import { PartnerLineForm } from './PartnerLineForm';

afterEach(cleanup);

function renderForm() {
  const onSubmit = vi.fn<(text: string) => boolean>(() => true);
  const focusKeyingSurface = vi.fn();
  render(
    <SessionApiContext value={{ ...INERT_SESSION_API, focusKeyingSurface }}>
      <PartnerLineForm onSubmit={onSubmit} />
    </SessionApiContext>,
  );
  const field = screen.getByRole('textbox', { name: 'Your line' }) as HTMLInputElement;
  const button = screen.getByRole('button', { name: 'Add line' });
  return { onSubmit, focusKeyingSurface, field, button, user: userEvent.setup() };
}

describe('PartnerLineForm', () => {
  it('has a labelled text field and an "Add line" button (Req 19.1)', () => {
    const { field, button } = renderForm();
    expect(field.type).toBe('text');
    expect(button.getAttribute('type')).toBe('submit');
  });

  it('types spaces, submits the trimmed line once on Enter, clears and returns focus (Req 19.2 to 19.5, 21.2)', async () => {
    const { onSubmit, focusKeyingSurface, field, user } = renderForm();
    await user.type(field, '  are you cold? {Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('are you cold?');
    expect(field.value).toBe('');
    expect(focusKeyingSurface).toHaveBeenCalledTimes(1);
  });

  it('submits with the "Add line" button too', async () => {
    const { onSubmit, field, button, user } = renderForm();
    await user.type(field, 'Water?');
    await user.click(button);
    expect(onSubmit).toHaveBeenCalledWith('Water?');
    expect(field.value).toBe('');
  });

  it('ignores a Whitespace-only line, keeps the value and keeps focus in the field (Req 19.6, 21.3)', async () => {
    const { onSubmit, focusKeyingSurface, field, button, user } = renderForm();
    await user.type(field, '   {Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field.value).toBe('   ');
    expect(document.activeElement).toBe(field);
    await user.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field.value).toBe('   ');
    expect(document.activeElement).toBe(field);
    expect(focusKeyingSurface).not.toHaveBeenCalled();
  });

  it('keeps the first 500 characters of a longer paste (Req 19.7, 19.8)', async () => {
    const { field, user } = renderForm();
    expect(field.maxLength).toBe(500);
    await user.click(field);
    await user.paste('x'.repeat(600));
    expect(field.value).toBe('x'.repeat(500));
  });
});
