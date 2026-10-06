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
  context.db = { trainer2AccountTrainingState: { findUnique: async () => null }, trainer2Plan: { findFirst: async (args: { where: { id?: string } }) => args.where.id ? ({ id: planId, currentRevisionId: revision.id, lifecycle: "Draft", initialApprovedRevisionId: null }) : null },
    trainer2PlanRevision: { findFirstOrThrow: async () => revision }, $executeRaw: readOnly,
    $transaction: async (fn: (db: unknown) => Promise<unknown>) => fn(context.db) };
  const result = await draftHttp(new Request(`http://127.0.0.1/api/trainer2/drafts/${planId}`), 'ReadDraft', planId);
  expect(readOnly).toHaveBeenCalledOnce();
  const body = await result.json();
  if (variant === 'complete') { expect(result.status).toBe(200); expect(body.review.status).toBe('validDraft'); }
  else { expect(result.ok).toBe(false); expect(body.review).toBeUndefined(); }
});
import { compatiblePrevious } from './previous-performance';

it('requires catalog identity, mass units, load type and rep basis for previous performance', () => {
  const p = createHypertrophyPlan().occurrences[0].positions[0];
  const r = { reps: { value: 8, basis: 'total' as const }, measurement: { kind: 'externalLoad' as const, value: '70', unit: 'kg' as const, convention: 'barbellTotal' as const, zeroMeaning: 'validZero' as const }, rir: '2' };
  expect(compatiblePrevious(p, p, r)).toBe(true);
  const custom = { ...p, exercise: { kind: 'authoredDescription' as const, name: p.exercise.name, variation: '' } };
  expect(compatiblePrevious(custom, custom, r)).toBe(false);
  expect(compatiblePrevious(p, { ...p, exercise: { ...p.exercise, variation: 'other' } }, r)).toBe(false);
  expect(compatiblePrevious(p, p, { ...r, measurement: null })).toBe(false);
  expect(compatiblePrevious(p, p, { ...r, reps: { value: 8, basis: 'perSide' } })).toBe(false);
  expect(compatiblePrevious(p, p, { ...r, measurement: { kind: 'bodyweight', convention: 'bodyweightOnly' } })).toBe(false);
  const lb = { ...p, targets: p.targets.map(t => ({ ...t, measurement: { ...r.measurement, unit: 'lb' as const } })) };
  expect(compatiblePrevious(lb, p, r)).toBe(true);
  expect(compatiblePrevious(p, p, r, [{ ...r, measurement: { ...r.measurement, unit: 'lb' } }])).toBe(true);
  expect(compatiblePrevious(p, p, r, [{ ...r, measurement: { kind: 'bodyweight', convention: 'bodyweightOnly' } }])).toBe(false);
  expect(compatiblePrevious(p, p, r, [{ reps: null, measurement: { ...r.measurement, unit: 'lb' }, rir: null }])).toBe(true);
  expect(compatiblePrevious(p, p, r, [{ reps: null, measurement: r.measurement, rir: null }])).toBe(true);
});
