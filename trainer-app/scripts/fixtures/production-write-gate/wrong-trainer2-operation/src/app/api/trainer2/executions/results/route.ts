export async function POST(request: Request) {
  const paused = productionWritePauseResponse('trainer2_draft', '/api/trainer2/executions/results');
  if (paused) return paused;
  return executionHttp(request, 'SaveSetResult');
}
