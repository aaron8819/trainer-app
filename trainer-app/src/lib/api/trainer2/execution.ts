import { readExerciseAdditions } from './exercise-additions-read';
import { readSetAdditions } from './set-additions-read';
import { readExerciseSwaps } from './exercise-swap';
import { readSetSkips } from './skip-set';
import { unresolvedOccurrences } from '../../engine/trainer2/occurrence-resolution';
import { readOccurrenceResolution } from './occurrence-resolution';
import { finishBinding } from '../../trainer2-contracts/workout-finish';
import { savedSetResult } from '../../trainer2-contracts/set-results';
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { initialPrescription, START_POLICY, startOccurrenceCommand, type ExecutionRead } from '../../trainer2-contracts/execution';
import { readSavedDocument } from '../../engine/trainer2/planning';
import { restrictionIssues } from '../../engine/trainer2/instructions';
import { reviewPlan } from '../../engine/trainer2/plan-review';
import { authorizeAccount, type ServerPrincipal } from './principal';
import { acceptCommand, CommandFailure } from './command';
import { readInstructions } from './instructions';
import { canonicalJson, integrityHash } from './integrity';

type DB = Prisma.TransactionClient;
export class InvalidStartSnapshot extends Error { constructor() { super('INVALID_START_SNAPSHOT'); } }
export async function activeSource(tx: DB, accountId: string, planId: string, allowCompleted = false) {
  const plan = await tx.trainer2Plan.findFirst({ where: { id: planId, accountId, tombstonedAt: null } });
  if (!plan) throw new CommandFailure('NOT_FOUND');
  if (plan.lifecycle !== 'Active' && !(allowCompleted && plan.lifecycle === 'Completed')) throw new CommandFailure('PLAN_NOT_ACTIVE', true);
  if (plan.currentRevisionId !== plan.initialApprovedRevisionId) throw new CommandFailure('INVALID_ACTIVATED_REVISION');
  const revision = await tx.trainer2PlanRevision.findFirstOrThrow({ where: { id: plan.currentRevisionId, planId, accountId } });
  const intent = readSavedDocument(revision.document);
  if (integrityHash(canonicalJson(intent)) !== revision.contentHash || reviewPlan(intent).length || !intent.progression)
    throw new CommandFailure('INVALID_SAVED_PLAN');
  return { plan, revision, intent };
}
export async function readExecution(tx: DB, principal: ServerPrincipal, executionId: string): Promise<ExecutionRead | null> {
  await authorizeAccount(tx, principal);
  const row = await tx.trainer2Execution.findFirst({ where: { id: executionId, accountId: principal.accountId } });
  if (!row) return null;
  const parsed = initialPrescription.safeParse(row.initialPrescription);
  if (!parsed.success) throw new InvalidStartSnapshot();
  const initial = parsed.data;
  if (!['Open', 'Finished', 'Discarded'].includes(row.lifecycle) || initial.executionId !== row.id || initial.accountId !== principal.accountId ||
    initial.planId !== row.planId || initial.revisionId !== row.revisionId || initial.occurrence.id !== row.occurrenceId ||
    initial.startedAt !== row.startedAt.toISOString() || canonicalJson(initial) !== row.canonicalContent ||
    integrityHash(row.canonicalContent) !== row.contentHash) throw new InvalidStartSnapshot();
  const revisions = await tx.trainer2SetResultRevision.findMany({ where: { accountId: principal.accountId, executionId: row.id }, orderBy: [{ targetId: 'asc' }, { version: 'desc' }] });
  const history = revisions.map(r => savedSetResult.parse({ executionId: r.executionId, targetId: r.targetId, performedSetId: r.performedSetId, version: r.version, result: r.result, reason: r.reason, actionId: r.actionId, recordedAt: r.recordedAt.toISOString(), ...(r.assignment ? { assignment: r.assignment } : {}) }));
  const seen = new Set<string>();
  const results = revisions.filter(r => { if (seen.has(r.targetId)) return false; seen.add(r.targetId); return true; })
    .map(r => savedSetResult.parse({ executionId: r.executionId, targetId: r.targetId, performedSetId: r.performedSetId, version: r.version, result: r.result, reason: r.reason, actionId: r.actionId, recordedAt: r.recordedAt.toISOString(), ...(r.assignment ? { assignment: r.assignment } : {}) }));
  const skips = await readSetSkips(tx, principal.accountId, row.id);
  const exerciseAdditions = await readExerciseAdditions(tx, principal.accountId, row.id);
  const additions = await readSetAdditions(tx, principal.accountId, row.id);
  const swaps = await readExerciseSwaps(tx, principal.accountId, row.id);
  const finish = await tx.trainer2ExecutionFinish.findUnique({ where: { executionId: row.id } });
  if ((row.lifecycle === 'Finished') !== !!finish) throw new InvalidStartSnapshot();
  const discard = await tx.trainer2ExecutionDiscard.findUnique({ where: { executionId: row.id } });
  if ((row.lifecycle === 'Discarded') !== !!discard || (discard && (revisions.length || skips.length || additions.length || exerciseAdditions.length))) throw new InvalidStartSnapshot();
  return { exerciseAdditions, additions, swaps, skips, discard: discard ? { actionId: discard.actionId, actorAccountId: discard.accountId, discardedAt: discard.discardedAt.toISOString() } : null, executionId: row.id, lifecycle: row.lifecycle as 'Open' | 'Finished' | 'Discarded', contentHash: row.contentHash, initial, results, history,
    finish: finish ? { actionId: finish.actionId, finishedAt: finish.finishedAt.toISOString(), expected: finishBinding.parse(finish.expected),
      unknownTargetIds: finish.unknownTargetIds as string[], planCompleted: finish.planCompleted } : null };
}
export async function readNextWorkout(tx: DB, principal: ServerPrincipal, planId: string) {
  await authorizeAccount(tx, principal);
  const { plan, revision, intent } = await activeSource(tx, principal.accountId, planId, true);
  const open = await tx.trainer2Execution.findFirst({ where: { accountId: principal.accountId, lifecycle: 'Open' } });
  const resolution = await readOccurrenceResolution(tx, principal.accountId, planId);
  const state = await tx.trainer2AccountTrainingState.findUniqueOrThrow({ where: { accountId: principal.accountId } });
  return { accountId: principal.accountId, planId, revisionId: revision.id, acceptedSequence: state.acceptedSequence.toString(),
    occurrences: intent.occurrences.map(o => {
      const skip = resolution.skips.find(s => s.occurrenceId === o.id);
      return { executionId: resolution.finished.find(e => e.occurrenceId === o.id)?.id ?? null, occurrenceId: o.id, name: o.name, stageName: intent.stages.find(s => s.id === o.stageId)!.name,
        status: skip ? 'Skipped' : resolution.resolvedIds.has(o.id) ? 'Finished' : 'Pending',
        skip: skip ? { actionId: skip.actionId, actorAccountId: skip.accountId, revisionId: skip.revisionId, skippedAt: skip.skippedAt.toISOString(), planCompleted: skip.planCompleted } : null };
    }),
    instructionEpoch: (await readInstructions(tx, principal.accountId)).epoch,
    lifecycle: plan.lifecycle, occurrence: plan.lifecycle === 'Completed' ? null : unresolvedOccurrences(intent.occurrences, resolution.resolvedIds)[0] ?? null, execution: open ? await readExecution(tx, principal, open.id) : null };
}
export async function startOccurrence(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = startOccurrenceCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const { revision, intent } = await activeSource(tx, principal.accountId, command.target.planId);
    if (revision.id !== command.expected.planRevisionId) throw new CommandFailure('STALE_REVISION', true);
    const occurrence = intent.occurrences.find(o => o.id === command.target.occurrenceId);
    if (!occurrence) throw new CommandFailure('OCCURRENCE_NOT_FOUND');

    const existing = await tx.trainer2Execution.findFirst({ where: { accountId: principal.accountId, occurrenceId: occurrence.id, lifecycle: { not: 'Discarded' } } });
    if (existing) throw new CommandFailure('ALREADY_STARTED', true);
    if (occurrence.id !== (await nextOccurrence(tx, principal.accountId, command.target.planId, intent.occurrences))?.id) throw new CommandFailure('OCCURRENCE_NOT_NEXT', true);
    if (await tx.trainer2Execution.findFirst({ where: { accountId: principal.accountId, lifecycle: 'Open' } }))
      throw new CommandFailure('OPEN_EXECUTION_CONFLICT', true);
    const instructions = await readInstructions(tx, principal.accountId);
    if (instructions.epoch !== command.expected.instructionEpoch) throw new CommandFailure('STALE_INSTRUCTIONS', true);
    const startedAt = new Date();
    if (restrictionIssues(instructions.document, command.target.planId, intent, startedAt.toISOString(), revision.id)
      .some(issue => issue.occurrenceId === occurrence.id)) throw new CommandFailure('UNRESOLVED_EXCLUSION');
    const executionId = randomUUID();
    const initial = initialPrescription.parse({ schemaVersion: 1, kind: 'START', provenance: 'VERIFIED_START', policyVersion: START_POLICY,
      accountId: principal.accountId, executionId, planId: command.target.planId, revisionId: revision.id, sourceContentHash: revision.contentHash,
      startedAt: startedAt.toISOString(), stage: intent.stages.find(s => s.id === occurrence.stageId), occurrence,
      progression: intent.progression, instructions, positions: occurrence.positions.map(p => ({ id: randomUUID(), sourcePositionId: p.id,
        targets: p.targets.map(t => ({ id: randomUUID(), sourceTargetId: t.id })) })) });
    const canonicalContent = canonicalJson(initial), contentHash = integrityHash(canonicalContent);
    // No semantic failure after the first domain write; infrastructure errors roll back the whole action.
    await tx.trainer2Execution.create({ data: { id: executionId, accountId: principal.accountId, planId: command.target.planId,
      revisionId: revision.id, occurrenceId: occurrence.id, actionId: command.actionId, startedAt,
      initialPrescription: initial, canonicalContent, contentHash } });
    return { executionId, planId: command.target.planId, revisionId: revision.id, occurrenceId: occurrence.id, contentHash };
  });
}

async function nextOccurrence(tx: DB, accountId: string, planId: string, occurrences: ExecutionRead['initial']['occurrence'][]) {
  const { resolvedIds } = await readOccurrenceResolution(tx, accountId, planId);
  return unresolvedOccurrences(occurrences, resolvedIds)[0] ?? null;
}
