import { executionHttp } from '@/lib/api/trainer2/execution-http';
import { productionWritePauseResponse } from '@/lib/operations/production-write-gate-http';
export async function POST(request: Request) {
  const paused = productionWritePauseResponse('workout_structural_edit', '/api/trainer2/plans/amend-exercise');
  if (paused) return paused;
  return executionHttp(request, 'AmendPendingExercise');
}
