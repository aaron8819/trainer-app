// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Trainer2Shell, useTrainer2Destination } from './Trainer2Shell';

const route = vi.hoisted(() => ({ pathname: '/trainer2', query: '' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname, useSearchParams: () => new URLSearchParams(route.query) }));
vi.mock('@/lib/ui/use-visual-viewport-metrics', () => ({ useVisualViewportMetrics: () => ({ keyboardOpen: false, bottomOffset: 0 }) }));
function Owner({ id, builder = false }: { id?: string; builder?: boolean }) { useTrainer2Destination(id, builder); return <p>Owner remains mounted</p>; }
afterEach(() => { cleanup(); route.pathname = '/trainer2'; route.query = ''; });
describe('Trainer2 shell destinations', () => {
  it('keeps empty Training and Program links within Trainer2 without a plan identity', () => {
    render(<Trainer2Shell><p>Empty account</p></Trainer2Shell>);
    expect(screen.getByRole('link', { name: 'Program' }).getAttribute('href')).toBe('/trainer2?view=program');
    expect(screen.getByRole('link', { name: 'Training' }).getAttribute('aria-current')).toBe('page');
    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).toMatch(/^\/trainer2(?:\/|\?|$)/);
  });
  it('recognizes direct Program URLs and scopes saved navigation to the reported plan', async () => {
    route.pathname = '/trainer2/dev/drafts'; route.query = 'planId=plan-a&view=program';
    render(<Trainer2Shell><Owner id="plan-a" /></Trainer2Shell>);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Program' }).getAttribute('href')).toBe('/trainer2/dev/drafts?planId=plan-a&view=program'));
    expect(screen.getByRole('link', { name: 'Program' }).getAttribute('aria-current')).toBe('page');
  });
  it('retains the saved Builder destination when another screen reports its plan', async () => {
    route.pathname = '/trainer2/dev/drafts'; route.query = 'planId=draft-a&view=builder';
    const view = render(<Trainer2Shell><Owner id="draft-a" builder /></Trainer2Shell>);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Builder' }).getAttribute('aria-current')).toBe('page'));
    route.pathname = '/trainer2/dev/executions/execution-a'; route.query = '';
    view.rerender(<Trainer2Shell><Owner id="active-plan" /></Trainer2Shell>);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Training' }).getAttribute('href')).toContain('active-plan'));
    expect(screen.getByRole('link', { name: 'Builder' }).getAttribute('href')).toBe('/trainer2/dev/drafts?view=builder&planId=draft-a');
  });
  it('keeps device access and sign-in minimal', () => {
    route.pathname = '/trainer2/auth';
    render(<Trainer2Shell><p>Device access</p></Trainer2Shell>);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByText('Device access')).toBeTruthy();
  });
  it('returns Builder to creation when its bookmarked draft becomes a training plan', async () => {
    route.pathname = '/trainer2/dev/drafts';
    const view = render(<Trainer2Shell><Owner id="plan-a" builder /></Trainer2Shell>);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Builder' }).getAttribute('href')).toContain('planId=plan-a'));
    view.rerender(<Trainer2Shell><Owner id="plan-a" /></Trainer2Shell>);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Builder' }).getAttribute('href')).toBe('/trainer2/dev/drafts?view=builder'));
  });
});
