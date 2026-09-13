import { z } from 'zod';
import { id, progressionIntent, savedDraftDocument, type DraftDocument } from '../../trainer2-contracts/draft';
import { canonicalJson } from '../../trainer2-contracts/canonical-json';
import { REVIEW_POLICY, reviewPlan } from './plan-review';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const account = z.string().min(1).max(200).refine(v => v.trim() === v);
const issue = z.object({ code: z.string().min(1), message: z.string().min(1),
  location: z.enum(['progression', 'editor', 'repair']), occurrenceId: id.optional() }).strict();
const savedReview = z.object({
  accountId: account, planId: id, revisionId: id, contentHash: hash,
  progression: progressionIntent.nullable(), progressionHash: hash,
  policyVersion: z.literal(REVIEW_POLICY), digest: hash, issues: z.array(issue),
  status: z.enum(['issues', 'validDraft']), intent: savedDraftDocument,
}).strict();
const responseSchema = z.object({ planId: id, revisionId: id, revisionNumber: z.int().positive(),
  contentHash: hash, intent: savedDraftDocument, review: savedReview,
  activationBlockers: z.array(z.string().min(1)),
}).strict();
export type SavedPlanResponse = z.infer<typeof responseSchema>;
export type SavedPlanReview = z.infer<typeof savedReview>;
export const INVALID_REVIEW_MESSAGE = 'Couldn’t verify this review. Try again.';

async function sha256(value: string) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

// One response boundary for the producer and browser. Nothing is defaulted from
// the expected snapshot; hashes, result policy and both documents must agree.
export async function validateReviewResponse(input: unknown, expected: {
  accountId: string; planId: string;
  snapshot?: { revisionId: string; contentHash: string; intent: DraftDocument };
}): Promise<SavedPlanResponse> {
  try {
    const result = responseSchema.parse(input);
    const r = result.review;
    const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
    const check = (valid: boolean) => { if (!valid) throw new Error('INVALID_REVIEW'); };
    check(r.accountId === account.parse(expected.accountId) && r.planId === id.parse(expected.planId));
    check(r.planId === result.planId && r.revisionId === result.revisionId && r.contentHash === result.contentHash);
    check(same(r.intent, result.intent) && same(r.progression, r.intent.progression ?? null));
    check(r.contentHash === await sha256(canonicalJson(r.intent)));
    check(r.progressionHash === await sha256(canonicalJson(r.progression)));
    const { accountId, planId, revisionId, contentHash, progression, progressionHash, policyVersion } = r;
    check(r.digest === await sha256(canonicalJson({ accountId, planId, revisionId, contentHash, progression, progressionHash, policyVersion })));
    const issues = reviewPlan(r.intent);
    check(same(r.issues, issues) && r.status === (issues.length ? 'issues' : 'validDraft'));
    check(same(result.activationBlockers, ['ACTIVATION_NOT_IMPLEMENTED', ...issues.map(i => i.code)]));
    if (expected.snapshot) {
      check(r.revisionId === id.parse(expected.snapshot.revisionId) && r.contentHash === hash.parse(expected.snapshot.contentHash));
      check(same(r.intent, expected.snapshot.intent));
    }
    return result;
  } catch { throw new Error(INVALID_REVIEW_MESSAGE); }
}
