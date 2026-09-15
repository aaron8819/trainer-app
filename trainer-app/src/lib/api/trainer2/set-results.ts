import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { setResultCommand, historicalCorrectionCommand, type SetResultCommand } from '../../trainer2-contracts/set-results';
import { acceptCommand, CommandFailure } from './command';
import { readExecution } from './execution';
import type { ServerPrincipal } from './principal';

export async function saveSetResult(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = setResultCommand.parse(input);
  return appendResult(db, principal, input, command);
}
export async function correctHistoricalSetResult(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  return appendResult(db, principal, input, historicalCorrectionCommand.parse(input));
}
async function appendResult(db: PrismaClient, principal: ServerPrincipal, input: unknown, command: SetResultCommand) {
  return acceptCommand(db, principal, input, command, async tx => {
    const execution = await readExecution(tx, principal, command.target.executionId);
    if (!execution) throw new CommandFailure('NOT_FOUND');
    const historical = command.commandType === 'CorrectHistoricalSetResult';
    if (historical && execution.lifecycle !== 'Finished') throw new CommandFailure('EXECUTION_NOT_FINISHED', true);
    if (!historical && execution.lifecycle !== 'Open') throw new CommandFailure('EXECUTION_NOT_OPEN', true);
    if (!execution.initial.positions.some(p => p.targets.some(t => t.id === command.target.targetId)))
      throw new CommandFailure('SET_NOT_FOUND');
    const current = execution.results.find(r => r.targetId === command.target.targetId);
    if (historical && !current?.result) throw new CommandFailure('HISTORICAL_RESULT_REQUIRED', true);
    if ((current?.version ?? 0) !== command.expected.resultVersion ||
      (command.commandType !== 'RecordSetResult' && current?.performedSetId !== command.expected.performedSetId))
      throw new CommandFailure('STALE_SET_RESULT', true);
    const performedSetId = current?.performedSetId ?? randomUUID(), version = (current?.version ?? 0) + 1;
    // Every semantic check precedes this append. Any later failure rolls back action, revision and sequence.
    await tx.trainer2SetResultRevision.create({ data: { ...command.target, accountId: principal.accountId,
      performedSetId, version, actionId: command.actionId, result: command.intent.result ?? Prisma.JsonNull,
      reason: command.commandType !== 'RecordSetResult' ? command.intent.reason : null } });
    return { ...command.target, performedSetId, version };
  });
}
