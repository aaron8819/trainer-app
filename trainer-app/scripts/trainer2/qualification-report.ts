import type { CleanupResult } from './disposable-cleanup';

/** Preserve the assertion cause while still reporting every cleanup failure. */
export function finishQualification(primaryError: unknown, cleanup: CleanupResult[]): void {
  const failures = cleanup.filter(result => result.status !== 'passed');
  if (primaryError || failures.length) {
    throw new AggregateError([
      ...(primaryError ? [primaryError] : []),
      ...failures.map(result => new Error(`${result.name}: ${result.status}: ${result.error ?? ''}`)),
    ], primaryError ? 'Qualification assertions failed; see primary and cleanup receipts' : 'Qualification cleanup failed',
    { cause: primaryError });
  }
}
