import type {
  Prisma,
  WorkoutSessionIntent,
  WorkoutStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  buildV2AcceptedPlannerIntentDto,
  buildV2MaterializationDryRunReport,
  buildV2MaterializationPreparationEvidence,
  buildV2MaterializationPromotionReadiness,
  buildV2PlannerMesocyclePolicy,
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
  type V2MaterializationDryRunReport,
  type V2MaterializationProductionWriteGates,
  type V2MaterializationPromotionReadiness,
} from "@/lib/engine/planning/v2";
import {
  buildV2MaterializedSeedForAcceptance,
  type BuildV2MaterializedSeedForAcceptanceInput,
  type BuildV2MaterializedSeedForAcceptanceResult,
} from "./mesocycle-handoff-v2-materialized-seed";
import { createCorrectiveSeedRevisionInTransaction } from "./mesocycle-seed-revision";
import {
  buildMesocycleSlotSequence,
  resolveMesocycleSlotContract,
} from "./mesocycle-slot-contract";
import {
  parseSlotPlanSeedJson,
  type ParsedSlotPlanSeed,
} from "./slot-plan-seed-parser";
import {
  normalizeLiveInventoryForV2Materialization,
  type LiveV2MaterializationExerciseRow,
} from "./v2-materialization-live-inventory";

const REPLACEMENT_SOURCE = "replace_empty_mesocycle_with_v2";

const V2_REPLACEMENT_PRODUCTION_WRITE_GATES: V2MaterializationProductionWriteGates = {
  acceptancePathDesigned: true,
  slotPlanSeedJsonWriteGateDesigned: true,
  receiptContractDesigned: true,
  runtimeReplayContractVerified: true,
  auditSerializationContractDesigned: true,
  rollbackStrategyDefined: true,
};

type ReplacementBlocker =
  | "explicit_owner_email_required"
  | "explicit_mesocycle_id_required"
  | "explicit_write_confirmation_required"
  | "target_mesocycle_not_found"
  | "owner_email_mismatch"
  | "target_not_active"
  | "target_not_active_accumulation"
  | "target_closed"
  | "target_not_new"
  | "slot_sequence_missing"
  | "slot_plan_seed_missing"
  | "workouts_exist"
  | "completed_or_partial_sessions_exist"
  | "workout_exercise_rows_exist"
  | "workout_set_rows_exist"
  | "set_logs_exist"
  | "performed_set_logs_exist"
  | "runtime_deviations_exist"
  | "performed_reality_not_empty"
  | "v2_base_plan_validation_blocked"
  | "v2_materialized_seed_blocked"
  | "slot_sequence_changed_before_write";

type ReplacementTx = {
  mesocycle: {
    findFirst(args: unknown): Promise<ReplacementMesocycleRow | null>;
    update(args: unknown): Promise<unknown>;
  };
  workout: {
    count(args: unknown): Promise<number>;
    findMany(args: unknown): Promise<ReplacementWorkoutRow[]>;
  };
  workoutExercise: {
    count(args: unknown): Promise<number>;
  };
  workoutSet: {
    count(args: unknown): Promise<number>;
  };
  setLog: {
    count(args: unknown): Promise<number>;
  };
  exercise: {
    findMany(args: unknown): Promise<LiveV2MaterializationExerciseRow[]>;
  };
  userPreference: {
    findUnique(args: unknown): Promise<{
      avoidExerciseIds: string[];
      favoriteExerciseIds: string[];
    } | null>;
  };
};

type ReplacementMesocycleRow = {
  id: string;
  state: string;
  isActive: boolean;
  closedAt: Date | string | null;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  slotSequenceJson: unknown;
  slotPlanSeedJson: unknown;
  currentSeedRevision?: { seedPayload: unknown } | null;
  macroCycle: {
    userId: string;
    user: {
      email: string | null;
    };
  };
};

type ReplacementWorkoutRow = {
  id: string;
  status: WorkoutStatus | string;
  selectionMetadata: unknown;
};

type V2ReplacementBuildDependencies = NonNullable<
  BuildV2MaterializedSeedForAcceptanceInput["dependencies"]
>;

export type EmptyMesocycleReplacementSafety = {
  checked: true;
  allowed: boolean;
  blockers: ReplacementBlocker[];
  target: {
    found: boolean;
    mesocycleId: string;
    ownerEmail: string;
    state?: string;
    isActive?: boolean;
    accumulationSessionsCompleted?: number;
    deloadSessionsCompleted?: number;
    hasSlotSequenceJson?: boolean;
    hasSlotPlanSeedJson?: boolean;
  };
  evidence: {
    workoutCount: number;
    completedOrPartialSessionCount: number;
    workoutExerciseRowCount: number;
    workoutSetRowCount: number;
    setLogCount: number;
    performedSetLogCount: number;
    runtimeDeviationCount: number;
    performedRealityEmpty: boolean;
    replacingWillOrphanPerformedHistory: false;
  };
};

export type V2ReplacementSeedPreparation = {
  status: "ready" | "blocked";
  blockers: ReplacementBlocker[];
  basePlanValidation: {
    status: string;
    passed: boolean;
    blockerCount: number;
    warningCount: number;
  };
  materializerStatus: V2MaterializationDryRunReport["materializer"]["status"];
  promotionReadinessStatus: V2MaterializationPromotionReadiness["status"];
  seedShapeCompatibility: V2MaterializationDryRunReport["seedShapeCompatibility"];
  candidateIdentitySummary: V2MaterializationDryRunReport["candidateIdentitySummary"];
  productionWriteGates: V2MaterializationProductionWriteGates;
  helperStatus: BuildV2MaterializedSeedForAcceptanceResult["status"];
  helperProvenanceSource:
    | "v2_disabled"
    | "v2_blocked_fail_closed"
    | "v2_materialized_seed";
};

type V2ReplacementSeedPreparationInternal = V2ReplacementSeedPreparation & {
  candidateSlotPlanSeedJson?: Prisma.InputJsonValue;
};

export type ReplaceEmptyMesocycleWithV2Result = {
  version: 1;
  source: typeof REPLACEMENT_SOURCE;
  dryRun: boolean;
  writeRequested: boolean;
  owner: {
    email: string;
    userId: string;
  };
  targetMesocycleId: string;
  replacementSemantics: {
    strategy: "update_existing_empty_mesocycle_in_place";
    preservesMesocycleId: true;
    updates: ["slotPlanSeedJson"];
    preserves: [
      "slotSequenceJson",
      "workouts",
      "workoutSets",
      "setLogs",
      "runtimeReplay",
      "defaultHandoffAcceptance",
    ];
  };
  candidateSafety: EmptyMesocycleReplacementSafety;
  v2Preparation: V2ReplacementSeedPreparation;
  seedComparison: {
    currentAvailable: boolean;
    v2Available: boolean;
    slotIdsInOrder: {
      current: string[];
      v2: string[];
      sameOrder: boolean | null;
    };
    totalSetCount: {
      current: number | null;
      v2: number | null;
    };
    changedSlotIds: string[];
  };
  seedRuntimeBoundary: {
    serializer: "buildMesocycleSlotPlanSeed";
    handcraftedSlotPlanSeedJson: false;
    executableRowFields: ["exerciseId", "role", "setCount"];
    acceptedPlannerIntentRuntimeInert: true;
    runtimeReplayUnchanged: true;
    runtimeConsumesPlannerMetadata: false;
  };
  provenance: {
    source:
      | "v2_materialized_seed"
      | "v2_blocked_fail_closed"
      | "replacement_not_attempted";
    operation: "replace_empty_mesocycle";
    owner: string;
    targetMesocycleId: string;
    noLoggedWorkoutsVerified: boolean;
    noPerformedSetsVerified: boolean;
    serializer: "buildMesocycleSlotPlanSeed";
    dbWriteOccurred: boolean;
    transactionStatus: "not_requested" | "no_write" | "success";
    fallbackStatus: "none" | "blocked_no_fallback";
    runtimeReplayUnchanged: true;
  };
  write: {
    requested: boolean;
    confirmationProvided: boolean;
    eligible: boolean;
    dbWriteOccurred: boolean;
    transactionStatus: "not_requested" | "no_write" | "success";
  };
  guardrails: {
    requiresExplicitOwnerEmail: true;
    requiresExplicitMesocycleId: true;
    requiresExplicitReplacementFlag: true;
    writeRequiresExplicitConfirmation: true;
    blocksWhenWorkoutRowsExist: true;
    blocksWhenPerformedSetLogsExist: true;
    doesNotMutateWorkouts: true;
    doesNotMutateRuntimeLogs: true;
    doesNotMutateHistoricalMesocycles: true;
    doesNotChangeDefaultAcceptRoute: true;
    doesNotChangeRuntimeReplay: true;
    v2BlockedFailsClosed: true;
    fallbackCannotBeLabeledV2Success: true;
  };
};

type ReplaceEmptyMesocycleWithV2Dependencies = {
  prismaClient?: typeof prisma;
  buildSlotPlanSeed?: V2ReplacementBuildDependencies["buildSlotPlanSeed"];
  buildDryRunReport?: V2ReplacementBuildDependencies["buildDryRunReport"];
  buildPromotionReadiness?: V2ReplacementBuildDependencies["buildPromotionReadiness"];
};

export type ReplaceEmptyMesocycleWithV2Input = {
  userId: string;
  ownerEmail: string;
  mesocycleId: string;
  replaceEmptyActiveMesocycleWithV2?: boolean;
  write?: boolean;
  confirmEmptyMesocycleReplacement?: boolean;
  dependencies?: ReplaceEmptyMesocycleWithV2Dependencies;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasRuntimeDeviation(selectionMetadata: unknown): boolean {
  const metadata = isRecord(selectionMetadata) ? selectionMetadata : null;
  const runtimeEditReconciliation = isRecord(metadata?.runtimeEditReconciliation)
    ? metadata.runtimeEditReconciliation
    : null;
  const ops = Array.isArray(runtimeEditReconciliation?.ops)
    ? runtimeEditReconciliation.ops
    : [];
  return ops.length > 0 || Boolean(metadata?.workoutStructureState);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function seedSummary(seedJson: unknown): {
  available: boolean;
  slotIds: string[];
  totalSetCount: number | null;
  seed: ParsedSlotPlanSeed | null;
} {
  const seed = parseSlotPlanSeedJson(seedJson);
  if (!seed) {
    return {
      available: false,
      slotIds: [],
      totalSetCount: null,
      seed: null,
    };
  }
  return {
    available: true,
    slotIds: seed.slots.map((slot) => slot.slotId),
    totalSetCount: seed.slots.reduce(
      (sum, slot) =>
        sum +
        slot.exercises.reduce(
          (slotSum, exercise) => slotSum + (exercise.setCount ?? 0),
          0,
        ),
      0,
    ),
    seed,
  };
}

function buildSeedComparison(input: {
  currentSeedJson: unknown;
  candidateSeedJson?: unknown;
}): ReplaceEmptyMesocycleWithV2Result["seedComparison"] {
  const current = seedSummary(input.currentSeedJson);
  const candidate = seedSummary(input.candidateSeedJson);
  const changedSlotIds =
    current.seed && candidate.seed
      ? current.seed.slots
          .filter((slot, index) => {
            const next = candidate.seed?.slots[index];
            return Boolean(next) && stableJson(slot) !== stableJson(next);
          })
          .map((slot) => slot.slotId)
      : [];

  return {
    currentAvailable: current.available,
    v2Available: candidate.available,
    slotIdsInOrder: {
      current: current.slotIds,
      v2: candidate.slotIds,
      sameOrder:
        current.available && candidate.available
          ? stableJson(current.slotIds) === stableJson(candidate.slotIds)
          : null,
    },
    totalSetCount: {
      current: current.totalSetCount,
      v2: candidate.totalSetCount,
    },
    changedSlotIds,
  };
}

function guardrails(): ReplaceEmptyMesocycleWithV2Result["guardrails"] {
  return {
    requiresExplicitOwnerEmail: true,
    requiresExplicitMesocycleId: true,
    requiresExplicitReplacementFlag: true,
    writeRequiresExplicitConfirmation: true,
    blocksWhenWorkoutRowsExist: true,
    blocksWhenPerformedSetLogsExist: true,
    doesNotMutateWorkouts: true,
    doesNotMutateRuntimeLogs: true,
    doesNotMutateHistoricalMesocycles: true,
    doesNotChangeDefaultAcceptRoute: true,
    doesNotChangeRuntimeReplay: true,
    v2BlockedFailsClosed: true,
    fallbackCannotBeLabeledV2Success: true,
  };
}

function seedRuntimeBoundary(): ReplaceEmptyMesocycleWithV2Result["seedRuntimeBoundary"] {
  return {
    serializer: "buildMesocycleSlotPlanSeed",
    handcraftedSlotPlanSeedJson: false,
    executableRowFields: ["exerciseId", "role", "setCount"],
    acceptedPlannerIntentRuntimeInert: true,
    runtimeReplayUnchanged: true,
    runtimeConsumesPlannerMetadata: false,
  };
}

function emptyCandidateIdentitySummary(): V2MaterializationDryRunReport["candidateIdentitySummary"] {
  return {
    available: false,
    rowCount: 0,
    detailLevel: "selected_identity",
    rankingDetailAvailability: {
      topAlternatives: "not_available",
      scoreTuple: "not_available",
      selectedReason: "not_available",
      reason: "materializer_does_not_emit_candidate_ranking",
    },
    rows: [],
  };
}

async function inspectEmptyReplacementSafety(
  tx: ReplacementTx,
  input: {
    userId: string;
    ownerEmail: string;
    mesocycleId: string;
  },
): Promise<{
  safety: EmptyMesocycleReplacementSafety;
  mesocycle: ReplacementMesocycleRow | null;
}> {
  const normalizedOwnerEmail = normalizeEmail(input.ownerEmail);
  const mesocycle = await tx.mesocycle.findFirst({
    where: {
      id: input.mesocycleId,
      macroCycle: { userId: input.userId },
    },
    select: {
      id: true,
      state: true,
      isActive: true,
      closedAt: true,
      accumulationSessionsCompleted: true,
      deloadSessionsCompleted: true,
      slotSequenceJson: true,
      slotPlanSeedJson: true,
      currentSeedRevision: { select: { seedPayload: true } },
      macroCycle: {
        select: {
          userId: true,
          user: {
            select: { email: true },
          },
        },
      },
    },
  });
  if (mesocycle?.currentSeedRevision?.seedPayload) {
    mesocycle.slotPlanSeedJson = mesocycle.currentSeedRevision.seedPayload;
  }

  if (!mesocycle) {
    return {
      mesocycle: null,
      safety: {
        checked: true,
        allowed: false,
        blockers: ["target_mesocycle_not_found"],
        target: {
          found: false,
          mesocycleId: input.mesocycleId,
          ownerEmail: input.ownerEmail,
        },
        evidence: {
          workoutCount: 0,
          completedOrPartialSessionCount: 0,
          workoutExerciseRowCount: 0,
          workoutSetRowCount: 0,
          setLogCount: 0,
          performedSetLogCount: 0,
          runtimeDeviationCount: 0,
          performedRealityEmpty: false,
          replacingWillOrphanPerformedHistory: false,
        },
      },
    };
  }

  const [
    workoutCount,
    completedOrPartialSessionCount,
    workoutExerciseRowCount,
    workoutSetRowCount,
    setLogCount,
    performedSetLogCount,
    workouts,
  ] = await Promise.all([
    tx.workout.count({ where: { mesocycleId: mesocycle.id } }),
    tx.workout.count({
      where: {
        mesocycleId: mesocycle.id,
        status: { in: ["COMPLETED", "PARTIAL"] },
      },
    }),
    tx.workoutExercise.count({
      where: { workout: { mesocycleId: mesocycle.id } },
    }),
    tx.workoutSet.count({
      where: { workoutExercise: { workout: { mesocycleId: mesocycle.id } } },
    }),
    tx.setLog.count({
      where: {
        workoutSet: { workoutExercise: { workout: { mesocycleId: mesocycle.id } } },
      },
    }),
    tx.setLog.count({
      where: {
        wasSkipped: false,
        workoutSet: { workoutExercise: { workout: { mesocycleId: mesocycle.id } } },
      },
    }),
    tx.workout.findMany({
      where: { mesocycleId: mesocycle.id },
      select: {
        id: true,
        status: true,
        selectionMetadata: true,
      },
    }),
  ]);

  const runtimeDeviationCount = workouts.filter((workout) =>
    hasRuntimeDeviation(workout.selectionMetadata),
  ).length;
  const ownerMatches =
    normalizeEmail(mesocycle.macroCycle.user.email ?? "") === normalizedOwnerEmail;
  const performedRealityEmpty =
    workoutCount === 0 &&
    completedOrPartialSessionCount === 0 &&
    workoutExerciseRowCount === 0 &&
    workoutSetRowCount === 0 &&
    setLogCount === 0 &&
    performedSetLogCount === 0 &&
    runtimeDeviationCount === 0;
  const blockers: ReplacementBlocker[] = [
    ...(ownerMatches ? [] : (["owner_email_mismatch"] as const)),
    ...(mesocycle.isActive ? [] : (["target_not_active"] as const)),
    ...(mesocycle.state === "ACTIVE_ACCUMULATION"
      ? []
      : (["target_not_active_accumulation"] as const)),
    ...(mesocycle.closedAt == null ? [] : (["target_closed"] as const)),
    ...(mesocycle.accumulationSessionsCompleted === 0 &&
    mesocycle.deloadSessionsCompleted === 0
      ? []
      : (["target_not_new"] as const)),
    ...(mesocycle.slotSequenceJson ? [] : (["slot_sequence_missing"] as const)),
    ...(mesocycle.slotPlanSeedJson ? [] : (["slot_plan_seed_missing"] as const)),
    ...(workoutCount === 0 ? [] : (["workouts_exist"] as const)),
    ...(completedOrPartialSessionCount === 0
      ? []
      : (["completed_or_partial_sessions_exist"] as const)),
    ...(workoutExerciseRowCount === 0
      ? []
      : (["workout_exercise_rows_exist"] as const)),
    ...(workoutSetRowCount === 0 ? [] : (["workout_set_rows_exist"] as const)),
    ...(setLogCount === 0 ? [] : (["set_logs_exist"] as const)),
    ...(performedSetLogCount === 0 ? [] : (["performed_set_logs_exist"] as const)),
    ...(runtimeDeviationCount === 0 ? [] : (["runtime_deviations_exist"] as const)),
    ...(performedRealityEmpty ? [] : (["performed_reality_not_empty"] as const)),
  ];

  return {
    mesocycle,
    safety: {
      checked: true,
      allowed: blockers.length === 0,
      blockers,
      target: {
        found: true,
        mesocycleId: mesocycle.id,
        ownerEmail: mesocycle.macroCycle.user.email ?? input.ownerEmail,
        state: mesocycle.state,
        isActive: mesocycle.isActive,
        accumulationSessionsCompleted: mesocycle.accumulationSessionsCompleted,
        deloadSessionsCompleted: mesocycle.deloadSessionsCompleted,
        hasSlotSequenceJson: Boolean(mesocycle.slotSequenceJson),
        hasSlotPlanSeedJson: Boolean(mesocycle.slotPlanSeedJson),
      },
      evidence: {
        workoutCount,
        completedOrPartialSessionCount,
        workoutExerciseRowCount,
        workoutSetRowCount,
        setLogCount,
        performedSetLogCount,
        runtimeDeviationCount,
        performedRealityEmpty,
        replacingWillOrphanPerformedHistory: false,
      },
    },
  };
}

async function buildV2ReplacementSeedPreparation(input: {
  tx: ReplacementTx;
  userId: string;
  mesocycle: ReplacementMesocycleRow;
  dependencies?: ReplaceEmptyMesocycleWithV2Dependencies;
}): Promise<V2ReplacementSeedPreparationInternal> {
  const slotContract = resolveMesocycleSlotContract({
    slotSequenceJson: input.mesocycle.slotSequenceJson,
    weeklySchedule: [],
  });
  const slotSequence = buildMesocycleSlotSequence(
    slotContract.slots.map((slot) => ({
      slotId: slot.slotId,
      intent: slot.intent.toUpperCase() as WorkoutSessionIntent,
      ...(slot.authoredSemantics ? { authoredSemantics: slot.authoredSemantics } : {}),
    })),
  );
  const [exercises, preferences] = await Promise.all([
    input.tx.exercise.findMany({
      orderBy: { name: "asc" },
      include: {
        aliases: true,
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
      },
    }),
    input.tx.userPreference.findUnique({ where: { userId: input.userId } }),
  ]);
  const plannerPolicy = buildV2PlannerMesocyclePolicy();
  const taxonomy = DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const inventory = normalizeLiveInventoryForV2Materialization(exercises);
  const constraints = {
    avoidExerciseIds: preferences?.avoidExerciseIds ?? [],
    favoriteExerciseIds: preferences?.favoriteExerciseIds ?? [],
    painConflictExerciseIds: [],
  };
  const preparationEvidence = buildV2MaterializationPreparationEvidence({
    plannerPolicy,
    taxonomy,
    inventory,
    constraints,
  });
  const { materializedPlan, basePlanValidation } = preparationEvidence;
  const buildDryRunReport =
    input.dependencies?.buildDryRunReport ?? buildV2MaterializationDryRunReport;
  const dryRunReport = buildDryRunReport({
    plannerPolicy,
    exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
    taxonomy,
    inventory,
    materializedPlan,
    constraints,
    slotIntentById: Object.fromEntries(
      slotSequence.slots.map((slot) => [slot.slotId, slot.intent]),
    ),
  });
  const buildPromotionReadiness =
    input.dependencies?.buildPromotionReadiness ??
    buildV2MaterializationPromotionReadiness;
  const promotionReadiness = buildPromotionReadiness({
    dryRunReport,
    requiredLaneCoverageBySlot: dryRunReport.requiredLaneCoverageBySlot,
    expectedSlotCount: slotSequence.slots.length,
    productionWriteGates: V2_REPLACEMENT_PRODUCTION_WRITE_GATES,
  });
  const basePlanPassed =
    (basePlanValidation.status === "pass" ||
      basePlanValidation.status === "pass_with_warnings") &&
    basePlanValidation.summary.blockerCount === 0;

  if (!basePlanPassed) {
    return {
      status: "blocked",
      blockers: ["v2_base_plan_validation_blocked"],
      basePlanValidation: {
        status: basePlanValidation.status,
        passed: false,
        blockerCount: basePlanValidation.summary.blockerCount,
        warningCount: basePlanValidation.summary.warningCount,
      },
      materializerStatus: dryRunReport.materializer.status,
      promotionReadinessStatus: promotionReadiness.status,
      seedShapeCompatibility: dryRunReport.seedShapeCompatibility,
      candidateIdentitySummary: dryRunReport.candidateIdentitySummary,
      productionWriteGates: V2_REPLACEMENT_PRODUCTION_WRITE_GATES,
      helperStatus: "blocked",
      helperProvenanceSource: "v2_blocked_fail_closed",
    };
  }

  const v2Seed = buildV2MaterializedSeedForAcceptance({
    enableV2MaterializedSeedWrite: true,
    slotSequence,
    plannerPolicy,
    exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
    taxonomy,
    inventory,
    materializedPlan,
    constraints,
    requiredLaneCoverageBySlot: dryRunReport.requiredLaneCoverageBySlot,
    productionWriteGates: V2_REPLACEMENT_PRODUCTION_WRITE_GATES,
    acceptedPlannerIntent: buildV2AcceptedPlannerIntentDto(plannerPolicy),
    dependencies: {
      buildDryRunReport: () => dryRunReport,
      buildPromotionReadiness: () => promotionReadiness,
      ...(input.dependencies?.buildSlotPlanSeed
        ? { buildSlotPlanSeed: input.dependencies.buildSlotPlanSeed }
        : {}),
    },
  });

  return {
    status: v2Seed.status === "ready" ? "ready" : "blocked",
    blockers:
      v2Seed.status === "ready" ? [] : ["v2_materialized_seed_blocked"],
    basePlanValidation: {
      status: basePlanValidation.status,
      passed: true,
      blockerCount: basePlanValidation.summary.blockerCount,
      warningCount: basePlanValidation.summary.warningCount,
    },
    materializerStatus: dryRunReport.materializer.status,
    promotionReadinessStatus: promotionReadiness.status,
    seedShapeCompatibility: dryRunReport.seedShapeCompatibility,
    candidateIdentitySummary: dryRunReport.candidateIdentitySummary,
    productionWriteGates: V2_REPLACEMENT_PRODUCTION_WRITE_GATES,
    ...(v2Seed.status === "ready"
      ? {
          candidateSlotPlanSeedJson:
            v2Seed.slotPlanSeedJson as unknown as Prisma.InputJsonValue,
        }
      : {}),
    helperStatus: v2Seed.status,
    helperProvenanceSource: v2Seed.provenance.source,
  };
}

function buildResult(input: {
  ownerEmail: string;
  userId: string;
  mesocycleId: string;
  writeRequested: boolean;
  confirmationProvided: boolean;
  safety: EmptyMesocycleReplacementSafety;
  v2Preparation: V2ReplacementSeedPreparationInternal;
  currentSeedJson: unknown;
  dbWriteOccurred: boolean;
  transactionStatus: ReplaceEmptyMesocycleWithV2Result["write"]["transactionStatus"];
}): ReplaceEmptyMesocycleWithV2Result {
  const eligible = input.safety.allowed && input.v2Preparation.status === "ready";
  const v2Source =
    input.v2Preparation.status === "ready"
      ? "v2_materialized_seed"
      : input.safety.allowed
        ? "v2_blocked_fail_closed"
        : "replacement_not_attempted";

  return {
    version: 1,
    source: REPLACEMENT_SOURCE,
    dryRun: !input.writeRequested,
    writeRequested: input.writeRequested,
    owner: {
      email: input.ownerEmail,
      userId: input.userId,
    },
    targetMesocycleId: input.mesocycleId,
    replacementSemantics: {
      strategy: "update_existing_empty_mesocycle_in_place",
      preservesMesocycleId: true,
      updates: ["slotPlanSeedJson"],
      preserves: [
        "slotSequenceJson",
        "workouts",
        "workoutSets",
        "setLogs",
        "runtimeReplay",
        "defaultHandoffAcceptance",
      ],
    },
    candidateSafety: input.safety,
    v2Preparation: {
      status: input.v2Preparation.status,
      blockers: input.v2Preparation.blockers,
      basePlanValidation: input.v2Preparation.basePlanValidation,
      materializerStatus: input.v2Preparation.materializerStatus,
      promotionReadinessStatus: input.v2Preparation.promotionReadinessStatus,
      seedShapeCompatibility: input.v2Preparation.seedShapeCompatibility,
      candidateIdentitySummary: input.v2Preparation.candidateIdentitySummary,
      productionWriteGates: input.v2Preparation.productionWriteGates,
      helperStatus: input.v2Preparation.helperStatus,
      helperProvenanceSource: input.v2Preparation.helperProvenanceSource,
    },
    seedComparison: buildSeedComparison({
      currentSeedJson: input.currentSeedJson,
      candidateSeedJson: input.v2Preparation.candidateSlotPlanSeedJson,
    }),
    seedRuntimeBoundary: seedRuntimeBoundary(),
    provenance: {
      source: v2Source,
      operation: "replace_empty_mesocycle",
      owner: input.ownerEmail,
      targetMesocycleId: input.mesocycleId,
      noLoggedWorkoutsVerified: input.safety.evidence.workoutCount === 0,
      noPerformedSetsVerified: input.safety.evidence.performedSetLogCount === 0,
      serializer: "buildMesocycleSlotPlanSeed",
      dbWriteOccurred: input.dbWriteOccurred,
      transactionStatus: input.transactionStatus,
      fallbackStatus:
        input.v2Preparation.status === "blocked" ? "blocked_no_fallback" : "none",
      runtimeReplayUnchanged: true,
    },
    write: {
      requested: input.writeRequested,
      confirmationProvided: input.confirmationProvided,
      eligible,
      dbWriteOccurred: input.dbWriteOccurred,
      transactionStatus: input.transactionStatus,
    },
    guardrails: guardrails(),
  };
}

function assertRequiredInput(input: ReplaceEmptyMesocycleWithV2Input): void {
  if (!input.ownerEmail || input.ownerEmail.trim().length === 0) {
    throw new Error("REPLACE_EMPTY_MESOCYCLE_WITH_V2_OWNER_EMAIL_REQUIRED");
  }
  if (!input.mesocycleId || input.mesocycleId.trim().length === 0) {
    throw new Error("REPLACE_EMPTY_MESOCYCLE_WITH_V2_MESOCYCLE_ID_REQUIRED");
  }
  if (input.replaceEmptyActiveMesocycleWithV2 !== true) {
    throw new Error("REPLACE_EMPTY_MESOCYCLE_WITH_V2_EXPLICIT_FLAG_REQUIRED");
  }
  if (input.write && input.confirmEmptyMesocycleReplacement !== true) {
    throw new Error("REPLACE_EMPTY_MESOCYCLE_WITH_V2_CONFIRMATION_REQUIRED");
  }
}

export async function replaceEmptyMesocycleWithV2(
  input: ReplaceEmptyMesocycleWithV2Input,
): Promise<ReplaceEmptyMesocycleWithV2Result> {
  assertRequiredInput(input);

  const client = input.dependencies?.prismaClient ?? prisma;
  const writeRequested = input.write === true;
  const confirmationProvided = input.confirmEmptyMesocycleReplacement === true;
  const initial = await client.$transaction(async (tx) =>
    inspectEmptyReplacementSafety(tx as unknown as ReplacementTx, input),
  );
  const v2Preparation =
    initial.safety.allowed && initial.mesocycle
      ? await client.$transaction((tx) =>
          buildV2ReplacementSeedPreparation({
            tx: tx as unknown as ReplacementTx,
            userId: input.userId,
            mesocycle: initial.mesocycle as ReplacementMesocycleRow,
            dependencies: input.dependencies,
          }),
        )
      : ({
          status: "blocked",
          blockers: [],
          basePlanValidation: {
            status: "not_evaluated",
            passed: false,
            blockerCount: 0,
            warningCount: 0,
          },
          materializerStatus: "blocked",
          promotionReadinessStatus: "blocked",
          seedShapeCompatibility: {
            compatible: false,
            slotCount: 0,
            exerciseCount: 0,
            missingNameCount: 0,
            duplicateExerciseIdWithinSlotCount: 0,
            invalidRoleCount: 0,
            invalidSetCount: 0,
            unsupportedClassCount: 0,
          },
          candidateIdentitySummary: emptyCandidateIdentitySummary(),
          productionWriteGates: V2_REPLACEMENT_PRODUCTION_WRITE_GATES,
          helperStatus: "blocked",
          helperProvenanceSource: "v2_blocked_fail_closed",
        } satisfies V2ReplacementSeedPreparationInternal);

  if (!writeRequested) {
    return buildResult({
      ownerEmail: input.ownerEmail,
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      writeRequested,
      confirmationProvided,
      safety: initial.safety,
      v2Preparation,
      currentSeedJson: initial.mesocycle?.slotPlanSeedJson,
      dbWriteOccurred: false,
      transactionStatus: "not_requested",
    });
  }

  if (!initial.safety.allowed || v2Preparation.status !== "ready") {
    return buildResult({
      ownerEmail: input.ownerEmail,
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      writeRequested,
      confirmationProvided,
      safety: initial.safety,
      v2Preparation,
      currentSeedJson: initial.mesocycle?.slotPlanSeedJson,
      dbWriteOccurred: false,
      transactionStatus: "no_write",
    });
  }

  const writeResult = await client.$transaction(async (tx) => {
    const current = await inspectEmptyReplacementSafety(
      tx as unknown as ReplacementTx,
      input,
    );
    if (!current.safety.allowed || !current.mesocycle) {
      return {
        safety: current.safety,
        currentSeedJson: current.mesocycle?.slotPlanSeedJson,
        dbWriteOccurred: false,
        transactionStatus: "no_write" as const,
      };
    }
    if (
      stableJson(current.mesocycle.slotSequenceJson) !==
      stableJson(initial.mesocycle?.slotSequenceJson)
    ) {
      return {
        safety: {
          ...current.safety,
          allowed: false,
          blockers: [
            ...current.safety.blockers,
            "slot_sequence_changed_before_write" as const,
          ],
        },
        currentSeedJson: current.mesocycle.slotPlanSeedJson,
        dbWriteOccurred: false,
        transactionStatus: "no_write" as const,
      };
    }

    const dbWriteOccurred =
      stableJson(current.mesocycle.slotPlanSeedJson) !==
      stableJson(v2Preparation.candidateSlotPlanSeedJson);
    if (dbWriteOccurred) {
      await createCorrectiveSeedRevisionInTransaction(
        tx as Prisma.TransactionClient,
        {
          mesocycleId: current.mesocycle.id,
          seedPayload: v2Preparation.candidateSlotPlanSeedJson,
          creationReason: "empty_active_mesocycle_v2_correction",
          actorSource: "replace_empty_mesocycle_with_v2",
        },
      );
    }

    return {
      safety: current.safety,
      currentSeedJson: current.mesocycle.slotPlanSeedJson,
      dbWriteOccurred,
      transactionStatus: "success" as const,
    };
  });

  return buildResult({
    ownerEmail: input.ownerEmail,
    userId: input.userId,
    mesocycleId: input.mesocycleId,
    writeRequested,
    confirmationProvided,
    safety: writeResult.safety,
    v2Preparation,
    currentSeedJson: writeResult.currentSeedJson,
    dbWriteOccurred: writeResult.dbWriteOccurred,
    transactionStatus: writeResult.transactionStatus,
  });
}
