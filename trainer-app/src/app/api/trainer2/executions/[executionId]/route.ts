import { executionHttp } from '@/lib/api/trainer2/execution-http';
export async function GET(request: Request, context: { params: Promise<{ executionId: string }> }) {
  return executionHttp(request, 'ReadExecution', (await context.params).executionId);
}
