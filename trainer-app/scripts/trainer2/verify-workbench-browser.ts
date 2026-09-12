import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
function signal() { let release!: () => void; const promise = new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Controlled response timed out')), 30000); release = () => { clearTimeout(timeout); resolve(); }; }); return { promise, release }; }
export async function verifyWorkbenchBrowser(tab: Page, advance: (planId: string) => Promise<void>) {
  await tab.goto(new URL('/trainer2/dev/drafts', tab.url()).href);
  const postReceived = signal(), deliverPost = signal(), getReceived = signal(), deliverGet = signal();
  let posts = 0, delay = true, failRead: '503' | 'network' | null = '503';
  await tab.route('**/api/trainer2/drafts/*', async route => {
    if (route.request().method() === 'POST') {
      posts++; const response = await route.fetch(); assert.equal(response.status(), 200);
      if (posts === 1) { postReceived.release(); await deliverPost.promise; }
      await route.fulfill({ response }); return;
    }
    if (delay) { getReceived.release(); await deliverGet.promise; delay = false; }
    const failure = failRead; failRead = null;
    if (failure === '503') await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    else if (failure === 'network') await route.abort('failed'); else await route.continue();
  });
  const name = tab.getByLabel('Plan name', { exact: true });
  const save = tab.getByRole('button', { name: 'Save plan', exact: true });
  const reload = () => tab.getByRole('button', { name: 'Reload latest version', exact: true });
  const saved = () => tab.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
  const failed = () => tab.getByRole('status').filter({ hasText: 'was saved, but could not be reloaded' }).waitFor();
  await save.click(); await postReceived.promise; assert(await name.isDisabled()); assert(await save.isDisabled());
  deliverPost.release(); await getReceived.promise; assert(await name.isDisabled());
  const planId = new URL(tab.url()).searchParams.get('planId')!; assert(planId);
  deliverGet.release(); await failed(); assert(await name.isDisabled());
  await reload().click(); await saved(); assert.equal(posts, 1);
  await name.fill('Browser accepted edit'); failRead = 'network'; await save.click(); await failed();
  assert(await name.isDisabled()); await advance(planId);
  await reload().click(); await saved(); assert.equal(posts, 2);
  assert.equal(await name.inputValue(), 'Newer server head'); assert(await name.isEnabled());
  await tab.unroute('**/api/trainer2/drafts/*');
  return { actualBrowser: true, results: ['POST and GET input locks', 'accepted bookmark retained before read', 'GET-only recovery after 503 and network failure', 'refresh reads newer head rather than historical acceptance'] };
}
