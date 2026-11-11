// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PartnerDisplay } from './PartnerDisplay';

afterEach(cleanup);

const display = (): HTMLElement => screen.getByRole('group', { name: 'Partner display' });
const headings = (): (string | null)[] => within(display()).getAllByRole('heading').map((h) => h.textContent);

describe('PartnerDisplay', () => {
  it('labels Current_Text "Typing" and Last_Spoken "Last said" (Req 14.1)', () => {
    render(<PartnerDisplay currentText="i w t g o" lastSpoken="I want to go outside." flip={false} />);
    expect(screen.getByRole('heading', { name: 'Typing' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Last said' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Typing' }).textContent).toContain('i w t g o');
    expect(screen.getByRole('region', { name: 'Last said' }).textContent).toContain('I want to go outside.');
  });

  it('shows placeholders when nothing is typed or said yet (Req 14.8, 14.9)', () => {
    render(<PartnerDisplay currentText="" lastSpoken={null} flip={false} />);
    expect(screen.getByText('Nothing typed yet')).toBeDefined();
    expect(screen.getByText('Nothing said yet')).toBeDefined();
  });

  it('hides the placeholders once there is text', () => {
    render(<PartnerDisplay currentText="h" lastSpoken="Hello." flip={false} />);
    expect(screen.queryByText('Nothing typed yet')).toBeNull();
    expect(screen.queryByText('Nothing said yet')).toBeNull();
  });

  it('rotates 180° when flipped and keeps the heading order, Last said first (Req 14.5, 24.6)', () => {
    render(<PartnerDisplay currentText="yes" lastSpoken={null} flip />);
    expect(display().style.transform).toBe('rotate(180deg)');
    expect(headings()).toStrictEqual(['Last said', 'Typing']);
  });

  it('has no rotation when not flipped, and puts Last said before Typing (Req 14.6, 24.6)', () => {
    const view = render(<PartnerDisplay currentText="yes" lastSpoken={null} flip />);
    view.rerender(<PartnerDisplay currentText="yes" lastSpoken={null} flip={false} />);
    expect(display().style.transform).toBe('');
    expect(headings()).toStrictEqual(['Last said', 'Typing']);
  });

  it('keeps every character of a 500-character text (Req 14.11)', () => {
    const long = 'w'.repeat(500);
    render(<PartnerDisplay currentText={long} lastSpoken={long} flip={false} />);
    expect(screen.getByRole('region', { name: 'Typing' }).textContent).toContain(long);
    expect(screen.getByRole('region', { name: 'Last said' }).textContent).toContain(long);
  });
});
