import { reviewActivation } from '../../api/trainer2/instructions';
import { emptyInstructions } from '@/lib/trainer2-contracts/activation';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHypertrophyPlan } from './plan-builder';
import { REVIEW_POLICY, reviewPlan } from './plan-review';
import { validateReviewResponse } from './review-response';
import { canonicalJson, integrityHash } from '../../api/trainer2/integrity';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
function response(missingIntent = false) {
  const intent = createHypertrophyPlan();
  if (missingIntent) delete intent.progression;
  const binding = { accountId: 'account-a', planId: crypto.randomUUID(), revisionId: crypto.randomUUID(),
    contentHash: integrityHash(canonicalJson(intent)), progression: intent.progression ?? null,
    progressionHash: integrityHash(canonicalJson(intent.progression ?? null)), policyVersion: REVIEW_POLICY };
  const issues = reviewPlan(intent);
  const result = { planId: binding.planId, revisionId: binding.revisionId, revisionNumber: 1, contentHash: binding.contentHash, intent,
    activationBlockers: issues.map(i => i.code),
    review: { ...binding, intent, issues, status: issues.length ? 'issues' : 'validDraft', digest: integrityHash(canonicalJson(binding)) } };
  const instructions = { epoch: 0, revisionId: null, document: emptyInstructions(), contentHash: integrityHash(canonicalJson(emptyInstructions())) };
  return { ...result, state: { lifecycle: "Draft" as const, initialApprovedRevisionId: null as string | null }, activation: reviewActivation(result.review as import("@/lib/engine/trainer2/plan-review").SavedPlanReview, instructions) };
}
describe('complete runtime review binding', () => {
  it.each([false, true])('accepts a complete result; missing progression is an issue (%s)', async missing => {
    const r = response(missing);
    expect(await validateReviewResponse(JSON.parse(JSON.stringify(r)), { accountId: 'account-a', planId: r.planId, snapshot: r })).toEqual(r);
  });
  const fields = ['accountId', 'planId', 'revisionId', 'contentHash', 'progression', 'progressionHash', 'policyVersion', 'digest', 'intent', 'issues', 'status'];
  for (const value of [undefined, null, '', 42, {}, []]) {
    it.each(fields)('rejects %s with ' + JSON.stringify(value), async field => {
      const r = response();
      const malformed = structuredClone(r);
      if (value === undefined) delete (malformed.review as Record<string, unknown>)[field];
      else (malformed.review as Record<string, unknown>)[field] = value;
      // Empty issues is already the valid result shape for this populated plan.
      if (field === 'issues' && Array.isArray(value)) return;
      await expect(validateReviewResponse(malformed, { accountId: 'account-a', planId: r.planId })).rejects.toThrow('Couldn’t verify');
    });
  }
  it.each(['planId', 'revisionId', 'contentHash', 'intent', 'revisionNumber', 'activationBlockers'])('rejects missing outer %s', async field => {
    const r = response(); const bad = { ...r } as Record<string, unknown>; delete bad[field];
    await expect(validateReviewResponse(bad, { accountId: 'account-a', planId: r.planId })).rejects.toThrow();
  });
  it('rejects wrong context, equal-valued later revisions, absent expectations and inconsistent content', async () => {
    const r = response();
    for (const expected of [{ accountId: 'other', planId: r.planId }, { accountId: 'account-a', planId: crypto.randomUUID() },
      { accountId: '', planId: r.planId }, { accountId: 'account-a', planId: r.planId, snapshot: { ...r, revisionId: crypto.randomUUID() } }])
      await expect(validateReviewResponse(r, expected)).rejects.toThrow();
    for (const mutate of [
      (v: typeof r) => { v.review.policyVersion = 'unsupported'; },
      (v: typeof r) => { v.review.progression = { ...v.review.progression!, version: 2 as 1 }; },
      (v: typeof r) => { v.review.intent.name = 'Different content'; },
      (v: typeof r) => { v.intent.name = 'Different outer document'; },
      (v: typeof r) => { v.review.status = 'issues'; },
      (v: typeof r) => { v.review.issues.push({ code: 'INVENTED', message: 'Invented', location: 'editor' }); },
      (v: typeof r) => { v.review.digest = '0'.repeat(64); },
      (v: typeof r) => { v.review.contentHash = v.contentHash = '0'.repeat(64); },
      (v: typeof r) => { v.review.progressionHash = '0'.repeat(64); },
    ]) {
      const bad = structuredClone(r); mutate(bad);
      await expect(validateReviewResponse(bad, { accountId: 'account-a', planId: r.planId })).rejects.toThrow();
    }
  });
});
