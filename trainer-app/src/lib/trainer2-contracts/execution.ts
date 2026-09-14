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
export const executionRead = z.object({ executionId: id, lifecycle: z.literal('Open'),
  contentHash: hash, initial: initialPrescription, results: z.array(savedSetResult) }).strict().refine(v =>
    v.executionId === v.initial.executionId && new Set(v.results.map(r => r.targetId)).size === v.results.length &&
    v.results.every(r => r.executionId === v.executionId && v.initial.positions.some(p => p.targets.some(t => t.id === r.targetId))));
export type ExecutionRead = z.infer<typeof executionRead>;
export async function validateExecutionRead(input: unknown, accountId: string, executionId?: string) {
  const value = executionRead.parse(input);
  const digest = async (data: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(data)))), b => b.toString(16).padStart(2, '0')).join('');
  if (value.initial.accountId !== accountId || (executionId && value.executionId !== executionId) ||
    value.contentHash !== await digest(value.initial) || value.initial.instructions.contentHash !== await digest(value.initial.instructions.document))
    throw new Error('Invalid saved workout response');
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
export const nextWorkoutRead = z.object({ accountId: z.string().min(1), planId: id, revisionId: id,
  instructionEpoch: z.int().min(0), occurrence, execution: executionRead.nullable() }).strict();
