import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ACTIVATION_POLICY, emptyInstructions, instructionCommand, instructionDocument, type InstructionSnapshot, type ActivationReview } from '../../trainer2-contracts/activation';
import type { SavedPlanReview } from '../../engine/trainer2/plan-review';
import { restrictionIssues } from '../../engine/trainer2/instructions';
import { catalog } from '../../engine/trainer2/catalog';
import { readSavedDocument } from '../../engine/trainer2/planning';
import { canonicalJson, integrityHash } from './integrity';
import { acceptCommand, CommandFailure } from './command';
import type { ServerPrincipal } from './principal';

export async function readInstructions(db: Prisma.TransactionClient, accountId: string): Promise<InstructionSnapshot> {
  const state = await db.trainer2AccountTrainingState.findUnique({ where: { accountId } });
  const epoch = state?.instructionEpoch ?? 0;
  if (!epoch) return { epoch: 0, revisionId: null, document: emptyInstructions(), contentHash: integrityHash(canonicalJson(emptyInstructions())) };
  const row = await db.trainer2InstructionRevision.findUniqueOrThrow({ where: { accountId_epoch: { accountId, epoch } } });
  const document = instructionDocument.parse(row.document);
  if (row.contentHash !== integrityHash(canonicalJson(document))) throw new Error('INVALID_INSTRUCTION_INTEGRITY');
  return { epoch, revisionId: row.id, contentHash: row.contentHash, document };
}
export function reviewActivation(review: SavedPlanReview, instructions: InstructionSnapshot, at = new Date().toISOString()): ActivationReview {
  const binding = { accountId: review.accountId, planId: review.planId, revisionId: review.revisionId, reviewDigest: review.digest,
    instructionEpoch: instructions.epoch, instructionRevisionId: instructions.revisionId, instructionHash: instructions.contentHash,
    restrictionIssues: restrictionIssues(instructions.document, review.planId, review.intent, at, review.revisionId), policyVersion: ACTIVATION_POLICY } as const;
  return { binding, digest: integrityHash(canonicalJson(binding)), instructions, evaluatedAt: at };
}
async function requireNewInstructionIds(tx: Prisma.TransactionClient, accountId: string, ids: string[]) {
  const used = await tx.$queryRaw<{ used: boolean }[]>`SELECT EXISTS (
    SELECT 1 FROM "Trainer2InstructionRevision" r,
    LATERAL (
      SELECT v->>'id' AS id FROM jsonb_array_elements(r."document"->'restrictions') v
      UNION ALL SELECT v->>'revisionId' FROM jsonb_array_elements(r."document"->'restrictions') v
      UNION ALL SELECT v->>'id' FROM jsonb_array_elements(r."document"->'exceptions') v
    ) identity WHERE r."accountId"=${accountId} AND identity.id=ANY(${ids}::text[])
  ) AS used`;
  if (used[0].used) throw new CommandFailure('IDENTITY_REUSED');
}
export async function changeInstructions(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = instructionCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const snapshot = await readInstructions(tx, principal.accountId);
    if (snapshot.epoch !== command.expected.instructionEpoch) throw new CommandFailure('STALE_INSTRUCTIONS', true);
    const document = structuredClone(snapshot.document);
    const op = command.intent;
    if (op.operation === 'AddRestriction') {
      const r = op.restriction;
      if (r.cleared || !catalog.some(e => e.id === r.catalogId)) throw new CommandFailure('INVALID_RESTRICTION');
      if (r.id === r.revisionId) throw new CommandFailure('IDENTITY_REUSED');
      await requireNewInstructionIds(tx, principal.accountId, [r.id, r.revisionId]);
      if (r.planId && !await tx.trainer2Plan.findFirst({ where: { id: r.planId, accountId: principal.accountId, tombstonedAt: null } })) throw new CommandFailure('NOT_FOUND');
      document.restrictions.push(r);
    } else if (op.operation === 'ClearRestriction') {
      const r = document.restrictions.find(v => v.revisionId === op.restrictionRevisionId && !v.cleared);
      if (!r) throw new CommandFailure('STALE_INSTRUCTIONS', true);
      await requireNewInstructionIds(tx, principal.accountId, [op.newRevisionId]);
      r.revisionId = op.newRevisionId; r.cleared = true;
    } else {
      const e = op.exception;
      const r = document.restrictions.find(v => v.revisionId === e.restrictionRevisionId && !v.cleared);
      if (!r || (r.planId && r.planId !== e.planId)) throw new CommandFailure('STALE_INSTRUCTIONS', true);
      await requireNewInstructionIds(tx, principal.accountId, [e.id]);
      const plan = await tx.trainer2Plan.findFirst({ where: { id: e.planId, accountId: principal.accountId, tombstonedAt: null } });
      if (!plan) throw new CommandFailure('NOT_FOUND');
      if (plan.currentRevisionId !== e.planRevisionId) throw new CommandFailure('STALE_REVIEW', true);
      const revision = await tx.trainer2PlanRevision.findFirstOrThrow({ where: { id: plan.currentRevisionId, accountId: principal.accountId, planId: plan.id } });
      const ids = new Set(readSavedDocument(revision.document).occurrences.flatMap(o => o.positions.map(p => p.id)));
      if (e.positionIds.some(p => !ids.has(p))) throw new CommandFailure('INVALID_EXCEPTION_SCOPE');
      if (Date.parse(e.from) < Date.parse(r.from) || (r.until && (!e.until || Date.parse(e.until) > Date.parse(r.until)))) throw new CommandFailure('INVALID_EXCEPTION_VALIDITY');
      document.exceptions.push(e);
    }
    const checked = instructionDocument.parse(document);
    const epoch = snapshot.epoch + 1;
    const instructionRevisionId = randomUUID();
    const canonicalContent = canonicalJson(checked);
    await tx.trainer2InstructionRevision.create({ data: { id: instructionRevisionId, accountId: principal.accountId,
      epoch, actionId: command.actionId, document: checked, canonicalContent, contentHash: integrityHash(canonicalContent) } });
    await tx.trainer2AccountTrainingState.update({ where: { accountId: principal.accountId }, data: { instructionEpoch: epoch } });
    return { instructionRevisionId, instructionEpoch: epoch };
  });
}
