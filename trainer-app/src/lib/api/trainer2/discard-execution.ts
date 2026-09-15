import type { PrismaClient } from '@prisma/client';
import { discardExecutionCommand } from '../../trainer2-contracts/discard-execution';
import { reviewedResults } from '../../trainer2-contracts/workout-finish';
import { acceptCommand, CommandFailure } from './command';
import { canonicalJson } from './integrity';
import { readExecution } from './execution';
import type { ServerPrincipal } from './principal';

export async function discardEmptyExecution(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = discardExecutionCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const execution = await readExecution(tx, principal, command.target.executionId);
    if (!execution) throw new CommandFailure('NOT_FOUND');
    if (execution.initial.occurrence.id !== command.target.occurrenceId) throw new CommandFailure('OCCURRENCE_MISMATCH');
    if (execution.lifecycle !== 'Open') throw new CommandFailure('EXECUTION_NOT_OPEN', true);
    // Authoritative append-only history: clearing is not erasure of performed work.
    if (await tx.trainer2SetResultRevision.count({ where: { accountId: principal.accountId, executionId: execution.executionId } }))
      throw new CommandFailure('EXECUTION_NOT_EMPTY', true);
    if (canonicalJson(command.expected) !== canonicalJson(reviewedResults(execution))) throw new CommandFailure('STALE_DISCARD_BINDING', true);
    // All subsequent effects and the durable outcome commit under the shared account lock.
    await tx.trainer2ExecutionDiscard.create({ data: { executionId: execution.executionId, accountId: principal.accountId,
      occurrenceId: command.target.occurrenceId, actionId: command.actionId, expected: command.expected } });
    await tx.trainer2Execution.update({ where: { id: execution.executionId }, data: { lifecycle: 'Discarded' } });
    return { executionId: execution.executionId, planId: execution.initial.planId, occurrenceId: command.target.occurrenceId };
  });
}
