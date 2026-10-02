import { z } from 'zod';
import { createDraftCommand, id, position, target } from './draft';
import { hash } from './activation';

export const ADD_EXERCISE_POLICY = 'trainer2-add-exercise-v1';
export const addExerciseIntent = z.object({ catalogId: z.string().min(1), sets: z.int().min(1).max(20),
  reps: target.shape.reps, rir: target.shape.rir, startingLoad: target.shape.measurement }).strict();
export const addExerciseCommand = createDraftCommand.pick({ schemaVersion: true, actionId: true,
  originatingAccountId: true, deviceId: true, ownershipEpoch: true, dependsOn: true }).extend({
  commandType: z.literal('AddExercise'), target: z.object({ executionId: id }).strict(),
  expected: z.object({ contentHash: hash }).strict(), intent: addExerciseIntent,
}).strict();
export type AddExerciseCommand = z.infer<typeof addExerciseCommand>;
export const exerciseAdditionContent = z.object({ policyVersion: z.literal(ADD_EXERCISE_POLICY),
  ordinal: z.int().min(1).max(100), position: position.extend({ role: z.literal('Accessory'),
    exercise: position.shape.exercise.options[1], targets: z.array(target).min(1).max(20) }).omit({ sourceKey: true }),
}).strict();
export const exerciseAddition = z.object({ executionId: id, actionId: id, contentHash: hash,
  content: exerciseAdditionContent, recordedAt: z.iso.datetime() }).strict();
export type ExerciseAddition = z.infer<typeof exerciseAddition>;
const cursor = z.string().regex(/^[1-9][0-9]*$/);
export const addExerciseResponse = z.object({ replayed: z.boolean(), outcomeCursor: cursor,
  outcome: z.discriminatedUnion('status', [
    z.object({ status: z.literal('Accepted'), actionId: id, commandType: z.literal('AddExercise'), acceptedSequence: cursor,
      result: z.object({ executionId: id, positionId: id, ordinal: z.int().min(1).max(100), contentHash: hash }).strict() }).strict(),
    z.object({ status: z.enum(['Rejected', 'Conflict']), actionId: id, commandType: z.literal('AddExercise'), code: z.string().min(1) }).strict(),
  ]),
}).strict();
