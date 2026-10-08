import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ database: vi.fn(), replace: vi.fn() }));
vi.mock('./database', () => ({ databaseFor: fixture.database }));
vi.mock('./sessions', () => ({ replacePasscode: fixture.replace, SESSION_COOKIE: '__Host-trainer2-session',
  sessionCookieOptions: () => ({ secure: true, httpOnly: true, path: '/', sameSite: 'lax' }) }));
import { authHttp } from './auth-http';

beforeEach(() => {
  for (const key of ['CI', 'VERCEL', 'VERCEL_ENV', 'NETLIFY', 'RENDER', 'WEBSITE_SITE_NAME',
    'TRAINER_WRITE_PAUSE']) vi.stubEnv(key, '');
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('TRAINER2_LOCAL_DRAFTS', 'enabled');
  vi.stubEnv('TRAINER2_APP_ORIGIN', 'http://localhost');
  fixture.database.mockReset().mockResolvedValue({}); fixture.replace.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
const body = 'accountId=synthetic&epoch=4&passcode=synthetic+replacement&confirmation=synthetic+replacement';
function request(form = body, origin = 'http://localhost'): NextRequest {
  return new NextRequest('http://localhost/trainer2/auth/replace-passcode', {
    method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin' }, body: form,
  });
}
describe('private replacement POST', () => {
  it('uses identity only, clears the cookie and redirects without echoing credentials', async () => {
    const response = await authHttp(request(), 'replace-passcode');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/trainer2/auth');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(fixture.database).toHaveBeenCalledExactlyOnceWith('identity', true);
    expect(await response.text()).not.toContain('synthetic replacement');
  });
  it('rejects foreign origins before opening any pool', async () => {
    expect((await authHttp(request(body, 'https://foreign.invalid'), 'replace-passcode')).status).toBe(400);
    expect(fixture.database).not.toHaveBeenCalled(); expect(fixture.replace).not.toHaveBeenCalled();
  });
  it.each([body + '&epoch=4', body + '&extra=x', body.replace('epoch=4', 'epoch=4.1'), 'x'.repeat(4097)])(
    'rejects malformed or duplicate fields without replacing', async form => {
      expect((await authHttp(request(form), 'replace-passcode')).status).toBe(400);
      expect(fixture.replace).not.toHaveBeenCalled();
    }
  );
  it('fails closed in CI before any pool and sanitizes auth failures', async () => {
    vi.stubEnv('CI', 'true');
    const response = await authHttp(request(), 'replace-passcode');
    expect(response.status).toBe(400); expect(fixture.database).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: 'AUTHENTICATION_FAILED' });
  });
});
