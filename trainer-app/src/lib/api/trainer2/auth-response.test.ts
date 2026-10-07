import { NextResponse } from 'next/server';
import { expect, it } from 'vitest';
import { privateAuthResponse } from './auth-response';

it('preserves response identity, status and body while setting exact private auth headers', async () => {
  const response = NextResponse.json({ error: 'AUTHENTICATION_FAILED' }, { status: 400 });
  expect(privateAuthResponse(response)).toBe(response);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'AUTHENTICATION_FAILED' });
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.headers.get('Vary')).toBe('Cookie');
  expect(response.headers.get('Referrer-Policy')).toBe('same-origin');
});
