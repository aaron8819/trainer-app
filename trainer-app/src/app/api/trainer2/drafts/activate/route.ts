import { draftHttp } from '@/lib/api/trainer2/http';
import { productionWritePauseResponse } from '@/lib/operations/production-write-gate-http';

export async function POST(request: Request) {
  const paused = productionWritePauseResponse('mesocycle_acceptance', '/api/trainer2/drafts/activate');
  if (paused) return paused;
  return draftHttp(request, 'ActivatePlan');
}
