import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { expect as baseExpect, type Page } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
const expect = baseExpect.configure({ timeout: 30_000 });

export async function navigationJourney({ page, base, artifact, accountId, planId, executionId, db, pass }: {
  page: Page; base: string; home: string; artifact: string; accountId: string; planId: string; executionId: string; db: PrismaClient; pass: (value: string) => void;
}) {
  const nav = page.getByRole('navigation', { name: 'Trainer2 navigation', exact: true });
  const shot = async (name: string) => page.screenshot({ path: resolve(artifact, `${name}.png`), fullPage: true });
  const trace = async (step: string) => writeFileSync(resolve(artifact, 'navigation.jsonl'), JSON.stringify({ step, url: page.url(),
    timeOrigin: await page.evaluate(() => performance.timeOrigin), builder: await nav.getByRole('link', { name: 'Builder', exact: true }).getAttribute('href') }) + '\n', { flag: 'a' });
  const surface = async (active: string, width: number) => {
    await expect(nav.getByRole('link', { name: active, exact: true })).toHaveAttribute('aria-current', 'page');
    assert.equal(await nav.getByRole('link').count(), 4);
    for (const link of await nav.getByRole('link').all()) {
      assert((await link.getAttribute('href'))!.startsWith('/trainer2'));
      const box = (await link.boundingBox())!; assert(box.width >= 44 && box.height >= 44);
    }
    const boxes = await Promise.all((await nav.getByRole('link').all()).map(link => link.boundingBox()));
    boxes.slice(1).forEach((box, index) => assert(box!.x >= boxes[index]!.x + boxes[index]!.width + 3));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.keyboard.press('Tab');
    await nav.getByRole('link', { name: active, exact: true }).focus();
    assert.notEqual(await nav.getByRole('link', { name: active, exact: true }).evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    if (width < 768) assert.equal(await nav.evaluate(el => getComputedStyle(el).position), 'fixed');
    else assert.equal(await nav.evaluate(el => getComputedStyle(el).position), 'static');
  };
  if (!executionId) {
    assert.equal(await db.trainer2Plan.count({ where: { accountId } }), 0);
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${base}/trainer2`);
      await expect(page.getByText('You have no plan yet.', { exact: false })).toBeVisible();
      assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(246, 245, 241)');
      await surface('Training', width); await shot(`empty-training-${width}`);
      await nav.getByRole('link', { name: 'Program', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'No program yet' })).toBeVisible();
      await surface('Program', width); await shot(`empty-program-${width}`);
      await page.goto(`${base}/trainer2?view=program`);
      await surface('Program', width);
      await page.getByRole('link', { name: 'Create plan', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Customize this template' })).toBeVisible();
      await surface('Builder', width); await shot(`builder-template-${width}`);
    }
    assert.equal(await db.trainer2Plan.count({ where: { accountId } }), 0);
    assert.equal(await db.trainer2Execution.count({ where: { accountId } }), 0);
    pass('Empty Training/Program, direct URL, Create plan, dark OS preference, desktop/390/320 navigation, focus, targets, separation and overflow; zero plans/executions');
    return;
  }

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`${base}/trainer2/dev/drafts?view=builder`);
  await page.getByRole('button', { name: 'Customize this template' }).click();
  await page.getByLabel('Plan name', { exact: true }).fill('Navigation retained draft');
  await nav.getByRole('link', { name: 'Program', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open active plan', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Builder', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/trainer2/dev/drafts' && url.searchParams.get('view') === 'builder');
  await expect(page.getByLabel('Plan name', { exact: true })).toHaveValue('Navigation retained draft');
  const bottom = page.getByRole('button', { name: 'Save plan', exact: true });
  const navBox = (await nav.boundingBox())!; assert((await bottom.boundingBox())!.y + (await bottom.boundingBox())!.height <= navBox.y - 4);
  await shot('builder-actions-320');
  await page.route('**/api/trainer2/drafts/create', route => route.abort());
  await bottom.click(); await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
  const builderPending = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith('trainer2-builder:'))));
  await nav.getByRole('link', { name: 'Program', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open active plan', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Builder', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/trainer2/dev/drafts' && url.searchParams.get('view') === 'builder');
  await expect(page.getByRole('button', { name: 'Check again', exact: true })).toBeVisible();
  await trace('Pending Builder restored');
  assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith('trainer2-builder:')))), builderPending);
  await page.unroute('**/api/trainer2/drafts/create');
  pass('Builder draft and exact pending CreateDraft survive shell navigation; fixed Save/Review clear mobile navigation');

  await nav.getByRole('link', { name: 'Program', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open active plan', exact: true })).toBeVisible();
  await trace('Program list');
  await page.getByRole('link', { name: 'Open active plan', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Back to training', exact: true })).toBeVisible();
  await trace('Saved Program entered');
  await surface('Program', 320); await shot('saved-program-320');
  const retainedBuilderId = JSON.parse(Object.values(builderPending)[0]).command.target.planId;
  await expect(nav.getByRole('link', { name: 'Builder', exact: true })).toHaveAttribute('href', `/trainer2/dev/drafts?view=builder&planId=${retainedBuilderId}`);
  const logger = `${base}/trainer2/dev/executions/${executionId}`;
  await page.goto(logger);
  const active = page.getByRole('region', { name: 'Active set', exact: true });
  const reps = active.getByLabel('Set 1 Actual reps', { exact: true });
  await expect(reps).toBeVisible();
  page.on('dialog', dialog => dialog.accept());
  await reps.fill('9');
  const retained = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith('trainer2-result:'))));
  await nav.getByRole('link', { name: 'Program', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Back to training', exact: true })).toBeVisible();
  await page.goto(logger); await expect(reps).toHaveValue('9');
  assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith('trainer2-result:')))), retained);
  await page.route('**/api/trainer2/executions/results', route => route.abort());
  await active.getByRole('button', { name: 'Log set', exact: true }).click();
  await expect(active.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
  const pending = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith('trainer2-result:'))));
  await nav.getByRole('link', { name: 'Program', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Back to training', exact: true })).toBeVisible();
  await page.goto(logger); await expect(active.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage).filter(([key]) => key.startsWith('trainer2-result:')))), pending);
  await page.unroute('**/api/trainer2/executions/results');
  await active.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByLabel('Rest timer', { exact: true })).toBeVisible();
  pass('Logger draft guard and exact pending result envelope survive navigation; retry retains command identity and starts existing rest');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await surface('Training', width);
    await active.getByRole('button', { name: 'Log set', exact: true }).scrollIntoViewIfNeeded();
    if (width < 768) {
      const action = (await active.getByRole('button', { name: 'Log set', exact: true }).boundingBox())!;
      assert(action.y + action.height <= (await nav.boundingBox())!.y);
    }
    await shot(`active-logger-${width}`);
    await active.getByRole('button', { name: 'History', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Exercise history' }); await expect(dialog).toBeVisible();
    await dialog.press('Escape'); await expect(active.getByRole('button', { name: 'History', exact: true })).toBeFocused();
  }
  // Chromium cannot open an iPhone keyboard; exercise the shared visual-viewport signal.
  await active.locator('input:visible').first().focus();
  await page.evaluate("Object.defineProperty(window.visualViewport, 'height', { configurable: true, get() { return innerHeight - 300; } }); window.visualViewport.dispatchEvent(new Event('resize'));");
  await expect(nav).toBeHidden();
  await shot('keyboard-signal-320');
  await page.evaluate(() => {
    delete (window.visualViewport as unknown as { height?: number }).height;
    (document.activeElement as HTMLElement).blur();
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(nav).toBeVisible();
  const completed = await db.trainer2Execution.findFirst({ where: { accountId, planId, lifecycle: 'Finished' } }); assert(completed);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${base}/trainer2/dev/executions/${completed.id}`);
    await expect(page.getByRole('link', { name: 'Back to training', exact: true })).toBeVisible();
    await surface('Training', width); await shot(`completed-review-${width}`);
    await nav.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Device access' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out this device' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out every device' })).toBeVisible();
    await expect(nav).toHaveCount(0); await shot(`device-access-${width}`);
  }
  pass('Active Logger/rest/actions, History modal focus return, completed review and minimal device access at desktop/390/320; sign-out controls inspected without revocation');
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    // A database-free V1 root-layout route exercises its unchanged navigation.
    await page.goto(`${base}/navigation-v1-check`);
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('href', '/settings');
    await expect(nav).toHaveCount(0); await shot(`v1-navigation-${width}`);
  }
  pass('Keyboard signal hides bottom navigation; V1 root navigation remains visible with its original destinations outside the Trainer2 path boundary');
}
