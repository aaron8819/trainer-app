import { draftDocument, type DraftDocument } from '../../trainer2-contracts/draft';
import { validateWorkoutDefaults } from './planning';

export const REVIEW_POLICY = 'trainer2-plan-review-v1';
export const progressionLabel = 'Follow the planned prescriptions';
export const progressionMeaning = 'Use each workout’s saved sets, reps and effort, including weekly changes and deload. Change targets deliberately; this mode does not increase weight or sets from workout results.';
export type PlanIssue = { code: string; message: string; location: 'progression' | 'editor' | 'repair'; occurrenceId?: string };
export function reviewPlan(doc: DraftDocument): PlanIssue[] {
  const issues: PlanIssue[] = [];
  try { validateWorkoutDefaults(draftDocument.parse(doc)); }
  catch { issues.push({ code: 'INVALID_SAVED_STRUCTURE', message: 'Remove obsolete override labels before reviewing this plan again.', location: 'repair' }); }
  if (!doc.progression) issues.push({ code: 'PROGRESSION_INTENT_REQUIRED', message: 'Choose how to follow this plan in Progression, then save.', location: 'progression' });
  if (!doc.occurrences.some(o => o.positions.some(p => p.targets.some(t => t.classification === 'working'))))
    issues.push({ code: 'NO_EXECUTABLE_TRAINING', message: 'Add a workout with at least one working set.', location: 'editor' });
  for (const o of doc.occurrences) {
    const context = `${doc.stages.find(s => s.id === o.stageId)?.name || 'Stage'} / ${o.name || 'Workout'}`;
    if (!o.positions.length) issues.push({ code: 'EMPTY_WORKOUT', message: `${context}: ${doc.builder ? 'add exercises to this workout.' : 'add exercises or remove this empty workout.'}`, location: 'editor', occurrenceId: o.id });
    for (const p of o.positions) {
      if (!p.exercise.name.trim()) issues.push({ code: 'UNNAMED_EXERCISE', message: `${context}: name exercise ${o.positions.indexOf(p) + 1}.`, location: 'editor', occurrenceId: o.id });
      if (!p.targets.length) issues.push({ code: 'NO_TARGETS', message: `${context}: add sets to ${p.exercise.name || 'the unnamed exercise'}, or remove it.`, location: 'editor', occurrenceId: o.id });
    }
  }
  return issues;
}
export type SavedPlanReview = {
  accountId: string; planId: string; revisionId: string; contentHash: string;
  progression: DraftDocument['progression'] | null; progressionHash: string;
  policyVersion: typeof REVIEW_POLICY; digest: string; issues: PlanIssue[];
  status: 'issues' | 'validDraft'; intent: DraftDocument;
};
