import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { createDraftCommand, editDraftCommand,
  type DraftCommand, type DraftDocument, type CommandResponse } from "../../trainer2-contracts/draft";
import { DraftFailure, editDocument, identities, validateWorkoutDefaults, readSavedDocument } from "../../engine/trainer2/planning";
import { canonicalJson, integrityHash } from "./integrity";
import { reviewPlan, REVIEW_POLICY, type SavedPlanReview } from '../../engine/trainer2/plan-review';
import { validateReviewResponse } from '../../engine/trainer2/review-response';

import { authorizeAccount as authorize, type ServerPrincipal } from "./principal";
export { DraftAccessError, type ServerPrincipal } from "./principal";
export { ActionCollision } from "./command";
import { readInstructions, reviewActivation } from "./instructions";
import { acceptCommand } from "./command";
export async function readDraft(db: PrismaClient | Prisma.TransactionClient, principal: ServerPrincipal, planId: string) {
  await authorize(db, principal);
  const plan = await db.trainer2Plan.findFirst({ where: { id: planId, accountId: principal.accountId, tombstonedAt: null } });
  if (!plan) return null;
  const revision = await db.trainer2PlanRevision.findFirstOrThrow({ where: { id: plan.currentRevisionId, planId, accountId: principal.accountId } });
  const intent = readSavedDocument(revision.document);
  const issues = reviewPlan(intent);
  const binding = { accountId: principal.accountId, planId, revisionId: revision.id, contentHash: revision.contentHash,
    progression: intent.progression ?? null, progressionHash: integrityHash(canonicalJson(intent.progression ?? null)), policyVersion: REVIEW_POLICY } as const;
  const review: SavedPlanReview = { ...binding, digest: integrityHash(canonicalJson(binding)), issues,
    status: issues.length ? 'issues' : 'validDraft', intent };
  const activation = reviewActivation(review, await readInstructions(db, principal.accountId));
  return validateReviewResponse({ planId, revisionId: revision.id, revisionNumber: revision.revisionNumber, contentHash: revision.contentHash,
    intent, review, state: { lifecycle: plan.lifecycle, initialApprovedRevisionId: plan.initialApprovedRevisionId }, activation,
    activationBlockers: [...issues.map(i => i.code), ...(activation.binding.restrictionIssues.length ? ['UNRESOLVED_EXCLUSION'] : [])] },
  { accountId: principal.accountId, planId, snapshot: { revisionId: revision.id, contentHash: revision.contentHash, intent } });
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
  return acceptCommand(db, principal, input, command, async tx => {
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
    if (plan.lifecycle !== "Draft") throw new DraftFailure("PLAN_NOT_DRAFT");
    if (plan.currentRevisionId !== command.expected.planRevisionId) throw new DraftFailure("STALE_REVISION");
    const previous = await tx.trainer2PlanRevision.findUniqueOrThrow({ where: { id: plan.currentRevisionId } });
    parentRevisionId = previous.id;
    revisionNumber = previous.revisionNumber + 1;
    intent = editDocument(readSavedDocument(previous.document), command, new Set(historical.map(i => i.id)));
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
    return { planId: command.target.planId, revisionId, revisionNumber, contentHash };
  });
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
