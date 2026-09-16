import type { Prisma } from '@prisma/client';

// Planning derives resolution from immutable skip decisions and finished executions.
// Discarded attempts are history, never terminal occurrence evidence.
export async function readOccurrenceResolution(tx: Prisma.TransactionClient, accountId: string, planId: string) {
  const finished = await tx.trainer2Execution.findMany({ where: { accountId, planId, lifecycle: 'Finished' }, select: { occurrenceId: true, id: true } });
  const skips = await tx.trainer2OccurrenceSkip.findMany({ where: { accountId, planId } });
  return { finished, skips, resolvedIds: new Set([...finished, ...skips].map(o => o.occurrenceId)) };
}
