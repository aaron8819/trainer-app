import type { DraftDocument } from '../../trainer2-contracts/draft';
import { instructionDocument, type InstructionDocument, type RestrictionIssue } from '../../trainer2-contracts/activation';

// Explicit exclusions only. Names and free text never establish exercise identity.
export function restrictionIssues(input: InstructionDocument, planId: string, plan: DraftDocument, at: string, revisionId: string): RestrictionIssue[] {
  const instructions = instructionDocument.parse(input);
  const valid = (v: { from: string; until: string | null }) => Date.parse(v.from) <= Date.parse(at) && (!v.until || Date.parse(at) < Date.parse(v.until));
  const issues: RestrictionIssue[] = [];
  for (const r of instructions.restrictions) {
    if (r.cleared || !valid(r) || (r.planId && r.planId !== planId)) continue;
    for (const o of plan.occurrences) for (const p of o.positions) {
      if (p.exercise.kind === 'catalogSnapshot' && p.exercise.catalogId !== r.catalogId) continue;
      if (instructions.exceptions.some(e => e.restrictionRevisionId === r.revisionId && e.planId === planId && e.planRevisionId === revisionId && e.positionIds.includes(p.id) && valid(e))) continue;
      const kind = p.exercise.kind === 'authoredDescription' ? 'uncertain' : 'excluded';
      issues.push({ restrictionRevisionId: r.revisionId, positionId: p.id, occurrenceId: o.id, kind,
        message: `${o.name} / ${p.exercise.name}: ${kind === 'uncertain' ? 'this custom exercise cannot be checked against' : 'conflicts with'} “${r.instruction}”. Edit this workout or explicitly allow the selected exercise.` });
    }
  }
  return issues;
}
