// Phase 3: Autoregulation Orchestration

import { computeFatigueScore, autoregulateWorkout } from "@/lib/engine";
import type { ApplyLoadsAudit } from "@/lib/engine/apply-loads";
import type { WorkoutPlan as EngineWorkoutPlan } from "@/lib/engine/types";
import type {
  AutoregulationPolicy,
  FatigueScore,
  AutoregulationModification,
} from "@/lib/engine/readiness/types";
import { DEFAULT_AUTOREGULATION_POLICY } from "@/lib/engine/readiness/types";
import {
  getLatestReadinessSignal,
  getSignalAgeHours,
  formatSignalAge,
} from "./readiness";

export type AutoregulationResult = {
  original: EngineWorkoutPlan;
  adjusted: EngineWorkoutPlan;
  loadAudit?: ApplyLoadsAudit;
  modifications: AutoregulationModification[];
  fatigueScore: FatigueScore | null;
  rationale: string;
  wasAutoregulated: boolean;
  applied: boolean;
  reason: string;
  signalAgeHours: number | null;
};

/**
 * Fetch the latest readiness signal, transform canonical numeric load
 * prescriptions, and rebuild projections from the final results.
 */
export async function applyAutoregulation(
  userId: string,
  workout: EngineWorkoutPlan,
  loadAudit: ApplyLoadsAudit,
  policy: AutoregulationPolicy = DEFAULT_AUTOREGULATION_POLICY,
): Promise<AutoregulationResult> {
  const signal = await getLatestReadinessSignal(userId);

  if (!signal) {
    const rationale = "No recent readiness signal. Workout left unchanged.";
    return {
      original: workout,
      adjusted: workout,
      loadAudit,
      modifications: [],
      fatigueScore: null,
      rationale,
      wasAutoregulated: false,
      applied: false,
      reason: rationale,
      signalAgeHours: null,
    };
  }

  const fatigueScore: FatigueScore = computeFatigueScore(signal);
  const transformed = autoregulateWorkout(workout, loadAudit, fatigueScore, policy);
  const signalAge = getSignalAgeHours(signal);
  const rationale = `${transformed.rationale} (signal ${formatSignalAge(signalAge)})`;

  return {
    original: workout,
    adjusted: transformed.adjustedWorkout,
    loadAudit: transformed.loadAudit,
    modifications: transformed.modifications,
    fatigueScore,
    rationale,
    wasAutoregulated: transformed.modifications.length > 0,
    applied: transformed.modifications.length > 0,
    reason: rationale,
    signalAgeHours: signalAge,
  };
}
