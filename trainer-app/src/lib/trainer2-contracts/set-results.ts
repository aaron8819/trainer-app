import { z } from 'zod';
import { assignmentBinding } from './exercise-swap';
import { id, measurement, target, createDraftCommand } from './draft';

const commandEnvelope = createDraftCommand.pick({ schemaVersion: true, actionId: true, originatingAccountId: true, deviceId: true, ownershipEpoch: true, dependsOn: true });

// Retain chosen form semantics when optional weight is blank. This is not a
// performed measurement and must never be treated as a zero or a load suggestion.
export const loggingOptions = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('externalLoad'), convention: z.enum(['barbellTotal', 'perImplement', 'machineDisplayed', 'machinePlatesPerArm', 'machineAddedPlatesTotal', 'smithPlatesTotal']), zeroMeaning: z.enum(['validZero', 'notAllowed']) }).strict(),
  z.object({ kind: z.literal('addedLoad'), convention: z.literal('addedExternal'), zeroMeaning: z.literal('noAddedLoad') }).strict(),
  z.object({ kind: z.literal('assistance'), convention: z.literal('displayedAssistance'), zeroMeaning: z.literal('noAssistance') }).strict(),
]);
export const performedResult = z.object({
  reps: z.object({ value: z.int().min(0).max(1000), basis: target.shape.reps.shape.basis }).strict().nullable(),
  measurement: measurement.nullable(), rir: target.shape.rir,
  loggingOptions: loggingOptions.optional(),
}).strict().refine(r => !r.loggingOptions || r.measurement === null, 'Logging options apply only when weight is unspecified').refine(r => r.reps !== null || r.measurement !== null || r.rir !== null, 'Enter at least one actual result');
const recordedResult = performedResult.refine(r => r.reps !== null, 'Enter reps to log a set');
const correctionReason = z.string().min(1).max(200).refine(v => v.trim().length > 0).optional();
const setTarget = z.object({ executionId: id, targetId: id }).strict();
export const recordSetResultCommand = commandEnvelope.extend({ commandType: z.literal('RecordSetResult'),
  target: setTarget, expected: z.object({ resultVersion: z.literal(0), skipActionId: id.optional(), assignment: assignmentBinding.optional() }).strict(),
  intent: z.object({ result: recordedResult }).strict(),
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
  assignment: assignmentBinding.optional(),
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
