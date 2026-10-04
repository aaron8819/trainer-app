import { executionHttp } from '@/lib/api/trainer2/execution-http';
import { productionWritePauseResponse } from '@/lib/operations/production-write-gate-http';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const paused = productionWritePauseResponse('mesocycle_lifecycle', '/api/trainer2/weeks/advance');
  if (paused) return paused;
  return executionHttp(request, 'AdvanceWeek');
}
