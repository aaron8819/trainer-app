import { z } from 'zod';
import { createDraftCommand, id } from './draft';

export const skipBinding = z.object({ planRevisionId: id, acceptedSequence: z.string().regex(/^(0|[1-9][0-9]*)$/) }).strict();
export const skipOccurrenceCommand = createDraftCommand.pick({ schemaVersion: true, actionId: true,
  originatingAccountId: true, deviceId: true, ownershipEpoch: true, dependsOn: true }).extend({
  commandType: z.literal('SkipOccurrence'), target: z.object({ planId: id, occurrenceId: id }).strict(),
  expected: skipBinding, intent: z.object({}).strict(),
}).strict();
export type SkipOccurrenceCommand = z.infer<typeof skipOccurrenceCommand>;
export const skipFact = z.object({ actionId: id, actorAccountId: z.string().min(1), skippedAt: z.iso.datetime(),
  revisionId: id, planCompleted: z.boolean() }).strict();
export const occurrenceResolutionRead = z.object({ occurrenceId: id, name: z.string(), stageName: z.string(), executionId: id.nullable().optional(),
  status: z.enum(['Pending', 'Finished', 'Skipped']), skip: skipFact.nullable() }).strict()
  .refine(v => (v.status === 'Skipped') === !!v.skip);
const cursor = z.string().regex(/^[1-9][0-9]*$/);
export const skipResponse = z.object({ replayed: z.boolean(), outcomeCursor: cursor, outcome: z.discriminatedUnion('status', [
  z.object({ status: z.literal('Accepted'), actionId: id, commandType: z.literal('SkipOccurrence'), acceptedSequence: cursor,
    result: z.object({ planId: id, revisionId: id, occurrenceId: id, planCompleted: z.boolean() }).strict() }).strict(),
  z.object({ status: z.enum(['Rejected', 'Conflict']), actionId: id, commandType: z.literal('SkipOccurrence'), code: z.string().min(1) }).strict(),
]) }).strict();
