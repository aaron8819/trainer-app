import type { Prisma, PrismaClient } from '@prisma/client';
import { setSkip, skipSetCommand } from '../../trainer2-contracts/skip-set';
import { acceptCommand, CommandFailure } from './command';
import { readExecution } from './execution';
import type { ServerPrincipal } from './principal';

export async function readSetSkips(tx: Prisma.TransactionClient, accountId: string, executionId: string) {
  const rows = await tx.$queryRaw<{ executionId: string; targetId: string; actionId: string; skippedAt: Date }[]>`
    SELECT "executionId", "targetId", "actionId", "skippedAt" FROM "Trainer2SetSkip"
    WHERE "accountId"=${accountId} AND "executionId"=${executionId}::uuid ORDER BY "targetId"`;
  return rows.map(r => setSkip.parse({ ...r, skippedAt: r.skippedAt.toISOString() }));
}

export async function skipSet(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = skipSetCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const execution = await readExecution(tx, principal, command.target.executionId);
    if (!execution) throw new CommandFailure('NOT_FOUND');
    if (execution.lifecycle !== 'Open') throw new CommandFailure('EXECUTION_NOT_OPEN', true);
    if (!execution.initial.positions.some(p => p.targets.some(t => t.id === command.target.targetId)))
      throw new CommandFailure('SET_NOT_FOUND');
    if (execution.results.some(r => r.targetId === command.target.targetId)) throw new CommandFailure('SET_RESULT_EXISTS', true);
    if (execution.skips?.some(s => s.targetId === command.target.targetId)) throw new CommandFailure('SET_ALREADY_SKIPPED', true);
    await tx.$executeRaw`INSERT INTO "Trainer2SetSkip" ("accountId", "executionId", "targetId", "actionId")
      VALUES (${principal.accountId}, ${command.target.executionId}::uuid, ${command.target.targetId}::uuid, ${command.actionId}::uuid)`;
    return command.target;
  });
}
