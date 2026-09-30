import type { ExecutionRead } from '@/lib/trainer2-contracts/execution';

export function ExerciseSwapHistory({ execution }: { execution: ExecutionRead }) {
  if (!execution.swaps?.length) return null;
  return <details className="my-2 text-sm">
    <summary className="min-h-11 cursor-pointer py-2">Exercise swap history</summary>
    <ul className="space-y-3">{execution.initial.positions.map(owned => {
      const swaps = execution.swaps!.filter(s => s.positionId === owned.id).sort((a, b) => a.version - b.version);
      if (!swaps.length) return null;
      const original = execution.initial.occurrence.positions.find(p => p.id === owned.sourcePositionId)!;
      return <li key={owned.id}><p className="font-semibold">Originally {original.exercise.name}</p>
        <ol className="space-y-1">{swaps.map((swap, index) => <li key={swap.version}>
          {index === 0 ? original.exercise.name : swaps[index - 1].content.exercise.name} → {swap.content.exercise.name}
          {swap.content.restoreOriginal ? ' · Returned to original' : ' · Swapped for today'}
          <span className="block text-xs text-slate-500">{swap.recordedAt}</span>
        </li>)}</ol>
      </li>;
    })}</ul>
  </details>;
}
