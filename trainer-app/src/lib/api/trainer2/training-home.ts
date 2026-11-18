import type { PrismaClient } from "@prisma/client";
import { authorizeAccount, type ServerPrincipal } from "./principal";

/** Account-scoped navigation only; never allocates planning or training state. */
export async function readTrainingHome(db: PrismaClient, principal: ServerPrincipal) {
  await authorizeAccount(db, principal);
  const plans = await db.trainer2Plan.findMany({
    where: { accountId: principal.accountId, tombstonedAt: null },
    select: { id: true, lifecycle: true, currentRevisionId: true }, orderBy: { id: "asc" },
  });
  const revisions = plans.length ? await db.trainer2PlanRevision.findMany({
    where: { accountId: principal.accountId, OR: plans.map(plan => ({
      planId: plan.id, id: plan.currentRevisionId,
    })) },
    select: { id: true, planId: true, document: true, createdAt: true },
  }) : [];
  // Navigation labels only. Opening a plan still uses the canonical validated read.
  return { plans: plans.map(plan => {
    const revision = revisions.find(row => row.id === plan.currentRevisionId && row.planId === plan.id);
    const document = revision?.document;
    const name = document && typeof document === 'object' && !Array.isArray(document) &&
      typeof document.name === 'string' && document.name.trim() ? document.name : 'Saved program';
    return { id: plan.id, lifecycle: plan.lifecycle, name,
      savedAt: revision?.createdAt.toISOString() ?? null };
  }) };
}
