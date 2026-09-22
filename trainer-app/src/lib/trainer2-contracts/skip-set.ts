import { z } from 'zod';
import { createDraftCommand, id } from './draft';

export const skipSetCommand = createDraftCommand.pick({ schemaVersion: true, actionId: true,
  originatingAccountId: true, deviceId: true, ownershipEpoch: true, dependsOn: true }).extend({
  commandType: z.literal('SkipSet'), target: z.object({ executionId: id, targetId: id }).strict(),
  expected: z.object({ resultVersion: z.literal(0), skipActionId: z.null() }).strict(),
  intent: z.object({}).strict(),
}).strict();
export type SkipSetCommand = z.infer<typeof skipSetCommand>;
export const setSkip = z.object({ executionId: id, targetId: id, actionId: id, skippedAt: z.iso.datetime() }).strict();
export type SetSkip = z.infer<typeof setSkip>;
const cursor = z.string().regex(/^[1-9][0-9]*$/);
export const skipSetResponse = z.object({ replayed: z.boolean(), outcomeCursor: cursor,
  outcome: z.discriminatedUnion('status', [
    z.object({ status: z.literal('Accepted'), actionId: id, commandType: z.literal('SkipSet'), acceptedSequence: cursor,
      result: z.object({ executionId: id, targetId: id }).strict() }).strict(),
    z.object({ status: z.enum(['Rejected', 'Conflict']), actionId: id, commandType: z.literal('SkipSet'), code: z.string().min(1) }).strict(),
  ]),
}).strict();
