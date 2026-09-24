import { draftHttp } from '@/lib/api/trainer2/http';
import { productionWritePauseResponse } from '@/lib/operations/production-write-gate-http';

export async function POST(request: Request) {
  const paused = productionWritePauseResponse('trainer2_draft', '/api/trainer2/drafts/instructions');
  if (paused) return paused;
  return draftHttp(request, 'ChangeInstructions');
}
