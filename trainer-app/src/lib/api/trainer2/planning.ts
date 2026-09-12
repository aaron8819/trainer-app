import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { createDraftCommand, editDraftCommand, draftDocument, activationBlockers,
  type DraftCommand, type DraftDocument, type DraftOutcome, type CommandResponse } from "../../trainer2-contracts/draft";
import { DraftFailure, editDocument, identities, validateWorkoutDefaults } from "../../engine/trainer2/planning";
import { canonicalJson, commandBinding, integrityHash } from "./integrity";

import { authorizeAccount as authorize, DraftAccessError, type ServerPrincipal } from "./principal";
export { DraftAccessError, type ServerPrincipal } from "./principal";
export class ActionCollision extends Error { constructor() { super("ACTION_ID_COLLISION"); } }
export async function readDraft(db: PrismaClient | Prisma.TransactionClient, principal: ServerPrincipal, planId: string) {
  await authorize(db, principal);
  const plan = await db.trainer2Plan.findFirst({ where: { id: planId, accountId: principal.accountId, tombstonedAt: null } });
  if (!plan) return null;
  const revision = await db.trainer2PlanRevision.findFirstOrThrow({ where: { id: plan.currentRevisionId, planId, accountId: principal.accountId } });
  const intent = draftDocument.parse(revision.document);
  return { planId, revisionId: revision.id, revisionNumber: revision.revisionNumber, contentHash: revision.contentHash,
    intent, activationBlockers: activationBlockers(intent) };
}
export function createDraft(db: PrismaClient, principal: ServerPrincipal, input: unknown): Promise<CommandResponse> {
  return acceptDraft(db, principal, input, "CreateDraft");
}
export function editDraft(db: PrismaClient, principal: ServerPrincipal, input: unknown): Promise<CommandResponse> {
  return acceptDraft(db, principal, input, "EditDraft");
}
async function acceptDraft(db: PrismaClient, principal: ServerPrincipal, input: unknown, type: DraftCommand["commandType"]): Promise<CommandResponse> {
  const schema = type === "CreateDraft" ? createDraftCommand : editDraftCommand;
  const command = schema.parse(input);
  if (command.originatingAccountId !== principal.accountId) throw new DraftAccessError("ACCOUNT_MISMATCH");
  const binding = commandBinding(input);
  await authorize(db, principal);
  // Retry only transaction infrastructure conflicts, retaining the same complete envelope.
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await tx.$executeRaw`INSERT INTO "Trainer2AccountTrainingState" ("accountId") VALUES (${principal.accountId}) ON CONFLICT DO NOTHING`;
        await tx.$queryRaw`SELECT "accountId" FROM "Trainer2AccountTrainingState" WHERE "accountId"=${principal.accountId} FOR UPDATE`;
        await authorize(tx, principal);
        const existing = await tx.trainer2DurableAction.findUnique({ where: { accountId_actionId: { accountId: principal.accountId, actionId: command.actionId } } });
        if (existing) {
          if (existing.envelopeHash !== binding.envelopeHash || existing.submittedEnvelope !== binding.submittedEnvelope) throw new ActionCollision();
          const saved = await tx.trainer2ActionOutcome.findFirstOrThrow({ where: { accountId: principal.accountId, actionId: command.actionId }, orderBy: { outcomeCursor: "desc" } });
          return { outcome: saved.outcome as DraftOutcome, replayed: true, outcomeCursor: saved.outcomeCursor.toString() };
        }
        await tx.trainer2DurableAction.create({ data: { accountId: principal.accountId, actionId: command.actionId, ...binding } });
        const state = await tx.trainer2AccountTrainingState.findUniqueOrThrow({ where: { accountId: principal.accountId } });
        let outcome: DraftOutcome;
        try {
          if (command.dependsOn.length) throw new DraftFailure("DEPENDENCIES_UNSUPPORTED");
          if (command.ownershipEpoch !== state.ownershipEpoch) throw new DraftFailure("OWNERSHIP_EPOCH");
          const plan = await tx.trainer2Plan.findFirst({ where: { id: command.target.planId, accountId: principal.accountId } });
          if (plan?.tombstonedAt) throw new DraftFailure("TOMBSTONED");
          let intent: DraftDocument;
          let parentRevisionId: string | null = null;
          let revisionNumber = 1;
          const historical = await tx.trainer2Identity.findMany({ where: { accountId: principal.accountId, planId: command.target.planId } });
          if (command.commandType === "CreateDraft") {
            if (await tx.trainer2Plan.findUnique({ where: { id: command.target.planId } })) throw new DraftFailure("IDENTITY_REUSED");
            intent = command.intent;
            validateWorkoutDefaults(intent);
          } else {
            if (!plan) throw new DraftFailure("NOT_FOUND");
            if (plan.currentRevisionId !== command.expected.planRevisionId) throw new DraftFailure("STALE_REVISION");
            const previous = await tx.trainer2PlanRevision.findUniqueOrThrow({ where: { id: plan.currentRevisionId } });
            parentRevisionId = previous.id;
            revisionNumber = previous.revisionNumber + 1;
            intent = editDocument(draftDocument.parse(previous.document), command, new Set(historical.map(i => i.id)));
          }
          const known = new Set(historical.map(i => i.id));
          const additions = identities(intent).filter(i => !known.has(i.id));
          if (await tx.trainer2Identity.count({ where: { id: { in: additions.map(i => i.id) } } })) throw new DraftFailure("IDENTITY_REUSED");
          const revisionId = randomUUID();
          const canonicalContent = canonicalJson(intent);
          const contentHash = integrityHash(canonicalContent);
          // All semantic failures are above the first domain write. SQL failures abort
          // the entire transaction, including the new action and counters.
          if (!plan) await tx.trainer2Plan.create({ data: { id: command.target.planId, accountId: principal.accountId, currentRevisionId: revisionId } });
          await tx.trainer2PlanRevision.create({ data: { id: revisionId, accountId: principal.accountId, planId: command.target.planId,
            revisionNumber, parentRevisionId, actionId: command.actionId, document: intent, canonicalContent, contentHash } });
          if (additions.length) await tx.trainer2Identity.createMany({ data: additions.map(i => ({ ...i, accountId: principal.accountId, planId: command.target.planId, firstRevisionId: revisionId })) });
          if (plan) await tx.trainer2Plan.update({ where: { id: plan.id }, data: { currentRevisionId: revisionId } });
          const updated = await tx.trainer2AccountTrainingState.update({ where: { accountId: principal.accountId }, data: { acceptedSequence: { increment: 1 } } });
          outcome = { status: "Accepted", actionId: command.actionId, commandType: command.commandType, acceptedSequence: updated.acceptedSequence.toString(),
            result: { planId: command.target.planId, revisionId, revisionNumber, contentHash } };
        } catch (error) {
          if (!(error instanceof DraftFailure)) throw error;
          outcome = { status: error.code === "STALE_REVISION" ? "Conflict" : "Rejected", actionId: command.actionId, commandType: command.commandType, code: error.code };
        }
        const saved = await tx.trainer2ActionOutcome.create({ data: { accountId: principal.accountId, actionId: command.actionId, status: outcome.status, outcome } });
        return { outcome, replayed: false, outcomeCursor: saved.outcomeCursor.toString() };
      }, { maxWait: 10_000, timeout: 15_000 });
    } catch (error) {
      if (attempt < 2 && (error as { code?: string }).code === "P2034") continue;
      throw error;
    }
  }
}

// Internal read primitive only; sync HTTP/dependency workers are deferred.
// Page from an immutable journal, bounded by a captured committed high-water mark.
export async function readOutcomeChanges(db: PrismaClient, principal: ServerPrincipal, after: bigint, through?: bigint, limit = 100) {
  await authorize(db, principal);
  if (after < BigInt(0) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_CURSOR");
  const state = await db.trainer2AccountTrainingState.findUnique({ where: { accountId: principal.accountId } });
  const highWater = state?.outcomeSequence ?? BigInt(0);
  const upper = through === undefined ? highWater : through;
  if (upper > highWater || upper < after) throw new Error("INVALID_CURSOR");
  const rows = await db.trainer2ActionOutcome.findMany({ where: { accountId: principal.accountId, outcomeCursor: { gt: after, lte: upper } }, orderBy: { outcomeCursor: "asc" }, take: limit });
  const next = rows.at(-1)?.outcomeCursor ?? upper;
  return { through: upper.toString(), next: next.toString(), changes: rows.map(r => ({ actionId: r.actionId, outcomeCursor: r.outcomeCursor.toString(), status: r.status, outcome: r.outcome })) };
}
