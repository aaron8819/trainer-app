import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createHypertrophyPlan } from '@/lib/engine/trainer2/plan-builder';
import { orderedWorkoutGroups } from '@/lib/engine/trainer2/ordered-workouts';
import { DraftReview } from './DraftReview';

afterEach(cleanup);
describe('saved occurrence ordering', () => {
  it.each(['template', 'independent', 'reordered', 'duplicates'])('renders %s in authoritative array order without mutating prescriptions', kind => {
    const intent = createHypertrophyPlan();
    if (kind !== 'template') {
      delete intent.builder;
      intent.occurrences = intent.occurrences.slice(0, 4).map((o, i) => ({ id: o.id,
        stageId: intent.stages[[2, 0, 2, 1][i]].id, name: kind === 'duplicates' ? 'Same name' : ['Zulu', 'Alpha', 'Mike', 'Beta'][i],
        positions: o.positions.map(p => ({ id: p.id, exercise: p.exercise, targets: p.targets })) }));
      if (kind === 'reordered') intent.occurrences.reverse();
    }
    const before = structuredClone(intent);
    const groups = orderedWorkoutGroups(intent);
    expect(groups.flatMap(g => g.workouts.map(w => w.occurrence))).toEqual(before.occurrences);
    expect(groups.flatMap(g => g.workouts.map(w => w.sequence))).toEqual(before.occurrences.map((_, i) => i + 1));
    const { container } = render(<DraftReview intent={intent} />);
    expect([...container.querySelectorAll('[data-occurrence-id]')].map(el => el.getAttribute('data-occurrence-id'))).toEqual(before.occurrences.map(o => o.id));
    expect(screen.getAllByRole('heading', { level: 4 }).map(el => el.textContent)).toEqual(before.occurrences.map(o => o.name));
    expect(intent).toEqual(before);
  });
  it('fails explicitly for missing order, duplicate identity or unknown stage instead of inventing order', () => {
    const doc = createHypertrophyPlan();
    for (const bad of [{ ...doc, occurrences: undefined }, { ...doc, occurrences: [...doc.occurrences, doc.occurrences[0]] },
      { ...doc, occurrences: [{ ...doc.occurrences[0], stageId: crypto.randomUUID() }] }]) {
      expect(() => orderedWorkoutGroups(bad)).toThrow();
    }
  });
});
