import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createHypertrophyPlan } from '../../engine/trainer2/plan-builder';
import { canonicalJson, integrityHash } from './integrity';
import { draftHttp } from './http';

const context = vi.hoisted(() => ({ db: {} as Record<string, unknown>, principal: { accountId: 'synthetic-account', issuer: 'synthetic', subject: 'synthetic' } }));
vi.mock('./access', () => ({ requestContext: async () => context }));
vi.mock('./principal', () => ({ authorizeAccount: async () => {}, DraftAccessError: class extends Error {} }));
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

it.each(['complete', 'missing hash', 'null hash', 'wrong hash', 'missing revision', 'empty revision', 'invalid number', 'invalid document'])('production read HTTP boundary: %s', async variant => {
  const planId = crypto.randomUUID();
  const document = createHypertrophyPlan();
  const revision: Record<string, unknown> = { id: crypto.randomUUID(), revisionNumber: 1, document, contentHash: integrityHash(canonicalJson(document)) };
  if (variant === 'missing hash') delete revision.contentHash;
  if (variant === 'null hash') revision.contentHash = null;
  if (variant === 'wrong hash') revision.contentHash = '0'.repeat(64);
  if (variant === 'missing revision') delete revision.id;
  if (variant === 'empty revision') revision.id = '';
  if (variant === 'invalid number') revision.revisionNumber = 0;
  if (variant === 'invalid document') revision.document = { ...document, occurrences: null };
  const readOnly = vi.fn();
  context.db = { trainer2Plan: { findFirst: async () => ({ id: planId, currentRevisionId: revision.id }) },
    trainer2PlanRevision: { findFirstOrThrow: async () => revision }, $executeRaw: readOnly,
    $transaction: async (fn: (db: unknown) => Promise<unknown>) => fn(context.db) };
  const result = await draftHttp(new Request(`http://127.0.0.1/api/trainer2/drafts/${planId}`), 'ReadDraft', planId);
  expect(readOnly).toHaveBeenCalledOnce();
  const body = await result.json();
  if (variant === 'complete') { expect(result.status).toBe(200); expect(body.review.status).toBe('validDraft'); }
  else { expect(result.ok).toBe(false); expect(body.review).toBeUndefined(); }
});
