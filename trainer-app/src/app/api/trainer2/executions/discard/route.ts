import { executionHttp } from '@/lib/api/trainer2/execution-http';
export const runtime = 'nodejs';
export async function POST(request: Request) { return executionHttp(request, 'DiscardEmptyExecution'); }
