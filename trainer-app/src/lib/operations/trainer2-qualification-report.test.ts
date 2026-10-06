// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { cleanupSteps, runCleanupCommand } from '../../../scripts/trainer2/disposable-cleanup';
import { finishQualification } from '../../../scripts/trainer2/qualification-report';

describe('qualification reporting', () => {
  it.skipIf(process.platform !== 'win32')('pins native observer modules despite a PowerShell 7 module path', async () => {
    const result = await runCleanupCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::Write($env:PSModulePath)'], 10_000, { ...process.env, PSModulePath: 'C:\\incompatible-powershell7-modules' });
    expect(result.status).toBe(0); expect(result.error).toBeUndefined();
    expect(result.stdout.toLowerCase()).toContain(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\Modules`.toLowerCase());
    expect(result.stdout).not.toContain('incompatible-powershell7-modules');
  });
  it('retains the shutdown operation as primary cause while cleanup continues', async () => {
    const primary = new Error('OWNED_BROWSER_CONNECTION_DISPOSE_TIMEOUT');
    let continued = false;
    const cleanup = await cleanupSteps([
      { name: 'context close', timeoutMs: 10, run: () => new Promise(() => {}) },
      { name: 'server', run: () => { continued = true; } },
    ]);
    expect(continued).toBe(true);
    expect(cleanup.map(step => step.status)).toEqual(['timed-out', 'passed']);
    try { finishQualification(primary, cleanup); throw new Error('Expected failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).cause).toBe(primary);
      expect((error as AggregateError).errors[0]).toBe(primary);
      expect((error as AggregateError).errors[1].message).toContain('context close: timed-out');
    }
  });
  it('fails cleanup even when assertions passed', () => {
    expect(() => finishQualification(undefined, [{ name: 'child close', status: 'failed', error: 'unobserved' }])).toThrow('cleanup failed');
    expect(() => finishQualification(undefined, [{ name: 'child close', status: 'passed' }])).not.toThrow();
  });
});
