import { executionHttp } from '@/lib/api/trainer2/execution-http';
export const POST = (request: Request) => executionHttp(request, 'StartOccurrence');
