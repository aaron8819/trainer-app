import type { PrismaClient } from '@prisma/client';
import { advanceWeekCommand } from '../../trainer2-contracts/advance-week';
import { authoredWeeks } from '../../engine/trainer2/occurrence-resolution';
import { acceptCommand, CommandFailure } from './command';
import { activeSource } from './execution';
import { readOccurrenceResolution } from './occurrence-resolution';
import type { ServerPrincipal } from './principal';

export async function advanceWeek(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = advanceWeekCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const { plan, revision, intent } = await activeSource(tx, principal.accountId, command.target.planId);
    const state = await tx.trainer2AccountTrainingState.findUniqueOrThrow({ where: { accountId: principal.accountId } });
    const weeks = authoredWeeks(intent.occurrences), week = weeks[plan.currentWeekIndex];
    if (!week || revision.id !== command.expected.planRevisionId || state.acceptedSequence.toString() !== command.expected.acceptedSequence ||
      plan.currentWeekIndex !== command.expected.weekIndex || week[0].id !== command.expected.firstOccurrenceId)
      throw new CommandFailure('STALE_WEEK_BINDING', true);
    const { resolvedIds } = await readOccurrenceResolution(tx, principal.accountId, plan.id);
    if (week.some(o => !resolvedIds.has(o.id))) throw new CommandFailure('WEEK_UNRESOLVED', true);
    if (await tx.trainer2Execution.findFirst({ where: { accountId: principal.accountId, lifecycle: 'Open' } }))
      throw new CommandFailure('OPEN_EXECUTION_CONFLICT', true);
    const planCompleted = plan.currentWeekIndex === weeks.length - 1;
    const result = { planId: plan.id, revisionId: revision.id, fromWeek: plan.currentWeekIndex,
      toWeek: planCompleted ? plan.currentWeekIndex : plan.currentWeekIndex + 1, planCompleted };
    await tx.trainer2WeekAdvance.create({ data: { accountId: principal.accountId, ...result, actionId: command.actionId, expected: command.expected } });
    await tx.trainer2Plan.update({ where: { id: plan.id }, data: { currentWeekIndex: result.toWeek, ...(planCompleted ? { lifecycle: 'Completed' } : {}) } });
    return result;
  });
}
