import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { unresolvedOccurrences } from './occurrence-resolution';
import { skipOccurrenceCommand } from '../../trainer2-contracts/skip-occurrence';

describe('Planning occurrence resolution', () => {
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
