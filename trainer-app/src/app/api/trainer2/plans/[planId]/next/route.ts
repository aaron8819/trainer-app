import { executionHttp } from '@/lib/api/trainer2/execution-http';
export async function GET(request: Request, context: { params: Promise<{ planId: string }> }) {
  return executionHttp(request, 'ReadNext', (await context.params).planId);
}
