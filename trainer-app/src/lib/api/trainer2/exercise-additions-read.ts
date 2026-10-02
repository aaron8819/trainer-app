import type { Prisma } from '@prisma/client';
import { exerciseAddition } from '../../trainer2-contracts/add-exercise';

export async function readExerciseAdditions(tx: Prisma.TransactionClient, accountId: string, executionId: string) {
  const rows = await tx.$queryRaw<{ executionId: string; actionId: string; contentHash: string; content: unknown; recordedAt: Date }[]>`
    SELECT "executionId","actionId","contentHash","content","recordedAt" FROM "Trainer2ExerciseAddition"
    WHERE "accountId"=${accountId} AND "executionId"=${executionId}::uuid ORDER BY "ordinal"`;
  return rows.map(r => exerciseAddition.parse({ ...r, recordedAt: r.recordedAt.toISOString() }));
}
