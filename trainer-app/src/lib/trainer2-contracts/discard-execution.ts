import { z } from 'zod';
import { createDraftCommand, id } from './draft';
import { finishBinding } from './workout-finish';
export const discardExecutionCommand = createDraftCommand.pick({ schemaVersion: true, actionId: true,
  originatingAccountId: true, deviceId: true, ownershipEpoch: true, dependsOn: true }).extend({
  commandType: z.literal('DiscardEmptyExecution'), target: z.object({ executionId: id, occurrenceId: id }).strict(),
  expected: finishBinding, intent: z.object({}).strict(),
}).strict();
export type DiscardExecutionCommand = z.infer<typeof discardExecutionCommand>;
export const discardFact = z.object({ actionId: id, actorAccountId: z.string().min(1), discardedAt: z.iso.datetime() }).strict();
const cursor = z.string().regex(/^[1-9][0-9]*$/);
export const discardResponse = z.object({ replayed: z.boolean(), outcomeCursor: cursor, outcome: z.discriminatedUnion('status', [
  z.object({ status: z.literal('Accepted'), actionId: id, commandType: z.literal('DiscardEmptyExecution'), acceptedSequence: cursor,
    result: z.object({ executionId: id, planId: id, occurrenceId: id }).strict() }).strict(),
  z.object({ status: z.enum(['Rejected', 'Conflict']), actionId: id, commandType: z.literal('DiscardEmptyExecution'), code: z.string().min(1) }).strict(),
]) }).strict();
