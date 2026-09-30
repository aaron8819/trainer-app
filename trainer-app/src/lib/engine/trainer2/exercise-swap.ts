import type { ExecutionRead } from '../../trainer2-contracts/execution';
import { SWAP_POLICY, type AssignmentBinding, type ExerciseSwap } from '../../trainer2-contracts/exercise-swap';
import { catalogExercise, type CatalogExercise } from './catalog';

export function currentAssignment(execution: Pick<ExecutionRead, 'swaps' | 'contentHash'>, positionId: string): AssignmentBinding {
  const latest = execution.swaps?.filter(s => s.positionId === positionId).sort((a, b) => b.version - a.version)[0];
  return { positionId, version: latest?.version ?? 0, actionId: latest?.actionId ?? null, contentHash: latest?.contentHash ?? execution.contentHash };
}
export function effectiveOccurrence(execution: Pick<ExecutionRead, 'initial' | 'swaps' | 'contentHash'>) {
  if (!execution.swaps?.length) return execution.initial.occurrence;
  return { ...execution.initial.occurrence, positions: execution.initial.occurrence.positions.map(original => {
    const owned = execution.initial.positions.find(p => p.sourcePositionId === original.id)!;
    const binding = currentAssignment(execution, owned.id);
    const latest = execution.swaps?.find(s => s.positionId === owned.id && s.version === binding.version);
    return latest ? { ...original, exercise: latest.content.exercise,
      targets: latest.content.targets.map(t => ({ ...t, id: owned.targets.find(o => o.id === t.id)!.sourceTargetId })) } : original;
  }) };
}
export function swapEligible(execution: Pick<ExecutionRead, 'initial' | 'lifecycle' | 'results' | 'history' | 'skips'>, positionId: string) {
  const position = execution.initial.positions.find(p => p.id === positionId);
  return execution.lifecycle === 'Open' && !!position && !position.targets.some(t =>
    (execution.history ?? execution.results).some(r => r.targetId === t.id) || execution.skips?.some(s => s.targetId === t.id));
}
// Always derive from START, even when restoring after multiple replacements.
export function replacementContent(execution: Pick<ExecutionRead, 'initial'>, positionId: string, entry: CatalogExercise | null): ExerciseSwap['content'] {
  const owned = execution.initial.positions.find(p => p.id === positionId);
  if (!owned) throw new Error('POSITION_NOT_FOUND');
  const original = execution.initial.occurrence.positions.find(p => p.id === owned.sourcePositionId)!;
  const exercise = entry ? catalogExercise(entry) : original.exercise;
  const compatible = exercise.kind === 'catalogSnapshot' && original.exercise.kind === 'catalogSnapshot' &&
    exercise.purpose === original.exercise.purpose && exercise.repBasis === original.exercise.repBasis;
  if (entry && (!Number.isInteger(entry.reps.min) || !Number.isInteger(entry.reps.max) ||
    !['total', 'perSide', 'alternating'].includes(entry.repBasis))) throw new Error('UNSUPPORTED_MEASUREMENT');
  return { policyVersion: SWAP_POLICY, positionId, restoreOriginal: !entry, exercise,
    targets: original.targets.map((target, i) => ({ ...target, id: owned.targets[i].id,
      reps: !entry || compatible ? { ...target.reps } : { ...entry.reps, basis: exercise.kind === 'catalogSnapshot' ? exercise.repBasis : target.reps.basis },
      measurement: !entry ? target.measurement : entry.loadKind === 'bodyweight' ? { kind: 'bodyweight' as const, convention: 'bodyweightOnly' as const } : null,
    })) };
}
