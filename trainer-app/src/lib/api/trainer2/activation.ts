import { ZodError } from 'zod';
import { INVALID_REVIEW_MESSAGE } from '../../engine/trainer2/review-response';
import { DraftFailure } from '../../engine/trainer2/planning';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { activatePlanCommand, ACTIVATION_POLICY } from '../../trainer2-contracts/activation';
import { acceptCommand, CommandFailure } from './command';
import { readDraft } from './planning';
import { canonicalJson } from './integrity';
import type { ServerPrincipal } from './principal';

export async function activatePlan(db: PrismaClient, principal: ServerPrincipal, input: unknown) {
  const command = activatePlanCommand.parse(input);
  return acceptCommand(db, principal, input, command, async tx => {
    const plan = await tx.trainer2Plan.findFirst({ where: { id: command.target.planId, accountId: principal.accountId, tombstonedAt: null } });
    if (!plan) throw new CommandFailure('NOT_FOUND');
    if (plan.lifecycle !== 'Draft') throw new CommandFailure(plan.lifecycle === 'Active' ? 'ALREADY_ACTIVATED' : 'PLAN_NOT_DRAFT', true);
    if (plan.currentRevisionId !== command.expected.planRevisionId) throw new CommandFailure('STALE_REVIEW', true);
    let saved;
    try { saved = await readDraft(tx, principal, plan.id); }
    catch (error) {
      if (error instanceof ZodError || error instanceof DraftFailure || (error instanceof Error && error.message === INVALID_REVIEW_MESSAGE)) throw new CommandFailure('INVALID_SAVED_PLAN');
      throw error;
    }
    if (!saved) throw new CommandFailure('NOT_FOUND');
    const reviewed = command.intent.reviewed;
    if (reviewed.digest !== saved.activation.digest || canonicalJson(reviewed.binding) !== canonicalJson(saved.activation.binding)
      || canonicalJson(reviewed.instructions) !== canonicalJson(saved.activation.instructions)) throw new CommandFailure('STALE_REVIEW', true);
    if (saved.review.issues.length) throw new CommandFailure('PLAN_ISSUES');
    if (saved.activation.binding.restrictionIssues.length) throw new CommandFailure('UNRESOLVED_EXCLUSION');
    const current = await tx.trainer2Plan.findFirst({ where: { accountId: principal.accountId, lifecycle: { in: ['Active', 'Paused'] } } });
    if (current) throw new CommandFailure('CURRENT_PLAN_CONFLICT', true, current.id);
    const decisionId = randomUUID();
    await tx.trainer2Plan.update({ where: { id: plan.id }, data: { lifecycle: 'Active', initialApprovedRevisionId: saved.revisionId } });
    await tx.trainer2PlanDecision.create({ data: { id: decisionId, accountId: principal.accountId, planId: plan.id,
      revisionId: saved.revisionId, actionId: command.actionId, kind: 'ActivatePlan',
      instructionRevisionId: saved.activation.instructions.revisionId, reviewedDigest: reviewed.digest, policyVersion: ACTIVATION_POLICY } });
    return { planId: plan.id, revisionId: saved.revisionId, decisionId, lifecycle: 'Active' as const };
  });
}
