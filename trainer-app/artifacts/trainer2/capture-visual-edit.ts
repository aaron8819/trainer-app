// Read-only source-component replay of the first actual PostgreSQL record in the deep journey.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
async function main() {
  const base = process.argv[2]; assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(base));
  const dir = 'artifacts/trainer2/visual-evidence/';
  const receipt = JSON.parse(readFileSync('artifacts/trainer2/polish-evidence/browser.json', 'utf8'));
  const first = [...receipt.full.history].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))[0];
  const execution = { ...receipt.initial, results: [first], history: [first] };
  assert.equal(first.version, 1);
  writeFileSync(dir + 'edit-replay.tsx', `import React,{useState,useCallback} from 'react';import{createRoot}from'react-dom/client';import{ActiveWorkout}from'@/components/trainer2/ActiveWorkout';const execution=${JSON.stringify(execution)};function App(){const [inputs,setInputs]=useState({});const update=useCallback((id,blocked)=>setInputs(p=>p[id]===blocked?p:{...p,[id]:blocked}),[]);return <><p className="mb-4 text-xs text-slate-500">Source-component replay · first verified PostgreSQL record</p><ActiveWorkout execution={execution} ownershipEpoch={0} locked={false} inputStates={inputs} onInputState={update} refresh={async()=>execution.results}/></>};createRoot(document.getElementById('root')).render(<App/>);`);
  await build({ entryPoints: [dir + 'edit-replay.tsx'], outfile: dir + 'edit-replay.js', bundle: true, platform: 'browser', jsx: 'automatic', alias: { '@': resolve('src') }, define: { 'process.env.NODE_ENV': '"production"' } });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 1000 }, reducedMotion: 'reduce' });
    await page.goto(base + '/trainer2/dev/drafts');
    const cssUrls = await page.locator('link[rel="stylesheet"]').evaluateAll(ls => ls.map(l => (l as HTMLLinkElement).href));
    const css = (await Promise.all(cssUrls.map(async u => (await page.request.get(u)).text()))).join('\n');
    await page.route('**/edit-replay', r => r.fulfill({ contentType: 'text/html', body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main id="root" class="mx-auto max-w-3xl space-y-4 p-4"></main><script>${readFileSync(dir + 'edit-replay.js', 'utf8')}</script></body></html>` }));
    await page.route('**/api/**', r => r.abort());
    await page.goto(base + '/edit-replay');
    const panel = page.getByRole('region', { name: 'Active set', exact: true });
    await page.getByRole('button', { name: /, set 1, recorded/ }).click();
    await expect(panel.getByText('Editing recorded set 1')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Update set' })).toBeEnabled();
    await page.screenshot({ path: dir + 'editing-desktop-replay.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: dir + 'editing-mobile-replay.png', fullPage: true });
    await panel.getByLabel(/Actual reps/).fill('9');
    await panel.getByRole('button', { name: 'Return to active set' }).click();
    await expect(panel).toContainText('Set 2 of 3');
    await expect(panel.getByLabel(/Actual reps/)).toHaveValue('8');
    await page.getByRole('button', { name: /, set 1, recorded/ }).click();
    await expect(panel.getByLabel(/Actual reps/)).toHaveValue('9');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    writeFileSync(dir + 'edit-replay.json', JSON.stringify({ first, checks: ['real source components and captured persisted record', 'Update set and edit banner', 'Return restores first unrecorded set', 'edit input retained across selection', 'no server writes; API requests blocked'] }, null, 2));
  } finally { await browser.close(); }
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
