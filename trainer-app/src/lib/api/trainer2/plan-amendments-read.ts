import type { Prisma } from '@prisma/client';
import { amendmentBinding, amendmentContent } from '../../trainer2-contracts/plan-exercise-amendment';
import { canonicalJson, integrityHash } from './integrity';
export async function readPlanAmendments(tx: Prisma.TransactionClient, accountId: string, planId: string) {
  const rows = await tx.$queryRaw<{ version: number; actionId: string; contentHash: string; content: unknown; canonicalContent: string }[]>`
    SELECT "version","actionId","contentHash","content","canonicalContent" FROM "Trainer2PlanExerciseAmendment"
    WHERE "accountId"=${accountId} AND "planId"=${planId}::uuid ORDER BY "version"`;
  const contents = rows.map((r, i) => {
    const content = amendmentContent.parse(r.content);
    if (r.version !== i + 1 || canonicalJson(content) !== r.canonicalContent || integrityHash(r.canonicalContent) !== r.contentHash) throw new Error('INVALID_PLAN_AMENDMENT');
    return content;
  });
  const last = rows.at(-1);
  return { contents, binding: last ? amendmentBinding.parse({ version: last.version, actionId: last.actionId, contentHash: last.contentHash }) : null };
}
