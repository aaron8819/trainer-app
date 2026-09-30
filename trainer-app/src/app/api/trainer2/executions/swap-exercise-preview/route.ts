import { executionHttp } from '@/lib/api/trainer2/execution-http';
export async function POST(request: Request) {
  return executionHttp(request, 'PreviewExerciseSwap');
}
