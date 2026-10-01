import { executionPositions } from '../../engine/trainer2/execution-targets';
import { effectiveOccurrence } from '../../engine/trainer2/exercise-swap';
import { sameLoggingExercise, compatibleLoggingLoad } from '../../engine/trainer2/logging-prefill';
import type { Prisma } from '@prisma/client';
import type { ExecutionRead } from '../../trainer2-contracts/execution';
import type { PerformedResult } from '../../trainer2-contracts/set-results';
import { canonicalJson } from '../../trainer2-contracts/canonical-json';
import { readExecution } from './execution';
import type { ServerPrincipal } from './principal';

type Position = ExecutionRead['initial']['occurrence']['positions'][number];
type PositionMatch = { status: 'none' } | { status: 'ambiguous' } | { status: 'unique'; position: Position };

function resolvePreviousPosition(current: Position, source: Position[]): PositionMatch {
  const matches = source.filter(position => sameLoggingExercise(position.exercise, current.exercise));
  if (matches.length === 0) return { status: 'none' };
  if (matches.length > 1) return { status: 'ambiguous' };
  return { status: 'unique', position: matches[0] };
}
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
export async function readExecutionWithPrevious(tx: Prisma.TransactionClient, principal: ServerPrincipal, executionId: string, preview?: ExecutionRead) {
  const current = preview ?? await readExecution(tx, principal, executionId);
  if (!current) return null;
  const previous: NonNullable<ExecutionRead['previous']> = [];
  const firstSetLoads: NonNullable<ExecutionRead['firstSetLoads']> = [];
  const wanted = effectiveOccurrence(current).positions.filter(p => p.exercise.kind === 'catalogSnapshot');
  const ambiguous = new Set<string>();
  if (!wanted.length || current.lifecycle === 'Discarded') return { ...current, previous, firstSetLoads };
  const candidates = await tx.trainer2ExecutionFinish.findMany({ where: { accountId: principal.accountId, executionId: { not: executionId }, finishedAt: { lte: new Date(current.initial.startedAt) } }, orderBy: [{ finishedAt: 'desc' }, { executionId: 'asc' }], select: { executionId: true } });
  for (const candidate of candidates) {
    const source = await readExecution(tx, principal, candidate.executionId);
    if (source?.lifecycle !== 'Finished' || !source.finish) continue;
    for (const position of wanted.filter(p => !ambiguous.has(p.id))) {
      const decision = resolvePreviousPosition(position, effectiveOccurrence(source).positions);
      if (decision.status === 'ambiguous') { ambiguous.add(position.id); continue; }
      if (decision.status === 'none') continue;
      const match = decision.position;
      // Weight suggestions need no performed reps and use working sets only.
      const target = position.targets[0];
      if (target && !firstSetLoads.some(h => h.positionId === position.id)) {
        const owned = executionPositions(source).find(p => p.sourcePositionId === match.id);
        const result = owned?.targets.flatMap(t => {
          if (match.targets.find(s => s.id === t.displayTargetId)?.classification !== 'working') return [];
          const saved = source.results.find(r => r.targetId === t.id);
          const m = saved?.result?.measurement;
          return saved && m && 'value' in m && compatibleLoggingLoad(m, target, position.exercise) ? [saved] : [];
        })[0];
        if (result) firstSetLoads.push({ positionId: position.id, executionId: source.executionId, result });
      }
      if (previous.some(h => h.positionId === position.id)) continue;
      const owned = executionPositions(source).find(p => p.sourcePositionId === match.id);
      if (!owned) continue;
      const currentOwned = executionPositions(current).find(p => p.sourcePositionId === position.id);
      const currentResults = current.results.flatMap(r => r.result && currentOwned?.targets.some(t => t.id === r.targetId) ? [r.result] : []);
      const results = owned.targets.flatMap(t => {
        const saved = source.results.find(r => r.targetId === t.id);
        return saved?.result && compatiblePrevious(position, match, saved.result, currentResults) ? [saved] : [];
      });
      if (results.length) previous.push({ positionId: position.id, sourcePositionId: match.id, executionId: source.executionId,
        workoutName: source.initial.occurrence.name, finishedAt: source.finish.finishedAt, results });
    }
    if (wanted.every(p => ambiguous.has(p.id) || (previous.some(h => h.positionId === p.id) && firstSetLoads.some(h => h.positionId === p.id)))) break;
  }
  return { ...current, previous, firstSetLoads };
}
