import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect as baseExpect, type Page, type Route } from '@playwright/test';
import {
  parseExactDisposableConfirmationArgs, validateDisposableDatabaseTargets,
} from '../src/lib/operations/test-environment-preflight';
import { runHomeProgramFixture } from './trainer2/home-program-fixture';
import { createHypertrophyPlan } from '../src/lib/engine/trainer2/plan-builder';
import { readDraft } from '../src/lib/api/trainer2/planning';
import { activatePlan } from '../src/lib/api/trainer2/activation';

const expect = baseExpect.configure({ timeout: 30_000 });
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function delayedRead(page: Page, url: string) {
  const arrived = gate(), released = gate(), delivered = gate();
  const handler = async (route: Route) => {
    const response = await route.fetch();
    arrived.release();
    await released.promise;
    await route.fulfill({ response });
    delivered.release();
  };
  await page.route(url, handler);
  return { arrived: arrived.promise, delivered: delivered.promise, release: released.release,
    remove: () => page.unroute(url, handler) };
}

async function main(): Promise<void> {
  assert(parseExactDisposableConfirmationArgs(process.argv.slice(2)).valid);
  assert(validateDisposableDatabaseTargets({ environment: process.env,
    confirmed: true, requiredTargets: [] }).valid);
  await runHomeProgramFixture(false, true, async ({
    page, base, home, artifact, accountId, planId, db, reader, principal, pass,
  }) => {
    const draft = await readDraft(reader, principal, planId);
    assert(draft, 'The disposable plan must exist before activation');
    const activation = await activatePlan(db, principal, {
      schemaVersion: 1, actionId: randomUUID(), deviceId: randomUUID(),
      originatingAccountId: accountId, ownershipEpoch: 0, dependsOn: [],
      commandType: 'ActivatePlan', target: { planId },
      expected: { planRevisionId: draft.revisionId }, intent: { reviewed: draft.activation },
    });
    assert.equal(activation.outcome.status, 'Accepted');
    const count = await db.trainer2Execution.count({ where: { accountId } });
    const draftUrl = `${base}/api/trainer2/drafts/${planId}`;
    const nextUrl = `${base}/api/trainer2/plans/${planId}/next`;
    let posts = 0;
    page.on('request', request => { if (request.method() === 'POST') ++posts; });
    const ready = page.getByRole('region', { name: 'Week progress', exact: true });
    const loading = page.getByRole('status').filter({ hasText: 'Getting your training ready' });
    const shot = (name: string) => page.screenshot({ path: resolve(artifact, name), fullPage: true });
    if (process.env.TRAINER2_LOADING_REMAINING !== '1') {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const plan = await delayedRead(page, draftUrl);
      const workout = await delayedRead(page, nextUrl);
      try {
        await page.goto(`${base}/trainer2`);
        await plan.arrived;
        await expect(loading).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Ready when you are.' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Start workout', exact: true })).toHaveCount(0);
        await expect(page.getByText('You have no plan yet.')).toHaveCount(0);
        await expect(page.getByRole('progressbar')).toHaveCount(0);
        await shot(`home-loading-plan-${width}.png`);
        plan.release();
        await workout.arrived;
        await expect(loading).toBeVisible();
        await shot(`home-loading-workout-${width}.png`);
        workout.release();
        await expect(ready).toBeVisible();
        await shot(`home-ready-${width}.png`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      } finally { plan.release(); workout.release(); await plan.remove(); await workout.remove(); }
    }
    pass('Actual Training entry keeps the Home frame through both delayed reads at mobile/desktop widths');
    const refresh = await delayedRead(page, draftUrl);
    try {
      await page.reload(); await refresh.arrived;
      await expect(loading).toBeVisible();
      refresh.release(); await expect(ready).toBeVisible();
    } finally { refresh.release(); await refresh.remove(); }
    pass('Slow refresh never flashes an empty plan or interactive workout');
    }
    await page.goto(home); await expect(ready).toBeVisible();
    for (const failedUrl of [draftUrl, nextUrl]) {
      let fail = true;
      const handler = async (route: Route) => {
        if (fail) await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        else await route.continue();
      };
      await page.route(failedUrl, handler);
      try {
        await page.goto(home);
        const error = failedUrl === draftUrl ? 'Could not load this plan' : 'Could not load this workout';
        await expect(page.getByRole('alert').filter({ hasText: error })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Ready when you are.' })).toBeVisible();
        fail = false;
        await page.getByRole('button', { name: 'Try again', exact: true }).click();
        await expect(ready).toBeVisible();
      } finally { await page.unroute(failedUrl, handler); }
    }
    pass('Both initial-read errors retry in place without any browser write');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const destination of ['Builder', 'Settings']) {
      const plan = await delayedRead(page, draftUrl), navigation = gate(), deliver = gate();
      const target = destination === 'Settings' ? '/trainer2/auth' : '/trainer2/dev/drafts';
      const match = (url: URL) => url.pathname === target && url.searchParams.has('_rsc') &&
        (destination === 'Settings' || url.searchParams.get('view') === 'builder');
      const handler = async (route: Route) => {
        const response = await route.fetch(); navigation.release();
        await deliver.promise; await route.fulfill({ response });
      };
      await page.route(match, handler);
      try {
        await page.goto(home); await plan.arrived;
        await page.getByRole('navigation', { name: 'Trainer2 navigation', exact: true })
          .getByRole('link', { name: destination, exact: true }).click();
        await navigation.promise;
        plan.release();
        await plan.delivered;
        deliver.release();
        await page.waitForURL(url => url.pathname === target &&
          (destination === 'Settings' || url.searchParams.get('view') === 'builder'));
        if (destination === 'Builder') {
          await expect(page.getByRole('heading', { name: 'Build a plan' })).toBeVisible();
        } else await expect(page.getByRole('heading', { name: 'Device access' })).toBeVisible();
      } finally {
        plan.release(); deliver.release(); await plan.remove(); await page.unroute(match, handler);
      }
    }
    pass('Builder/Settings remain the destination when a delayed plan read resolves during pending navigation');
    assert.equal(posts, 0);
    assert.equal(await db.trainer2Execution.count({ where: { accountId } }), count);
    writeFileSync(resolve(artifact, 'loading-summary.json'), JSON.stringify({ posts, count, artifact }));
    console.log(`LOADING_PREVIEWS ${artifact}`);
    await page.context().clearCookies();
    await page.goto(`${base}/trainer2`);
    await page.waitForURL(`${base}/trainer2/auth`);
    await expect(page.getByRole('heading', { name: 'Trainer2 sign in' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Week progress' })).toHaveCount(0);
    pass('Signed-out entry remains auth-only with no plan details');
  }, false, createHypertrophyPlan());
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
