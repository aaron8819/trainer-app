import { z } from 'zod';
import { id, measurement, target, createDraftCommand } from './draft';

const commandEnvelope = createDraftCommand.pick({ schemaVersion: true, actionId: true, originatingAccountId: true, deviceId: true, ownershipEpoch: true, dependsOn: true });

export const performedResult = z.object({
  reps: z.object({ value: z.int().min(0).max(1000), basis: target.shape.reps.shape.basis }).strict().nullable(),
  measurement: measurement.nullable(), rir: target.shape.rir,
}).strict().refine(r => r.reps !== null || r.measurement !== null || r.rir !== null, 'Enter at least one actual result');
const correctionReason = z.string().min(1).max(200).refine(v => v.trim().length > 0).optional();
const setTarget = z.object({ executionId: id, targetId: id }).strict();
export const recordSetResultCommand = commandEnvelope.extend({ commandType: z.literal('RecordSetResult'),
  target: setTarget, expected: z.object({ resultVersion: z.literal(0), skipActionId: id.optional() }).strict(),
  intent: z.object({ result: performedResult }).strict(),
}).strict();
export const correctSetResultCommand = commandEnvelope.extend({ commandType: z.literal('CorrectSetResult'),
  target: setTarget, expected: z.object({ resultVersion: z.int().min(1), performedSetId: id }).strict(),
  intent: z.object({ result: performedResult.nullable(), reason: correctionReason }).strict()
    .refine(v => v.result !== null || !!v.reason, 'Clearing a result requires a reason'),
}).strict();
export const historicalCorrectionCommand = correctSetResultCommand.extend({ commandType: z.literal('CorrectHistoricalSetResult'),
  intent: z.object({ result: performedResult, reason: correctionReason }).strict(),
}).strict();
export const resultMutationCommand = z.discriminatedUnion('commandType', [recordSetResultCommand, correctSetResultCommand, historicalCorrectionCommand]);
export const setResultCommand = z.discriminatedUnion('commandType', [recordSetResultCommand, correctSetResultCommand]);
export type SetResultCommand = z.infer<typeof resultMutationCommand>;
export type PerformedResult = z.infer<typeof performedResult>;
export const savedSetResult = z.object({ executionId: id, targetId: id, performedSetId: id, version: z.int().min(1),
  result: performedResult.nullable(), reason: z.string().max(200).nullable(), actionId: id, recordedAt: z.iso.datetime(),
}).strict();
export type SavedSetResult = z.infer<typeof savedSetResult>;
const cursor = z.string().regex(/^[1-9][0-9]*$/);
export const setResultResponse = z.object({ replayed: z.boolean(), outcomeCursor: cursor,
  outcome: z.discriminatedUnion('status', [
    z.object({ status: z.literal('Accepted'), actionId: id, commandType: z.enum(['RecordSetResult', 'CorrectSetResult', 'CorrectHistoricalSetResult']),
      acceptedSequence: cursor, result: z.object({ executionId: id, targetId: id, performedSetId: id, version: z.int().min(1) }).strict() }).strict(),
    z.object({ status: z.enum(['Rejected', 'Conflict']), actionId: id,
      commandType: z.enum(['RecordSetResult', 'CorrectSetResult', 'CorrectHistoricalSetResult']), code: z.string().min(1) }).strict(),
  ]),
}).strict();
