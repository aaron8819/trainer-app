import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  requireComponent, requireExits, requireFixtures, requireSuccessfulJobs,
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
      expect(job.steps.find(step => step.uses === 'actions/checkout@v7')?.with?.ref)
        .toBe('${{ github.event.pull_request.head.sha }}');
    }
    expect(browser.steps.some(step =>
      step.name === 'Build synthetic V2 production artifact')).toBe(false);
    expect(workflow.jobs['trainer2-production-artifact'].steps.some(step =>
      step.name === 'Prepare disposable dependencies')).toBe(false);
  });
});
