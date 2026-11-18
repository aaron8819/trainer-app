import type { Prisma, PrismaClient } from '@prisma/client';
import { amendPendingExerciseCommand, amendmentPreviewRequest, amendmentContent } from '../../trainer2-contracts/plan-exercise-amendment';
import { amendedOccurrence, backExtensionAmendment, pendingBackExtensionPositions } from '../../engine/trainer2/plan-exercise-amendment';
import { restrictionIssues } from '../../engine/trainer2/instructions';
import { activeSource } from './execution';
import { readPlanAmendments } from './plan-amendments-read';
import { readOccurrenceResolution } from './occurrence-resolution';
import { readInstructions } from './instructions';
import { acceptCommand, CommandFailure } from './command';
import { authorizeAccount, type ServerPrincipal } from './principal';
import { canonicalJson, integrityHash } from './integrity';
export async function previewPendingExerciseAmendment(tx: Prisma.TransactionClient, principal: ServerPrincipal, input: unknown) {
  await authorizeAccount(tx, principal);
  const request = amendmentPreviewRequest.parse(input);
  const { revision, intent } = await activeSource(tx, principal.accountId, request.planId);
  const amendments = await readPlanAmendments(tx, principal.accountId, request.planId);
  const effective = { ...intent, occurrences: intent.occurrences.map(o => amendedOccurrence(o, amendments.contents)) };
  const resolution = await readOccurrenceResolution(tx, principal.accountId, request.planId);
  const started = await tx.trainer2Execution.findMany({ where: { accountId: principal.accountId, planId: request.planId }, select: { occurrenceId: true } });
  const eligible = pendingBackExtensionPositions(effective, new Set([...resolution.resolvedIds, ...started.map(e => e.occurrenceId)]));
  if (request.intent.positions.some(p => !eligible.some(e => e.occurrenceId === p.occurrenceId && e.positionId === p.positionId))) throw new CommandFailure('POSITION_NOT_PENDING', true);
  const content = amendmentContent.parse(backExtensionAmendment(effective, request.intent.positions));
  const instructions = await readInstructions(tx, principal.accountId);
  const changed = { ...effective, occurrences: effective.occurrences.map(o => amendedOccurrence(o, [content])) };
  if (restrictionIssues(instructions.document, request.planId, changed, new Date().toISOString(), revision.id)
    .some(i => request.intent.positions.some(p => p.occurrenceId === i.occurrenceId && p.positionId === i.positionId))) throw new CommandFailure('UNRESOLVED_EXCLUSION');
  return { planId: request.planId, expected: { planRevisionId: revision.id, amendmentVersion: amendments.binding?.version ?? 0,
    instructionEpoch: instructions.epoch, effectiveHash: integrityHash(canonicalJson(content)) }, content };
}
export async function amendPendingExercise(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = amendPendingExerciseCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const value = await previewPendingExerciseAmendment(tx, principal, { planId: command.target.planId, intent: command.intent });
    if (canonicalJson(value.expected) !== canonicalJson(command.expected)) throw new CommandFailure('STALE_AMENDMENT', true);
    const version = value.expected.amendmentVersion + 1;
    await tx.$executeRaw`INSERT INTO "Trainer2PlanExerciseAmendment" ("accountId","planId","revisionId","actionId","version","instructionEpoch","contentHash","canonicalContent","content")
      VALUES (${principal.accountId},${value.planId}::uuid,${value.expected.planRevisionId}::uuid,${command.actionId}::uuid,${version},${value.expected.instructionEpoch},${value.expected.effectiveHash},${canonicalJson(value.content)},${JSON.stringify(value.content)}::jsonb)`;
    return { planId: value.planId, version, contentHash: value.expected.effectiveHash };
  });
}
