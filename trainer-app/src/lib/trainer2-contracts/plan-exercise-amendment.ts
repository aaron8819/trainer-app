import { z } from 'zod';
import { createDraftCommand, id, exercise, target } from './draft';
import { hash } from './activation';
export const AMENDMENT_POLICY = 'trainer2-plan-exercise-amendment-v1';
export const amendmentPosition = z.object({ occurrenceId: id, positionId: id }).strict();
export const amendmentIntent = z.object({ positions: z.array(amendmentPosition).min(1).max(500),
  catalogId: z.literal('t2:45-degree-back-extension') }).strict().refine(v => new Set(v.positions.map(p => `${p.occurrenceId}:${p.positionId}`)).size === v.positions.length);
export const amendmentBinding = z.object({ version: z.int().min(1), actionId: id, contentHash: hash }).strict();
export const amendmentContent = z.object({ policyVersion: z.literal(AMENDMENT_POLICY),
  replacements: z.array(amendmentPosition.extend({ exercise, targets: z.array(target).max(100) }).strict()).min(1).max(500) }).strict();
export const amendmentExpected = z.object({ planRevisionId: id, amendmentVersion: z.int().min(0), instructionEpoch: z.int().min(0), effectiveHash: hash }).strict();
export const amendmentPreviewRequest = z.object({ planId: id, intent: amendmentIntent }).strict();
export const amendmentPreview = z.object({ planId: id, expected: amendmentExpected, content: amendmentContent }).strict();
export const amendPendingExerciseCommand = createDraftCommand.pick({ schemaVersion: true, actionId: true, originatingAccountId: true,
  deviceId: true, ownershipEpoch: true, dependsOn: true }).extend({ commandType: z.literal('AmendPendingExercise'),
  target: z.object({ planId: id }).strict(), expected: amendmentExpected, intent: amendmentIntent }).strict();
export type AmendPendingExerciseCommand = z.infer<typeof amendPendingExerciseCommand>;
export type AmendmentContent = z.infer<typeof amendmentContent>;
export const amendmentResponse = z.object({ replayed: z.boolean(), outcomeCursor: z.string().regex(/^[1-9][0-9]*$/),
  outcome: z.discriminatedUnion('status', [z.object({ status: z.literal('Accepted'), actionId: id, commandType: z.literal('AmendPendingExercise'),
    acceptedSequence: z.string().regex(/^[1-9][0-9]*$/), result: z.object({ planId: id, version: z.int().min(1), contentHash: hash }).strict() }).strict(),
    z.object({ status: z.enum(['Rejected', 'Conflict']), actionId: id, commandType: z.literal('AmendPendingExercise'), code: z.string().min(1) }).strict()]) }).strict();
