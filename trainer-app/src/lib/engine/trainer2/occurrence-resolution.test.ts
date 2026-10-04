import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { unresolvedOccurrences, currentWeekOccurrences, eligibleCurrentWeekOccurrences } from './occurrence-resolution';
import { skipOccurrenceCommand } from '../../trainer2-contracts/skip-occurrence';

describe('Planning occurrence resolution', () => {
  it('allows every unresolved workout in the current contiguous week and retains the completed week until the persisted cursor advances', () => {
    const occurrences = [{ id: 'a', stageId: 'week-z' }, { id: 'b', stageId: 'week-z' }, { id: 'c', stageId: 'week-a' }, { id: 'd', stageId: 'week-z' }];
    expect(eligibleCurrentWeekOccurrences(occurrences, new Set()).map(o => o.id)).toEqual(['a', 'b']);
    expect(currentWeekOccurrences(occurrences, new Set(['b'])).map(o => o.id)).toEqual(['a', 'b']);
    expect(eligibleCurrentWeekOccurrences(occurrences, new Set(['b'])).map(o => o.id)).toEqual(['a']);
    expect(eligibleCurrentWeekOccurrences(occurrences, new Set(['a', 'b'])).map(o => o.id)).toEqual([]);
    expect(currentWeekOccurrences(occurrences, new Set(['a', 'b'])).map(o => o.id)).toEqual(['a', 'b']);
    expect(eligibleCurrentWeekOccurrences(occurrences, new Set(['a', 'b']), 1).map(o => o.id)).toEqual(['c']);
    expect(eligibleCurrentWeekOccurrences(occurrences, new Set(['a', 'b', 'c']), 2).map(o => o.id)).toEqual(['d']);
    expect(currentWeekOccurrences(occurrences, new Set(['a', 'b', 'c', 'd']), 2).map(o => o.id)).toEqual(['d']);
  });
  const ordered = [{ id: 'z', name: 'Same', stage: 2 }, { id: 'a', name: 'Same', stage: 1 }, { id: 'q', name: 'Same', stage: 2 }];
  it.each([[[], ['z', 'a', 'q']], [['z'], ['a', 'q']], [['a'], ['z', 'q']], [['z', 'a'], ['q']], [['z', 'a', 'q'], []]])('retains authored order with terminal IDs %j', (resolved, expected) => {
    expect(unresolvedOccurrences(ordered, new Set(resolved)).map(o => o.id)).toEqual(expected);
    expect(ordered.map(o => o.id)).toEqual(['z', 'a', 'q']);
  });
  it('requires an exact occurrence and canonical version binding, never an implicit next target', () => {
    const c = { schemaVersion: 1, commandType: 'SkipOccurrence', actionId: randomUUID(), deviceId: randomUUID(), originatingAccountId: 'synthetic', ownershipEpoch: 0, dependsOn: [],
      target: { planId: randomUUID(), occurrenceId: randomUUID() }, expected: { planRevisionId: randomUUID(), acceptedSequence: '2' }, intent: {} };
    expect(skipOccurrenceCommand.safeParse(c).success).toBe(true);
    for (const expected of [undefined, null, {}, { ...c.expected, acceptedSequence: 2 }, { ...c.expected, acceptedSequence: '02' }]) expect(skipOccurrenceCommand.safeParse({ ...c, expected }).success).toBe(false);
    expect(skipOccurrenceCommand.safeParse({ ...c, target: { planId: c.target.planId } }).success).toBe(false);
    expect(skipOccurrenceCommand.safeParse({ ...c, intent: { reason: 'extra' } }).success).toBe(false);
  });
});
