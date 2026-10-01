import type { Prisma } from '@prisma/client';
import { setAddition } from '../../trainer2-contracts/add-set';

export async function readSetAdditions(tx: Prisma.TransactionClient, accountId: string, executionId: string) {
  const rows = await tx.$queryRaw<{ executionId: string; actionId: string; contentHash: string; content: unknown; recordedAt: Date }[]>`
    SELECT "executionId","actionId","contentHash","content","recordedAt" FROM "Trainer2SetAddition"
    WHERE "accountId"=${accountId} AND "executionId"=${executionId}::uuid ORDER BY "positionId","ordinal"`;
  return rows.map(r => setAddition.parse({ ...r, recordedAt: r.recordedAt.toISOString() }));
}
