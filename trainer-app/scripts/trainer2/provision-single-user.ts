import type { PrismaClient } from "@prisma/client";
import { makeVerifier } from "../../src/lib/api/trainer2/sessions";

/** Operator-owned transaction. Caller must have separately verified the existing User.id. */
export async function provisionSingleUser(db: PrismaClient, accountId: string, setupCode: string) {
  if (!/^[0-9a-f-]{36}$/i.test(accountId) || setupCode.length < 24)
    throw new Error("INVALID_SINGLE_USER_PROVISIONING_INPUT");
  const verifier = await makeVerifier(setupCode);
  return db.$transaction(async tx => {
    if (await tx.trainer2AccountPrincipal.count() !== 0) throw new Error("HISTORICAL_PRINCIPAL_REVIEW_REQUIRED");
    if (await tx.trainer2Owner.count() !== 0) throw new Error("OWNER_ALREADY_BOUND");
    if (!(await tx.user.findUnique({ where: { id: accountId }, select: { id: true } })))
      throw new Error("EXISTING_USER_REQUIRED");
    return tx.trainer2Owner.create({ data: { id: 1, accountId, setupVerifier: verifier } });
  });
}
