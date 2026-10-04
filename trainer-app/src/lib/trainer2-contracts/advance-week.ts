import { z } from 'zod';
import { createDraftCommand, id } from './draft';
import { skipBinding } from './skip-occurrence';

export const weekRead = z.object({ index: z.int().min(0), firstOccurrenceId: id, occurrenceIds: z.array(id).min(1).refine(ids => new Set(ids).size === ids.length), ready: z.boolean(), final: z.boolean() }).strict();
export const advanceWeekCommand = createDraftCommand.pick({ schemaVersion: true, actionId: true,
  originatingAccountId: true, deviceId: true, ownershipEpoch: true, dependsOn: true }).extend({
  commandType: z.literal('AdvanceWeek'), target: z.object({ planId: id }).strict(),
  expected: skipBinding.extend({ weekIndex: z.int().min(0), firstOccurrenceId: id }).strict(), intent: z.object({}).strict(),
}).strict();
export type AdvanceWeekCommand = z.infer<typeof advanceWeekCommand>;
export const advanceWeekResponse = z.object({ replayed: z.boolean(), outcomeCursor: z.string().regex(/^[1-9][0-9]*$/),
  outcome: z.discriminatedUnion('status', [
    z.object({ status: z.literal('Accepted'), actionId: id, commandType: z.literal('AdvanceWeek'), acceptedSequence: z.string().regex(/^[1-9][0-9]*$/),
      result: z.object({ planId: id, revisionId: id, fromWeek: z.int().min(0), toWeek: z.int().min(0), planCompleted: z.boolean() }).strict() }).strict(),
    z.object({ status: z.enum(['Rejected', 'Conflict']), actionId: id, commandType: z.literal('AdvanceWeek'), code: z.string().min(1) }).strict(),
  ]),
}).strict();
