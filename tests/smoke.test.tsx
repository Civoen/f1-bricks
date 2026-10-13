// @vitest-environment jsdom
/**
 * Smoke test: renders every page against the in-memory demo backend and
 * walks the main flows (log a lap, view a circuit, history, correct, delete).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'true');
  window.scrollTo = () => {};
});
afterEach(() => cleanup());

async function renderAt(path: string) {
  window.history.pushState({}, '', path);
  const { App } = await import('../src/App');
  const utils = render(<App />);
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull(), { timeout: 4000 });
  return utils;
}

describe('pages render with demo data', () => {
  it('dashboard shows the hero and all 24 rounds in the timing tower', async () => {
    await renderAt('/');
    expect(screen.getByText('TIMING TOWER')).toBeTruthy();
    const tower = screen.getByRole('list');
    expect(within(tower).getAllByRole('link')).toHaveLength(24);
    expect(within(tower).getAllByRole('link')[0]!.getAttribute('aria-label')).toMatch(/^Round 1, Albert Park/);
    expect(within(tower).getAllByRole('link')[23]!.getAttribute('aria-label')).toMatch(/^Round 24, Yas Marina/);
    expect(screen.getAllByText(/DEMO DATA/).length).toBeGreaterThan(0);
    // Sidebar has Log under Home
    const rail = screen.getAllByRole('navigation', { name: 'Primary' })[0]!;
    const labels = within(rail).getAllByRole('link').map((a) => a.getAttribute('aria-label'));
    expect(labels.slice(1, 3)).toEqual(['Dashboard', 'Log a lap']);
  });

  it.each(['/circuits', '/circuits/suzuka', '/circuits/miami', '/history', '/stats'])('%s renders', async (path) => {
    await renderAt(path);
    expect(document.querySelector('h1')).toBeTruthy();
  });
});

describe('main flows', () => {
  it('validates and logs a lap, then confirms the outcome', async () => {
    await renderAt('/log?circuit=miami');
    const input = screen.getByLabelText('Lap time') as HTMLInputElement;
    const save = screen.getByRole('button', { name: /SAVE LAP/ });

    fireEvent.change(input, { target: { value: '1295' } });
    expect(input.value).toBe('1:29.5');
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.change(input, { target: { value: '170000' } });
    expect(input.value).toBe('1:70.000');
    expect(save.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Seconds must be between/)).toBeTruthy();

    fireEvent.change(input, { target: { value: '129500' } });
    expect(input.value).toBe('1:29.500');
    expect(screen.getByText('NEW CIRCUIT RECORD')).toBeTruthy(); // nobody has a time at Miami in demo data
    expect(save.hasAttribute('disabled')).toBe(false);

    await act(async () => { fireEvent.click(save); });
    const dialog = await screen.findByRole('dialog', { name: 'Lap saved' }, { timeout: 3000 });
    expect(within(dialog).getByText('New circuit record')).toBeTruthy();
    expect(within(dialog).getByText('1:29.500')).toBeTruthy();

    // Undo removes it again and puts the time back in the field
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /Undo/ })); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 });
    expect((screen.getByLabelText('Lap time') as HTMLInputElement).value).toBe('1:29.500');
    expect(screen.getByText(/Undone/)).toBeTruthy();
  });

  it('corrects and deletes a lap from the history', async () => {
    await renderAt('/history?circuit=suzuka');
    const before = screen.getAllByRole('row').length;
    const editBtn = screen.getAllByRole('button', { name: /^Correct / })[0]!;
    fireEvent.click(editBtn);
    const dialog = await screen.findByRole('dialog', { name: 'Correct lap' });
    fireEvent.change(within(dialog).getByLabelText('Lap time'), { target: { value: '135000' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save correction' })); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 });
    expect(screen.getAllByText('1:35.000').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: /^Delete / })[0]!);
    const del = await screen.findByRole('dialog', { name: 'Delete lap' });
    await act(async () => { fireEvent.click(within(del).getByRole('button', { name: 'Delete lap' })); });
    await waitFor(() => expect(screen.getAllByRole('row').length).toBe(before - 1), { timeout: 3000 });
  });
});
