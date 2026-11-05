import { z } from 'zod';
import { id } from './draft';
import { performedResult } from './set-results';

export const exerciseHistoryRead = z.object({ executionId: id, positionId: id, limited: z.boolean(), sessions: z.array(z.object({
  executionId: id, workoutName: z.string(), finishedAt: z.iso.datetime(), deload: z.boolean().nullable(),
  sets: z.array(z.object({ number: z.int().positive(), result: performedResult }).strict()).min(1),
}).strict()).max(10) }).strict();
export type ExerciseHistoryRead = z.infer<typeof exerciseHistoryRead>;
