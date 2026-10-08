import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/api/trainer2/database', () => ({ databaseFor: async () => ({}) }));
vi.mock('@/lib/api/trainer2/development', () => ({ developmentEnabled: () => true }));
vi.mock('@/lib/api/trainer2/access', () => ({ hostedEnabled: () => false }));
vi.mock('@/lib/api/trainer2/sessions', () => ({
  sessionForRequest: fixture.session,
  soleOwner: async () => ({ accountId: 'synthetic-owner', sessionEpoch: 4,
    passcodeVerifier: 'synthetic-verifier' }),
}));
import AuthPage from './page';

beforeEach(() => {
  fixture.session.mockReset().mockResolvedValue({ accountId: 'synthetic-owner' });
});

it('offers private blank password inputs and the expected owner epoch to a signed-in device',
  async () => {
    const html = renderToStaticMarkup(await AuthPage());
    const document = new DOMParser().parseFromString(html, 'text/html');
    const form = document.querySelector('form[action="/trainer2/auth/replace-passcode"]');
    expect(form).not.toBeNull();
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.querySelector('[name="accountId"]')?.getAttribute('value'))
      .toBe('synthetic-owner');
    expect(form?.querySelector('[name="epoch"]')?.getAttribute('value')).toBe('4');
    for (const name of ['passcode', 'confirmation']) {
      const input = form?.querySelector(`input[name="${name}"]`);
      expect(input?.getAttribute('type')).toBe('password');
      expect(input?.getAttribute('autocomplete')).toBe('new-password');
      expect(input?.hasAttribute('value')).toBe(false);
    }
    expect(form?.textContent).toContain('sign out every V2 device');
  });

it('does not offer replacement to a signed-out device', async () => {
  fixture.session.mockImplementation(() => { throw new Error('UNAUTHENTICATED'); });
  const html = renderToStaticMarkup(await AuthPage());
  expect(html).not.toContain('/trainer2/auth/replace-passcode');
  expect(html).toContain('/trainer2/auth/sign-in');
});
