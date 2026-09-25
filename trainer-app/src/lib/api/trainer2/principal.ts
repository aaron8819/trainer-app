// Next rejects this module in a client import graph. No identity enters a browser bundle.
import "next/headers";
import type { PrismaClient, Prisma } from "@prisma/client";
import { sessionForRequest } from "./sessions";

export class DraftAccessError extends Error {}
export type ServerPrincipal = Readonly<{ accountId: string; sessionId: string }>;

export async function resolveAccount(db: PrismaClient | Prisma.TransactionClient, request: Request): Promise<ServerPrincipal> {
  return sessionForRequest(db, request);
}

export async function authorizeAccount(db: PrismaClient | Prisma.TransactionClient, principal: ServerPrincipal) {
  const rows = await db.trainer2Owner.findMany({ take: 2, select: { id: true, accountId: true, sessionEpoch: true } });
  const owner = rows[0];
  if (rows.length !== 1 || owner.id !== 1 || owner.accountId !== process.env.TRAINER2_OWNER_USER_ID ||
    owner.accountId !== principal.accountId) throw new DraftAccessError("UNAUTHORIZED");
  const session = await db.trainer2DeviceSession.findUnique({ where: { id: principal.sessionId },
    select: { ownerId: true, epoch: true, revokedAt: true, expiresAt: true, absoluteExpiresAt: true } });
  if (!session || session.ownerId !== owner.id || session.epoch !== owner.sessionEpoch ||
    session.revokedAt || session.expiresAt <= new Date() || session.absoluteExpiresAt <= new Date())
    throw new DraftAccessError("UNAUTHORIZED");
}
