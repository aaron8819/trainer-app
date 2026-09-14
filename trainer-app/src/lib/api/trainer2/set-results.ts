import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { setResultCommand } from '../../trainer2-contracts/set-results';
import { acceptCommand, CommandFailure } from './command';
import { readExecution } from './execution';
import type { ServerPrincipal } from './principal';

export async function saveSetResult(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = setResultCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const execution = await readExecution(tx, principal, command.target.executionId);
    if (!execution) throw new CommandFailure('NOT_FOUND');
    if (execution.lifecycle !== 'Open') throw new CommandFailure('EXECUTION_NOT_OPEN', true);
    if (!execution.initial.positions.some(p => p.targets.some(t => t.id === command.target.targetId)))
      throw new CommandFailure('SET_NOT_FOUND');
    const current = execution.results.find(r => r.targetId === command.target.targetId);
    if ((current?.version ?? 0) !== command.expected.resultVersion ||
      (command.commandType === 'CorrectSetResult' && current?.performedSetId !== command.expected.performedSetId))
      throw new CommandFailure('STALE_SET_RESULT', true);
    const performedSetId = current?.performedSetId ?? randomUUID(), version = (current?.version ?? 0) + 1;
    // Every semantic check precedes this append. Any later failure rolls back action, revision and sequence.
    await tx.trainer2SetResultRevision.create({ data: { ...command.target, accountId: principal.accountId,
      performedSetId, version, actionId: command.actionId, result: command.intent.result ?? Prisma.JsonNull,
      reason: command.commandType === 'CorrectSetResult' ? command.intent.reason : null } });
    return { ...command.target, performedSetId, version };
  });
}
