import type { SetAddition } from './add-set';
import { executionPositions } from '../engine/trainer2/execution-targets';
import type { SetSkip } from './skip-set';
import { assignmentBinding, type ExerciseSwap } from './exercise-swap';
import { currentAssignment } from '../engine/trainer2/exercise-swap';
import { z } from 'zod';
import { createDraftCommand, id } from './draft';
import { hash } from './activation';
import type { InitialPrescription } from './execution';
import type { SavedSetResult } from './set-results';

export const finishBinding = z.object({ contentHash: hash, assignments: z.array(assignmentBinding).optional(), results: z.array(z.object({
  targetId: id, resultVersion: z.int().min(0), performedSetId: id.nullable(), skipActionId: id.optional(),
}).strict().refine(r => (r.resultVersion === 0) === (r.performedSetId === null))).max(10000) }).strict();
export const finishExecutionCommand = createDraftCommand.pick({ schemaVersion: true, actionId: true,
  originatingAccountId: true, deviceId: true, ownershipEpoch: true, dependsOn: true }).extend({
  commandType: z.literal('FinishExecution'), target: z.object({ executionId: id }).strict(),
  expected: finishBinding, intent: z.object({ acknowledgeUnrecorded: z.boolean() }).strict(),
}).strict();
export type FinishExecutionCommand = z.infer<typeof finishExecutionCommand>;
export function reviewedResults(execution: { additions?: SetAddition[]; initial: InitialPrescription; contentHash: string; results: SavedSetResult[]; skips?: SetSkip[]; swaps?: ExerciseSwap[] }) {
  return { contentHash: execution.contentHash, ...(execution.swaps?.length ? { assignments: execution.initial.positions.map(p => currentAssignment(execution, p.id)).sort((a,b) => a.positionId.localeCompare(b.positionId)) } : {}), results: executionPositions(execution).flatMap(p => p.targets.map(t => {
    const r = execution.results.find(r => r.targetId === t.id);
    const skip = execution.skips?.find(s => s.targetId === t.id);
    return { ...(skip ? { skipActionId: skip.actionId } : {}), targetId: t.id, resultVersion: r?.version ?? 0, performedSetId: r?.performedSetId ?? null };
  })).sort((a, b) => a.targetId.localeCompare(b.targetId)) };
}
export function unrecordedTargets(execution: { additions?: SetAddition[]; initial: InitialPrescription; results: SavedSetResult[]; skips?: SetSkip[] }) {
  return executionPositions(execution).flatMap((p, i) => p.targets.filter(t => !execution.results.find(r => r.targetId === t.id)?.result)
    .map(t => ({ targetId: t.id, skipped: !execution.results.some(r => r.targetId === t.id) && !!execution.skips?.some(s => s.targetId === t.id), required: (execution.initial.occurrence.positions[i].targets.find(s => s.id === t.displayTargetId) ?? execution.additions!.find(a => a.content.target.id === t.id)!.content.target).required })));
}
export const finishFact = z.object({ actionId: id, finishedAt: z.iso.datetime(), expected: finishBinding,
  unknownTargetIds: z.array(id), planCompleted: z.boolean() }).strict();
const cursor = z.string().regex(/^[1-9][0-9]*$/);
export const finishResponse = z.object({ replayed: z.boolean(), outcomeCursor: cursor, outcome: z.discriminatedUnion('status', [
  z.object({ status: z.literal('Accepted'), actionId: id, commandType: z.literal('FinishExecution'), acceptedSequence: cursor,
    result: z.object({ executionId: id, planId: id, occurrenceId: id, planCompleted: z.boolean() }).strict() }).strict(),
  z.object({ status: z.enum(['Rejected', 'Conflict']), actionId: id, commandType: z.literal('FinishExecution'), code: z.string().min(1) }).strict(),
]) }).strict();
