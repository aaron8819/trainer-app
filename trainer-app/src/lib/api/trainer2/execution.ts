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
async function activeSource(tx: DB, accountId: string, planId: string) {
  const plan = await tx.trainer2Plan.findFirst({ where: { id: planId, accountId, tombstonedAt: null } });
  if (!plan) throw new CommandFailure('NOT_FOUND');
  if (plan.lifecycle !== 'Active') throw new CommandFailure('PLAN_NOT_ACTIVE', true);
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
  if (row.lifecycle !== 'Open' || initial.executionId !== row.id || initial.accountId !== principal.accountId ||
    initial.planId !== row.planId || initial.revisionId !== row.revisionId || initial.occurrence.id !== row.occurrenceId ||
    initial.startedAt !== row.startedAt.toISOString() || canonicalJson(initial) !== row.canonicalContent ||
    integrityHash(row.canonicalContent) !== row.contentHash) throw new InvalidStartSnapshot();
  return { executionId: row.id, lifecycle: 'Open', contentHash: row.contentHash, initial };
}
export async function readNextWorkout(tx: DB, principal: ServerPrincipal, planId: string) {
  await authorizeAccount(tx, principal);
  const { revision, intent } = await activeSource(tx, principal.accountId, planId);
  const open = await tx.trainer2Execution.findFirst({ where: { accountId: principal.accountId, lifecycle: 'Open' } });
  return { accountId: principal.accountId, planId, revisionId: revision.id,
    instructionEpoch: (await readInstructions(tx, principal.accountId)).epoch,
    occurrence: intent.occurrences[0], execution: open ? await readExecution(tx, principal, open.id) : null };
}
export async function startOccurrence(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = startOccurrenceCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const { revision, intent } = await activeSource(tx, principal.accountId, command.target.planId);
    if (revision.id !== command.expected.planRevisionId) throw new CommandFailure('STALE_REVISION', true);
    const occurrence = intent.occurrences.find(o => o.id === command.target.occurrenceId);
    if (!occurrence) throw new CommandFailure('OCCURRENCE_NOT_FOUND');
    if (occurrence.id !== intent.occurrences[0].id) throw new CommandFailure('OCCURRENCE_NOT_NEXT', true);
    const existing = await tx.trainer2Execution.findFirst({ where: { accountId: principal.accountId, occurrenceId: occurrence.id } });
    if (existing) throw new CommandFailure('ALREADY_STARTED', true);
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
