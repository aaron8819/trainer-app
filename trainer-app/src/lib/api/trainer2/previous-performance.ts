import type { Prisma } from '@prisma/client';
import type { ExecutionRead } from '../../trainer2-contracts/execution';
import type { PerformedResult } from '../../trainer2-contracts/set-results';
import { canonicalJson } from '../../trainer2-contracts/canonical-json';
import { readExecution } from './execution';
import type { ServerPrincipal } from './principal';

type Position = ExecutionRead['initial']['occurrence']['positions'][number];
export function compatiblePrevious(current: Position, source: Position, result: PerformedResult, currentResults: PerformedResult[] = []) {
  const a = current.exercise, b = source.exercise;
  if (a.kind !== 'catalogSnapshot' || b.kind !== 'catalogSnapshot' || canonicalJson(a) !== canonicalJson(b)) return false;
  // Missing measurements cannot establish comparability. Never infer a custom identity from a name.
  if (!result.reps || !result.measurement) return false;
  // Both supported numeric units measure mass; the UI converts kg to lb without changing source evidence.
  const observed = currentResults.filter(r => r.reps || r.measurement);
  if (observed.length) return observed.some(r => (!r.reps || r.reps.basis === result.reps!.basis) && (!r.measurement ||
    (r.measurement.kind === result.measurement!.kind && r.measurement.convention === result.measurement!.convention)));
  if (result.reps.basis !== a.repBasis || result.measurement.kind !== a.loadKind || result.measurement.convention !== a.convention) return false;
  return current.targets.some(t => t.reps.basis === result.reps!.basis && (!t.measurement ||
    (t.measurement.kind === result.measurement!.kind && t.measurement.convention === result.measurement!.convention)));
}

// Presentation-only enrichment, called inside the existing authorized read-only transaction.
export async function readExecutionWithPrevious(tx: Prisma.TransactionClient, principal: ServerPrincipal, executionId: string) {
  const current = await readExecution(tx, principal, executionId);
  if (!current) return null;
  const previous: NonNullable<ExecutionRead['previous']> = [];
  const wanted = current.initial.occurrence.positions.filter(p => p.exercise.kind === 'catalogSnapshot');
  if (!wanted.length || current.lifecycle === 'Discarded') return { ...current, previous };
  const candidates = await tx.trainer2ExecutionFinish.findMany({ where: { accountId: principal.accountId, executionId: { not: executionId }, finishedAt: { lte: new Date(current.initial.startedAt) } }, orderBy: [{ finishedAt: 'desc' }, { executionId: 'asc' }], select: { executionId: true } });
  for (const candidate of candidates) {
    const source = await readExecution(tx, principal, candidate.executionId);
    if (source?.lifecycle !== 'Finished' || !source.finish) continue;
    for (const position of wanted.filter(p => !previous.some(h => h.positionId === p.id))) {
      const matches = source.initial.occurrence.positions.filter(p => canonicalJson(p.exercise) === canonicalJson(position.exercise));
      // Multiple appearances are not a one-to-one position match. Omit instead of inventing one.
      if (matches.length !== 1) continue;
      const match = matches[0], owned = source.initial.positions.find(p => p.sourcePositionId === match.id)!;
      const currentOwned = current.initial.positions.find(p => p.sourcePositionId === position.id);
      const currentResults = current.results.flatMap(r => r.result && currentOwned?.targets.some(t => t.id === r.targetId) ? [r.result] : []);
      const results = owned.targets.flatMap(t => {
        const saved = source.results.find(r => r.targetId === t.id);
        return saved?.result && compatiblePrevious(position, match, saved.result, currentResults) ? [saved] : [];
      });
      if (results.length) previous.push({ positionId: position.id, sourcePositionId: match.id, executionId: source.executionId,
        workoutName: source.initial.occurrence.name, finishedAt: source.finish.finishedAt, results });
    }
    if (previous.length === wanted.length) break;
  }
  return { ...current, previous };
}
