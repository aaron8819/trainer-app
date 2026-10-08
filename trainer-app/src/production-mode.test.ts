import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { proxy } from './proxy';
import manifest from './app/manifest';
import { currentDeploymentDecision } from './lib/operations/deployment-boundary';
import { assertProductionRequest, hostedEnabled, hostedTestEnabled } from './lib/api/trainer2/access';

beforeEach(() => {
  vi.stubEnv('TRAINER_BUILT_MODE', 'v2-production');
  vi.stubEnv('TRAINER_DEPLOYMENT_MODE', 'v2-production');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('TRAINER2_APP_ORIGIN', 'https://trainer.example.test');
  for (const key of ['TRAINER2_IDENTITY_CONNECTION_STRING', 'TRAINER2_READ_CONNECTION_STRING',
    'TRAINER2_WRITE_CONNECTION_STRING', 'TRAINER2_DB_CA_CERT_PEM', 'TRAINER2_OWNER_USER_ID'])
    vi.stubEnv(key, 'synthetic-configuration');
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'OWNER_EMAIL', 'DATABASE_SSL_NO_VERIFY'])
    vi.stubEnv(key, '');
});
afterEach(() => vi.unstubAllEnvs());
const request = (path: string, host = 'trainer.example.test'): NextRequest =>
  new NextRequest(`https://${host}${path}`, { headers: { host } });

it('rewrites root to Training, preserves query and uses private responses', () => {
  const response = proxy(request('/?view=program'));
  expect(response.headers.get('x-middleware-rewrite'))
    .toBe('https://trainer.example.test/trainer2?view=program');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(hostedEnabled()).toBe(true);
  expect(hostedTestEnabled()).toBe(false);
});

it('permits existing V2/auth and install assets while denying V1 and unknown hosts', () => {
  for (const path of ['/trainer2', '/trainer2/auth', '/trainer2/auth/replace-passcode',
    '/api/trainer2/plans', '/manifest.webmanifest', '/icons/trainer-icon-192.png',
    '/icons/trainer-icon-512.png', '/apple-icon.png']) {
    expect(proxy(request(path)).headers.get('x-middleware-next'), path).toBe('1');
    expect(proxy(request(path, 'unknown.example.test')).status, path).toBe(404);
  }
  for (const path of ['/plans', '/api/workouts', '/program', '/trainer2-other'])
    expect(proxy(request(path)).status, path).toBe(404);
  expect(() => assertProductionRequest(request('/api/trainer2/plans', 'unknown.example.test')))
    .toThrow('HOSTED_ADMISSION_DISABLED');
});

it('fails closed for noncanonical or insecure production origins and mismatched environments', () => {
  for (const origin of ['http://trainer.example.test', 'https://trainer.example.test/',
    'https://user:password@trainer.example.test', 'invalid']) {
    vi.stubEnv('TRAINER2_APP_ORIGIN', origin);
    expect(currentDeploymentDecision()).toBe('deny');
    expect(proxy(request('/')).status).toBe(503);
  }
  vi.stubEnv('TRAINER2_APP_ORIGIN', 'https://trainer.example.test');
  for (const environment of ['', 'preview', 'unknown']) {
    vi.stubEnv('VERCEL_ENV', environment);
    expect(proxy(request('/')).status).toBe(503);
  }
});

it('keeps V1 root and routes intact in V1 production mode', () => {
  vi.stubEnv('TRAINER_BUILT_MODE', 'v1');
  vi.stubEnv('TRAINER_DEPLOYMENT_MODE', 'v1');
  for (const path of ['/', '/plans', '/program', '/api/workouts']) {
    const response = proxy(request(path));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  }
});

it('uses root start and scope, standalone mode and existing icon assets', () => {
  expect(manifest()).toMatchObject({ start_url: '/', scope: '/', display: 'standalone' });
  expect(manifest().icons?.every(icon => icon.src.startsWith('/icons/trainer-icon-'))).toBe(true);
});
