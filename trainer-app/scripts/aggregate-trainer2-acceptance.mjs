import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @param {unknown} needs */
export function requireSuccessfulJobs(needs) {
  assert(needs && typeof needs === 'object' && !Array.isArray(needs), 'Missing job results');
  for (const id of ['trainer2-production-artifact', 'trainer2-browser']) {
    assert(id in needs, `Missing job: ${id}`);
    const job = Reflect.get(needs, id);
    assert(job && typeof job === 'object' && job.result === 'success', `Job not successful: ${id}`);
  }
}

/** @param {string} directory @param {string} head @param {string} tree */
export function requireComponent(directory, head, tree) {
  const source = readFileSync(join(directory, 'source.txt'), 'utf8').trim().split(/\r?\n/);
  assert.deepEqual(source, [head, tree], 'Component source differs or was dirty');
}

/** @param {string} directory @param {string} base */
export function requireBase(directory, base) {
  assert(/^[a-f0-9]{40}$/.test(base), 'Missing exact base');
  assert.equal(readFileSync(join(directory, 'base.txt'), 'utf8').trim(), base,
    'Component base differs');
}

/** @param {string} directory @param {string} lockfileHash @param {number} nodeMajor */
export function requireBuild(directory, lockfileHash, nodeMajor) {
  const build = JSON.parse(readFileSync(join(directory, 'build.json'), 'utf8'));
  assert.equal(build.command, 'npm run build', 'Unexpected build command');
  assert.equal(build.packageBuild, 'next build', 'Package build contract drift');
  assert.equal(build.lockfileHash, lockfileHash, 'Build lockfile differs');
  assert.equal(Number(build.node?.match(/^v(\d+)\.\d+\.\d+$/)?.[1]), nodeMajor,
    'Build Node runtime differs');
  assert(/^\d+\.\d+\.\d+$/.test(build.npm), 'Missing npm version');
  assert(/^16\./.test(build.next), 'Unexpected Next build major');
  assert(typeof build.buildId === 'string' && /^[A-Za-z0-9_-]+$/.test(build.buildId),
    'Missing build identity');
  assert(readFileSync(join(directory, 'production-build.log'), 'utf8').includes('(Turbopack)'),
    'Missing deployed Turbopack build evidence');
  return build;
}

/** @param {string} directory @param {string[]} names */
export function requireExits(directory, names) {
  for (const name of names) {
    assert.equal(readFileSync(join(directory, `${name}.exit`), 'utf8').trim(), '0',
      `Missing or failed qualification: ${name}`);
  }
}

/** @param {string} directory @param {number} expectedFixtures
 * @param {string} head @param {string} tree */
export function requireFixtures(directory, expectedFixtures, head, tree) {
  const fixtures = readdirSync(directory, { withFileTypes: true }).filter(e => e.isDirectory());
  assert.equal(fixtures.length, expectedFixtures, 'Missing or unexpected fixture');
  for (const fixture of fixtures) {
    const location = join(directory, fixture.name);
    const report = JSON.parse(readFileSync(join(location, 'report.json'), 'utf8'));
    assert.equal(report.source?.commit, head, 'Fixture commit mismatch');
    assert.equal(report.source?.tree, tree, 'Fixture tree mismatch');
    assert.equal(report.source?.dirtyState, '', 'Dirty fixture source');
    assert(Array.isArray(report.checks) && report.checks.length > 0, 'Empty fixture assertions');
    assert.deepEqual(report.errors, [], 'Fixture browser errors');
    const cleanup = JSON.parse(readFileSync(join(location, 'cleanup.json'), 'utf8'));
    const expectedCleanup = ['browser connection', 'browser', 'browser worker completion',
      'Next process tree', 'Next pipes', 'Next worker completion', 'identity client',
      'runtime client', 'read client', 'admin pool', 'native fixture cluster', 'fixture container'];
    assert(Array.isArray(cleanup), 'Missing cleanup');
    assert.deepEqual(cleanup.map(step => step.name).sort(), expectedCleanup.sort(),
      'Missing or duplicated cleanup step');
    assert(cleanup.length === 12 &&
      cleanup.every(step => step.status === 'passed'), 'Missing or failed fixture cleanup');
    const worker = JSON.parse(readFileSync(join(location, 'fixture-worker-exit.json'), 'utf8'));
    assert.equal(worker.exitCode, 0, 'Fixture worker failed');
  }
}

export function aggregateAcceptance() {
  const base = resolve('trainer-app/artifacts/parallel-acceptance');
  mkdirSync(base, { recursive: true });
  const head = process.env.ACCEPTANCE_HEAD;
  const candidateBase = process.env.ACCEPTANCE_BASE;
  const run = process.env.ACCEPTANCE_RUN;
  const attempt = process.env.ACCEPTANCE_ATTEMPT;
  const receipt = { head, base: candidateBase, run, attempt, success: false, tree: '', build: null, error: '' };
  try {
    assert(head && /^[a-f0-9]{40}$/.test(head), 'Missing exact head');
    assert(run && /^\d+$/.test(run) && attempt && /^\d+$/.test(attempt), 'Missing run identity');
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
    assert.equal(git('rev-parse', 'HEAD'), head, 'Aggregate checkout mismatch');
    assert.equal(git('status', '--porcelain'), '', 'Dirty aggregate source');
    receipt.tree = git('rev-parse', 'HEAD^{tree}');
    assert(candidateBase && /^[a-f0-9]{40}$/.test(candidateBase), 'Missing exact base');
    git('merge-base', '--is-ancestor', candidateBase, head);
    requireSuccessfulJobs(JSON.parse(process.env.ACCEPTANCE_NEEDS ?? 'null'));
    const component = name => join(base, `trainer2-acceptance-${name}-${head}-${run}-${attempt}`);
    requireComponent(component('build'), head, receipt.tree);
    requireBase(component('build'), candidateBase);
    const policy = JSON.parse(readFileSync('scripts/codex/trainer-policy.v1.json', 'utf8'));
    const nodeMajor = policy.verification.exactTreeEvidence.checks[0].definition.nodeMajor;
    receipt.build = requireBuild(component('build'),
      createHash('sha256').update(readFileSync('trainer-app/package-lock.json')).digest('hex'), nodeMajor);
    requireExits(component('build'), ['invalid-rgb', 'production-build', 'production-artifact']);
    for (const name of ['equipment', 'navigation', 'logger']) {
      const directory = component(name);
      requireComponent(join(directory, 'linux-qualification'), head, receipt.tree);
      requireBase(join(directory, 'linux-qualification'), candidateBase);
      requireExits(join(directory, 'linux-qualification'), [name]);
      requireFixtures(join(directory, 'trainer2'), name === 'navigation' ? 2 : 1,
        head, receipt.tree);
    }
    receipt.success = true;
  } catch (error) {
    receipt.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  }
  writeFileSync(join(base, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  aggregateAcceptance();
}
