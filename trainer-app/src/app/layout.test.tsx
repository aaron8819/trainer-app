import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ decision: vi.fn() }));
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: 'sans' }), Geist_Mono: () => ({ variable: 'mono' }),
}));
vi.mock('@/components/navigation/AppNavigation', () => ({
  AppNavigation: () => <nav>V1 navigation fixture</nav>,
}));
vi.mock('@/lib/operations/deployment-boundary', () => ({
  currentDeploymentDecision: fixture.decision,
}));
import RootLayout, { generateMetadata } from './layout';

it('keeps V1 navigation and metadata in V1 mode', () => {
  fixture.decision.mockReturnValue('v1');
  expect(renderToStaticMarkup(<RootLayout>content</RootLayout>)).toContain('V1 navigation fixture');
  expect(generateMetadata()).toEqual({ title: 'Personal AI Trainer',
    description: 'Adaptive strength training, logging, and analytics.' });
});

it('omits V1 navigation and supplies install metadata in V2 production', () => {
  fixture.decision.mockReturnValue('v2-production');
  expect(renderToStaticMarkup(<RootLayout>content</RootLayout>)).not.toContain('V1 navigation fixture');
  expect(generateMetadata()).toMatchObject({ manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, title: 'Trainer', statusBarStyle: 'default' },
    icons: { apple: '/apple-icon.png' } });
});
