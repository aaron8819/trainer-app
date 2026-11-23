import type { Prisma } from '@prisma/client';
import { executionPositions } from '../../engine/trainer2/execution-targets';
import { currentAssignment, effectiveOccurrence } from '../../engine/trainer2/exercise-swap';
import { sameLoggingExercise } from '../../engine/trainer2/logging-prefill';
import { savedDraftDocument } from '../../trainer2-contracts/draft';
import type { ExerciseHistoryRead } from '../../trainer2-contracts/exercise-history';
import { canonicalJson, integrityHash } from './integrity';
import { catalog, catalogExercise } from '../../engine/trainer2/catalog';
import type { ExecutionRead } from '../../trainer2-contracts/execution';
import type { PerformedResult } from '../../trainer2-contracts/set-results';
import { compatiblePrevious } from './previous-performance';
import { readExecution } from './execution';
import type { ServerPrincipal } from './principal';

type Position = ExecutionRead['initial']['occurrence']['positions'][number];
const legacyBackExtension = catalogExercise(catalog.find(e => e.id === 't2:bodyweight-45-degree-back-extension')!);
const plateOptionalBackExtension = catalogExercise(catalog.find(e => e.id === 't2:45-degree-back-extension')!);

function isLegacyBackExtension(current: Position, source: Position) {
  return sameLoggingExercise(current.exercise, plateOptionalBackExtension) &&
    sameLoggingExercise(source.exercise, legacyBackExtension);
}

function historyCompatible(current: Position, source: Position, result: PerformedResult, currentResults: PerformedResult[]) {
  if (!isLegacyBackExtension(current, source)) return compatiblePrevious(current, source, result, currentResults);
  // For this exact legacy movement, bodyweight is equivalent to no plates.
  // Use that equivalence only to qualify the comparison; return the recorded
  // bodyweight measurement unchanged and never use this rule for prefill.
  if (result.measurement?.kind !== 'bodyweight' || result.measurement.convention !== 'bodyweightOnly') return false;
  return compatiblePrevious(current, current, {
    ...result, measurement: { kind: 'addedLoad', convention: 'addedExternal', zeroMeaning: 'noAddedLoad', value: '0', unit: 'lb' },
  }, currentResults);
}

// A bounded, presentation-only read. Ambiguous occurrences stop the search, as in the existing prefill path.
export async function readExerciseHistory(tx: Prisma.TransactionClient, principal: ServerPrincipal, executionId: string, positionId: string, cursor?: string): Promise<ExerciseHistoryRead | null> {
  const current = await readExecution(tx, principal, executionId);
  if (!current || current.lifecycle === 'Discarded') return null;
  const ownedCurrent = executionPositions(current).find(p => p.id === positionId);
  const position = effectiveOccurrence(current).positions.find(p => p.id === ownedCurrent?.displayPositionId);
  if (!position) return null;
  const output: ExerciseHistoryRead = { executionId, positionId, limited: false, nextCursor: null, sessions: [] };
  if (position.exercise.kind !== 'catalogSnapshot') return output;
  const boundary = cursor ? await tx.trainer2ExecutionFinish.findFirst({ where: { accountId: principal.accountId, executionId: cursor, finishedAt: { lte: new Date(current.initial.startedAt) } }, select: { executionId: true, finishedAt: true } }) : null;
  if (cursor && (!boundary || cursor === executionId)) return null;
  const candidates = await tx.trainer2ExecutionFinish.findMany({ where: { accountId: principal.accountId, executionId: { not: executionId }, finishedAt: { lte: new Date(current.initial.startedAt) }, ...(boundary ? { OR: [{ finishedAt: { lt: boundary.finishedAt } }, { finishedAt: boundary.finishedAt, executionId: { gt: boundary.executionId } }] } : {}) }, orderBy: [{ finishedAt: 'desc' }, { executionId: 'asc' }], take: 6, select: { executionId: true } });
  if (candidates.length > 5) output.nextCursor = candidates[4].executionId;
  const currentResults = current.results.flatMap(r => r.result && ownedCurrent?.targets.some(t => t.id === r.targetId) ? [r.result] : []);
  for (const candidate of candidates.slice(0, 5)) {
    const source = await readExecution(tx, principal, candidate.executionId);
    if (source?.lifecycle !== 'Finished' || !source.finish) continue;
    const matches = effectiveOccurrence(source).positions.filter(p => sameLoggingExercise(p.exercise, position.exercise) || isLegacyBackExtension(position, p));
    if (matches.length > 1) { output.limited = true; output.nextCursor = null; break; }
    if (!matches.length) continue;
    const match = matches[0], owned = executionPositions(source).find(p => p.displayPositionId === match.id);
    if (!owned) continue;
    const assignment = currentAssignment(source, owned.id);
    const candidates = owned.targets.flatMap((target, index) => {
      const saved = source.results.find(r => r.targetId === target.id);
      if (!saved?.result || (!saved.assignment && assignment.version > 0) || (saved.assignment && canonicalJson(saved.assignment) !== canonicalJson(assignment))) return [];
      return [{ number: index + 1, result: saved.result }];
    });
    const anchor = candidates.find(s => historyCompatible(position, match, s.result, currentResults));
    if (!anchor) continue;
    const sets = candidates.filter(s => {
      const r = s.result, a = anchor.result;
      return (!r.reps || r.reps.basis === a.reps?.basis) && (!r.measurement || (r.measurement.kind === a.measurement?.kind && r.measurement.convention === a.measurement?.convention));
    });
    const revision = await tx.trainer2PlanRevision.findFirst({ where: { id: source.initial.revisionId, planId: source.initial.planId, accountId: principal.accountId }, select: { document: true, contentHash: true } });
    let deload: boolean | null = null;
    if (revision && revision.contentHash === source.initial.sourceContentHash && integrityHash(canonicalJson(revision.document)) === revision.contentHash) {
      const parsed = savedDraftDocument.safeParse(revision.document);
      if (parsed.success && parsed.data.occurrences.some(o => o.id === source.initial.occurrence.id && o.stageId === source.initial.stage.id)) deload = parsed.data.builder?.weeks.find(w => w.stageId === source.initial.stage.id)?.deload ?? null;
    }
    output.sessions.push({ executionId: source.executionId, workoutName: source.initial.occurrence.name, finishedAt: source.finish.finishedAt, deload, sets });
  }
  return output;
}
