import type { WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  buildWeekCloseDeficitSnapshot,
  isAccumulationWeekBoundary,
  readWeekCloseDeficitSnapshot,
  type WeekCloseDeficitSnapshot,
} from "@/lib/api/mesocycle-week-close";
import { loadHomeProgramSupport } from "@/lib/api/program";
import { generateSessionFromIntent } from "@/lib/api/template-session";
import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import { isStrictOptionalGapFillSession } from "@/lib/gap-fill/classifier";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { WORKOUT_AUDIT_CONCLUSIONS } from "./conclusions";
import { resolveWorkoutAuditIdentity } from "./context-builder";
import type { WorkoutAuditIdentity, WorkoutAuditRequest } from "./types";

type SupportedWeekCloseResolution =
  | "NO_GAP_FILL_NEEDED"
  | "GAP_FILL_COMPLETED"
  | "GAP_FILL_DISMISSED"
  | "AUTO_DISMISSED";

type SupportedWeekCloseStatus = "PENDING_OPTIONAL_GAP_FILL" | "RESOLVED";

type GapFillAvailabilityCategory =
  | "eligible"
  | "no_meaningful_deficits_remain"
  | "deficits_below_threshold"
  | "no_valid_exercise_inventory_exists"
  | "policy_intentionally_blocks_activation"
  | "audit_gap";

export type WeekCloseHandoffAuditRequest = Pick<
  WorkoutAuditRequest,
  "userId" | "ownerEmail" | "sanitizationLevel"
> & {
  targetWeek?: number;
  previewOptionalGapFill?: boolean;
};

export type HandoffPreWeekCloseDeficit = {
  muscle: string;
  remainingDeficit: number;
  weeklyTarget: number;
  projectedEffectiveVolume: number;
  futureCapacity: number | null;
  requiredNow: number | null;
};

export type HandoffPostWeekCloseDeficit = {
  muscle: string;
  deficit: number;
  target: number;
  actual: number;
};

export type OptionalGapFillBasis = {
  category: GapFillAvailabilityCategory;
  reasonCode: string;
  thresholdPolicy: "not_observed_in_current_runtime";
  targetMuscles: string[];
  linkedWorkoutId: string | null;
  preview: {
    attempted: boolean;
    status: "not_attempted" | "ok" | "error";
    exerciseCount: number | null;
    error: string | null;
  };
};

export type WeekCloseHandoffConclusions = {
  same_intent_capacity_exhausted: boolean | null;
  week_close_trigger_expected: boolean;
  week_close_trigger_observed: boolean;
  pending_week_close_present: boolean;
  historical_mixed_contract_state: {
    detected: boolean;
    confidence: "high" | null;
    inferenceType: "historical_mixed_contract_state" | null;
    reasonCode:
      | "strict_optional_gap_fill_without_week_close_owner"
      | "not_detected"
      | null;
    note: string;
    strictOptionalGapFillWorkoutId: string | null;
    strictOptionalGapFillWorkoutStatus: string | null;
  };
  optional_gap_fill_expected: boolean;
  optional_gap_fill_eligible: boolean;
  optional_gap_fill_basis: OptionalGapFillBasis;
  unresolved_deficits_pre_week_close: HandoffPreWeekCloseDeficit[];
  unresolved_deficits_post_week_close: HandoffPostWeekCloseDeficit[];
  unresolved_deficits_post_gap_fill_opportunity: HandoffPostWeekCloseDeficit[];
};

export type WeekCloseBoundaryWorkout = {
  id: string;
  status: string;
  intent: string | null;
  scheduledAt: string;
  mesocycleWeekSnapshot: number | null;
  mesoSessionSnapshot: number | null;
  isFinalAdvancingSessionInWeek: boolean;
  receiptAvailable: boolean;
};

export type WeekCloseBoundaryRow = {
  id: string;
  status: SupportedWeekCloseStatus;
  resolution: SupportedWeekCloseResolution | null;
  targetWeek: number;
  triggeredAt: string;
  resolvedAt: string | null;
  optionalWorkout: {
    id: string;
    status: string;
    scheduledDate: string;
  } | null;
};

export type WeekCloseHandoffAuditArtifact = {
  version: 1;
  auditType: "week-close-handoff";
  generatedAt: string;
  source: "live" | "pii-safe";
  identity: WorkoutAuditIdentity;
  request: WeekCloseHandoffAuditRequest;
  conclusions: WeekCloseHandoffConclusions;
  canonicalPaths: typeof WORKOUT_AUDIT_CONCLUSIONS;
  target: {
    mesocycleId: string;
    targetWeek: number;
    sessionsPerWeek: number;
  };
  boundaryWorkout: WeekCloseBoundaryWorkout | null;
  weekClose: WeekCloseBoundaryRow | null;
  strictOptionalGapFillWorkout: {
    id: string;
    status: string;
    scheduledAt?: string | null;
  } | null;
  walkthrough: {
    preWeekClose: {
      owner: "final_advancing_session_receipt";
      deficits: HandoffPreWeekCloseDeficit[];
    };
    postWeekClose: {
      owner: "week_close_snapshot";
      deficits: HandoffPostWeekCloseDeficit[];
    };
    postGapFillOpportunity: {
      owner: "pending_week_close_or_optional_gap_fill_outcome";
      deficits: HandoffPostWeekCloseDeficit[];
    };
  };
  warningSummary: {
    blockingErrors: string[];
    semanticWarnings: string[];
    backgroundWarnings: string[];
  };
};

type BoundaryWorkoutRecord = {
  id: string;
  status: WorkoutStatus;
  sessionIntent: string | null;
  scheduledDate: Date;
  mesocycleWeekSnapshot: number | null;
  mesoSessionSnapshot: number | null;
  mesocyclePhaseSnapshot: "ACCUMULATION" | "DELOAD" | null;
  selectionMetadata: unknown;
};

type StrictOptionalGapFillWorkoutRecord = {
  id: string;
  status: WorkoutStatus;
  scheduledDate: Date;
};

type WeekCloseRowRecord = {
  id: string;
  status: SupportedWeekCloseStatus;
  resolution: SupportedWeekCloseResolution | null;
  targetWeek: number;
  triggeredAt: Date;
  resolvedAt: Date | null;
  deficitSnapshotJson: unknown;
  optionalWorkout: {
    id: string;
    status: WorkoutStatus;
    scheduledDate: Date;
  } | null;
};

function getPerformedStatuses(): WorkoutStatus[] {
  return [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[];
}

function sanitizeIdentity(
  request: WeekCloseHandoffAuditRequest,
  identity: WorkoutAuditIdentity
): WorkoutAuditIdentity {
  if (request.sanitizationLevel !== "pii-safe") {
    return identity;
  }

  return {
    userId: "redacted",
  };
}

function sanitizeRequest(
  request: WeekCloseHandoffAuditRequest
): WeekCloseHandoffAuditRequest {
  if (request.sanitizationLevel !== "pii-safe") {
    return request;
  }

  return {
    ...request,
    userId: undefined,
    ownerEmail: undefined,
  };
}

function getTargetMuscles(snapshot: WeekCloseDeficitSnapshot | null): string[] {
  const fromSummary = snapshot?.summary.topTargetMuscles?.filter((entry) => entry.trim().length > 0) ?? [];
  if (fromSummary.length > 0) {
    return fromSummary;
  }
  return snapshot?.muscles.slice(0, 3).map((row) => row.muscle) ?? [];
}

export function readPreWeekCloseDeficits(selectionMetadata: unknown): HandoffPreWeekCloseDeficit[] {
  const receipt = readSessionDecisionReceipt(selectionMetadata);
  const deficits = receipt?.plannerDiagnostics?.outcome?.deficitsAfterClosure ?? {};
  const opportunity = receipt?.plannerDiagnostics?.opportunity?.currentSessionMuscleOpportunity ?? {};

  return Object.entries(deficits)
    .filter(([, snapshot]) => snapshot.remainingDeficit > 0)
    .map(([muscle, snapshot]) => ({
      muscle,
      remainingDeficit: snapshot.remainingDeficit,
      weeklyTarget: snapshot.weeklyTarget,
      projectedEffectiveVolume: snapshot.projectedEffectiveVolume,
      futureCapacity: opportunity[muscle]?.futureCapacity ?? null,
      requiredNow: opportunity[muscle]?.requiredNow ?? null,
    }))
    .sort((left, right) => right.remainingDeficit - left.remainingDeficit);
}

export function readPostWeekCloseDeficits(
  snapshot: WeekCloseDeficitSnapshot | null
): HandoffPostWeekCloseDeficit[] {
  return (snapshot?.muscles ?? [])
    .filter((row) => row.deficit > 0)
    .map((row) => ({
      muscle: row.muscle,
      deficit: row.deficit,
      target: row.target,
      actual: row.actual,
    }))
    .sort((left, right) => right.deficit - left.deficit);
}

function hasSameIntentCapacityExhausted(deficits: HandoffPreWeekCloseDeficit[]): boolean | null {
  if (deficits.length === 0) {
    return null;
  }

  return deficits.some(
    (row) =>
      row.remainingDeficit > 0 &&
      row.futureCapacity != null &&
      row.futureCapacity <= 0 &&
      row.requiredNow != null &&
      row.requiredNow > 0
  );
}

export function classifyOptionalGapFillBasis(input: {
  previewOptionalGapFill: boolean;
  weekCloseObserved: boolean;
  weekClosePending: boolean;
  weekCloseResolution: SupportedWeekCloseResolution | null;
  linkedWorkoutId: string | null;
  targetMuscles: string[];
  postWeekCloseDeficits: HandoffPostWeekCloseDeficit[];
  previewResult:
    | {
        status: "ok";
        exerciseCount: number;
      }
    | {
        status: "error";
        error: string;
      }
    | null;
}): {
  optionalGapFillExpected: boolean;
  optionalGapFillEligible: boolean;
  basis: OptionalGapFillBasis;
} {
  const preview =
    input.previewResult == null
      ? {
          attempted: false,
          status: "not_attempted" as const,
          exerciseCount: null,
          error: null,
        }
      : input.previewResult.status === "ok"
        ? {
            attempted: true,
            status: "ok" as const,
            exerciseCount: input.previewResult.exerciseCount,
            error: null,
          }
        : {
            attempted: true,
            status: "error" as const,
            exerciseCount: null,
            error: input.previewResult.error,
          };

  if (input.postWeekCloseDeficits.length === 0) {
    return {
      optionalGapFillExpected: false,
      optionalGapFillEligible: false,
      basis: {
        category: "no_meaningful_deficits_remain",
        reasonCode: "no_post_week_close_deficits",
        thresholdPolicy: "not_observed_in_current_runtime",
        targetMuscles: [],
        linkedWorkoutId: input.linkedWorkoutId,
        preview,
      },
    };
  }

  if (!input.weekCloseObserved) {
    return {
      optionalGapFillExpected: true,
      optionalGapFillEligible: false,
      basis: {
        category: "audit_gap",
        reasonCode: "week_close_row_missing",
        thresholdPolicy: "not_observed_in_current_runtime",
        targetMuscles: input.targetMuscles,
        linkedWorkoutId: input.linkedWorkoutId,
        preview,
      },
    };
  }

  if (input.weekCloseResolution === "NO_GAP_FILL_NEEDED") {
    return {
      optionalGapFillExpected: false,
      optionalGapFillEligible: false,
      basis: {
        category: "no_meaningful_deficits_remain",
        reasonCode: "week_close_resolved_no_gap_fill_needed",
        thresholdPolicy: "not_observed_in_current_runtime",
        targetMuscles: [],
        linkedWorkoutId: input.linkedWorkoutId,
        preview,
      },
    };
  }

  if (!input.weekClosePending) {
    return {
      optionalGapFillExpected: true,
      optionalGapFillEligible: false,
      basis: {
        category: "policy_intentionally_blocks_activation",
        reasonCode: input.weekCloseResolution
          ? `week_close_resolved_${input.weekCloseResolution.toLowerCase()}`
          : "week_close_not_pending",
        thresholdPolicy: "not_observed_in_current_runtime",
        targetMuscles: input.targetMuscles,
        linkedWorkoutId: input.linkedWorkoutId,
        preview,
      },
    };
  }

  if (input.linkedWorkoutId) {
    return {
      optionalGapFillExpected: true,
      optionalGapFillEligible: false,
      basis: {
        category: "policy_intentionally_blocks_activation",
        reasonCode: "optional_gap_fill_already_linked",
        thresholdPolicy: "not_observed_in_current_runtime",
        targetMuscles: input.targetMuscles,
        linkedWorkoutId: input.linkedWorkoutId,
        preview,
      },
    };
  }

  if (input.targetMuscles.length === 0) {
    return {
      optionalGapFillExpected: true,
      optionalGapFillEligible: false,
      basis: {
        category: "audit_gap",
        reasonCode: "missing_target_muscles",
        thresholdPolicy: "not_observed_in_current_runtime",
        targetMuscles: [],
        linkedWorkoutId: input.linkedWorkoutId,
        preview,
      },
    };
  }

  if (!input.previewOptionalGapFill) {
    return {
      optionalGapFillExpected: true,
      optionalGapFillEligible: false,
      basis: {
        category: "audit_gap",
        reasonCode: "preview_skipped",
        thresholdPolicy: "not_observed_in_current_runtime",
        targetMuscles: input.targetMuscles,
        linkedWorkoutId: input.linkedWorkoutId,
        preview,
      },
    };
  }

  if (input.previewResult?.status === "error") {
    return {
      optionalGapFillExpected: true,
      optionalGapFillEligible: false,
      basis: {
        category: "no_valid_exercise_inventory_exists",
        reasonCode: "generation_preview_failed",
        thresholdPolicy: "not_observed_in_current_runtime",
        targetMuscles: input.targetMuscles,
        linkedWorkoutId: input.linkedWorkoutId,
        preview,
      },
    };
  }

  if (input.previewResult?.status === "ok" && input.previewResult.exerciseCount <= 0) {
    return {
      optionalGapFillExpected: true,
      optionalGapFillEligible: false,
      basis: {
        category: "no_valid_exercise_inventory_exists",
        reasonCode: "generation_preview_empty",
        thresholdPolicy: "not_observed_in_current_runtime",
        targetMuscles: input.targetMuscles,
        linkedWorkoutId: input.linkedWorkoutId,
        preview,
      },
    };
  }

  return {
    optionalGapFillExpected: true,
    optionalGapFillEligible: true,
    basis: {
      category: "eligible",
      reasonCode: "pending_week_close_with_generatable_preview",
      thresholdPolicy: "not_observed_in_current_runtime",
      targetMuscles: input.targetMuscles,
      linkedWorkoutId: null,
      preview,
    },
  };
}

export function buildWeekCloseHandoffConclusions(input: {
  boundaryWorkoutPresent: boolean;
  boundaryWorkoutIsFinal: boolean;
  weekCloseObserved: boolean;
  weekClosePending: boolean;
  strictOptionalGapFillWorkoutId: string | null;
  strictOptionalGapFillWorkoutStatus: string | null;
  weekCloseResolution: SupportedWeekCloseResolution | null;
  previewOptionalGapFill: boolean;
  linkedWorkoutId: string | null;
  targetMuscles: string[];
  preWeekCloseDeficits: HandoffPreWeekCloseDeficit[];
  postWeekCloseDeficits: HandoffPostWeekCloseDeficit[];
  postGapFillOpportunityDeficits: HandoffPostWeekCloseDeficit[];
  previewResult:
    | {
        status: "ok";
        exerciseCount: number;
      }
    | {
        status: "error";
        error: string;
      }
    | null;
}): WeekCloseHandoffConclusions {
  const gapFill = classifyOptionalGapFillBasis({
    previewOptionalGapFill: input.previewOptionalGapFill,
    weekCloseObserved: input.weekCloseObserved,
    weekClosePending: input.weekClosePending,
    weekCloseResolution: input.weekCloseResolution,
    linkedWorkoutId: input.linkedWorkoutId,
    targetMuscles: input.targetMuscles,
    postWeekCloseDeficits: input.postWeekCloseDeficits,
    previewResult: input.previewResult,
  });

  const weekCloseTriggerExpected = input.boundaryWorkoutPresent && input.boundaryWorkoutIsFinal;
  const historicalMixedContractDetected =
    weekCloseTriggerExpected &&
    !input.weekCloseObserved &&
    !input.weekClosePending &&
    input.strictOptionalGapFillWorkoutId != null;

  return {
    same_intent_capacity_exhausted: hasSameIntentCapacityExhausted(input.preWeekCloseDeficits),
    week_close_trigger_expected: weekCloseTriggerExpected,
    week_close_trigger_observed: input.weekCloseObserved,
    pending_week_close_present: input.weekClosePending,
    historical_mixed_contract_state: historicalMixedContractDetected
      ? {
          detected: true,
          confidence: "high",
          inferenceType: "historical_mixed_contract_state",
          reasonCode: "strict_optional_gap_fill_without_week_close_owner",
          note:
            "High-confidence inference: this anchored week has a strict optional gap-fill workout but no persisted week-close owner. This indicates historical mixed-contract state, not proof of the exact historical code version.",
          strictOptionalGapFillWorkoutId: input.strictOptionalGapFillWorkoutId,
          strictOptionalGapFillWorkoutStatus: input.strictOptionalGapFillWorkoutStatus,
        }
      : {
          detected: false,
          confidence: null,
          inferenceType: null,
          reasonCode: "not_detected",
          note:
            "Not detected. Historical mixed-contract state requires an expected week-close boundary, no persisted week-close row for the anchored week, and a strict optional gap-fill workout for that same week.",
          strictOptionalGapFillWorkoutId: input.strictOptionalGapFillWorkoutId,
          strictOptionalGapFillWorkoutStatus: input.strictOptionalGapFillWorkoutStatus,
        },
    optional_gap_fill_expected: gapFill.optionalGapFillExpected,
    optional_gap_fill_eligible: gapFill.optionalGapFillEligible,
    optional_gap_fill_basis: gapFill.basis,
    unresolved_deficits_pre_week_close: input.preWeekCloseDeficits,
    unresolved_deficits_post_week_close: input.postWeekCloseDeficits,
    unresolved_deficits_post_gap_fill_opportunity: input.postGapFillOpportunityDeficits,
  };
}

async function resolveActiveMesocycle(userId: string) {
  return prisma.mesocycle.findFirst({
    where: {
      isActive: true,
      macroCycle: { userId },
    },
    orderBy: [{ mesoNumber: "desc" }],
    select: {
      id: true,
      sessionsPerWeek: true,
      durationWeeks: true,
      startWeek: true,
      blocks: {
        orderBy: { blockNumber: "asc" },
        select: {
          blockType: true,
          startWeek: true,
          durationWeeks: true,
          volumeTarget: true,
          intensityBias: true,
        },
      },
      macroCycle: {
        select: {
          startDate: true,
        },
      },
    },
  });
}

async function resolveTargetWeek(input: {
  userId: string;
  mesocycleId: string;
  sessionsPerWeek: number;
  explicitTargetWeek?: number;
}): Promise<number | null> {
  if (input.explicitTargetWeek != null) {
    return input.explicitTargetWeek;
  }

  const latestWeekClose = await prisma.mesocycleWeekClose.findFirst({
    where: {
      mesocycleId: input.mesocycleId,
    },
    orderBy: [{ targetWeek: "desc" }],
    select: {
      targetWeek: true,
    },
  });
  if (latestWeekClose?.targetWeek != null) {
    return latestWeekClose.targetWeek;
  }

  const boundaryWorkouts = await prisma.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      status: { in: getPerformedStatuses() },
      advancesSplit: { not: false },
      mesocyclePhaseSnapshot: "ACCUMULATION",
      mesocycleWeekSnapshot: { not: null },
      mesoSessionSnapshot: { not: null },
    },
    orderBy: [{ mesocycleWeekSnapshot: "desc" }, { mesoSessionSnapshot: "desc" }, { scheduledDate: "desc" }],
    select: {
      mesocycleWeekSnapshot: true,
      mesoSessionSnapshot: true,
    },
    take: 20,
  });

  const boundary = boundaryWorkouts.find((workout) =>
    isAccumulationWeekBoundary({
      snapshotPhase: "ACCUMULATION",
      snapshotSession: workout.mesoSessionSnapshot ?? 0,
      sessionsPerWeek: input.sessionsPerWeek,
    })
  );

  return boundary?.mesocycleWeekSnapshot ?? null;
}

async function loadBoundaryWorkout(input: {
  userId: string;
  mesocycleId: string;
  targetWeek: number;
}): Promise<BoundaryWorkoutRecord | null> {
  const candidates = await prisma.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      mesocycleWeekSnapshot: input.targetWeek,
      status: { in: getPerformedStatuses() },
      advancesSplit: { not: false },
      mesocyclePhaseSnapshot: "ACCUMULATION",
      mesoSessionSnapshot: { not: null },
    },
    orderBy: [{ mesoSessionSnapshot: "desc" }, { scheduledDate: "desc" }],
    select: {
      id: true,
      status: true,
      sessionIntent: true,
      scheduledDate: true,
      mesocycleWeekSnapshot: true,
      mesoSessionSnapshot: true,
      mesocyclePhaseSnapshot: true,
      selectionMetadata: true,
    },
    take: 5,
  });

  return candidates[0] ?? null;
}

async function loadWeekCloseRow(input: {
  mesocycleId: string;
  targetWeek: number;
}): Promise<WeekCloseRowRecord | null> {
  return prisma.mesocycleWeekClose.findUnique({
    where: {
      mesocycleId_targetWeek: {
        mesocycleId: input.mesocycleId,
        targetWeek: input.targetWeek,
      },
    },
    select: {
      id: true,
      status: true,
      resolution: true,
      targetWeek: true,
      triggeredAt: true,
      resolvedAt: true,
      deficitSnapshotJson: true,
      optionalWorkout: {
        select: {
          id: true,
          status: true,
          scheduledDate: true,
        },
      },
    },
  });
}

async function loadStrictOptionalGapFillWorkout(input: {
  userId: string;
  mesocycleId: string;
  targetWeek: number;
}): Promise<StrictOptionalGapFillWorkoutRecord | null> {
  const candidates = await prisma.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      mesocycleWeekSnapshot: input.targetWeek,
      advancesSplit: false,
      status: { in: getPerformedStatuses() },
    },
    orderBy: [{ scheduledDate: "desc" }],
    select: {
      id: true,
      status: true,
      scheduledDate: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
    },
  });

  const strict = candidates.find((workout) =>
    isStrictOptionalGapFillSession({
      selectionMetadata: workout.selectionMetadata,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
    })
  );

  return strict
    ? {
        id: strict.id,
        status: strict.status,
        scheduledDate: strict.scheduledDate,
      }
    : null;
}

async function previewOptionalGapFill(input: {
  userId: string;
  targetMuscles: string[];
  weekCloseId: string;
  targetWeek: number;
  maxGeneratedHardSets?: number;
  maxGeneratedExercises?: number;
}): Promise<
  | {
      status: "ok";
      exerciseCount: number;
    }
  | {
      status: "error";
      error: string;
    }
> {
  const result = await generateSessionFromIntent(input.userId, {
    intent: "body_part",
    targetMuscles: input.targetMuscles,
    weekCloseId: input.weekCloseId,
    optionalGapFill: true,
    optionalGapFillContext: {
      weekCloseId: input.weekCloseId,
      targetWeek: input.targetWeek,
    },
    maxGeneratedHardSets: input.maxGeneratedHardSets,
    maxGeneratedExercises: input.maxGeneratedExercises,
    plannerDiagnosticsMode: "debug",
  });

  if ("error" in result) {
    return {
      status: "error",
      error: result.error,
    };
  }

  return {
    status: "ok",
    exerciseCount: result.workout.mainLifts.length + result.workout.accessories.length,
  };
}

export async function runWeekCloseHandoffAudit(
  request: WeekCloseHandoffAuditRequest
): Promise<WeekCloseHandoffAuditArtifact> {
  const identity = await resolveWorkoutAuditIdentity(request);
  const activeMesocycle = await resolveActiveMesocycle(identity.userId);
  if (!activeMesocycle) {
    throw new Error("No active mesocycle found for handoff audit");
  }

  const targetWeek = await resolveTargetWeek({
    userId: identity.userId,
    mesocycleId: activeMesocycle.id,
    sessionsPerWeek: activeMesocycle.sessionsPerWeek,
    explicitTargetWeek: request.targetWeek,
  });
  if (targetWeek == null) {
    throw new Error("Unable to resolve target week for handoff audit");
  }

  const [boundaryWorkout, weekCloseRow, homeProgramSupport, strictOptionalGapFillWorkout] = await Promise.all([
    loadBoundaryWorkout({
      userId: identity.userId,
      mesocycleId: activeMesocycle.id,
      targetWeek,
    }),
    loadWeekCloseRow({
      mesocycleId: activeMesocycle.id,
      targetWeek,
    }),
    loadHomeProgramSupport(identity.userId),
    loadStrictOptionalGapFillWorkout({
      userId: identity.userId,
      mesocycleId: activeMesocycle.id,
      targetWeek,
    }),
  ]);

  const boundaryReceipt = boundaryWorkout
    ? readSessionDecisionReceipt(boundaryWorkout.selectionMetadata)
    : undefined;
  const boundaryIsFinal =
    boundaryWorkout?.mesocyclePhaseSnapshot === "ACCUMULATION" &&
    boundaryWorkout.mesoSessionSnapshot != null &&
    isAccumulationWeekBoundary({
      snapshotPhase: boundaryWorkout.mesocyclePhaseSnapshot,
      snapshotSession: boundaryWorkout.mesoSessionSnapshot,
      sessionsPerWeek: activeMesocycle.sessionsPerWeek,
    });

  const preWeekCloseDeficits = boundaryWorkout
    ? readPreWeekCloseDeficits(boundaryWorkout.selectionMetadata)
    : [];

  const weekCloseSnapshotFromRow = readWeekCloseDeficitSnapshot(weekCloseRow?.deficitSnapshotJson);
  const canonicalWeekCloseSnapshot = await buildWeekCloseDeficitSnapshot(prisma, {
    userId: identity.userId,
    mesocycle: activeMesocycle,
    targetWeek,
  });
  const postWeekCloseSnapshot = weekCloseSnapshotFromRow ?? canonicalWeekCloseSnapshot;
  const postWeekCloseDeficits = readPostWeekCloseDeficits(postWeekCloseSnapshot);
  const targetMuscles = getTargetMuscles(postWeekCloseSnapshot);

  const shouldPreview =
    request.previewOptionalGapFill !== false &&
    weekCloseRow?.status === "PENDING_OPTIONAL_GAP_FILL" &&
    !weekCloseRow.optionalWorkout &&
    targetMuscles.length > 0 &&
    homeProgramSupport.gapFill.weekCloseId === weekCloseRow.id;
  const previewResult = shouldPreview
    ? await previewOptionalGapFill({
        userId: identity.userId,
        targetMuscles,
        weekCloseId: weekCloseRow.id,
        targetWeek,
        maxGeneratedHardSets: postWeekCloseSnapshot.policy.maxGeneratedHardSets,
        maxGeneratedExercises: postWeekCloseSnapshot.policy.maxGeneratedExercises,
      })
    : null;

  const postGapFillOpportunitySnapshot =
    weekCloseRow?.resolution === "NO_GAP_FILL_NEEDED"
      ? {
          version: 1 as const,
          policy: postWeekCloseSnapshot.policy,
          summary: {
            totalDeficitSets: 0,
            qualifyingMuscleCount: 0,
            topTargetMuscles: [],
          },
          muscles: [],
        }
      : canonicalWeekCloseSnapshot;
  const postGapFillOpportunityDeficits = readPostWeekCloseDeficits(postGapFillOpportunitySnapshot);

  const conclusions = buildWeekCloseHandoffConclusions({
    boundaryWorkoutPresent: Boolean(boundaryWorkout),
    boundaryWorkoutIsFinal: boundaryIsFinal === true,
    weekCloseObserved: Boolean(weekCloseRow),
    weekClosePending: weekCloseRow?.status === "PENDING_OPTIONAL_GAP_FILL",
    strictOptionalGapFillWorkoutId: strictOptionalGapFillWorkout?.id ?? null,
    strictOptionalGapFillWorkoutStatus: strictOptionalGapFillWorkout?.status ?? null,
    weekCloseResolution: weekCloseRow?.resolution ?? null,
    previewOptionalGapFill: request.previewOptionalGapFill !== false,
    linkedWorkoutId: weekCloseRow?.optionalWorkout?.id ?? null,
    targetMuscles,
    preWeekCloseDeficits,
    postWeekCloseDeficits,
    postGapFillOpportunityDeficits,
    previewResult,
  });

  return {
    version: 1,
    auditType: "week-close-handoff",
    generatedAt: new Date().toISOString(),
    source: request.sanitizationLevel === "pii-safe" ? "pii-safe" : "live",
    identity: sanitizeIdentity(request, identity),
    request: sanitizeRequest(request),
    conclusions,
    canonicalPaths: WORKOUT_AUDIT_CONCLUSIONS,
    target: {
      mesocycleId: activeMesocycle.id,
      targetWeek,
      sessionsPerWeek: activeMesocycle.sessionsPerWeek,
    },
    boundaryWorkout: boundaryWorkout
      ? {
          id: boundaryWorkout.id,
          status: boundaryWorkout.status,
          intent: boundaryWorkout.sessionIntent?.toLowerCase() ?? null,
          scheduledAt: boundaryWorkout.scheduledDate.toISOString(),
          mesocycleWeekSnapshot: boundaryWorkout.mesocycleWeekSnapshot,
          mesoSessionSnapshot: boundaryWorkout.mesoSessionSnapshot,
          isFinalAdvancingSessionInWeek: boundaryIsFinal === true,
          receiptAvailable: boundaryReceipt != null,
        }
      : null,
    weekClose: weekCloseRow
      ? {
          id: weekCloseRow.id,
          status: weekCloseRow.status,
          resolution: weekCloseRow.resolution,
          targetWeek: weekCloseRow.targetWeek,
          triggeredAt: weekCloseRow.triggeredAt.toISOString(),
          resolvedAt: weekCloseRow.resolvedAt?.toISOString() ?? null,
          optionalWorkout: weekCloseRow.optionalWorkout
            ? {
                id: weekCloseRow.optionalWorkout.id,
                status: weekCloseRow.optionalWorkout.status,
                scheduledDate: weekCloseRow.optionalWorkout.scheduledDate.toISOString(),
              }
            : null,
        }
      : null,
    strictOptionalGapFillWorkout: strictOptionalGapFillWorkout
      ? {
          id: strictOptionalGapFillWorkout.id,
          status: strictOptionalGapFillWorkout.status,
          scheduledAt: strictOptionalGapFillWorkout.scheduledDate.toISOString(),
        }
      : null,
    walkthrough: {
      preWeekClose: {
        owner: "final_advancing_session_receipt",
        deficits: preWeekCloseDeficits,
      },
      postWeekClose: {
        owner: "week_close_snapshot",
        deficits: postWeekCloseDeficits,
      },
      postGapFillOpportunity: {
        owner: "pending_week_close_or_optional_gap_fill_outcome",
        deficits: postGapFillOpportunityDeficits,
      },
    },
    warningSummary: {
      blockingErrors: [],
      semanticWarnings: boundaryWorkout
        ? []
        : ["No final advancing session was found for the audited week; pre-week-close receipt data is unavailable."],
      backgroundWarnings:
        homeProgramSupport.gapFill.weekCloseId != null &&
        weekCloseRow != null &&
        homeProgramSupport.gapFill.weekCloseId !== weekCloseRow.id
          ? [
              `Current home gap-fill support is anchored to week-close ${homeProgramSupport.gapFill.weekCloseId}, not the audited row ${weekCloseRow.id}.`,
            ]
          : [],
    },
  };
}
