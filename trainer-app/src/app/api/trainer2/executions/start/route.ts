import { executionHttp } from '@/lib/api/trainer2/execution-http';
import { productionWritePauseResponse } from '@/lib/operations/production-write-gate-http';

export async function POST(request: Request) {
  const paused = productionWritePauseResponse('workout_materialization', '/api/trainer2/executions/start');
  if (paused) return paused;
  return executionHttp(request, 'StartOccurrence');
}
