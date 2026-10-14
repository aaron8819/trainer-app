// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHypertrophyPlan } from '../engine/trainer2/plan-builder';
import { catalog, catalogExercise } from '../engine/trainer2/catalog';
import { startingPounds, compatibleCatalogResult } from '../engine/trainer2/logging-prefill';
import { initialPrescription } from '../trainer2-contracts/execution';
import { acceptedFixtureResult, fixtureHistorySets, HISTORY_STARTING_POUNDS,
  validateFixtureStartingLoad } from './trainer2-fixture';

function start() {
  const doc = createHypertrophyPlan(randomUUID);
  const occurrence = doc.occurrences[0];
  return initialPrescription.parse({
    schemaVersion: 1, kind: 'START', provenance: 'VERIFIED_START',
    policyVersion: 'trainer2-start-v1', accountId: 'fixture-only',
    executionId: randomUUID(), planId: randomUUID(), revisionId: randomUUID(),
    sourceContentHash: 'a'.repeat(64), startedAt: new Date().toISOString(),
    stage: doc.stages[0], occurrence, progression: doc.progression,
    instructions: { epoch: 0, revisionId: null, contentHash: 'b'.repeat(64),
      document: { version: 1, restrictions: [], exceptions: [] } },
    positions: occurrence.positions.map(p => ({ id: randomUUID(), sourcePositionId: p.id,
      targets: p.targets.map(t => ({ id: randomUUID(), sourceTargetId: t.id })) })),
  });
}

describe('Shared disposable fixture facts', () => {
  it.each([0, false, null, { executionId: 'example' }])('returns accepted %j', result => {
    expect(acceptedFixtureResult({ outcome: { status: 'Accepted', result } })).toEqual(result);
  });
  it.each([['Rejected', 'SET_NOT_FOUND'], ['Conflict', 'STALE_SET_RESULT']])(
    'retains %s %s diagnostics', (status, code) => {
      expect(() => acceptedFixtureResult({ outcome: {
        status, code, commandType: 'RecordSetResult',
      } })).toThrow(`RecordSetResult: ${status} ${code}`);
    });
  it('fails clearly for a malformed accepted outcome', () => {
    expect(() => acceptedFixtureResult({ outcome: { status: 'Accepted' } }))
      .toThrow('has no result');
  });
  it('validates the independent rounding boundary before expensive setup', () => {
    expect(() => validateFixtureStartingLoad()).not.toThrow();
    const measurement = { kind: 'externalLoad' as const, convention: 'perImplement' as const,
      zeroMeaning: 'validZero' as const, value: '60', unit: 'kg' as const };
    expect(startingPounds(measurement)).toBe('130');
    expect(startingPounds({ ...measurement, value: '60.123456' }))
      .toBe(HISTORY_STARTING_POUNDS);
    expect(HISTORY_STARTING_POUNDS).toBe('135');
  });
  it('records only execution-owned working targets and leaves START unchanged', () => {
    const initial = start();
    initial.occurrence.positions[0].targets[0].classification = 'preparation';
    const before = JSON.stringify(initial);
    const fixture = fixtureHistorySets(initial);
    expect(fixture.targets).toEqual(initial.positions[0].targets.slice(1).map(t => ({
      executionId: initial.executionId, targetId: t.id,
    })));
    expect(fixture.targets[0].targetId)
      .not.toBe(initial.occurrence.positions[0].targets[1].id);
    expect(JSON.stringify(initial)).toBe(before);
  });
  it('uses the snapshot recording convention, rep basis and zero policy', () => {
    const initial = start();
    initial.occurrence.positions[0].exercise = catalogExercise(
      catalog.find(e => e.id === 't2:concentration-curl')!);
    const exercise = initial.occurrence.positions[0].exercise;
    const fixture = fixtureHistorySets(initial);
    expect(fixture.result.measurement).toMatchObject({ convention: 'perImplement',
      zeroMeaning: 'notAllowed', value: '60.123456', unit: 'kg' });
    expect(fixture.result.reps?.basis).toBe('perSide');
    expect(compatibleCatalogResult(fixture.result, exercise)).toBe(true);
  });
  it('rejects missing and planned identities before submission', () => {
    expect(() => fixtureHistorySets(start(), 99)).toThrow('position is missing');
    const missingPosition = start();
    missingPosition.positions[0].sourcePositionId = randomUUID();
    expect(() => fixtureHistorySets(missingPosition)).toThrow('source position is missing');
    const missingTarget = start();
    missingTarget.positions[0].targets[0].sourceTargetId = randomUUID();
    expect(() => fixtureHistorySets(missingTarget)).toThrow('source target is missing');
    const planned = start();
    planned.positions[0].targets[0].id = planned.positions[0].targets[0].sourceTargetId;
    expect(() => fixtureHistorySets(planned)).toThrow('execution-owned identity');
  });
  it('rejects unsupported exercise kinds and absent working sets', () => {
    const authored = start();
    authored.occurrence.positions[0].exercise = {
      kind: 'authoredDescription', name: 'Custom', variation: '',
    };
    expect(() => fixtureHistorySets(authored)).toThrow('external load');
    const noWork = start();
    noWork.occurrence.positions[0].targets.forEach(t => { t.classification = 'preparation'; });
    expect(() => fixtureHistorySets(noWork)).toThrow('no working targets');
  });
});
