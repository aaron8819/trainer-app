// Fixed labels only. Never emit connection strings, cookies, SQL or exception text.
export function infrastructureReason(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'timeout exceeded when trying to connect') return 'POOL_ACQUIRE_TIMEOUT';
  if (message === 'Connection terminated due to connection timeout') return 'CONNECTION_TIMEOUT';
  if (message === 'Connection terminated unexpectedly') return 'CONNECTION_TERMINATED';
  return 'UNCLASSIFIED';
}
export class AdmissionInfrastructureError extends Error {
  constructor(readonly phase: string, override readonly cause: unknown) { super('ADMISSION_INFRASTRUCTURE_FAILED'); }
}
