import { saveSetResult } from './set-results';
import { ZodError } from 'zod';
import { id } from '../../trainer2-contracts/draft';
import { requestContext } from './access';
import { DraftAccessError } from './principal';
import { ActionCollision, CommandFailure } from './command';
import { InvalidStartSnapshot, readExecution, readNextWorkout, startOccurrence } from './execution';

export async function executionHttp(request: Request, operation: 'StartOccurrence' | 'SaveSetResult' | 'ReadExecution' | 'ReadNext', target?: string) {
  const json = (body: unknown, status: number) => Response.json(body, { status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } });
  try {
    const { db, principal } = await requestContext(request, operation === 'StartOccurrence' || operation === 'SaveSetResult' ? 'write' : 'read');
    if (operation === 'ReadExecution' || operation === 'ReadNext') {
      const key = id.parse(target);
      const result = await db.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
        return operation === 'ReadExecution' ? readExecution(tx, principal, key) : readNextWorkout(tx, principal, key);
      });
      return json(result ?? { error: 'NOT_FOUND' }, result ? 200 : 404);
    }
    const text = await request.text();
    if (text.length > 10000) return json({ error: 'COMMAND_TOO_LARGE' }, 413);
    const result = await (operation === 'SaveSetResult' ? saveSetResult : startOccurrence)(db, principal, JSON.parse(text));
    return json(result, result.outcome.status === 'Accepted' ? 200 : result.outcome.status === 'Conflict' ? 409 : 422);
  } catch (error) {
    if (error instanceof DraftAccessError) return json({ error: error.message }, 403);
    if (error instanceof ActionCollision) return json({ error: 'ACTION_ID_COLLISION' }, 409);
    if (error instanceof InvalidStartSnapshot) return json({ error: 'INVALID_START_SNAPSHOT' }, 422);
    if (error instanceof CommandFailure) return json({ error: error.code }, error.code === 'NOT_FOUND' ? 404 : 409);
    if (error instanceof ZodError || error instanceof SyntaxError) return json({ error: 'INVALID_COMMAND' }, 400);
    return json({ error: 'EXECUTION_TRANSACTION_FAILED', retry: 'Retry the same action envelope' }, 503);
  }
}
