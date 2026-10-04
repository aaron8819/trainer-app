import { AdmissionInfrastructureError, infrastructureReason } from './admission-diagnostics';
import { previewExerciseSwap, swapExercise } from './exercise-swap';
import { skipSet } from './skip-set';
import { readExecutionWithPrevious } from './previous-performance';
import { skipOccurrence } from './skip-occurrence';
import { discardEmptyExecution } from './discard-execution';
import { finishExecution } from './workout-finish';
import { saveSetResult, correctHistoricalSetResult } from './set-results';
import { ZodError } from 'zod';
import { id } from '../../trainer2-contracts/draft';
import { requestContext } from './access';
import { assertSessionMutationOrigin } from './authentication';
import { DraftAccessError } from './principal';
import { ActionCollision, CommandFailure } from './command';
import { InvalidStartSnapshot, readNextWorkout, startOccurrence } from './execution';
import { addSet } from './add-set';
import { addExercise } from './add-exercise';
import { advanceWeek } from './advance-week';

export async function executionHttp(request: Request, operation: 'AdvanceWeek' | 'AddExercise' | 'AddSet' | 'SwapExercise' | 'PreviewExerciseSwap' | 'SkipSet' | 'SkipOccurrence' | 'DiscardEmptyExecution' | 'CorrectHistoricalSetResult' | 'FinishExecution' | 'StartOccurrence' | 'SaveSetResult' | 'ReadExecution' | 'ReadNext', target?: string) {
  const started = Date.now();
  let stage = 'admission';
  const json = (body: unknown, status: number) => Response.json(body, { status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } });
  try {
    if (operation === 'PreviewExerciseSwap') assertSessionMutationOrigin(request);
    const purpose = operation === 'AdvanceWeek' || operation === 'AddExercise' || operation === 'AddSet' || operation === 'SwapExercise' || operation === 'SkipSet' || operation === 'SkipOccurrence' || operation === 'DiscardEmptyExecution' || operation === 'CorrectHistoricalSetResult' || operation === 'StartOccurrence' || operation === 'SaveSetResult' || operation === 'FinishExecution' ? 'write' : 'read';
    const { db, principal } = operation === 'PreviewExerciseSwap' ? await requestContext(request, purpose, false) : await requestContext(request, purpose);
    stage = 'transaction';
    if (operation === 'ReadExecution' || operation === 'ReadNext') {
      const key = id.parse(target);
      const result = await db.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
        return operation === 'ReadExecution' ? readExecutionWithPrevious(tx, principal, key) : readNextWorkout(tx, principal, key);
      });
      return json(result ?? { error: 'NOT_FOUND' }, result ? 200 : 404);
    }
    const text = await request.text();
    if (text.length > (operation === 'FinishExecution' || operation === 'DiscardEmptyExecution' ? 2000000 : 10000)) return json({ error: 'COMMAND_TOO_LARGE' }, 413);
    if (operation === 'PreviewExerciseSwap') {
      const value = await db.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
        return previewExerciseSwap(tx, principal, JSON.parse(text));
      });
      return json(value, 200);
    }
    const result = await (operation === 'AdvanceWeek' ? advanceWeek : operation === 'AddExercise' ? addExercise : operation === 'AddSet' ? addSet : operation === 'SwapExercise' ? swapExercise : operation === 'SkipSet' ? skipSet : operation === 'SkipOccurrence' ? skipOccurrence : operation === 'DiscardEmptyExecution' ? discardEmptyExecution : operation === 'CorrectHistoricalSetResult' ? correctHistoricalSetResult : operation === 'FinishExecution' ? finishExecution : operation === 'SaveSetResult' ? saveSetResult : startOccurrence)(db, principal, JSON.parse(text));
    return json(result, result.outcome.status === 'Accepted' ? 200 : result.outcome.status === 'Conflict' ? 409 : 422);
  } catch (error) {
    if (error instanceof DraftAccessError) return json({ error: error.message }, 403);
    if (error instanceof ActionCollision) return json({ error: 'ACTION_ID_COLLISION' }, 409);
    if (error instanceof InvalidStartSnapshot) return json({ error: 'INVALID_START_SNAPSHOT' }, 422);
    if (error instanceof CommandFailure) return json({ error: error.code }, error.code === 'NOT_FOUND' ? 404 : 409);
    if (error instanceof ZodError || error instanceof SyntaxError) return json({ error: 'INVALID_COMMAND' }, 400);
    // Never log the exception text, request envelope or connection configuration.
    const failure = error as { code?: unknown; name?: unknown; cause?: { code?: unknown } } | null;
    const safeCode = (value: unknown) => typeof value === 'string' && /^[A-Z0-9_]{1,40}$/.test(value) ? value : undefined;
    console.error('trainer2_execution_failed', { operation, stage, elapsedMs: Date.now() - started,
      code: safeCode(failure?.code), causeCode: safeCode(failure?.cause?.code),
      ...(error instanceof AdmissionInfrastructureError ? { admissionPhase: error.phase, infrastructureReason: infrastructureReason(error.cause) } : {}),
      errorType: typeof failure?.name === 'string' && /^[A-Za-z]{1,60}$/.test(failure.name) ? failure.name : 'Unknown' });
    return json({ error: 'EXECUTION_TRANSACTION_FAILED', retry: 'Retry the same action envelope' }, 503);
  }
}
