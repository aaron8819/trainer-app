import type { InitialPrescription } from '../trainer2-contracts/execution';
import { performedResult } from '../trainer2-contracts/set-results';
import { startingPounds } from '../engine/trainer2/logging-prefill';

/** Test-only command diagnostics; never include credentials or the command payload. */
export function acceptedFixtureResult<T>(response: {
  outcome: { status: string; result?: T; code?: string; commandType?: string };
}): T {
  const outcome = response.outcome;
  if (outcome.status !== 'Accepted') {
    throw new Error(`Fixture ${outcome.commandType ?? 'command'}: ${outcome.status} ` +
      `${outcome.code ?? 'NO_CODE'}`);
  }
  if (outcome.result === undefined) throw new Error('Accepted fixture outcome has no result');
  return outcome.result;
}

const historyLoad = { kind: 'externalLoad', convention: 'perImplement',
  zeroMeaning: 'validZero', value: '60.123456', unit: 'kg' } as const;
export const HISTORY_STARTING_POUNDS = '135';

/** Cheap golden-value preflight, before the database/server/browser are started. */
export function validateFixtureStartingLoad(): void {
  if (startingPounds(historyLoad) !== HISTORY_STARTING_POUNDS) {
    throw new Error('Fixture history conversion changed: 60.123456 kg must suggest 135 lb');
  }
}

/** Fresh START only: derive recording IDs from its execution-owned map, not planned targets. */
export function fixtureHistorySets(initial: InitialPrescription, positionIndex = 0) {
  validateFixtureStartingLoad();
  const owned = initial.positions[positionIndex];
  if (!owned) throw new Error('Fixture execution position is missing');
  const source = initial.occurrence.positions.find(p => p.id === owned.sourcePositionId);
  if (!source) throw new Error('Fixture source position is missing');
  const exercise = source.exercise;
  if (exercise.kind !== 'catalogSnapshot' || exercise.loadKind !== 'externalLoad') {
    throw new Error('History fixture requires a catalog exercise with external load');
  }
  const targets = owned.targets.flatMap(target => {
    const prescription = source.targets.find(t => t.id === target.sourceTargetId);
    if (!prescription) throw new Error('Fixture source target is missing');
    if (target.id === target.sourceTargetId) {
      throw new Error('Fixture recording target must have an execution-owned identity');
    }
    return prescription.classification === 'working'
      ? [{ executionId: initial.executionId, targetId: target.id }] : [];
  });
  if (!targets.length) throw new Error('Fixture has no working targets');
  const result = performedResult.parse({
    reps: { value: 10, basis: exercise.repBasis },
    measurement: { ...historyLoad, convention: exercise.convention,
      zeroMeaning: exercise.catalogFacts?.externalZeroMeaning ?? 'validZero' },
    rir: '3',
  });
  return { targets, result, expectedStartingPounds: HISTORY_STARTING_POUNDS };
}
