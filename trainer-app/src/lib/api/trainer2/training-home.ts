import type { PrismaClient } from "@prisma/client";
import { authorizeAccount, type ServerPrincipal } from "./principal";

/** Account-scoped navigation only; never allocates planning or training state. */
export async function readTrainingHome(db: PrismaClient, principal: ServerPrincipal) {
  await authorizeAccount(db, principal);
  const plans = await db.trainer2Plan.findMany({
    where: { accountId: principal.accountId, tombstonedAt: null },
    select: { id: true, lifecycle: true }, orderBy: { id: "asc" },
  });
  return { plans };
}
