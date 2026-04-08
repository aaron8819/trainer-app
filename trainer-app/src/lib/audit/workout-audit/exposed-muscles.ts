import type { SessionGenerationResult } from "@/lib/api/template-session/types";
import type { VolumePlanByMuscle } from "@/lib/engine/volume";
import { toMuscleId, toMuscleLabel } from "@/lib/engine/stimulus";
import { normalizeExposedMuscle } from "@/lib/engine/volume-landmarks";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";
import type {
  PlannerAnchorFixtureDiagnostic,
  PlannerClosureCandidateDiagnostic,
  PlannerDeficitSnapshot,
  PlannerDiagnostics,
  PlannerExerciseDiagnostic,
  PlannerMuscleDiagnostic,
  PlannerOpportunityMuscleDiagnostic,
  PlannerOvershootAdjustment,
  PlannerRoleAnchor,
  PlannerTradeoffDiagnostic,
} from "@/lib/planner-diagnostics/types";

type NumericMuscleMap = Record<string, number>;
type SuccessfulSessionGenerationResult = Exclude<SessionGenerationResult, { error: string }>;

export type AuditPlannerRoleAnchor =
  | { kind: "muscle"; muscle: string }
  | { kind: "movement_pattern"; movementPattern: string };

export type AuditPlannerAnchorFixtureDiagnostic = Omit<
  PlannerAnchorFixtureDiagnostic,
  "anchor"
> & {
  anchor?: AuditPlannerRoleAnchor;
};

export type AuditPlannerClosureCandidateDiagnostic = Omit<
  PlannerClosureCandidateDiagnostic,
  "dominantDeficitMuscleId"
> & {
  dominantDeficitMuscleId?: string;
};

export type AuditPlannerExerciseDiagnostic = Omit<
  PlannerExerciseDiagnostic,
  "anchorUsed"
> & {
  stimulusVector: NumericMuscleMap;
  anchorUsed?: AuditPlannerRoleAnchor;
};

export type AuditPlannerDiagnostics = Omit<
  PlannerDiagnostics,
  "anchor" | "exercises" | "closure"
> & {
  anchor?: Omit<NonNullable<PlannerDiagnostics["anchor"]>, "fixtures"> & {
    fixtures: AuditPlannerAnchorFixtureDiagnostic[];
  };
  exercises: Record<string, AuditPlannerExerciseDiagnostic>;
  closure: Omit<PlannerDiagnostics["closure"], "firstIterationCandidates"> & {
    firstIterationCandidates?: AuditPlannerClosureCandidateDiagnostic[];
  };
};

export type AuditSessionDecisionReceipt = Omit<
  SessionDecisionReceipt,
  "plannerDiagnostics"
> & {
  plannerDiagnostics?: AuditPlannerDiagnostics;
};

export type AuditSessionGenerationResult =
  | { error: string }
  | (Omit<SuccessfulSessionGenerationResult, "volumePlanByMuscle" | "selection"> & {
      volumePlanByMuscle: NumericMuscleMap;
      selection: Omit<
        SuccessfulSessionGenerationResult["selection"],
        "volumePlanByMuscle" | "sessionDecisionReceipt"
      > & {
        volumePlanByMuscle: NumericMuscleMap;
        sessionDecisionReceipt?: AuditSessionDecisionReceipt;
      };
    });

function sumOptionalNumber(left?: number, right?: number): number | undefined {
  if (left == null && right == null) {
    return undefined;
  }
  return (left ?? 0) + (right ?? 0);
}

function normalizeAuditMuscleKey(muscle: string): string {
  const canonicalMuscleId = toMuscleId(muscle);
  const displayMuscle = canonicalMuscleId ? toMuscleLabel(canonicalMuscleId) : muscle;
  return normalizeExposedMuscle(displayMuscle);
}

export function normalizeExposedMuscleListForAudit(
  muscles: string[] | undefined
): string[] | undefined {
  if (!muscles) {
    return undefined;
  }
  return Array.from(new Set(muscles.map((muscle) => normalizeAuditMuscleKey(muscle))));
}

export function normalizeNumericMuscleMapForAudit(
  record: NumericMuscleMap | undefined
): NumericMuscleMap | undefined {
  if (!record) {
    return undefined;
  }

  const normalized: NumericMuscleMap = {};
  for (const [muscle, value] of Object.entries(record)) {
    const exposedMuscle = normalizeAuditMuscleKey(muscle);
    normalized[exposedMuscle] = (normalized[exposedMuscle] ?? 0) + value;
  }
  return normalized;
}

export function normalizeVolumePlanByMuscleForAudit(
  record: VolumePlanByMuscle | undefined
): NumericMuscleMap | undefined {
  if (!record) {
    return undefined;
  }

  const normalized: NumericMuscleMap = {};
  for (const [muscle, plan] of Object.entries(record)) {
    const exposedMuscle = normalizeAuditMuscleKey(muscle);
    normalized[exposedMuscle] = (normalized[exposedMuscle] ?? 0) + plan.planned;
  }
  return normalized;
}

function normalizePlannerRoleAnchorForAudit(
  anchor: PlannerRoleAnchor | undefined
): AuditPlannerRoleAnchor | undefined {
  if (!anchor || anchor.kind !== "muscle") {
    return anchor;
  }

  return {
    ...anchor,
    muscle: normalizeAuditMuscleKey(anchor.muscle),
  };
}

function normalizeOvershootAdjustmentForAudit(
  adjustment: PlannerOvershootAdjustment | undefined
): PlannerOvershootAdjustment | undefined {
  if (!adjustment) {
    return adjustment;
  }

  return {
    ...adjustment,
    limitingMuscles:
      normalizeExposedMuscleListForAudit(adjustment.limitingMuscles) ?? [],
  };
}

function mergePlannerOpportunityMuscleDiagnostic(
  current: PlannerOpportunityMuscleDiagnostic | undefined,
  next: PlannerOpportunityMuscleDiagnostic
): PlannerOpportunityMuscleDiagnostic {
  return {
    sessionOpportunityWeight:
      (current?.sessionOpportunityWeight ?? 0) + next.sessionOpportunityWeight,
    weeklyTarget: (current?.weeklyTarget ?? 0) + next.weeklyTarget,
    performedEffectiveVolumeBeforeSession:
      (current?.performedEffectiveVolumeBeforeSession ?? 0) +
      next.performedEffectiveVolumeBeforeSession,
    startingDeficit: (current?.startingDeficit ?? 0) + next.startingDeficit,
    futureOpportunityUnits: sumOptionalNumber(
      current?.futureOpportunityUnits,
      next.futureOpportunityUnits
    ),
    weeklyOpportunityUnits: sumOptionalNumber(
      current?.weeklyOpportunityUnits,
      next.weeklyOpportunityUnits
    ),
    futureCapacity: sumOptionalNumber(current?.futureCapacity, next.futureCapacity),
    requiredNow: sumOptionalNumber(current?.requiredNow, next.requiredNow),
    urgencyMultiplier:
      current?.urgencyMultiplier == null && next.urgencyMultiplier == null
        ? undefined
        : Math.max(current?.urgencyMultiplier ?? 0, next.urgencyMultiplier ?? 0),
  };
}

function normalizePlannerOpportunityMuscleMapForAudit(
  record: Record<string, PlannerOpportunityMuscleDiagnostic> | undefined
): Record<string, PlannerOpportunityMuscleDiagnostic> | undefined {
  if (!record) {
    return undefined;
  }

  const normalized: Record<string, PlannerOpportunityMuscleDiagnostic> = {};
  for (const [muscle, diagnostic] of Object.entries(record)) {
    const exposedMuscle = normalizeAuditMuscleKey(muscle);
    normalized[exposedMuscle] = mergePlannerOpportunityMuscleDiagnostic(
      normalized[exposedMuscle],
      diagnostic
    );
  }
  return normalized;
}

function mergePlannerMuscleDiagnostic(
  current: PlannerMuscleDiagnostic | undefined,
  next: PlannerMuscleDiagnostic
): PlannerMuscleDiagnostic {
  return {
    weeklyTarget: (current?.weeklyTarget ?? 0) + next.weeklyTarget,
    performedEffectiveVolumeBeforeSession:
      (current?.performedEffectiveVolumeBeforeSession ?? 0) +
      next.performedEffectiveVolumeBeforeSession,
    plannedEffectiveVolumeAfterRoleBudgeting:
      (current?.plannedEffectiveVolumeAfterRoleBudgeting ?? 0) +
      next.plannedEffectiveVolumeAfterRoleBudgeting,
    projectedEffectiveVolumeAfterRoleBudgeting:
      (current?.projectedEffectiveVolumeAfterRoleBudgeting ?? 0) +
      next.projectedEffectiveVolumeAfterRoleBudgeting,
    deficitAfterRoleBudgeting:
      (current?.deficitAfterRoleBudgeting ?? 0) + next.deficitAfterRoleBudgeting,
    plannedEffectiveVolumeAfterClosure:
      (current?.plannedEffectiveVolumeAfterClosure ?? 0) +
      next.plannedEffectiveVolumeAfterClosure,
    projectedEffectiveVolumeAfterClosure:
      (current?.projectedEffectiveVolumeAfterClosure ?? 0) +
      next.projectedEffectiveVolumeAfterClosure,
    finalRemainingDeficit:
      (current?.finalRemainingDeficit ?? 0) + next.finalRemainingDeficit,
  };
}

function normalizePlannerMuscleMapForAudit(
  record: Record<string, PlannerMuscleDiagnostic> | undefined
): Record<string, PlannerMuscleDiagnostic> | undefined {
  if (!record) {
    return undefined;
  }

  const normalized: Record<string, PlannerMuscleDiagnostic> = {};
  for (const [muscle, diagnostic] of Object.entries(record)) {
    const exposedMuscle = normalizeAuditMuscleKey(muscle);
    normalized[exposedMuscle] = mergePlannerMuscleDiagnostic(
      normalized[exposedMuscle],
      diagnostic
    );
  }
  return normalized;
}

function mergePlannerDeficitSnapshot(
  current: PlannerDeficitSnapshot | undefined,
  next: PlannerDeficitSnapshot
): PlannerDeficitSnapshot {
  return {
    weeklyTarget: (current?.weeklyTarget ?? 0) + next.weeklyTarget,
    performedEffectiveVolumeBeforeSession:
      (current?.performedEffectiveVolumeBeforeSession ?? 0) +
      next.performedEffectiveVolumeBeforeSession,
    plannedEffectiveVolume: (current?.plannedEffectiveVolume ?? 0) + next.plannedEffectiveVolume,
    projectedEffectiveVolume:
      (current?.projectedEffectiveVolume ?? 0) + next.projectedEffectiveVolume,
    remainingDeficit: (current?.remainingDeficit ?? 0) + next.remainingDeficit,
  };
}

function normalizePlannerDeficitMapForAudit(
  record: Record<string, PlannerDeficitSnapshot> | undefined
): Record<string, PlannerDeficitSnapshot> | undefined {
  if (!record) {
    return undefined;
  }

  const normalized: Record<string, PlannerDeficitSnapshot> = {};
  for (const [muscle, snapshot] of Object.entries(record)) {
    const exposedMuscle = normalizeAuditMuscleKey(muscle);
    normalized[exposedMuscle] = mergePlannerDeficitSnapshot(
      normalized[exposedMuscle],
      snapshot
    );
  }
  return normalized;
}

function normalizePlannerExerciseDiagnosticForAudit(
  diagnostic: PlannerExerciseDiagnostic
): AuditPlannerExerciseDiagnostic {
  return {
    ...diagnostic,
    stimulusVector:
      normalizeNumericMuscleMapForAudit(diagnostic.stimulusVector) ?? {},
    anchorUsed: normalizePlannerRoleAnchorForAudit(diagnostic.anchorUsed),
    overshootAdjustmentsApplied: normalizeOvershootAdjustmentForAudit(
      diagnostic.overshootAdjustmentsApplied
    ),
  };
}

function normalizePlannerExerciseMapForAudit(
  record: Record<string, PlannerExerciseDiagnostic> | undefined
): Record<string, AuditPlannerExerciseDiagnostic> | undefined {
  if (!record) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(record).map(([exerciseId, diagnostic]) => [
      exerciseId,
      normalizePlannerExerciseDiagnosticForAudit(diagnostic),
    ])
  );
}

function normalizePlannerAnchorFixtureForAudit(
  fixture: PlannerAnchorFixtureDiagnostic
): AuditPlannerAnchorFixtureDiagnostic {
  return {
    ...fixture,
    anchor: normalizePlannerRoleAnchorForAudit(fixture.anchor),
    overshootAdjustmentsApplied: normalizeOvershootAdjustmentForAudit(
      fixture.overshootAdjustmentsApplied
    ),
  };
}

function normalizePlannerClosureCandidateForAudit(
  candidate: PlannerClosureCandidateDiagnostic
): AuditPlannerClosureCandidateDiagnostic {
  return {
    ...candidate,
    dominantDeficitMuscleId: candidate.dominantDeficitMuscleId
      ? normalizeAuditMuscleKey(candidate.dominantDeficitMuscleId)
      : undefined,
  };
}

function normalizePlannerTradeoffForAudit(
  tradeoff: PlannerTradeoffDiagnostic
): PlannerTradeoffDiagnostic {
  return {
    ...tradeoff,
    muscle: tradeoff.muscle ? normalizeAuditMuscleKey(tradeoff.muscle) : undefined,
  };
}

function normalizePlannerDiagnosticsForAudit(
  diagnostics: PlannerDiagnostics | undefined
): AuditPlannerDiagnostics | undefined {
  if (!diagnostics) {
    return undefined;
  }

  return {
    ...diagnostics,
    opportunity: diagnostics.opportunity
      ? {
          ...diagnostics.opportunity,
          targetMuscles: normalizeExposedMuscleListForAudit(
            diagnostics.opportunity.targetMuscles
          ),
          currentSessionMuscleOpportunity:
            normalizePlannerOpportunityMuscleMapForAudit(
              diagnostics.opportunity.currentSessionMuscleOpportunity
            ) ?? {},
        }
      : undefined,
    anchor: diagnostics.anchor
      ? {
          ...diagnostics.anchor,
          fixtures: diagnostics.anchor.fixtures.map(normalizePlannerAnchorFixtureForAudit),
        }
      : undefined,
    muscles: normalizePlannerMuscleMapForAudit(diagnostics.muscles) ?? {},
    exercises: normalizePlannerExerciseMapForAudit(diagnostics.exercises) ?? {},
    closure: {
      ...diagnostics.closure,
      firstIterationCandidates: diagnostics.closure.firstIterationCandidates?.map(
        normalizePlannerClosureCandidateForAudit
      ),
    },
    outcome: diagnostics.outcome
      ? {
          ...diagnostics.outcome,
          startingDeficits:
            normalizePlannerDeficitMapForAudit(diagnostics.outcome.startingDeficits) ?? {},
          deficitsAfterBaseSession:
            normalizePlannerDeficitMapForAudit(diagnostics.outcome.deficitsAfterBaseSession) ??
            {},
          deficitsAfterSupplementation:
            normalizePlannerDeficitMapForAudit(
              diagnostics.outcome.deficitsAfterSupplementation
            ) ?? {},
          deficitsAfterClosure:
            normalizePlannerDeficitMapForAudit(diagnostics.outcome.deficitsAfterClosure) ?? {},
          unresolvedDeficits:
            normalizeExposedMuscleListForAudit(diagnostics.outcome.unresolvedDeficits) ?? [],
          keyTradeoffs: diagnostics.outcome.keyTradeoffs.map(normalizePlannerTradeoffForAudit),
        }
      : undefined,
  };
}

export function normalizeSessionDecisionReceiptForAudit(
  receipt: SessionDecisionReceipt | undefined
): AuditSessionDecisionReceipt | undefined {
  if (!receipt) {
    return undefined;
  }

  return {
    ...receipt,
    targetMuscles: normalizeExposedMuscleListForAudit(receipt.targetMuscles),
    lifecycleVolume: {
      ...receipt.lifecycleVolume,
      targets: normalizeNumericMuscleMapForAudit(receipt.lifecycleVolume.targets),
    },
    sorenessSuppressedMuscles:
      normalizeExposedMuscleListForAudit(receipt.sorenessSuppressedMuscles) ?? [],
    plannerDiagnostics: normalizePlannerDiagnosticsForAudit(receipt.plannerDiagnostics),
  };
}

export function normalizeSessionGenerationResultForAudit(
  generationResult: SessionGenerationResult | undefined
): AuditSessionGenerationResult | undefined {
  if (!generationResult || "error" in generationResult) {
    return generationResult;
  }

  return {
    ...generationResult,
    volumePlanByMuscle:
      normalizeVolumePlanByMuscleForAudit(generationResult.volumePlanByMuscle) ?? {},
    selection: {
      ...generationResult.selection,
      volumePlanByMuscle:
        normalizeVolumePlanByMuscleForAudit(generationResult.selection.volumePlanByMuscle) ?? {},
      sessionDecisionReceipt: normalizeSessionDecisionReceiptForAudit(
        generationResult.selection.sessionDecisionReceipt
      ),
    },
  };
}
