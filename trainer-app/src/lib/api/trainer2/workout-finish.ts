import type { PrismaClient } from '@prisma/client';
import { finishExecutionCommand, reviewedResults, unrecordedTargets } from '../../trainer2-contracts/workout-finish';
import { acceptCommand, CommandFailure } from './command';
import { readExecution } from './execution';
import { readSavedDocument } from '../../engine/trainer2/planning';
import { canonicalJson } from './integrity';
import type { ServerPrincipal } from './principal';

export async function finishExecution(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = finishExecutionCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const execution = await readExecution(tx, principal, command.target.executionId);
    if (!execution) throw new CommandFailure('NOT_FOUND');
    if (execution.lifecycle === 'Finished') throw new CommandFailure('ALREADY_FINISHED', true);
    if (canonicalJson(command.expected) !== canonicalJson(reviewedResults(execution))) throw new CommandFailure('STALE_FINISH_RESULTS', true);
    const unknownTargetIds = unrecordedTargets(execution).map(t => t.targetId).sort();
    if (unknownTargetIds.length && !command.intent.acknowledgeUnrecorded) throw new CommandFailure('UNRECORDED_ACKNOWLEDGEMENT_REQUIRED');
    const { planId, revisionId, occurrence } = execution.initial;
    const plan = await tx.trainer2Plan.findFirstOrThrow({ where: { id: planId, accountId: principal.accountId } });
    if (plan.lifecycle !== 'Active' || plan.currentRevisionId !== revisionId || plan.initialApprovedRevisionId !== revisionId)
      throw new CommandFailure('PLAN_NOT_ACTIVE', true);
    const revision = await tx.trainer2PlanRevision.findFirstOrThrow({ where: { id: revisionId, accountId: principal.accountId, planId } });
    const intent = readSavedDocument(revision.document);
    const finished = await tx.trainer2Execution.findMany({ where: { accountId: principal.accountId, planId, lifecycle: 'Finished' }, select: { occurrenceId: true } });
    const planCompleted = intent.occurrences.every(o => o.id === occurrence.id || finished.some(x => x.occurrenceId === o.id));
    // No semantic failures below: all finish, membership, closure and receipt effects commit together.
    await tx.trainer2ExecutionFinish.create({ data: { executionId: execution.executionId, accountId: principal.accountId,
      planId, revisionId, occurrenceId: occurrence.id, actionId: command.actionId, expected: command.expected,
      unknownTargetIds, planCompleted, priorPlanLifecycle: plan.lifecycle,
      endpoint: { kind: intent.endpoint, occurrenceIds: intent.occurrences.map(o => o.id) }, finishedAt: new Date() } });
    await tx.trainer2Execution.update({ where: { id: execution.executionId }, data: { lifecycle: 'Finished' } });
    if (planCompleted) await tx.trainer2Plan.update({ where: { id: planId }, data: { lifecycle: 'Completed' } });
    return { executionId: execution.executionId, planId, occurrenceId: occurrence.id, planCompleted };
  });
}
