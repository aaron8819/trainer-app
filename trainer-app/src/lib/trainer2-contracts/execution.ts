import { setSkip } from './skip-set';
import { occurrenceResolutionRead, skipBinding } from './skip-occurrence';
import { discardFact } from './discard-execution';
import { finishFact, reviewedResults, unrecordedTargets } from './workout-finish';
import { z } from 'zod';
import { createDraftCommand, id, occurrence, stage, progressionIntent } from './draft';
import { hash, instructionSnapshot } from './activation';
import { canonicalJson } from './canonical-json';

import { savedSetResult } from './set-results';

export const START_POLICY = 'trainer2-start-v1';
export const startOccurrenceCommand = createDraftCommand.pick({ schemaVersion: true, actionId: true,
  originatingAccountId: true, deviceId: true, ownershipEpoch: true, dependsOn: true }).extend({
  commandType: z.literal('StartOccurrence'), target: z.object({ planId: id, occurrenceId: id }).strict(),
  expected: z.object({ planRevisionId: id, instructionEpoch: z.int().min(0) }).strict(), intent: z.object({}).strict(),
}).strict();
export type StartOccurrenceCommand = z.infer<typeof startOccurrenceCommand>;

// Prescription values occur once. The execution-owned identity map contains no targets/defaults.
export const initialPrescription = z.object({ schemaVersion: z.literal(1), kind: z.literal('START'),
  provenance: z.literal('VERIFIED_START'), policyVersion: z.literal(START_POLICY),
  accountId: z.string().min(1), executionId: id, planId: id, revisionId: id, sourceContentHash: hash,
  startedAt: z.iso.datetime(), stage, occurrence, progression: progressionIntent, instructions: instructionSnapshot,
  positions: z.array(z.object({ id, sourcePositionId: id,
    targets: z.array(z.object({ id, sourceTargetId: id }).strict()) }).strict()),
}).strict().superRefine((s, ctx) => {
  const own = [s.executionId, ...s.positions.flatMap(p => [p.id, ...p.targets.map(t => t.id)])];
  const source = [s.planId, s.revisionId, s.stage.id, s.occurrence.id,
    ...s.occurrence.positions.flatMap(p => [p.id, ...p.targets.map(t => t.id)])];
  if (new Set(own).size !== own.length || own.some(id => source.includes(id)) ||
    new Set(source).size !== source.length || s.stage.id !== s.occurrence.stageId ||
    s.positions.length !== s.occurrence.positions.length || s.positions.some((p, i) => {
      const original = s.occurrence.positions[i];
      return p.sourcePositionId !== original.id || p.targets.length !== original.targets.length ||
        p.targets.some((t, j) => t.sourceTargetId !== original.targets[j].id);
    })) ctx.addIssue({ code: 'custom', message: 'Invalid execution source identity graph' });
});
export type InitialPrescription = z.infer<typeof initialPrescription>;
const previousPerformance = z.object({ positionId: id, sourcePositionId: id, executionId: id, workoutName: z.string(), finishedAt: z.iso.datetime(), results: z.array(savedSetResult).min(1) }).strict();
export const executionRead = z.object({ executionId: id, lifecycle: z.enum(['Open', 'Finished', 'Discarded']), discard: discardFact.nullable().optional(), finish: finishFact.nullable(),
  skips: z.array(setSkip).optional(),
  firstSetLoads: z.array(z.object({ positionId: id, executionId: id, result: savedSetResult }).strict()).optional(),
  previous: z.array(previousPerformance).optional(), contentHash: hash, initial: initialPrescription, results: z.array(savedSetResult), history: z.array(savedSetResult).optional() }).strict().refine(v =>
    v.executionId === v.initial.executionId && (v.lifecycle === 'Discarded' ? !!v.discard && v.discard.actorAccountId === v.initial.accountId && v.results.length === 0 && v.history?.length === 0 : !v.discard) && (v.lifecycle === 'Finished' ? !!v.finish : !v.finish) && new Set(v.results.map(r => r.targetId)).size === v.results.length &&
    v.results.every(r => r.executionId === v.executionId && v.initial.positions.some(p => p.targets.some(t => t.id === r.targetId))));
export type ExecutionRead = z.infer<typeof executionRead>;
export async function validateExecutionRead(input: unknown, accountId: string, executionId?: string) {
  const value = executionRead.parse(input);
  const digest = async (data: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(data)))), b => b.toString(16).padStart(2, '0')).join('');
  if (value.initial.accountId !== accountId || (executionId && value.executionId !== executionId) ||
    value.contentHash !== await digest(value.initial) || value.initial.instructions.contentHash !== await digest(value.initial.instructions.document))
    throw new Error('Invalid saved workout response');
  if (value.previous?.some(p => p.executionId === value.executionId || !value.initial.occurrence.positions.some(o => o.id === p.positionId) || p.results.some(r => r.executionId !== p.executionId || !r.result) || p.finishedAt > value.initial.startedAt) || new Set(value.previous?.map(p => p.positionId)).size !== (value.previous?.length ?? 0)) throw new Error('Invalid previous performance');
  if (value.firstSetLoads?.some(p => p.executionId === value.executionId || p.result.executionId !== p.executionId ||
    !p.result.result?.measurement || !('value' in p.result.result.measurement) ||
    !value.initial.occurrence.positions.some(o => o.id === p.positionId)) ||
    new Set(value.firstSetLoads?.map(p => p.positionId)).size !== (value.firstSetLoads?.length ?? 0)) throw new Error('Invalid first-set load');
  if (new Set(value.skips?.map(s => s.targetId)).size !== (value.skips?.length ?? 0) ||
    value.skips?.some(s => s.executionId !== value.executionId || !value.initial.positions.some(p => p.targets.some(t => t.id === s.targetId))) ||
    (value.lifecycle === 'Discarded' && value.skips?.length)) throw new Error('Invalid skip history');
  const history = value.history ?? value.results;
  if (value.history) {
    if (history.some(r => r.executionId !== value.executionId || !value.results.some(c => c.targetId === r.targetId))) throw new Error('Invalid result history');
    for (const current of value.results) {
      const chain = history.filter(r => r.targetId === current.targetId).sort((a, b) => a.version - b.version);
      if (chain.length !== current.version || chain.some((r, i) => r.version !== i + 1 || r.performedSetId !== current.performedSetId) ||
        canonicalJson(chain.at(-1)) !== canonicalJson(current)) throw new Error('Invalid result history');
    }
  }
  if (value.finish) {
    const atFinish = value.finish.expected.results.flatMap(binding => {
      if (binding.resultVersion === 0) return [];
      const revision = history.find(r => r.targetId === binding.targetId && r.version === binding.resultVersion && r.performedSetId === binding.performedSetId);
      if (!revision) throw new Error('Missing finish evidence');
      return [revision];
    });
    const original = { ...value, results: atFinish };
    if (canonicalJson(value.finish.expected) !== canonicalJson(reviewedResults(original)) ||
      canonicalJson(value.finish.unknownTargetIds) !== canonicalJson(unrecordedTargets(original).map(t => t.targetId).sort()))
      throw new Error('Invalid finish response');
  }
  return value;
}
const cursor = z.string().regex(/^[1-9][0-9]*$/);
export const startResponse = z.object({ replayed: z.boolean(), outcomeCursor: cursor,
  outcome: z.discriminatedUnion('status', [
    z.object({ status: z.literal('Accepted'), actionId: id, commandType: z.literal('StartOccurrence'), acceptedSequence: cursor,
      result: z.object({ executionId: id, planId: id, revisionId: id, occurrenceId: id, contentHash: hash }).strict() }).strict(),
    z.object({ status: z.enum(['Rejected', 'Conflict']), actionId: id, commandType: z.literal('StartOccurrence'), code: z.string().min(1) }).strict(),
  ]),
}).strict();
export const nextWorkoutRead = z.object({ acceptedSequence: skipBinding.shape.acceptedSequence, occurrences: z.array(occurrenceResolutionRead).min(1), accountId: z.string().min(1), planId: id, revisionId: id,
  instructionEpoch: z.int().min(0), lifecycle: z.enum(['Active', 'Completed']), occurrence: occurrence.nullable(), execution: executionRead.nullable() }).strict().refine(v => (v.lifecycle === 'Completed') === (v.occurrence === null) && (!v.execution || v.execution.lifecycle === 'Open') &&
  new Set(v.occurrences.map(o => o.occurrenceId)).size === v.occurrences.length &&
  (v.occurrences.find(o => o.status === 'Pending')?.occurrenceId ?? null) === (v.occurrence?.id ?? null) &&
  v.occurrences.every(o => !o.skip || (o.skip.actorAccountId === v.accountId && o.skip.revisionId === v.revisionId && (!o.skip.planCompleted || v.lifecycle === 'Completed'))));
export type NextWorkoutRead = z.infer<typeof nextWorkoutRead>;
