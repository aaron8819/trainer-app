import { POST as advance } from '@/app/api/trainer2/weeks/advance/route';
import { POST as addExercise } from '@/app/api/trainer2/executions/add-exercise/route';
import { POST as swap } from '@/app/api/trainer2/executions/swap-exercise/route';
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ draft: vi.fn(), execution: vi.fn() }));
vi.mock('@/lib/api/trainer2/http', () => ({ draftHttp: calls.draft }));
vi.mock('@/lib/api/trainer2/execution-http', () => ({ executionHttp: calls.execution }));

import { POST as activate } from '@/app/api/trainer2/drafts/activate/route';
import { POST as instructions } from '@/app/api/trainer2/drafts/instructions/route';
import { POST as start } from '@/app/api/trainer2/executions/start/route';
import { POST as discard } from '@/app/api/trainer2/executions/discard/route';
import { POST as finish } from '@/app/api/trainer2/executions/finish/route';
import { POST as results } from '@/app/api/trainer2/executions/results/route';
import { POST as corrections } from '@/app/api/trainer2/executions/corrections/route';
import { POST as skip } from '@/app/api/trainer2/occurrences/skip/route';

const routes = [
  ['weeks/advance', advance, calls.execution, 'AdvanceWeek'],
  ['executions/add-exercise', addExercise, calls.execution, 'AddExercise'],
  ['executions/swap-exercise', swap, calls.execution, 'SwapExercise'],
  ['drafts/activate', activate, calls.draft, 'ActivatePlan'],
  ['drafts/instructions', instructions, calls.draft, 'ChangeInstructions'],
  ['executions/start', start, calls.execution, 'StartOccurrence'],
  ['executions/discard', discard, calls.execution, 'DiscardEmptyExecution'],
  ['executions/finish', finish, calls.execution, 'FinishExecution'],
  ['executions/results', results, calls.execution, 'SaveSetResult'],
  ['executions/corrections', corrections, calls.execution, 'CorrectHistoricalSetResult'],
  ['occurrences/skip', skip, calls.execution, 'SkipOccurrence'],
] as const;

const initialPause = process.env.TRAINER_WRITE_PAUSE;
afterEach(() => {
  if (initialPause === undefined) delete process.env.TRAINER_WRITE_PAUSE;
  else process.env.TRAINER_WRITE_PAUSE = initialPause;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Trainer2 mutation route pause boundary', () => {
  it.each(routes)('%s returns the pause response before command dispatch', async (path, handler) => {
    process.env.TRAINER_WRITE_PAUSE = 'enabled';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await handler(new Request(`http://localhost/api/trainer2/${path}`, { method: 'POST' }));
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(await response.json()).toMatchObject({ code: 'PRODUCTION_WRITE_PAUSED' });
    expect(calls.draft).not.toHaveBeenCalled();
    expect(calls.execution).not.toHaveBeenCalled();
  });

  it.each(routes)('%s dispatches its command when the pause is off', async (path, handler, dispatch, command) => {
    delete process.env.TRAINER_WRITE_PAUSE;
    const expected = new Response(null, { status: 204 });
    dispatch.mockResolvedValue(expected);
    const request = new Request(`http://localhost/api/trainer2/${path}`, { method: 'POST' });
    expect(await handler(request)).toBe(expected);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(request, command);
  });
});
