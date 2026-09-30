import { z } from 'zod';
import { createDraftCommand, exercise, id, target } from './draft';
import { hash } from './activation';

export const SWAP_POLICY = 'trainer2-exercise-swap-v1';
export const assignmentBinding = z.object({ positionId: id, version: z.int().min(0), actionId: id.nullable(), contentHash: hash }).strict()
  .refine(v => (v.version === 0) === (v.actionId === null));
export type AssignmentBinding = z.infer<typeof assignmentBinding>;
export const swapContent = z.object({ policyVersion: z.literal(SWAP_POLICY), positionId: id,
  restoreOriginal: z.boolean(), exercise, targets: z.array(target).max(100) }).strict().refine(v => {
    const e = v.exercise;
    return e.kind !== 'catalogSnapshot' || v.targets.every(t => t.reps.basis === e.repBasis &&
      (!t.measurement || (t.measurement.kind === e.loadKind && t.measurement.convention === e.convention)));
  }, 'Targets must retain replacement measurement meaning');
export const exerciseSwap = z.object({ executionId: id, positionId: id, version: z.int().min(1), actionId: id,
  previousActionId: id.nullable(), instructionEpoch: z.int().min(0), contentHash: hash, content: swapContent,
  recordedAt: z.iso.datetime() }).strict();
export type ExerciseSwap = z.infer<typeof exerciseSwap>;
export const swapIntent = z.discriminatedUnion('restoreOriginal', [
  z.object({ restoreOriginal: z.literal(true) }).strict(),
  z.object({ restoreOriginal: z.literal(false), catalogId: z.string().min(1).max(200) }).strict(),
]);
export const swapPreviewRequest = z.object({ executionId: id, positionId: id, intent: swapIntent }).strict();
export const swapPreview = z.object({ executionId: id, contentHash: hash, assignment: assignmentBinding,
  instructionEpoch: z.int().min(0), effectiveHash: hash, content: swapContent,
  suggestedLoad: z.string().nullable(), targetsChanged: z.boolean() }).strict();
export const swapExerciseCommand = createDraftCommand.pick({ schemaVersion: true, actionId: true,
  originatingAccountId: true, deviceId: true, ownershipEpoch: true, dependsOn: true }).extend({
  commandType: z.literal('SwapExercise'), target: z.object({ executionId: id, positionId: id }).strict(),
  expected: z.object({ contentHash: hash, assignment: assignmentBinding, instructionEpoch: z.int().min(0), effectiveHash: hash }).strict(),
  intent: swapIntent,
}).strict();
export type SwapExerciseCommand = z.infer<typeof swapExerciseCommand>;
const cursor = z.string().regex(/^[1-9][0-9]*$/);
export const swapResponse = z.object({ replayed: z.boolean(), outcomeCursor: cursor,
  outcome: z.discriminatedUnion('status', [
    z.object({ status: z.literal('Accepted'), actionId: id, commandType: z.literal('SwapExercise'), acceptedSequence: cursor,
      result: z.object({ executionId: id, positionId: id, version: z.int().min(1), contentHash: hash }).strict() }).strict(),
    z.object({ status: z.enum(['Rejected', 'Conflict']), actionId: id, commandType: z.literal('SwapExercise'), code: z.string().min(1) }).strict(),
  ]),
}).strict();
