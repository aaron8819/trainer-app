import type { InitialPrescription } from '../../trainer2-contracts/execution';

import type { SetAddition } from '../../trainer2-contracts/add-set';
import type { ExerciseAddition } from '../../trainer2-contracts/add-exercise';
type TargetExecution = { initial: InitialPrescription; additions?: SetAddition[]; exerciseAdditions?: ExerciseAddition[] };
export function originalPositions(execution: TargetExecution) {
  return [...execution.initial.occurrence.positions,
    ...(execution.exerciseAdditions ?? []).slice().sort((a,b) => a.content.ordinal-b.content.ordinal).map(a => a.content.position)];
}
export function baseExecutionPositions(execution: TargetExecution) {
  return [...execution.initial.positions.map(p => ({ ...p, displayPositionId: p.sourcePositionId,
    targets: p.targets.map(t => ({ ...t, displayTargetId: t.sourceTargetId })) })),
    ...(execution.exerciseAdditions ?? []).slice().sort((a,b) => a.content.ordinal-b.content.ordinal).map(a => ({
      id: a.content.position.id, sourcePositionId: null, displayPositionId: a.content.position.id,
      targets: a.content.position.targets.map(t => ({ id: t.id, displayTargetId: t.id })),
    }))];
}
// Original targets retain their source identity. Additions have only execution identity.
export function executionPositions(execution: TargetExecution) {
  return baseExecutionPositions(execution).map(p => ({ ...p, targets: [
    ...p.targets,
    ...(execution.additions ?? []).filter(a => a.content.positionId === p.id)
      .sort((a,b) => a.content.ordinal - b.content.ordinal)
      .map(a => ({ id: a.content.target.id, displayTargetId: a.content.target.id })),
  ] }));
}
