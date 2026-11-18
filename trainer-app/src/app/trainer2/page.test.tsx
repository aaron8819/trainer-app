import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { DraftAccessError } from '@/lib/api/trainer2/principal';
const fixture = vi.hoisted(() => ({ context: vi.fn(), home: vi.fn(), enabled: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('@/lib/api/trainer2/access', () => ({
  requestContext: fixture.context, hostedEnabled: fixture.enabled,
}));
vi.mock('@/lib/api/trainer2/development', () => ({ developmentEnabled: () => false }));
vi.mock('@/lib/api/trainer2/training-home', () => ({ readTrainingHome: fixture.home }));
import TrainingPage from './page';

const db = Object.freeze({ synthetic: true });
const principal = Object.freeze({ accountId: 'synthetic-owner', sessionId: 'synthetic-session' });
const active = { id: '00000000-0000-0000-0000-000000000001', lifecycle: 'Active' };
beforeEach(() => {
  fixture.enabled.mockReset().mockReturnValue(true);
  fixture.context.mockReset().mockResolvedValue({ db, principal });
  fixture.home.mockReset().mockResolvedValue({ plans: [] });
});
const page = (view?: string) => TrainingPage({ searchParams: Promise.resolve({ view }) });

it('opens the existing active plan after authorized read-only entry', async () => {
  fixture.home.mockResolvedValue({ plans: [{ id: 'draft', lifecycle: 'Draft' }, active] });
  await expect(page()).rejects.toThrow(`NEXT_REDIRECT:/trainer2/dev/drafts?planId=${active.id}`);
  expect(fixture.home).toHaveBeenCalledExactlyOnceWith(db, principal);
  expect(fixture.context.mock.calls[0].slice(1)).toEqual(['read', false]);
});

it.each(['empty', 'Draft', 'Paused', 'Completed'])('keeps the no-active-plan screen: %s',
  async lifecycle => {
    fixture.home.mockResolvedValue({ plans: lifecycle === 'empty' ? [] : [{ id: 'other', lifecycle }] });
    const html = renderToStaticMarkup(await page());
    expect(html).toContain('Training');
    expect(html).toContain('Create plan');
    if (lifecycle === 'empty') expect(html).toContain('You have no plan yet.');
    else expect(html).toContain(`Open ${lifecycle.toLowerCase()} plan`);
  });

it('preserves intentional Program list access even with an active plan', async () => {
  fixture.home.mockResolvedValue({ plans: [active] });
  const document = new DOMParser().parseFromString(renderToStaticMarkup(await page('program')),
    'text/html');
  expect(document.querySelector('h1')?.textContent).toBe('Program');
  expect(document.querySelector('a')?.getAttribute('href'))
    .toBe(`/trainer2/dev/drafts?planId=${active.id}&view=program`);
});

it('redirects an unauthorized or expired session to auth before reading any plan', async () => {
  fixture.context.mockRejectedValue(new DraftAccessError('UNAUTHENTICATED'));
  await expect(page()).rejects.toThrow('NEXT_REDIRECT:/trainer2/auth');
  expect(fixture.home).not.toHaveBeenCalled();
});

it('keeps deployment admission before account reads', async () => {
  fixture.enabled.mockReturnValue(false);
  await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
  expect(fixture.context).not.toHaveBeenCalled();
});

it('does not hide infrastructure failures as an entry redirect', async () => {
  fixture.home.mockRejectedValue(new Error('Synthetic read failure'));
  await expect(page()).rejects.toThrow('Synthetic read failure');
});

it('separates completed programs from current plans and links history to saved read-only review', async () => {
  fixture.home.mockResolvedValue({ plans: [
    { ...active, name: 'Current block', savedAt: '2026-11-01T00:00:00.000Z' },
    { id: 'past / plan', lifecycle: 'Completed', name: 'Previous block', savedAt: '2026-10-01T00:00:00.000Z' },
  ] });
  const document = new DOMParser().parseFromString(renderToStaticMarkup(await page('program')), 'text/html');
  const completed = document.querySelector('[aria-label="Completed programs"]')!;
  expect(completed.textContent).toContain('Previous block');
  expect(completed.textContent).not.toContain('Current block');
  expect(completed.querySelector('a')?.getAttribute('href'))
    .toBe('/trainer2/dev/drafts?planId=past%20%2F%20plan&view=program');
  expect(document.querySelector('[aria-label="Current programs"]')?.textContent).toContain('Current block');
  expect(document.querySelectorAll('form, button')).toHaveLength(0);
});

it('explains the empty completed history without hiding the current program', async () => {
  fixture.home.mockResolvedValue({ plans: [active] });
  const html = renderToStaticMarkup(await page('program'));
  expect(html).toContain('No completed programs yet.');
  expect(html).toContain('Open active plan');
});
