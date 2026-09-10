// Next rejects this module in a client import graph. No identity enters a browser bundle.
import "next/headers";
import type { PrismaClient, Prisma } from "@prisma/client";

export class DraftAccessError extends Error {}
/** Output of a supported server verifier, never a request DTO or decoded token. */
export type VerifiedPrincipal = Readonly<{ issuer: string; subject: string }>;
export type ServerPrincipal = VerifiedPrincipal & Readonly<{ accountId: string }>;

export async function resolveAccount(db: PrismaClient | Prisma.TransactionClient, verified: VerifiedPrincipal): Promise<ServerPrincipal> {
  if (!verified.issuer || !verified.subject || verified.issuer.trim() !== verified.issuer || verified.subject.trim() !== verified.subject)
    throw new DraftAccessError("INVALID_PRINCIPAL");
  const mapping = await db.trainer2AccountPrincipal.findUnique({ where: { issuer_subject: {
    issuer: verified.issuer, subject: verified.subject,
  } } });
  if (!mapping) throw new DraftAccessError("UNAUTHORIZED");
  // No email matching, provisioning, or authorization cache. Read on every operation.
  return { issuer: mapping.issuer, subject: mapping.subject, accountId: mapping.accountId };
}

export async function authorizeAccount(db: PrismaClient | Prisma.TransactionClient, principal: ServerPrincipal) {
  const current = await resolveAccount(db, principal);
  if (current.accountId !== principal.accountId) throw new DraftAccessError("UNAUTHORIZED");
}
