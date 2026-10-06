import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { makeVerifier } from "./sessions";
import { assertEpochCapacity } from "./session-epoch";

export type OwnerTransitionArchive = {
  version: 2;
  owner: { id: number; accountId: string; sessionEpoch: number };
  sessions: Array<{ id: string; ownerId: number; epoch: number; createdAt: Date;
    renewedAt: Date; expiresAt: Date; absoluteExpiresAt: Date; revokedAt: Date | null }>;
};

/** Operator-only. The private attribution manifest contains no authentication material.
 * The bounded operator runner durably publishes/readbacks it before any writes.
 */
export async function transitionSyntheticOwner(db: PrismaClient, input: {
  expectedSyntheticAccountId: string;
  verifiedRealAccountId: string;
  verifiedRealEmail?: string;
  expectedSessionEpoch?: number;
  expectedSessionCount?: number;
  setupCode: string;
  preserveArchive: (archive: OwnerTransitionArchive) => Promise<void>;
}) {
  const ids = [input.expectedSyntheticAccountId, input.verifiedRealAccountId];
  if (ids.some(id => !/^[0-9a-f-]{36}$/i.test(id)) || ids[0] === ids[1] ||
    input.setupCode.length < 24 || input.setupCode.length > 128)
    throw new Error("INVALID_OWNER_TRANSITION_INPUT");
  const setupVerifier = await makeVerifier(input.setupCode);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Trainer2Owner" WHERE id = 1 FOR UPDATE`;
    const owners = await tx.trainer2Owner.findMany({ take: 2 });
    const owner = owners[0];
    if (owners.length !== 1 || owner.id !== 1 || owner.accountId !== ids[0] ||
      (input.expectedSessionEpoch !== undefined && owner.sessionEpoch !== input.expectedSessionEpoch))
      throw new Error("OWNER_TRANSITION_BINDING_MISMATCH");
    assertEpochCapacity(owner.sessionEpoch, 3);
    if (await tx.trainer2AccountPrincipal.count() !== 0)
      throw new Error("HISTORICAL_PRINCIPAL_REVIEW_REQUIRED");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ids[0]} OR id = ${ids[1]} FOR SHARE`;
    const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
    const synthetic = users.find(user => user.id === ids[0]);
    const real = users.find(user => user.id === ids[1]);
    if (!synthetic || !/^trainer2-hosted-synthetic-[0-9a-f-]+@example\.invalid$/.test(synthetic.email) ||
      !real || real.email.endsWith("@example.invalid") ||
      (input.verifiedRealEmail !== undefined && real.email !== input.verifiedRealEmail))
      throw new Error("OWNER_TRANSITION_USER_MISMATCH");

    // Discover every account-scoped Trainer2 table, including future additions.
    const tables = await tx.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND left(table_name, 8) = 'Trainer2'
        AND column_name = 'accountId' ORDER BY table_name`;
    if (!tables.some(table => table.table_name === "Trainer2Plan") ||
      !tables.some(table => table.table_name === "Trainer2SetResultRevision"))
      throw new Error("OWNER_TRANSITION_INVENTORY_INCOMPLETE");
    for (const { table_name: table } of tables) {
      if (!/^Trainer2[A-Za-z0-9]+$/.test(table)) throw new Error("INVALID_TRAINER2_TABLE");
      const rows = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT count(*) AS count FROM ${Prisma.raw(`public."${table}"`)}
        WHERE "accountId" = ${ids[1]}`);
      if (rows[0]?.count !== BigInt(0)) throw new Error("REAL_OWNER_TRAINER2_DATA_EXISTS");
    }
    await tx.$queryRaw`SELECT id FROM "Trainer2DeviceSession" ORDER BY id FOR UPDATE`;
    const sessions = await tx.trainer2DeviceSession.findMany({ orderBy: { id: "asc" }, select: {
      id: true, ownerId: true, epoch: true, createdAt: true, renewedAt: true,
      expiresAt: true, absoluteExpiresAt: true, revokedAt: true,
    } });
    if (input.expectedSessionCount !== undefined && sessions.length !== input.expectedSessionCount)
      throw new Error("OWNER_TRANSITION_SESSION_COUNT_MISMATCH");
    await input.preserveArchive({ version: 2, owner: {
      id: owner.id, accountId: owner.accountId, sessionEpoch: owner.sessionEpoch,
    }, sessions });
    await tx.trainer2DeviceSession.updateMany({ where: { ownerId: 1, revokedAt: null },
      data: { revokedAt: new Date() } });
    await tx.trainer2Owner.update({ where: { id: 1 }, data: {
      accountId: ids[1], passcodeVerifier: null, setupVerifier,
      failedAttempts: 0, lockedUntil: null, sessionEpoch: owner.sessionEpoch + 1,
    } });
    return { archivedSessionCount: sessions.length, setupRequired: true as const };
  }, { isolationLevel: "Serializable", timeout: 30000 });
}
