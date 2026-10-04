import type { PrismaClient } from '@prisma/client';
import { skipOccurrenceCommand } from '../../trainer2-contracts/skip-occurrence';
import { unresolvedOccurrences, eligibleCurrentWeekOccurrences } from '../../engine/trainer2/occurrence-resolution';
import { acceptCommand, CommandFailure } from './command';
import { activeSource } from './execution';
import { readOccurrenceResolution } from './occurrence-resolution';
import type { ServerPrincipal } from './principal';

// Planning owns explicit unperformed resolution and the mandatory endpoint consequence.
export async function skipOccurrence(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = skipOccurrenceCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const { plan, revision, intent } = await activeSource(tx, principal.accountId, command.target.planId);
    const state = await tx.trainer2AccountTrainingState.findUniqueOrThrow({ where: { accountId: principal.accountId } });
    if (revision.id !== command.expected.planRevisionId || state.acceptedSequence.toString() !== command.expected.acceptedSequence)
      throw new CommandFailure('STALE_SKIP_BINDING', true);
    const occurrence = intent.occurrences.find(o => o.id === command.target.occurrenceId);
    if (!occurrence) throw new CommandFailure('OCCURRENCE_NOT_FOUND');
    const { resolvedIds } = await readOccurrenceResolution(tx, principal.accountId, plan.id);
    if (resolvedIds.has(occurrence.id)) throw new CommandFailure('OCCURRENCE_RESOLVED', true);
    const pending = unresolvedOccurrences(intent.occurrences, resolvedIds);
    if (!eligibleCurrentWeekOccurrences(intent.occurrences, resolvedIds).some(o => o.id === occurrence.id)) throw new CommandFailure('OCCURRENCE_NOT_CURRENT_WEEK', true);
    if (await tx.trainer2Execution.findFirst({ where: { accountId: principal.accountId, lifecycle: 'Open' } }))
      throw new CommandFailure('OPEN_EXECUTION_CONFLICT', true);
    if (await tx.trainer2Execution.findFirst({ where: { accountId: principal.accountId, occurrenceId: occurrence.id, lifecycle: { not: 'Discarded' } } }))
      throw new CommandFailure('ALREADY_STARTED', true);
    const planCompleted = pending.length === 1;
    // No semantic failures after the first domain write. The shared account lock
    // orders Start, Skip, Finish, Discard, instructions and every evidence command.
    await tx.trainer2OccurrenceSkip.create({ data: { accountId: principal.accountId, planId: plan.id, revisionId: revision.id,
      occurrenceId: occurrence.id, actionId: command.actionId, expected: command.expected, planCompleted,
      priorPlanLifecycle: plan.lifecycle, endpoint: { kind: intent.endpoint, occurrenceIds: intent.occurrences.map(o => o.id) } } });
    if (planCompleted) await tx.trainer2Plan.update({ where: { id: plan.id }, data: { lifecycle: 'Completed' } });
    return { planId: plan.id, revisionId: revision.id, occurrenceId: occurrence.id, planCompleted };
  });
}
