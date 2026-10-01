import type { InitialPrescription } from '../../trainer2-contracts/execution';

import type { SetAddition } from '../../trainer2-contracts/add-set';
type TargetExecution = { initial: InitialPrescription; additions?: SetAddition[] };
// Original targets retain their source identity. Additions have only execution identity.
export function executionPositions(execution: TargetExecution) {
  return execution.initial.positions.map(p => ({ ...p, targets: [
    ...p.targets.map(t => ({ ...t, displayTargetId: t.sourceTargetId })),
    ...(execution.additions ?? []).filter(a => a.content.positionId === p.id)
      .sort((a,b) => a.content.ordinal - b.content.ordinal)
      .map(a => ({ id: a.content.target.id, displayTargetId: a.content.target.id })),
  ] }));
}
