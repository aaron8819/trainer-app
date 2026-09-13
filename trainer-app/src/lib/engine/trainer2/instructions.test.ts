import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHypertrophyPlan } from './plan-builder';
import { restrictionIssues } from './instructions';
import { emptyInstructions, instructionDocument } from '../../trainer2-contracts/activation';
import { catalog } from './catalog';

describe('explicit instruction applicability', () => {
  it('checks exact identity, scope, dates and custom uncertainty without mutating intent', () => {
    const revisionId = randomUUID();
    const doc = createHypertrophyPlan(), planId = randomUUID();
    const p = doc.occurrences[0].positions[0];
    if (p.exercise.kind !== 'catalogSnapshot') throw new Error('catalog fixture');
    const instructions = emptyInstructions();
    const r = { id: randomUUID(), revisionId: randomUUID(), catalogId: p.exercise.catalogId, instruction: 'Avoid this exercise', planId: null, from: '2026-01-01T00:00:00.000Z', until: '2026-10-01T00:00:00.000Z', cleared: false };
    instructions.restrictions.push(r);
    const at = '2026-09-13T12:00:00.000Z';
    const before = JSON.stringify(doc);
    const matches = restrictionIssues(instructions, planId, doc, at, revisionId);
    expect(matches.map(i => i.positionId)).toEqual(doc.occurrences.flatMap(o => o.positions.filter(p => p.exercise.kind === 'catalogSnapshot' && p.exercise.catalogId === r.catalogId).map(p => p.id)));
    expect(restrictionIssues(instructions, planId, doc, r.until, revisionId)).toEqual([]);
    expect(restrictionIssues(instructions, planId, doc, '2025-12-31T23:59:59.000Z', revisionId)).toEqual([]);
    expect(restrictionIssues({ ...instructions, restrictions: [{ ...r, planId: randomUUID() }] }, planId, doc, at, revisionId)).toEqual([]);
    expect(restrictionIssues({ ...instructions, restrictions: [{ ...r, cleared: true }] }, planId, doc, at, revisionId)).toEqual([]);
    expect(JSON.stringify(doc)).toBe(before);
    p.exercise = { kind: 'authoredDescription', name: catalog[0].name, variation: '' };
    expect(restrictionIssues(instructions, planId, doc, at, revisionId).find(i => i.positionId === p.id)?.kind).toBe('uncertain');
  });
  it('exceptions are named, versioned, selected-work, plan and time scoped', () => {
    const revisionId = randomUUID();
    const doc = createHypertrophyPlan(), planId = randomUUID(), p = doc.occurrences[0].positions[0];
    if (p.exercise.kind !== 'catalogSnapshot') throw new Error('catalog fixture');
    const instructions = emptyInstructions();
    const r = { id: randomUUID(), revisionId: randomUUID(), catalogId: p.exercise.catalogId, instruction: 'Avoid', planId: null, from: '2026-01-01T00:00:00.000Z', until: null, cleared: false };
    instructions.restrictions.push(r);
    const e = { id: randomUUID(), restrictionRevisionId: r.revisionId, planId, planRevisionId: revisionId, positionIds: [p.id], reason: 'Deliberate exception', from: r.from, until: '2026-10-01T00:00:00.000Z' };
    instructions.exceptions.push(e);
    const at = '2026-09-13T12:00:00.000Z';
    expect(restrictionIssues(instructions, planId, doc, at, revisionId).some(i => i.positionId === p.id)).toBe(false);
    expect(restrictionIssues(instructions, planId, doc, at, revisionId).length).toBeGreaterThan(0);
    for (const replacement of [{ ...e, planRevisionId: randomUUID() }, { ...e, planId: randomUUID() }, { ...e, restrictionRevisionId: randomUUID() }, { ...e, positionIds: [randomUUID()] }, { ...e, until: at }]) {
      expect(restrictionIssues({ ...instructions, exceptions: [replacement] }, planId, doc, at, revisionId).some(i => i.positionId === p.id)).toBe(true);
    }
    expect(instructionDocument.safeParse({ ...instructions, version: 2 }).success).toBe(false);
  });
});
