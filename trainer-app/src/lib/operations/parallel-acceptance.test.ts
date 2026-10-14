import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { isolatedLinuxJob } from '../../../scripts/trainer2/isolated-linux-lifecycle';
import {
  requireComponent, requireExits, requireFixtures, requireSuccessfulJobs, requireBase, requireBuild,
} from '../../../scripts/aggregate-trainer2-acceptance.mjs';

const head = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const directories: string[] = [];
function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'trainer-acceptance-'));
  directories.push(directory);
  return directory;
}
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true })));
const success = {
  'trainer2-production-artifact': { result: 'success' },
  'trainer2-browser': { result: 'success' },
};

describe('parallel acceptance fails closed', () => {
  it('requires both job families and accepts only success', () => {
    expect(() => requireSuccessfulJobs(success)).not.toThrow();
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      for (const id of Object.keys(success)) {
        expect(() => requireSuccessfulJobs({ ...success, [id]: { result } })).toThrow();
      }
    }
    for (const missing of [null, {}, { 'trainer2-browser': { result: 'success' } },
      { 'trainer2-production-artifact': { result: 'success' } }]) {
      expect(() => requireSuccessfulJobs(missing)).toThrow();
    }
  });
  it('requires complete clean exact source and successful exit evidence', () => {
    const path = fixture();
    expect(() => requireComponent(path, head, tree)).toThrow();
    writeFileSync(join(path, 'source.txt'), `${head}\n${tree}\n`);
    expect(() => requireComponent(path, head, tree)).not.toThrow();
    for (const value of [`${head}\n${head}`, `${head}\n${tree}\n M dirty`, tree]) {
      writeFileSync(join(path, 'source.txt'), value);
      expect(() => requireComponent(path, head, tree)).toThrow();
    }
    expect(() => requireExits(path, ['logger'])).toThrow();
    for (const value of ['1', '', 'null']) {
      writeFileSync(join(path, 'logger.exit'), value);
      expect(() => requireExits(path, ['logger'])).toThrow();
    }
    writeFileSync(join(path, 'logger.exit'), '0\n');
    expect(() => requireExits(path, ['logger'])).not.toThrow();
  });
  it('rejects absent or stale base and incomplete deployed-build evidence', () => {
    const path = fixture();
    const base = 'c'.repeat(40);
    expect(() => requireBase(path, base)).toThrow();
    writeFileSync(join(path, 'base.txt'), base);
    expect(() => requireBase(path, base)).not.toThrow();
    expect(() => requireBase(path, head)).toThrow();
    expect(() => requireBase(path, '')).toThrow();
    const build = { command: 'npm run build', packageBuild: 'next build',
      node: 'v22.20.0', npm: '10.9.3', next: '16.1.6', lockfileHash: 'lock', buildId: 'built-id' };
    expect(() => requireBuild(path, 'lock', 22)).toThrow();
    const write = (value: unknown): void => writeFileSync(join(path, 'build.json'), JSON.stringify(value));
    write(build);
    expect(() => requireBuild(path, 'lock', 22)).toThrow();
    writeFileSync(join(path, 'production-build.log'), 'Next.js 16.1.6 (Turbopack)');
    expect(requireBuild(path, 'lock', 22)).toEqual(build);
    for (const override of [{ command: 'next build --webpack' }, { packageBuild: 'next build --webpack' },
      { node: 'v20.1.0' }, { node: 'unknown' }, { npm: '' }, { next: '' },
      { lockfileHash: 'stale' }, { buildId: '' }]) {
      write({ ...build, ...override });
      expect(() => requireBuild(path, 'lock', 22)).toThrow();
    }
    write(build);
    writeFileSync(join(path, 'production-build.log'), 'Next.js 16.1.6 (webpack)');
    expect(() => requireBuild(path, 'lock', 22)).toThrow();
  });
  it('requires all fixture reports and successful teardown before qualification', () => {
    const path = fixture();
    const child = join(path, 'owned');
    mkdirSync(child);
    const report = {
      source: { commit: head, tree, dirtyState: '' }, checks: ['saved'], errors: [],
    };
    const cleanup = ['browser connection', 'browser', 'browser worker completion',
      'Next process tree', 'Next pipes', 'Next worker completion', 'identity client',
      'runtime client', 'read client', 'admin pool', 'native fixture cluster', 'fixture container']
      .map(name => ({ name, status: 'passed' }));
    const write = (name: string, value: unknown): void =>
      writeFileSync(join(child, name), JSON.stringify(value));
    write('report.json', report);
    write('cleanup.json', cleanup);
    write('fixture-worker-exit.json', { exitCode: 0 });
    expect(() => requireFixtures(path, 1, head, tree)).not.toThrow();
    expect(() => requireFixtures(path, 2, head, tree)).toThrow();
    write('report.json', { ...report, checks: [] });
    expect(() => requireFixtures(path, 1, head, tree)).toThrow();
    write('report.json', { ...report, source: { ...report.source, tree: head } });
    expect(() => requireFixtures(path, 1, head, tree)).toThrow();
    write('report.json', report);
    write('cleanup.json', cleanup.slice(1));
    expect(() => requireFixtures(path, 1, head, tree)).toThrow();
    write('cleanup.json', Array.from({ length: 12 }, () => cleanup[0]));
    expect(() => requireFixtures(path, 1, head, tree)).toThrow();
    write('cleanup.json', [...cleanup.slice(1), { name: 'browser', status: 'failed' }]);
    expect(() => requireFixtures(path, 1, head, tree)).toThrow();
    write('cleanup.json', cleanup);
    write('fixture-worker-exit.json', { exitCode: 1 });
    expect(() => requireFixtures(path, 1, head, tree)).toThrow();
  });
  it('keeps isolated parallel producers and an always-running required aggregate', () => {
    const yaml = createRequire(import.meta.url)('js-yaml') as { load(source: string): unknown };
    const workflow = yaml.load(readFileSync(
      resolve('../.github/workflows/credential-free-inventory.yml'), 'utf8')) as {
      jobs: Record<string, { name: string; needs?: string[]; if?: string;
        strategy?: { 'fail-fast': boolean; 'max-parallel': number; matrix: { journey: string[] } };
        steps: { uses?: string; name?: string; run?: string; with?: Record<string, unknown> }[] }>;
    };
    for (const job of Object.values(workflow.jobs)) {
      const setup = job.steps.find(step => step.uses === 'actions/setup-node@v7');
      if (!setup) continue;
      expect(setup.with?.['node-version']).toBe('24.21.0');
      expect(job.steps.find(step => step.name === 'Match deployed npm runtime')?.run)
        .toBe('npm install --global npm@11.19.0');
    }
    const aggregate = workflow.jobs['trainer2-combined-acceptance'];
    expect(aggregate.name).toBe('Trainer2 disposable combined acceptance');
    expect(aggregate.if).toBe('${{ always() }}');
    expect(aggregate.needs).toEqual(['trainer2-production-artifact', 'trainer2-browser']);
    const browser = workflow.jobs['trainer2-browser'];
    expect(browser.strategy).toEqual({ 'fail-fast': false, 'max-parallel': 3,
      matrix: { journey: ['equipment', 'navigation', 'logger'] } });
    for (const id of ['trainer2-production-artifact', 'trainer2-browser']) {
      const job = workflow.jobs[id];
      expect(job.needs).toBeUndefined();
      expect(isolatedLinuxJob('linux', {
        TRAINER2_ISOLATED_LINUX_JOB: '1', CI: 'true', GITHUB_ACTIONS: 'true',
        RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_JOB: id,
      })).toBe(true);
      expect(job.steps.find(step => step.uses === 'actions/checkout@v7')?.with?.ref)
        .toBe('${{ github.event.pull_request.head.sha }}');
    }
    const production = workflow.jobs['trainer2-production-artifact'];
    const buildStep = production.steps.find(step => step.name === 'Build synthetic V2 production artifact');
    const invalidIcon = production.steps.find(step =>
      step.name === 'Reject isolated known-invalid RGB favicon');
    expect(invalidIcon?.run).toContain('test "$result" -ne 0');
    expect(invalidIcon?.run).toContain('test "$result" -ne 124');
    expect(invalidIcon?.run).toContain('test "$result" -ne 137');
    expect(invalidIcon?.run).toContain('The PNG is not in RGBA format');
    expect(buildStep?.run).toContain('npm run build >');
    expect(buildStep?.run).not.toContain('--webpack');
    expect(production.steps.some(step => step.name === 'Record successful build identity')).toBe(true);
    for (const job of [production, browser]) {
      expect(job.steps.find(step => step.name === 'Record exact source')?.run)
        .toContain('git merge-base --is-ancestor');
    }
    expect(browser.steps.some(step =>
      step.name === 'Build synthetic V2 production artifact')).toBe(false);
    expect(workflow.jobs['trainer2-production-artifact'].steps.some(step =>
      step.name === 'Prepare disposable dependencies')).toBe(false);
  });
});
