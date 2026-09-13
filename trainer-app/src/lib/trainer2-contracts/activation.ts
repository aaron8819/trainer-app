import { z } from 'zod';
import { id, createDraftCommand } from './draft';

export const ACTIVATION_POLICY = 'trainer2-activation-v1';
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
const validity = { from: z.iso.datetime(), until: z.iso.datetime().nullable() };
export const restriction = z.object({ id, revisionId: id, catalogId: z.string().min(1).max(200),
  instruction: z.string().trim().min(1).max(500), planId: id.nullable(), ...validity, cleared: z.boolean(),
}).strict().refine(v => !v.until || Date.parse(v.until) > Date.parse(v.from), 'End must follow start');
export const exception = z.object({ id, restrictionRevisionId: id, planId: id, planRevisionId: id,
  positionIds: z.array(id).min(1).max(10000).refine(v => new Set(v).size === v.length),
  reason: z.string().trim().min(1).max(500), ...validity,
}).strict().refine(v => !v.until || Date.parse(v.until) > Date.parse(v.from), 'End must follow start');
export const instructionDocument = z.object({ version: z.literal(1), restrictions: z.array(restriction).max(1000),
  exceptions: z.array(exception).max(1000) }).strict();
export type InstructionDocument = z.infer<typeof instructionDocument>;
export const emptyInstructions = (): InstructionDocument => ({ version: 1, restrictions: [], exceptions: [] });
export const instructionSnapshot = z.object({ epoch: z.int().min(0), revisionId: id.nullable(),
  contentHash: hash, document: instructionDocument }).strict();
export type InstructionSnapshot = z.infer<typeof instructionSnapshot>;
export const restrictionIssue = z.object({ restrictionRevisionId: id, positionId: id, occurrenceId: id,
  kind: z.enum(['excluded', 'uncertain']), message: z.string().min(1) }).strict();
export type RestrictionIssue = z.infer<typeof restrictionIssue>;
export const activationBinding = z.object({ accountId: z.string().min(1), planId: id, revisionId: id,
  reviewDigest: hash, instructionEpoch: z.int().min(0), instructionRevisionId: id.nullable(), instructionHash: hash,
  restrictionIssues: z.array(restrictionIssue), policyVersion: z.literal(ACTIVATION_POLICY),
}).strict();
export const activationReview = z.object({ binding: activationBinding, digest: hash,
  instructions: instructionSnapshot, evaluatedAt: z.iso.datetime() }).strict();
export type ActivationReview = z.infer<typeof activationReview>;
const envelope = createDraftCommand.pick({ schemaVersion: true, actionId: true, originatingAccountId: true,
  deviceId: true, ownershipEpoch: true, dependsOn: true });
export const activatePlanCommand = envelope.extend({ commandType: z.literal('ActivatePlan'),
  target: z.object({ planId: id }).strict(), expected: z.object({ planRevisionId: id }).strict(),
  intent: z.object({ reviewed: activationReview }).strict(),
}).strict();
export const instructionCommand = envelope.extend({ commandType: z.literal('ChangeInstructions'),
  target: z.object({}).strict(), expected: z.object({ instructionEpoch: z.int().min(0) }).strict(),
  intent: z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('AddRestriction'), restriction }).strict(),
    z.object({ operation: z.literal('ClearRestriction'), restrictionRevisionId: id, newRevisionId: id }).strict(),
    z.object({ operation: z.literal('AddScopedException'), exception }).strict(),
  ]),
}).strict();
export type ActivatePlanCommand = z.infer<typeof activatePlanCommand>;
export type InstructionCommand = z.infer<typeof instructionCommand>;
export const lifecycle = z.enum(['Draft', 'Active', 'Paused', 'Completed', 'ConcludedEarly']);
export const planState = z.object({ lifecycle, initialApprovedRevisionId: id.nullable() }).strict();
const cursor = z.string().regex(/^[1-9][0-9]*$/);
export const activationResponse = z.object({ replayed: z.boolean(), outcomeCursor: cursor,
  outcome: z.discriminatedUnion('status', [
    z.object({ status: z.literal('Accepted'), actionId: id, commandType: z.literal('ActivatePlan'), acceptedSequence: cursor,
      result: z.object({ planId: id, revisionId: id, decisionId: id, lifecycle: z.literal('Active') }).strict() }).strict(),
    z.object({ status: z.enum(['Conflict', 'Rejected']), actionId: id, commandType: z.literal('ActivatePlan'), code: z.string().min(1), currentPlanId: id.optional() }).strict(),
  ]),
}).strict();
