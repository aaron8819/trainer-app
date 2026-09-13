import type { Prisma, PrismaClient } from '@prisma/client';
import { commandBinding } from './integrity';
import { authorizeAccount, DraftAccessError, type ServerPrincipal } from './principal';

import { DraftFailure } from "../../engine/trainer2/planning";

export class ActionCollision extends Error { constructor() { super('ACTION_ID_COLLISION'); } }
export class CommandFailure extends Error {
  constructor(readonly code: string, readonly conflict = false, readonly currentPlanId?: string) { super(code); }
}
export type ActionOutcome<R> = { status: 'Accepted'; actionId: string; commandType: string; acceptedSequence: string; result: R }
  | { status: 'Rejected' | 'Conflict'; actionId: string; commandType: string; code: string; currentPlanId?: string };
export type ActionResponse<R> = { outcome: ActionOutcome<R>; replayed: boolean; outcomeCursor: string };
type Envelope = { actionId: string; commandType: string; originatingAccountId: string; ownershipEpoch: number; dependsOn: string[] };

// All Trainer2 planning/instruction commands share authorization, lock order,
// immutable envelope identity, retry and atomic outcome semantics.
export async function acceptCommand<R>(db: PrismaClient, principal: ServerPrincipal, input: unknown, command: Envelope,
  apply: (tx: Prisma.TransactionClient) => Promise<R>): Promise<ActionResponse<R>> {
  if (command.originatingAccountId !== principal.accountId) throw new DraftAccessError('ACCOUNT_MISMATCH');
  const binding = commandBinding(input);
  await authorizeAccount(db, principal);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await tx.$executeRaw`INSERT INTO "Trainer2AccountTrainingState" ("accountId") VALUES (${principal.accountId}) ON CONFLICT DO NOTHING`;
        await tx.$queryRaw`SELECT "accountId" FROM "Trainer2AccountTrainingState" WHERE "accountId"=${principal.accountId} FOR UPDATE`;
        await authorizeAccount(tx, principal);
        const existing = await tx.trainer2DurableAction.findUnique({ where: { accountId_actionId: { accountId: principal.accountId, actionId: command.actionId } } });
        if (existing) {
          if (existing.envelopeHash !== binding.envelopeHash || existing.submittedEnvelope !== binding.submittedEnvelope) throw new ActionCollision();
          const saved = await tx.trainer2ActionOutcome.findFirstOrThrow({ where: { accountId: principal.accountId, actionId: command.actionId }, orderBy: { outcomeCursor: 'desc' } });
          return { outcome: saved.outcome as ActionOutcome<R>, replayed: true, outcomeCursor: saved.outcomeCursor.toString() };
        }
        await tx.trainer2DurableAction.create({ data: { accountId: principal.accountId, actionId: command.actionId, ...binding } });
        let outcome: ActionOutcome<R>;
        try {
          const state = await tx.trainer2AccountTrainingState.findUniqueOrThrow({ where: { accountId: principal.accountId } });
          if (command.dependsOn.length) throw new CommandFailure('DEPENDENCIES_UNSUPPORTED');
          if (command.ownershipEpoch !== state.ownershipEpoch) throw new CommandFailure('OWNERSHIP_EPOCH');
          // FENCED accounts cannot accept new local planning commands. LEGACY
          // remains the accepted local synthetic default; hosted admission is denied.
          if (state.runtimeOwner === 'FENCED') throw new CommandFailure('ACCOUNT_FENCED');
          const result = await apply(tx);
          const updated = await tx.trainer2AccountTrainingState.update({ where: { accountId: principal.accountId }, data: { acceptedSequence: { increment: 1 } } });
          outcome = { status: 'Accepted', actionId: command.actionId, commandType: command.commandType, acceptedSequence: updated.acceptedSequence.toString(), result };
        } catch (error) {
          if (!(error instanceof CommandFailure) && !(error instanceof DraftFailure)) throw error;
          outcome = { status: (error instanceof CommandFailure ? error.conflict : error.code === 'STALE_REVISION') ? 'Conflict' : 'Rejected', actionId: command.actionId, commandType: command.commandType, code: error.code, ...(error instanceof CommandFailure && error.currentPlanId ? { currentPlanId: error.currentPlanId } : {}) };
        }
        const saved = await tx.trainer2ActionOutcome.create({ data: { accountId: principal.accountId, actionId: command.actionId,
          status: outcome.status, outcome: outcome as Prisma.InputJsonValue } });
        return { outcome, replayed: false, outcomeCursor: saved.outcomeCursor.toString() };
      }, { maxWait: 10_000, timeout: 15_000 });
    } catch (error) {
      if (attempt < 2 && (error as { code?: string }).code === 'P2034') continue;
      throw error;
    }
  }
}
