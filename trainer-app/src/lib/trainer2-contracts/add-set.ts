import { z } from 'zod';
import { createDraftCommand, exercise, id, target } from './draft';
import { assignmentBinding } from './exercise-swap';
import { hash } from './activation';

export const ADD_SET_POLICY = 'trainer2-add-set-v1';
export const setAdditionContent = z.object({ policyVersion: z.literal(ADD_SET_POLICY),
  positionId: id, ordinal: z.int().min(1).max(100), target: target.extend({ classification: z.literal('working'), required: z.literal(true) }),
  exercise, assignment: assignmentBinding,
}).strict();
export const setAddition = z.object({ executionId: id, actionId: id, contentHash: hash,
  content: setAdditionContent, recordedAt: z.iso.datetime() }).strict();
export type SetAddition = z.infer<typeof setAddition>;
export const addSetCommand = createDraftCommand.pick({ schemaVersion: true, actionId: true,
  originatingAccountId: true, deviceId: true, ownershipEpoch: true, dependsOn: true }).extend({
  commandType: z.literal('AddSet'), target: z.object({ executionId: id, positionId: id }).strict(),
  expected: z.object({ contentHash: hash, assignment: assignmentBinding }).strict(), intent: z.object({}).strict(),
}).strict();
export type AddSetCommand = z.infer<typeof addSetCommand>;
const cursor = z.string().regex(/^[1-9][0-9]*$/);
export const addSetResponse = z.object({ replayed: z.boolean(), outcomeCursor: cursor,
  outcome: z.discriminatedUnion('status', [
    z.object({ status: z.literal('Accepted'), actionId: id, commandType: z.literal('AddSet'), acceptedSequence: cursor,
      result: z.object({ executionId: id, positionId: id, targetId: id, ordinal: z.int().min(1).max(100), contentHash: hash }).strict() }).strict(),
    z.object({ status: z.enum(['Rejected', 'Conflict']), actionId: id, commandType: z.literal('AddSet'), code: z.string().min(1) }).strict(),
  ]),
}).strict();
