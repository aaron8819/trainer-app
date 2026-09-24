import { executionHttp } from '@/lib/api/trainer2/execution-http';
import { productionWritePauseResponse } from '@/lib/operations/production-write-gate-http';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const paused = productionWritePauseResponse('workout_structural_edit', '/api/trainer2/executions/discard');
  if (paused) return paused;
  return executionHttp(request, 'DiscardEmptyExecution');
}
