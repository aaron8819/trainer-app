import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
  type V2MaterializationExercise,
  type V2MaterializationDryRunReport,
  type V2MaterializationPromotionReadiness,
} from "@/lib/engine/planning/v2";

const mocks = vi.hoisted(() => ({
  loadPreloadedGenerationSnapshot: vi.fn(),
  projectSuccessorSlotPlansFromSnapshot: vi.fn(),
}));

vi.mock("./template-session/context-loader", () => ({
  loadPreloadedGenerationSnapshot: (...args: unknown[]) =>
    mocks.loadPreloadedGenerationSnapshot(...args),
}));

vi.mock("./mesocycle-handoff-slot-plan-projection", async (importOriginal) => {
  const original = await importOriginal<typeof import("./mesocycle-handoff-slot-plan-projection")>();
  return {
    ...original,
    projectSuccessorSlotPlansFromSnapshot: (...args: unknown[]) =>
      mocks.projectSuccessorSlotPlansFromSnapshot(...args),
  };
});

import {
  acceptPreparedMesocycleHandoffInTransaction,
  acceptPreparedMesocycleHandoffWithProvenanceInTransaction,
  enterMesocycleHandoffInTransaction,
  findIncompatibleCarryForwardKeeps,
  formatCarryForwardConflictMessage,
  loadClosedMesocycleArchive,
  MesocycleHandoffV2MaterializedSeedBlockedError,
  prepareMesocycleHandoffAcceptance,
  prepareV2AcceptedSeedPreparationCompare,
  prepareV2AcceptedSeedPreparationProbe,
  readMesocycleHandoffSummary,
  readNextCycleSeedDraft,
  sanitizeNextCycleSeedDraft,
  toHandoffProjectionSource,
  type NextMesocycleDesign,
  type NextCycleSeedDraft,
  updateMesocycleHandoffDraftInTransaction,
} from "./mesocycle-handoff";
import { buildMesocycleSlotPlanSeed } from "./mesocycle-handoff-slot-plan-projection.seed-serialization";

async function prepareThenAcceptMesocycleHandoff(tx: unknown, mesocycleId = "meso-1") {
  const prepared = await prepareMesocycleHandoffAcceptance({
    userId: "user-1",
    mesocycleId,
    reader: tx as never,
  });
  const client = tx as {
    mesocycle: {
      findFirst?: ReturnType<typeof vi.fn>;
      updateMany?: ReturnType<typeof vi.fn>;
    };
  };
  client.mesocycle.findFirst ??= vi
    .fn()
    .mockResolvedValueOnce({
      ...prepared.pendingRow,
      macroCycleId: prepared.source.macroCycleId,
    })
    .mockResolvedValueOnce(null);
  client.mesocycle.updateMany ??= vi.fn();
  return acceptPreparedMesocycleHandoffInTransaction(tx as never, prepared);
}

function buildRecommendedDesign(): NextMesocycleDesign {
  return {
    version: 1,
    designedAt: "2026-04-01T00:00:00.000Z",
    sourceMesocycleId: "meso-1",
    profile: {
      focus: "Upper Hypertrophy",
      durationWeeks: 5,
      volumeTarget: "HIGH",
      intensityBias: "HYPERTROPHY",
      blocks: [],
    },
    structure: {
      splitType: "UPPER_LOWER",
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      sequenceMode: "ordered_flexible",
      slots: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          authoredSemantics: {
            slotArchetype: "upper_horizontal_balanced",
            primaryLaneContract: {
              mode: "lane_control",
              lanes: [
                {
                  key: "press",
                  preferredMovementPatterns: ["horizontal_push"],
                  compatibleMovementPatterns: [],
                  fallbackOnlyMovementPatterns: ["vertical_push"],
                },
                {
                  key: "pull",
                  preferredMovementPatterns: ["horizontal_pull"],
                  compatibleMovementPatterns: [],
                  fallbackOnlyMovementPatterns: ["vertical_pull"],
                },
              ],
            },
            supportCoverageContract: {
              preferredAccessoryPrimaryMuscles: ["Chest", "Upper Back", "Rear Delts"],
              requiredMovementPatterns: ["vertical_pull", "horizontal_pull"],
              avoidDuplicatePatterns: ["vertical_pull"],
            },
            continuityScope: "slot",
          },
        },
        {
          slotId: "lower_a",
          intent: "LOWER",
          authoredSemantics: {
            slotArchetype: "lower_squat_dominant",
            primaryLaneContract: {
              mode: "lane_control",
              lanes: [
                {
                  key: "primary",
                  preferredMovementPatterns: ["squat"],
                  compatibleMovementPatterns: [],
                  fallbackOnlyMovementPatterns: ["hinge"],
                  preferredPrimaryMuscles: ["Quads"],
                },
              ],
            },
            supportCoverageContract: {
              preferredAccessoryPrimaryMuscles: ["Quads"],
              requiredMovementPatterns: ["hinge"],
              avoidDuplicatePatterns: ["squat"],
              supportPenaltyPatterns: ["hinge"],
              maxPreferredSupportPerPattern: 1,
            },
            continuityScope: "slot",
          },
        },
        {
          slotId: "upper_b",
          intent: "UPPER",
          authoredSemantics: {
            slotArchetype: "upper_vertical_balanced",
            primaryLaneContract: {
              mode: "lane_control",
              lanes: [
                {
                  key: "press",
                  preferredMovementPatterns: ["vertical_push"],
                  compatibleMovementPatterns: [],
                  fallbackOnlyMovementPatterns: ["horizontal_push"],
                },
                {
                  key: "pull",
                  preferredMovementPatterns: ["vertical_pull"],
                  compatibleMovementPatterns: [],
                  fallbackOnlyMovementPatterns: ["horizontal_pull"],
                },
              ],
            },
            supportCoverageContract: {
              preferredAccessoryPrimaryMuscles: ["Lats", "Front Delts", "Side Delts"],
              requiredMovementPatterns: ["horizontal_pull"],
              avoidDuplicatePatterns: ["vertical_push", "vertical_pull"],
              supportPenaltyPatterns: ["vertical_push"],
              maxPreferredSupportPerPattern: 1,
            },
            continuityScope: "slot",
          },
        },
        {
          slotId: "lower_b",
          intent: "LOWER",
          authoredSemantics: {
            slotArchetype: "lower_hinge_dominant",
            primaryLaneContract: {
              mode: "lane_control",
              lanes: [
                {
                  key: "primary",
                  preferredMovementPatterns: ["hinge"],
                  compatibleMovementPatterns: [],
                  fallbackOnlyMovementPatterns: ["squat"],
                  preferredPrimaryMuscles: ["Hamstrings", "Glutes"],
                },
              ],
            },
            supportCoverageContract: {
              preferredAccessoryPrimaryMuscles: ["Hamstrings", "Glutes"],
              requiredMovementPatterns: ["squat"],
              avoidDuplicatePatterns: ["hinge"],
              supportPenaltyPatterns: ["squat"],
              maxPreferredSupportPerPattern: 1,
            },
            continuityScope: "slot",
          },
        },
      ],
    },
    carryForward: {
      decisions: [
        {
          exerciseId: "bench",
          role: "CORE_COMPOUND",
          priorIntent: "UPPER",
          action: "keep",
          targetIntent: "UPPER",
          signalQuality: "high",
          reasonCodes: ["core_compound_continuity"],
        },
        {
          exerciseId: "row",
          role: "ACCESSORY",
          priorIntent: "UPPER",
          action: "rotate",
          signalQuality: "medium",
          reasonCodes: ["accessory_rotation_default"],
        },
      ],
    },
    startingPoint: {
      volumeEntry: "conservative",
      baselineSource: "accumulation_preferred",
      allowNonDeloadFallback: true,
    },
    explainability: {
      profileReasonCodes: ["carry_forward_mesocycle_profile_default"],
      profileSignalQuality: "medium",
      structureReasonCodes: ["upper_lower_default_frequency_cap"],
      structureSignalQuality: "medium",
      startingPointReasonCodes: ["conservative_entry_after_deload_boundary"],
      startingPointSignalQuality: "medium",
    },
  };
}

function buildRecommendedDraft(): NextCycleSeedDraft {
  return {
    version: 1 as const,
    sourceMesocycleId: "meso-1",
    createdAt: "2026-04-01T00:00:00.000Z",
    structure: {
      splitType: "UPPER_LOWER" as const,
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      sequenceMode: "ordered_flexible" as const,
      slots: [
        { slotId: "upper_a", intent: "UPPER" as const },
        { slotId: "lower_a", intent: "LOWER" as const },
        { slotId: "upper_b", intent: "UPPER" as const },
        { slotId: "lower_b", intent: "LOWER" as const },
      ],
    },
    startingPoint: {
      volumeEntry: "conservative" as const,
      baselineSource: "accumulation_preferred" as const,
      allowNonDeloadFallback: true as const,
    },
    carryForwardSelections: [
      {
        exerciseId: "bench",
        exerciseName: "Bench Press",
        sessionIntent: "UPPER" as const,
        role: "CORE_COMPOUND" as const,
        action: "keep" as const,
      },
      {
        exerciseId: "row",
        exerciseName: "Chest-Supported Row",
        sessionIntent: "UPPER" as const,
        role: "ACCESSORY" as const,
        action: "rotate" as const,
      },
    ],
  };
}

function buildHandoffSummaryJson(draft: NextCycleSeedDraft = buildRecommendedDraft()) {
  return {
    version: 1 as const,
    mesocycleId: "meso-1",
    macroCycleId: "macro-1",
    mesoNumber: 1,
    closedAt: "2026-04-01T00:00:00.000Z",
    lifecycle: {
      terminalState: "AWAITING_HANDOFF" as const,
      durationWeeks: 5,
      accumulationSessionsCompleted: 8,
      deloadSessionsCompleted: 1,
      deloadExcludedFromNextBaseline: true as const,
    },
    training: {
      focus: "Upper Hypertrophy",
      splitType: "UPPER_LOWER" as const,
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      weeklySequence: ["UPPER", "LOWER", "UPPER", "LOWER"] as const,
    },
    carryForwardRecommendations: [
      {
        exerciseId: "bench",
        exerciseName: "Bench Press",
        sessionIntent: "UPPER" as const,
        role: "CORE_COMPOUND" as const,
        recommendation: "keep" as const,
        signalQuality: "high" as const,
        reasonCodes: ["core_compound_continuity"],
      },
      {
        exerciseId: "row",
        exerciseName: "Chest-Supported Row",
        sessionIntent: "UPPER" as const,
        role: "ACCESSORY" as const,
        recommendation: "rotate" as const,
        signalQuality: "medium" as const,
        reasonCodes: ["accessory_rotation_default"],
      },
    ],
    recommendedNextSeed: draft,
    recommendedDesign: buildRecommendedDesign(),
  };
}

function makeProjectedSlotPlans() {
  return [
    {
      slotId: "upper_a",
      intent: "UPPER",
      exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 }],
    },
    {
      slotId: "lower_a",
      intent: "LOWER",
      exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 }],
    },
    {
      slotId: "upper_b",
      intent: "UPPER",
      exercises: [{ exerciseId: "row", role: "ACCESSORY", setCount: 3 }],
    },
    {
      slotId: "lower_b",
      intent: "LOWER",
      exercises: [{ exerciseId: "split-squat", role: "ACCESSORY", setCount: 3 }],
    },
  ];
}

function makeV2ComparisonSlotPlans() {
  return [
    {
      slotId: "upper_a",
      intent: "UPPER",
      exercises: [
        { exerciseId: "incline-press", role: "CORE_COMPOUND", setCount: 3 },
        { exerciseId: "row", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "pulldown", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "reverse-fly", role: "ACCESSORY", setCount: 2 },
      ],
    },
    {
      slotId: "lower_a",
      intent: "LOWER",
      exercises: [
        { exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 },
        { exerciseId: "leg-curl", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "calf-raise", role: "ACCESSORY", setCount: 3 },
      ],
    },
    {
      slotId: "upper_b",
      intent: "UPPER",
      exercises: [
        { exerciseId: "bench", role: "CORE_COMPOUND", setCount: 3 },
        { exerciseId: "lateral-raise", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "cable-curl", role: "ACCESSORY", setCount: 2 },
        { exerciseId: "triceps-pushdown", role: "ACCESSORY", setCount: 2 },
      ],
    },
    {
      slotId: "lower_b",
      intent: "LOWER",
      exercises: [
        { exerciseId: "split-squat", role: "ACCESSORY", setCount: 3 },
        { exerciseId: "rdl", role: "CORE_COMPOUND", setCount: 3 },
        { exerciseId: "leg-curl", role: "ACCESSORY", setCount: 2 },
        { exerciseId: "calf-raise", role: "ACCESSORY", setCount: 3 },
      ],
    },
  ];
}

function makeComparisonInventory(): V2MaterializationExercise[] {
  return [
    {
      exerciseId: "bench",
      name: "Bench Press",
      movementPatterns: ["horizontal_press"],
      primaryMuscles: ["Chest"],
      secondaryMuscles: ["Triceps"],
      equipment: ["barbell"],
      isCompound: true,
      isMainLiftEligible: true,
      stimulusByMusclePerSet: { Chest: 1, Triceps: 0.4 },
    },
    {
      exerciseId: "incline-press",
      name: "Incline Dumbbell Press",
      movementPatterns: ["horizontal_press"],
      primaryMuscles: ["Chest"],
      secondaryMuscles: ["Triceps"],
      equipment: ["dumbbell"],
      isCompound: true,
      isMainLiftEligible: true,
      stimulusByMusclePerSet: { Chest: 1, Triceps: 0.4 },
    },
    {
      exerciseId: "row",
      name: "Chest-Supported Row",
      movementPatterns: ["horizontal_pull", "row"],
      primaryMuscles: ["Upper Back", "Lats"],
      secondaryMuscles: ["Rear Delts", "Biceps"],
      equipment: ["machine"],
      isCompound: true,
      isMainLiftEligible: false,
      stimulusByMusclePerSet: { "Upper Back": 1, Lats: 0.7, Biceps: 0.3 },
    },
    {
      exerciseId: "pulldown",
      name: "Lat Pulldown",
      movementPatterns: ["vertical_pull"],
      primaryMuscles: ["Lats"],
      secondaryMuscles: ["Biceps"],
      equipment: ["cable"],
      isCompound: true,
      isMainLiftEligible: false,
      stimulusByMusclePerSet: { Lats: 1, Biceps: 0.3 },
    },
    {
      exerciseId: "reverse-fly",
      name: "Reverse Fly",
      movementPatterns: ["horizontal_pull"],
      primaryMuscles: ["Rear Delts"],
      secondaryMuscles: ["Upper Back"],
      equipment: ["dumbbell"],
      isCompound: false,
      isMainLiftEligible: false,
      stimulusByMusclePerSet: { "Rear Delts": 1 },
    },
    {
      exerciseId: "squat",
      name: "Back Squat",
      movementPatterns: ["squat"],
      primaryMuscles: ["Quads"],
      secondaryMuscles: ["Glutes"],
      equipment: ["barbell"],
      isCompound: true,
      isMainLiftEligible: true,
      stimulusByMusclePerSet: { Quads: 1, Glutes: 0.6 },
    },
    {
      exerciseId: "split-squat",
      name: "Split Squat",
      movementPatterns: ["squat"],
      primaryMuscles: ["Quads"],
      secondaryMuscles: ["Glutes"],
      equipment: ["dumbbell"],
      isCompound: true,
      isMainLiftEligible: false,
      stimulusByMusclePerSet: { Quads: 1, Glutes: 0.5 },
    },
    {
      exerciseId: "rdl",
      name: "Romanian Deadlift",
      movementPatterns: ["hinge"],
      primaryMuscles: ["Hamstrings"],
      secondaryMuscles: ["Glutes", "Lower Back"],
      equipment: ["barbell"],
      isCompound: true,
      isMainLiftEligible: true,
      stimulusByMusclePerSet: { Hamstrings: 1, Glutes: 0.6 },
    },
    {
      exerciseId: "leg-curl",
      name: "Seated Leg Curl",
      movementPatterns: ["knee_flexion"],
      primaryMuscles: ["Hamstrings"],
      secondaryMuscles: [],
      equipment: ["machine"],
      isCompound: false,
      isMainLiftEligible: false,
      stimulusByMusclePerSet: { Hamstrings: 1 },
    },
    {
      exerciseId: "calf-raise",
      name: "Standing Calf Raise",
      movementPatterns: ["ankle_extension"],
      primaryMuscles: ["Calves"],
      secondaryMuscles: [],
      equipment: ["machine"],
      isCompound: false,
      isMainLiftEligible: false,
      stimulusByMusclePerSet: { Calves: 1 },
    },
    {
      exerciseId: "lateral-raise",
      name: "Cable Lateral Raise",
      movementPatterns: ["shoulder_abduction"],
      primaryMuscles: ["Side Delts"],
      secondaryMuscles: [],
      equipment: ["cable"],
      isCompound: false,
      isMainLiftEligible: false,
      stimulusByMusclePerSet: { "Side Delts": 1 },
    },
    {
      exerciseId: "cable-curl",
      name: "Cable Curl",
      movementPatterns: ["elbow_flexion"],
      primaryMuscles: ["Biceps"],
      secondaryMuscles: [],
      equipment: ["cable"],
      isCompound: false,
      isMainLiftEligible: false,
      stimulusByMusclePerSet: { Biceps: 1 },
    },
    {
      exerciseId: "triceps-pushdown",
      name: "Triceps Pushdown",
      movementPatterns: ["elbow_extension"],
      primaryMuscles: ["Triceps"],
      secondaryMuscles: [],
      equipment: ["cable"],
      isCompound: false,
      isMainLiftEligible: false,
      stimulusByMusclePerSet: { Triceps: 1 },
    },
  ];
}

function makeAcceptanceTx(input: {
  create?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  updateMany?: ReturnType<typeof vi.fn>;
} = {}) {
  const recommendedDraft = buildRecommendedDraft();
  const create =
    input.create ??
    vi.fn().mockResolvedValue({
      id: "meso-2",
      state: "ACTIVE_ACCUMULATION",
      mesoNumber: 2,
    });
  return {
    mesocycle: {
      findUnique: vi
        .fn()
        .mockResolvedValueOnce({
          id: "meso-1",
          macroCycleId: "macro-1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          focus: "Upper Hypertrophy",
          volumeTarget: "HIGH",
          intensityBias: "HYPERTROPHY",
          sessionsPerWeek: 4,
          daysPerWeek: 4,
          splitType: "UPPER_LOWER",
          accumulationSessionsCompleted: 8,
          deloadSessionsCompleted: 1,
          blocks: [],
          macroCycle: { userId: "user-1" },
        })
        .mockResolvedValueOnce({
          id: "meso-1",
          state: "AWAITING_HANDOFF",
          mesoNumber: 1,
          focus: "Upper Hypertrophy",
          closedAt: new Date("2026-04-01T00:00:00.000Z"),
          handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
          nextSeedDraftJson: recommendedDraft,
        }),
      findFirst: vi
        .fn()
        .mockResolvedValueOnce({
          id: "meso-1",
          state: "AWAITING_HANDOFF",
          mesoNumber: 1,
          focus: "Upper Hypertrophy",
          closedAt: new Date("2026-04-01T00:00:00.000Z"),
          handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
          nextSeedDraftJson: recommendedDraft,
          macroCycleId: "macro-1",
        })
        .mockResolvedValueOnce(null),
      create,
      update: input.update ?? vi.fn(),
      updateMany: input.updateMany ?? vi.fn(),
    },
    trainingBlock: {
      createMany: vi.fn(),
    },
    mesocycleExerciseRole: {
      createMany: vi.fn(),
    },
    constraints: {
      upsert: vi.fn(),
    },
  };
}

function makeReadyV2MaterializedSeedWrite() {
  const productionWriteGates = {
    acceptancePathDesigned: true,
    slotPlanSeedJsonWriteGateDesigned: true,
    receiptContractDesigned: true,
    runtimeReplayContractVerified: true,
    auditSerializationContractDesigned: true,
    rollbackStrategyDefined: true,
  };
  return {
    enableV2MaterializedSeedWrite: true,
    dependencies: {
      buildDryRunReport: vi.fn(() => ({
        version: 1,
        executableSeedPreview: makeProjectedSlotPlans().map((slot) => ({
          slotId: slot.slotId,
          exercises: slot.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            role: exercise.role,
            setCount: exercise.setCount,
          })),
        })),
      })),
      buildPromotionReadiness: vi.fn(() => ({
        version: 1,
        status: "eligible_for_guarded_write",
        safeToPromoteToProductionWrite: true,
        productionWriteGates,
        blockers: [],
        nonBlockingOmissions: [],
      })),
    },
  };
}

function makeBlockedV2MaterializedSeedWrite() {
  const productionWriteGates = {
    acceptancePathDesigned: true,
    slotPlanSeedJsonWriteGateDesigned: true,
    receiptContractDesigned: true,
    runtimeReplayContractVerified: true,
    auditSerializationContractDesigned: true,
    rollbackStrategyDefined: true,
  };
  return {
    enableV2MaterializedSeedWrite: true,
    dependencies: {
      buildDryRunReport: vi.fn(() => ({
        version: 1,
        executableSeedPreview: [],
      })),
      buildPromotionReadiness: vi.fn(() => ({
        version: 1,
        status: "not_ready",
        safeToPromoteToProductionWrite: false,
        productionWriteGates,
        blockers: [
          {
            category: "required_materialization",
            reason: "required_lane_coverage_incomplete",
          },
        ],
        nonBlockingOmissions: [],
      })),
    },
  };
}

function makeV2AcceptedSeedPreparationProbeInput(
  input: {
    blocked?: boolean;
    slotPlans?: ReturnType<typeof makeProjectedSlotPlans>;
    inventory?: V2MaterializationExercise[];
  } = {},
) {
  const slotPlans = input.slotPlans ?? makeProjectedSlotPlans();
  const requiredLaneCoverageBySlot = slotPlans.map((slot) => ({
    slotId: slot.slotId,
    requiredLaneCount: slot.exercises.length,
    materializedRequiredLaneCount: input.blocked ? 0 : slot.exercises.length,
    blockedRequiredLaneCount: input.blocked ? slot.exercises.length : 0,
    missingRequiredLaneIds: input.blocked
      ? slot.exercises.map((exercise) => exercise.exerciseId)
      : [],
  }));
  const productionWriteGates = {
    acceptancePathDesigned: true,
    slotPlanSeedJsonWriteGateDesigned: true,
    receiptContractDesigned: true,
    runtimeReplayContractVerified: true,
    auditSerializationContractDesigned: true,
    rollbackStrategyDefined: true,
  };
  const dryRunReport: V2MaterializationDryRunReport = {
    version: 1,
    source: "v2_exercise_materialization",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    status: input.blocked ? "blocked" : "materialized",
    plannerPolicyAvailable: true,
    exerciseSelectionPlanAvailable: true,
    taxonomyAvailable: true,
    inventoryAvailable: true,
    materializer: {
      status: input.blocked ? "blocked" : "materialized",
      blockerCount: input.blocked ? 1 : 0,
      omissionCount: 0,
    },
    seedShapeCompatibility: {
      compatible: !input.blocked,
      slotCount: input.blocked ? 0 : slotPlans.length,
      exerciseCount: input.blocked
        ? 0
        : slotPlans.reduce((sum, slot) => sum + slot.exercises.length, 0),
      missingNameCount: 0,
      duplicateExerciseIdWithinSlotCount: 0,
      invalidRoleCount: 0,
      invalidSetCount: 0,
      unsupportedClassCount: 0,
    },
    requiredLaneCoverageBySlot,
    executableSeedPreview: input.blocked
      ? []
      : slotPlans.map((slot) => ({
          slotId: slot.slotId,
          intent: slot.intent,
          exercises: slot.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            name: exercise.exerciseId,
            role: exercise.role as "CORE_COMPOUND" | "ACCESSORY",
            setCount: exercise.setCount,
          })),
        })),
    strippedMaterializerFields: ["laneIds"],
    blockers: input.blocked
      ? [{ slotId: "upper_a", laneId: "bench", reason: "no_class_match" }]
      : [],
    omissions: [],
    readiness: {
      safeToPromoteToProductionWrite: false,
      missingBeforePromotion: [],
    },
  };
  const buildSlotPlanSeed = vi.fn(buildMesocycleSlotPlanSeed);

  return {
    ...(input.inventory
      ? {
          inventory: input.inventory,
          taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
        }
      : {}),
    basePlanValidation: {
      source: "v2_base_plan_validation",
      status: input.blocked ? "fail" : "pass",
      blockerCount: input.blocked ? 1 : 0,
      warningCount: 0,
      nextSafeAction: input.blocked
        ? "fix_materializer"
        : "ready_for_base_plan_compare",
    } as const,
    requiredLaneCoverageBySlot,
    productionWriteGates,
    dependencies: {
      buildDryRunReport: vi.fn(() => dryRunReport),
      buildPromotionReadiness: vi.fn((): V2MaterializationPromotionReadiness => ({
        version: 1,
        source: "v2_materialization_promotion_readiness",
        readOnly: true,
        affectsScoringOrGeneration: false,
        status: input.blocked ? "blocked" : "eligible_for_guarded_write",
        safeToPromoteToProductionWrite: !input.blocked,
        requiredMaterialization: {
          status: input.blocked ? "blocked" : "passed",
          requiredLaneCoveragePassed: !input.blocked,
          materializerStatus: input.blocked ? "blocked" : "materialized",
          requiredBlockerCount: input.blocked ? 1 : 0,
        },
        optionalOmissions: {
          count: 0,
          affectsPromotion: false,
          reasons: [],
        },
        seedShape: {
          compatible: !input.blocked,
          slotCountMatches: !input.blocked,
          noDuplicateExerciseIdsWithinSlot: true,
          rolesValid: true,
          setCountsValid: true,
          namesAvailable: true,
        },
        productionWriteGates,
        blockers: input.blocked
          ? [
              {
                category: "required_materialization",
                reason: "upper_a:required_lane_coverage_incomplete",
              },
            ]
          : [],
        nonBlockingOmissions: [],
      })),
      buildSlotPlanSeed,
    },
  };
}

describe("sanitizeNextCycleSeedDraft", () => {
  it("canonicalizes ordered slots and allows drop actions against the frozen recommendation set", () => {
    const sanitized = sanitizeNextCycleSeedDraft({
      sourceMesocycleId: "meso-1",
      fallbackDraft: buildRecommendedDraft(),
      draft: {
        sourceMesocycleId: "meso-1",
        structure: {
          splitType: "PPL",
          sessionsPerWeek: 3,
          daysPerWeek: 3,
          sequenceMode: "ordered_flexible",
          slots: [
            { slotId: "x", intent: "PULL" },
            { slotId: "y", intent: "PUSH" },
            { slotId: "z", intent: "LEGS" },
          ],
        },
        carryForwardSelections: [
          {
            exerciseId: "bench",
            exerciseName: "ignored",
            sessionIntent: "UPPER",
            role: "CORE_COMPOUND",
            action: "drop",
          },
          {
            exerciseId: "row",
            exerciseName: "ignored",
            sessionIntent: "UPPER",
            role: "ACCESSORY",
            action: "rotate",
          },
        ],
      },
    });

    expect(sanitized.structure.slots).toEqual([
      { slotId: "pull_a", intent: "PULL" },
      { slotId: "push_a", intent: "PUSH" },
      { slotId: "legs_a", intent: "LEGS" },
    ]);
    expect(sanitized.carryForwardSelections).toEqual([
      expect.objectContaining({ exerciseName: "Bench Press", action: "drop" }),
      expect.objectContaining({ exerciseName: "Chest-Supported Row", action: "rotate" }),
    ]);
  });

  it("rejects keep selections whose prior intent no longer exists in the edited split", () => {
    expect(() =>
      sanitizeNextCycleSeedDraft({
        sourceMesocycleId: "meso-1",
        fallbackDraft: buildRecommendedDraft(),
        draft: {
          sourceMesocycleId: "meso-1",
          structure: {
            splitType: "PPL",
            sessionsPerWeek: 3,
            daysPerWeek: 3,
            sequenceMode: "ordered_flexible",
            slots: [
              { slotId: "x", intent: "PUSH" },
              { slotId: "y", intent: "PULL" },
              { slotId: "z", intent: "LEGS" },
            ],
          },
          carryForwardSelections: [
            {
              exerciseId: "bench",
              exerciseName: "ignored",
              sessionIntent: "UPPER",
              role: "CORE_COMPOUND",
              action: "keep",
            },
            {
              exerciseId: "row",
              exerciseName: "ignored",
              sessionIntent: "UPPER",
              role: "ACCESSORY",
              action: "rotate",
            },
          ],
        },
      })
    ).toThrow("MESOCYCLE_HANDOFF_KEEP_SELECTION_CONFLICT:");

    const conflicts = findIncompatibleCarryForwardKeeps({
      slots: [{ intent: "PUSH" }, { intent: "PULL" }, { intent: "LEGS" }],
      carryForwardSelections: buildRecommendedDraft().carryForwardSelections,
    });

    expect(formatCarryForwardConflictMessage(conflicts)).toContain("Bench Press (UPPER)");
  });
});

describe("handoff readers", () => {
  it("narrows the shared handoff projection source used by preview and accept", () => {
    expect(
      toHandoffProjectionSource({
        macroCycleId: "macro-1",
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 5,
        focus: "Upper Hypertrophy",
        volumeTarget: "HIGH",
        intensityBias: "HYPERTROPHY",
        blocks: [],
      })
    ).toEqual({
      macroCycleId: "macro-1",
      mesoNumber: 1,
      startWeek: 0,
      durationWeeks: 5,
      focus: "Upper Hypertrophy",
      volumeTarget: "HIGH",
      intensityBias: "HYPERTROPHY",
      blocks: [],
    });
  });

  it("rejects version-only JSON that does not satisfy the handoff contract shape", () => {
    expect(readNextCycleSeedDraft({ version: 1 })).toBeNull();
    expect(readMesocycleHandoffSummary({ version: 1 })).toBeNull();
  });

  it("auto-remaps obvious keep selections when reading upper/lower next-cycle drafts", () => {
    const staleDraft: NextCycleSeedDraft = {
      ...buildRecommendedDraft(),
      carryForwardSelections: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          sessionIntent: "PUSH" as const,
          role: "CORE_COMPOUND" as const,
          action: "keep" as const,
        },
        {
          exerciseId: "row",
          exerciseName: "Chest-Supported Row",
          sessionIntent: "PULL" as const,
          role: "ACCESSORY" as const,
          action: "keep" as const,
        },
        {
          exerciseId: "split-squat",
          exerciseName: "Split Squat",
          sessionIntent: "LEGS" as const,
          role: "ACCESSORY" as const,
          action: "keep" as const,
        },
      ],
    };

    expect(readNextCycleSeedDraft(staleDraft)?.carryForwardSelections).toEqual([
      expect.objectContaining({ exerciseName: "Bench Press", sessionIntent: "UPPER" }),
      expect.objectContaining({ exerciseName: "Chest-Supported Row", sessionIntent: "UPPER" }),
      expect.objectContaining({ exerciseName: "Split Squat", sessionIntent: "LOWER" }),
    ]);

    expect(
      readMesocycleHandoffSummary(buildHandoffSummaryJson(staleDraft))?.recommendedNextSeed
        .carryForwardSelections
    ).toEqual([
      expect.objectContaining({ exerciseName: "Bench Press", sessionIntent: "UPPER" }),
      expect.objectContaining({ exerciseName: "Chest-Supported Row", sessionIntent: "UPPER" }),
      expect.objectContaining({ exerciseName: "Split Squat", sessionIntent: "LOWER" }),
    ]);
  });

  it("loads completed archives as reviewable but not editable handoff state", async () => {
    const result = await loadClosedMesocycleArchive(
      {
        mesocycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: "meso-1",
            state: "COMPLETED",
            mesoNumber: 1,
            focus: "Upper Hypertrophy",
            closedAt: new Date("2026-04-01T00:00:00.000Z"),
            handoffSummaryJson: {
              ...buildHandoffSummaryJson(buildRecommendedDraft()),
            },
            nextSeedDraftJson: {
              version: 1,
            },
          }),
        },
      } as never,
      { userId: "user-1", mesocycleId: "meso-1" }
    );

    expect(result).toMatchObject({
      mesocycleId: "meso-1",
      currentState: "COMPLETED",
      reviewState: "historical_closeout",
      isEditableHandoff: false,
      draft: null,
    });
  });
});

describe("enterMesocycleHandoffInTransaction", () => {
  it("persists returned structure and carry-forward reason/signal outputs into the frozen summary", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "meso-1",
      macroCycleId: "macro-1",
      mesoNumber: 1,
      startWeek: 0,
      durationWeeks: 5,
      focus: "Upper Hypertrophy",
      volumeTarget: "HIGH",
      intensityBias: "HYPERTROPHY",
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      splitType: "UPPER_LOWER",
      accumulationSessionsCompleted: 8,
      deloadSessionsCompleted: 1,
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
      blocks: [],
      macroCycle: { userId: "user-1" },
    });
    const update = vi.fn().mockResolvedValue({ id: "meso-1", state: "AWAITING_HANDOFF" });
    const roleFindMany = vi.fn().mockResolvedValue([
      {
        exerciseId: "bench",
        sessionIntent: "UPPER",
        role: "CORE_COMPOUND",
        exercise: { name: "Bench Press" },
      },
      {
        exerciseId: "row",
        sessionIntent: "UPPER",
        role: "ACCESSORY",
        exercise: { name: "Chest-Supported Row" },
      },
    ]);
    const constraintsFindUnique = vi.fn().mockResolvedValue({
      weeklySchedule: ["PUSH", "PULL", "LEGS", "PUSH", "PULL"],
      daysPerWeek: 5,
      splitType: "PPL",
    });
    const workoutFindMany = vi.fn().mockResolvedValue([
      {
        scheduledDate: new Date("2026-03-24T00:00:00.000Z"),
        completedAt: new Date("2026-03-24T01:00:00.000Z"),
        status: "COMPLETED",
        sessionIntent: "UPPER",
        selectionMode: "AUTO",
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 4,
              weekInBlock: 4,
              phase: "ACCUMULATION",
              blockType: "accumulation",
              isDeload: false,
              source: "computed",
            },
            sessionSlot: {
              slotId: "upper_a",
              intent: "UPPER",
              sequenceIndex: 0,
              source: "mesocycle_slot_sequence",
            },
            deloadDecision: {
              mode: "none",
              reason: [],
              reductionPercent: 0,
              appliedTo: "none",
            },
            lifecycleVolume: {
              source: "lifecycle",
            },
            readiness: {
              wasAutoregulated: false,
              signalAgeHours: 6,
              fatigueScoreOverall: 0.72,
              intensityScaling: {
                applied: false,
                exerciseIds: [],
                scaledUpCount: 0,
                scaledDownCount: 0,
              },
            },
            plannerDiagnosticsMode: "standard",
            exceptions: [],
          },
        },
        advancesSplit: true,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        exercises: [
          { id: "we-bench-1", exerciseId: "bench" },
          { id: "we-row-1", exerciseId: "row" },
        ],
      },
    ]);
    const readinessFindFirst = vi.fn().mockResolvedValue({
      timestamp: new Date("2026-03-24T06:00:00.000Z"),
      userId: "user-1",
      whoopRecovery: null,
      whoopStrain: null,
      whoopHrv: null,
      whoopSleepQuality: null,
      whoopSleepHours: null,
      subjectiveReadiness: 4,
      subjectiveMotivation: 4,
      subjectiveSoreness: {},
      subjectiveStress: 2,
      performanceRpeDeviation: 0,
      performanceStalls: 0,
      performanceCompliance: 1,
    });

    await enterMesocycleHandoffInTransaction(
      {
        mesocycle: {
          findUnique,
          update,
        },
        mesocycleExerciseRole: {
          findMany: roleFindMany,
        },
        constraints: {
          findUnique: constraintsFindUnique,
        },
        workout: {
          findMany: workoutFindMany,
        },
        readinessSignal: {
          findFirst: readinessFindFirst,
        },
      } as never,
      "meso-1"
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          handoffSummaryJson: expect.objectContaining({
            carryForwardRecommendations: [
              expect.objectContaining({
                exerciseId: "bench",
                recommendation: "keep",
                signalQuality: "high",
                reasonCodes: ["required_anchor_continuity_supported_by_receipt_slot"],
              }),
              expect.objectContaining({
                exerciseId: "row",
                recommendation: "rotate",
                signalQuality: "medium",
                reasonCodes: ["carry_forward_rotation_ambiguous_slot_target"],
              }),
            ],
            recommendedDesign: expect.objectContaining({
              structure: expect.objectContaining({
                sessionsPerWeek: 5,
                splitType: "PPL",
              }),
              explainability: expect.objectContaining({
                structureReasonCodes: [
                  "preferred_frequency_honored",
                  "preferred_split_honored",
                  "explicit_weekly_schedule_order_honored",
                ],
                structureSignalQuality: "high",
              }),
            }),
          }),
        }),
      })
    );
  });

  it("ignores performed workouts with futureSeedCarryForward ignore when building carry-forward evidence", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "meso-1",
      macroCycleId: "macro-1",
      mesoNumber: 1,
      startWeek: 0,
      durationWeeks: 5,
      focus: "Upper Hypertrophy",
      volumeTarget: "HIGH",
      intensityBias: "HYPERTROPHY",
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      splitType: "UPPER_LOWER",
      accumulationSessionsCompleted: 8,
      deloadSessionsCompleted: 1,
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
      blocks: [],
      macroCycle: { userId: "user-1" },
    });
    const update = vi.fn().mockResolvedValue({ id: "meso-1", state: "AWAITING_HANDOFF" });
    const roleFindMany = vi.fn().mockResolvedValue([
      {
        exerciseId: "bench",
        sessionIntent: "UPPER",
        role: "CORE_COMPOUND",
        exercise: { name: "Bench Press" },
      },
      {
        exerciseId: "row",
        sessionIntent: "UPPER",
        role: "ACCESSORY",
        exercise: { name: "Chest-Supported Row" },
      },
    ]);
    const constraintsFindUnique = vi.fn().mockResolvedValue({
      weeklySchedule: ["PUSH", "PULL", "LEGS", "PUSH", "PULL"],
      daysPerWeek: 5,
      splitType: "PPL",
    });
    const workoutFindMany = vi.fn().mockResolvedValue([
      {
        scheduledDate: new Date("2026-03-24T00:00:00.000Z"),
        completedAt: new Date("2026-03-24T01:00:00.000Z"),
        status: "COMPLETED",
        sessionIntent: "UPPER",
        selectionMode: "AUTO",
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 4,
              weekInBlock: 4,
              phase: "ACCUMULATION",
              blockType: "accumulation",
              isDeload: false,
              source: "computed",
            },
            sessionSlot: {
              slotId: "upper_a",
              intent: "UPPER",
              sequenceIndex: 0,
              source: "mesocycle_slot_sequence",
            },
            deloadDecision: {
              mode: "none",
              reason: [],
              reductionPercent: 0,
              appliedTo: "none",
            },
            lifecycleVolume: {
              source: "lifecycle",
            },
            readiness: {
              wasAutoregulated: false,
              signalAgeHours: 6,
              fatigueScoreOverall: 0.72,
              intensityScaling: {
                applied: false,
                exerciseIds: [],
                scaledUpCount: 0,
                scaledDownCount: 0,
              },
            },
            plannerDiagnosticsMode: "standard",
            exceptions: [],
          },
          runtimeEditReconciliation: {
            version: 1,
            lastReconciledAt: "2026-03-24T01:00:00.000Z",
            directives: {
              continuityAlias: "none",
              progressionAlias: "none",
              futureSessionGeneration: "ignore",
              futureSeedCarryForward: "ignore",
            },
            ops: [
              {
                kind: "add_exercise",
                source: "api_workouts_add_exercise",
                appliedAt: "2026-03-24T01:00:00.000Z",
                scope: "current_workout_only",
                facts: {
                  workoutExerciseId: "we-row-2",
                  exerciseId: "row",
                  orderIndex: 1,
                  section: "ACCESSORY",
                  setCount: 3,
                  prescriptionSource: "session_accessory_defaults",
                },
              },
            ],
          },
        },
        advancesSplit: true,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        exercises: [
          { id: "we-bench-2", exerciseId: "bench" },
          { id: "we-row-2", exerciseId: "row" },
        ],
      },
    ]);
    const readinessFindFirst = vi.fn().mockResolvedValue({
      timestamp: new Date("2026-03-24T06:00:00.000Z"),
      userId: "user-1",
      whoopRecovery: null,
      whoopStrain: null,
      whoopHrv: null,
      whoopSleepQuality: null,
      whoopSleepHours: null,
      subjectiveReadiness: 4,
      subjectiveMotivation: 4,
      subjectiveSoreness: {},
      subjectiveStress: 2,
      performanceRpeDeviation: 0,
      performanceStalls: 0,
      performanceCompliance: 1,
    });

    await enterMesocycleHandoffInTransaction(
      {
        mesocycle: {
          findUnique,
          update,
        },
        mesocycleExerciseRole: {
          findMany: roleFindMany,
        },
        constraints: {
          findUnique: constraintsFindUnique,
        },
        workout: {
          findMany: workoutFindMany,
        },
        readinessSignal: {
          findFirst: readinessFindFirst,
        },
      } as never,
      "meso-1"
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          handoffSummaryJson: expect.objectContaining({
            carryForwardRecommendations: [
              expect.objectContaining({
                exerciseId: "bench",
                recommendation: "keep",
                signalQuality: "medium",
                reasonCodes: ["required_anchor_continuity_fallback"],
              }),
              expect.objectContaining({
                exerciseId: "row",
                recommendation: "drop",
                signalQuality: "high",
                reasonCodes: ["accessory_drop_no_mesocycle_exposure"],
              }),
            ],
          }),
        }),
      })
    );
  });
});

describe("handoff draft persistence", () => {
  it("updates the mutable draft and returns the pending handoff record", async () => {
    const draft = buildRecommendedDraft();
    const findUnique = vi.fn().mockResolvedValue({
      id: "meso-1",
      state: "AWAITING_HANDOFF",
      mesoNumber: 1,
      focus: "Upper Hypertrophy",
      closedAt: new Date("2026-04-01T00:00:00.000Z"),
      handoffSummaryJson: buildHandoffSummaryJson(draft),
      nextSeedDraftJson: draft,
    });
    const update = vi.fn().mockResolvedValue({
      id: "meso-1",
      state: "AWAITING_HANDOFF",
      mesoNumber: 1,
      focus: "Upper Hypertrophy",
      closedAt: new Date("2026-04-01T00:00:00.000Z"),
      handoffSummaryJson: buildHandoffSummaryJson(draft),
      nextSeedDraftJson: {
        ...draft,
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
    });

    const result = await updateMesocycleHandoffDraftInTransaction(
      {
        mesocycle: {
          findUnique,
          update,
        },
      } as never,
      {
        mesocycleId: "meso-1",
        draft: {
          sourceMesocycleId: "meso-1",
          structure: {
            splitType: "UPPER_LOWER",
            sessionsPerWeek: 4,
            daysPerWeek: 4,
            sequenceMode: "ordered_flexible",
            slots: draft.structure.slots,
          },
          carryForwardSelections: [
            {
              exerciseId: "bench",
              exerciseName: "Bench Press",
              sessionIntent: "UPPER",
              role: "CORE_COMPOUND",
              action: "keep",
            },
            {
              exerciseId: "row",
              exerciseName: "Chest-Supported Row",
              sessionIntent: "UPPER",
              role: "ACCESSORY",
              action: "drop",
            },
          ],
        },
      }
    );

    expect(result.draft).toMatchObject({
      updatedAt: "2026-04-02T00:00:00.000Z",
    });
    expect(update).toHaveBeenCalledOnce();
  });

  it("accepts the edited draft, persists slot metadata, and only carries kept exercises forward", async () => {
    const recommendedDraft = buildRecommendedDraft();
    const editedDraft = {
      ...recommendedDraft,
      structure: {
        ...recommendedDraft.structure,
        splitType: "PPL" as const,
        sessionsPerWeek: 3,
        daysPerWeek: 3,
        slots: [
          { slotId: "ignore-1", intent: "PUSH" as const },
          { slotId: "ignore-2", intent: "PULL" as const },
          { slotId: "ignore-3", intent: "LEGS" as const },
        ],
      },
      carryForwardSelections: [
        { ...recommendedDraft.carryForwardSelections[0], action: "drop" as const },
        { ...recommendedDraft.carryForwardSelections[1], action: "drop" as const },
      ],
    };
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({
      context: {},
    });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      slotPlans: [
        {
          slotId: "push_a",
          intent: "PUSH",
          exercises: [
            { exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 },
            { exerciseId: "machine-press", role: "ACCESSORY", setCount: 3 },
          ],
        },
        {
          slotId: "pull_a",
          intent: "PULL",
          exercises: [{ exerciseId: "row", role: "ACCESSORY", setCount: 3 }],
        },
        {
          slotId: "legs_a",
          intent: "LEGS",
          exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 }],
        },
      ],
    });

    const mesocycleFindUnique = vi
      .fn()
      .mockResolvedValueOnce({
        id: "meso-1",
        macroCycleId: "macro-1",
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 5,
        focus: "Upper Hypertrophy",
        volumeTarget: "HIGH",
        intensityBias: "HYPERTROPHY",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        accumulationSessionsCompleted: 8,
        deloadSessionsCompleted: 1,
        blocks: [],
        macroCycle: { userId: "user-1" },
      })
      .mockResolvedValueOnce({
        id: "meso-1",
        state: "AWAITING_HANDOFF",
        handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
        nextSeedDraftJson: editedDraft,
        closedAt: new Date("2026-04-01T00:00:00.000Z"),
      });
    const mesocycleCreate = vi.fn().mockResolvedValue({
      id: "meso-2",
      state: "ACTIVE_ACCUMULATION",
      mesoNumber: 2,
    });
    const exerciseRoleCreateMany = vi.fn();
    const constraintsUpsert = vi.fn();
    const mesocycleUpdate = vi.fn();

    await prepareThenAcceptMesocycleHandoff(
      {
        mesocycle: {
          findUnique: mesocycleFindUnique,
          create: mesocycleCreate,
          update: mesocycleUpdate,
        },
        trainingBlock: {
          createMany: vi.fn(),
        },
        mesocycleExerciseRole: {
          createMany: exerciseRoleCreateMany,
        },
        constraints: {
          upsert: constraintsUpsert,
        },
      } as never,
    );

    expect(mesocycleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          splitType: "PPL",
          sessionsPerWeek: 3,
          daysPerWeek: 3,
          slotSequenceJson: {
            version: 1,
            source: "handoff_draft",
            sequenceMode: "ordered_flexible",
            slots: [
              {
                slotId: "push_a",
                intent: "PUSH",
                authoredSemantics: {
                  slotArchetype: "push_standard",
                  primaryLaneContract: null,
                  supportCoverageContract: null,
                  continuityScope: "slot",
                },
              },
              {
                slotId: "pull_a",
                intent: "PULL",
                authoredSemantics: {
                  slotArchetype: "pull_standard",
                  primaryLaneContract: null,
                  supportCoverageContract: null,
                  continuityScope: "slot",
                },
              },
              {
                slotId: "legs_a",
                intent: "LEGS",
                authoredSemantics: {
                  slotArchetype: "legs_standard",
                  primaryLaneContract: null,
                  supportCoverageContract: null,
                  continuityScope: "slot",
                },
              },
            ],
          },
          slotPlanSeedJson: {
            version: 1,
            source: "handoff_slot_plan_projection",
            slots: [
              {
                slotId: "push_a",
                exercises: [
                  { exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 },
                  { exerciseId: "machine-press", role: "ACCESSORY", setCount: 3 },
                ],
              },
              {
                slotId: "pull_a",
                exercises: [{ exerciseId: "row", role: "ACCESSORY", setCount: 3 }],
              },
              {
                slotId: "legs_a",
                exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 }],
              },
            ],
          },
        }),
      })
    );
    const createData = mesocycleCreate.mock.calls[0]?.[0]?.data as {
      slotSequenceJson: {
        slots: Array<{ slotId: string }>;
      };
      slotPlanSeedJson?: {
        slots: Array<{
          slotId: string;
          exercises: Array<Record<string, unknown>>;
        }>;
      };
    };
    expect(createData.slotPlanSeedJson?.slots.map((slot) => slot.slotId)).toEqual(
      createData.slotSequenceJson.slots.map((slot) => slot.slotId)
    );
    expect(createData.slotPlanSeedJson?.slots[0]).not.toHaveProperty("intent");
    expect(createData.slotPlanSeedJson?.slots[0]?.exercises[0]).not.toHaveProperty("exerciseName");
    expect(createData.slotPlanSeedJson?.slots[0]?.exercises[0]).not.toHaveProperty("name");
    expect(mocks.projectSuccessorSlotPlansFromSnapshot.mock.calls[0]?.[0]).not.toHaveProperty(
      "plannerOnlyPolicyOverride",
    );
    expect(exerciseRoleCreateMany).not.toHaveBeenCalled();
    expect(constraintsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          weeklySchedule: ["PUSH", "PULL", "LEGS"],
        }),
      })
    );
    expect(mesocycleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "meso-1" },
        data: expect.objectContaining({ state: "COMPLETED", isActive: false }),
      })
    );
  });

  it("keeps slot-plan projection outside the persistence transaction", async () => {
    const recommendedDraft = buildRecommendedDraft();
    mocks.loadPreloadedGenerationSnapshot.mockClear();
    mocks.projectSuccessorSlotPlansFromSnapshot.mockClear();
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({ context: {} });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      slotPlans: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 }],
        },
        {
          slotId: "lower_a",
          intent: "LOWER",
          exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 }],
        },
        {
          slotId: "upper_b",
          intent: "UPPER",
          exercises: [{ exerciseId: "row", role: "ACCESSORY", setCount: 3 }],
        },
        {
          slotId: "lower_b",
          intent: "LOWER",
          exercises: [{ exerciseId: "split-squat", role: "ACCESSORY", setCount: 3 }],
        },
      ],
    });

    const tx = {
      mesocycle: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            id: "meso-1",
            macroCycleId: "macro-1",
            mesoNumber: 1,
            startWeek: 0,
            durationWeeks: 5,
            focus: "Upper Hypertrophy",
            volumeTarget: "HIGH",
            intensityBias: "HYPERTROPHY",
            sessionsPerWeek: 4,
            daysPerWeek: 4,
            splitType: "UPPER_LOWER",
            accumulationSessionsCompleted: 8,
            deloadSessionsCompleted: 1,
            blocks: [],
            macroCycle: { userId: "user-1" },
          })
          .mockResolvedValueOnce({
            id: "meso-1",
            state: "AWAITING_HANDOFF",
            mesoNumber: 1,
            focus: "Upper Hypertrophy",
            closedAt: new Date("2026-04-01T00:00:00.000Z"),
            handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
            nextSeedDraftJson: recommendedDraft,
          }),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: "meso-1",
            state: "AWAITING_HANDOFF",
            mesoNumber: 1,
            focus: "Upper Hypertrophy",
            closedAt: new Date("2026-04-01T00:00:00.000Z"),
            handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
            nextSeedDraftJson: recommendedDraft,
            macroCycleId: "macro-1",
          })
          .mockResolvedValueOnce(null),
        create: vi.fn().mockResolvedValue({
          id: "meso-2",
          state: "ACTIVE_ACCUMULATION",
          mesoNumber: 2,
        }),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      trainingBlock: {
        createMany: vi.fn(),
      },
      mesocycleExerciseRole: {
        createMany: vi.fn(),
      },
      constraints: {
        upsert: vi.fn(),
      },
    };

    const prepared = await prepareMesocycleHandoffAcceptance({
      userId: "user-1",
      mesocycleId: "meso-1",
      reader: tx as never,
    });
    expect(mocks.loadPreloadedGenerationSnapshot).toHaveBeenCalledOnce();

    mocks.loadPreloadedGenerationSnapshot.mockClear();
    mocks.projectSuccessorSlotPlansFromSnapshot.mockClear();

    await acceptPreparedMesocycleHandoffInTransaction(tx as never, prepared);

    expect(mocks.loadPreloadedGenerationSnapshot).not.toHaveBeenCalled();
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).not.toHaveBeenCalled();
  });

  it("records legacy projection seed persistence only after the default transaction succeeds", async () => {
    mocks.loadPreloadedGenerationSnapshot.mockClear();
    mocks.projectSuccessorSlotPlansFromSnapshot.mockClear();
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({ context: {} });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      slotPlans: makeProjectedSlotPlans(),
    });
    const tx = makeAcceptanceTx();

    const prepared = await prepareMesocycleHandoffAcceptance({
      userId: "user-1",
      mesocycleId: "meso-1",
      reader: tx as never,
    });

    expect(prepared.seedPersistenceProvenance).toMatchObject({
      source: "legacy_projection_seed",
      dbWriteOccurred: false,
      seedSourceSelectedBeforeTransaction: true,
      persistedInsideExistingAcceptanceTransaction: false,
      fallback: { occurred: false },
      executableSeedTruth: {
        source: "slotPlanSeedJson",
        runtimeConsumedFields: ["exerciseId", "role", "setCount"],
      },
    });
    expect(prepared.seedPersistenceProvenance.source).not.toBe(
      "v2_materialized_seed"
    );

    const result = await acceptPreparedMesocycleHandoffWithProvenanceInTransaction(
      tx as never,
      prepared
    );

    expect(result.seedPersistenceProvenance).toMatchObject({
      source: "legacy_projection_seed",
      dbWriteOccurred: true,
      seedSourceSelectedBeforeTransaction: true,
      persistedInsideExistingAcceptanceTransaction: true,
      persistedMesocycleId: "meso-2",
      fallback: { occurred: false },
    });
  });

  it("continues on the legacy path when explicit V2 preparation is disabled", async () => {
    mocks.projectSuccessorSlotPlansFromSnapshot.mockClear();
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({ context: {} });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      slotPlans: makeProjectedSlotPlans(),
    });
    const buildDryRunReport = vi.fn();
    const tx = makeAcceptanceTx();

    const prepared = await prepareMesocycleHandoffAcceptance({
      userId: "user-1",
      mesocycleId: "meso-1",
      reader: tx as never,
      v2MaterializedSeedWrite: {
        enableV2MaterializedSeedWrite: false,
        dependencies: { buildDryRunReport },
      },
    });

    expect(prepared.seedPersistenceProvenance).toMatchObject({
      source: "legacy_projection_seed",
      dbWriteOccurred: false,
    });
    expect(buildDryRunReport).not.toHaveBeenCalled();
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).toHaveBeenCalledOnce();
  });

  it("fails closed before the transaction when explicit V2 opt-in is blocked", async () => {
    mocks.loadPreloadedGenerationSnapshot.mockClear();
    mocks.projectSuccessorSlotPlansFromSnapshot.mockClear();
    const tx = makeAcceptanceTx();
    const v2MaterializedSeedWrite = makeBlockedV2MaterializedSeedWrite();

    await expect(
      prepareMesocycleHandoffAcceptance({
        userId: "user-1",
        mesocycleId: "meso-1",
        reader: tx as never,
        v2MaterializedSeedWrite: v2MaterializedSeedWrite as never,
      })
    ).rejects.toMatchObject({
      seedPersistenceProvenance: {
        source: "v2_blocked_fail_closed",
        dbWriteOccurred: false,
        persistedInsideExistingAcceptanceTransaction: false,
        fallback: { occurred: false },
      },
    });

    await expect(
      prepareMesocycleHandoffAcceptance({
        userId: "user-1",
        mesocycleId: "meso-1",
        reader: makeAcceptanceTx() as never,
        v2MaterializedSeedWrite: makeBlockedV2MaterializedSeedWrite() as never,
      })
    ).rejects.toBeInstanceOf(MesocycleHandoffV2MaterializedSeedBlockedError);
    expect(tx.mesocycle.create).not.toHaveBeenCalled();
    expect(mocks.loadPreloadedGenerationSnapshot).not.toHaveBeenCalled();
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).not.toHaveBeenCalled();
  });

  it("carries ready V2 seed provenance into the existing acceptance transaction", async () => {
    mocks.loadPreloadedGenerationSnapshot.mockClear();
    mocks.projectSuccessorSlotPlansFromSnapshot.mockClear();
    const tx = makeAcceptanceTx();

    const prepared = await prepareMesocycleHandoffAcceptance({
      userId: "user-1",
      mesocycleId: "meso-1",
      reader: tx as never,
      v2MaterializedSeedWrite: makeReadyV2MaterializedSeedWrite() as never,
    });

    expect(prepared.seedPersistenceProvenance).toMatchObject({
      source: "v2_materialized_seed",
      dbWriteOccurred: false,
      seedSourceSelectedBeforeTransaction: true,
      persistedInsideExistingAcceptanceTransaction: false,
      fallback: { occurred: false },
    });
    expect(mocks.loadPreloadedGenerationSnapshot).not.toHaveBeenCalled();
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).not.toHaveBeenCalled();

    const result = await acceptPreparedMesocycleHandoffWithProvenanceInTransaction(
      tx as never,
      prepared
    );

    expect(result.seedPersistenceProvenance).toMatchObject({
      source: "v2_materialized_seed",
      dbWriteOccurred: true,
      seedSourceSelectedBeforeTransaction: true,
      persistedInsideExistingAcceptanceTransaction: true,
      persistedMesocycleId: "meso-2",
      fallback: { occurred: false },
      executableSeedTruth: {
        source: "slotPlanSeedJson",
        runtimeConsumedFields: ["exerciseId", "role", "setCount"],
      },
    });
    expect(tx.mesocycle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slotPlanSeedJson: expect.objectContaining({
            slots: expect.arrayContaining([
              expect.objectContaining({ slotId: "upper_a" }),
            ]),
          }),
        }),
      })
    );
  });

  it("prepares a read-only V2 accepted-seed probe from the real handoff slot sequence", async () => {
    mocks.loadPreloadedGenerationSnapshot.mockClear();
    mocks.projectSuccessorSlotPlansFromSnapshot.mockClear();
    const tx = makeAcceptanceTx();
    const v2Probe = makeV2AcceptedSeedPreparationProbeInput();

    const result = await prepareV2AcceptedSeedPreparationProbe({
      userId: "user-1",
      mesocycleId: "meso-1",
      reader: tx as never,
      v2Probe,
    });

    expect(result).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      wouldWriteTransaction: false,
      wouldCallLegacyProjection: false,
      wouldCallLegacyRepair: false,
      seedSerializer: "buildMesocycleSlotPlanSeed",
      context: {
        ownerLoaded: true,
        mesocycleLoaded: true,
        slotSequence: {
          source: "handoff_acceptance_preparation",
          slots: [
            { slotId: "upper_a", intent: "UPPER" },
            { slotId: "lower_a", intent: "LOWER" },
            { slotId: "upper_b", intent: "UPPER" },
            { slotId: "lower_b", intent: "LOWER" },
          ],
        },
        handoff: {
          sourceState: "AWAITING_HANDOFF",
          summaryLoaded: true,
          draftLoaded: true,
          acceptanceProjectionBuilt: true,
        },
      },
      gates: {
        basePlanValidation: {
          status: "pass",
          passed: true,
          blockerCount: 0,
        },
        materializerStatus: { status: "materialized", passed: true },
        seedShapeCompatibility: { passed: true, compatible: true },
        requiredLaneCoverage: { passed: true, slotCount: 4 },
        noRequiredBlockersRemain: { passed: true },
        promotionReadiness: {
          status: "eligible_for_guarded_write",
          eligibleForGuardedWrite: true,
          safeToPromoteToProductionWrite: false,
        },
      },
      projectionRepairBoundary: {
        legacyProjectionCalled: false,
        legacyRepairEngineCalled: false,
        supportFloorClosureCalled: false,
        weeklyObligationClosureCalled: false,
        lateSetBumpingCalled: false,
        capTrimCalled: false,
        repairAddedExercisesIntroduced: false,
        duplicateCleanupMutatedV2Output: false,
        dirtyCollateralCleanupMutatedV2Output: false,
      },
      seedSerializationBoundary: {
        serializer: "buildMesocycleSlotPlanSeed",
        handcraftedSlotPlanSeedJson: false,
        executableRowFields: ["exerciseId", "role", "setCount"],
        previewExposedAsSlotPlanSeedJson: false,
        serializerProbe: {
          attempted: true,
          status: "passed",
          slotCount: 4,
          exerciseCount: 4,
          blockers: [],
        },
      },
      acceptancePreparation: {
        helperOptIn: "disabled",
        helperStatus: "disabled",
        wouldWriteTransaction: false,
        persistenceProvenanceIsSeparate: true,
        dbWriteOccurred: false,
      },
      provenance: {
        source: "v2_disabled",
        dbWriteOccurred: false,
      },
    });
    expect(result).not.toHaveProperty("slotPlanSeedJson");
    expect(v2Probe.dependencies.buildSlotPlanSeed).toHaveBeenCalledOnce();
    expect(tx.mesocycle.create).not.toHaveBeenCalled();
    expect(tx.mesocycle.update).not.toHaveBeenCalled();
    expect(tx.mesocycle.updateMany).not.toHaveBeenCalled();
    expect(mocks.loadPreloadedGenerationSnapshot).not.toHaveBeenCalled();
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).not.toHaveBeenCalled();
  });

  it("reports blocked V2 preparation as fail-closed probe readiness without legacy fallback success", async () => {
    mocks.loadPreloadedGenerationSnapshot.mockClear();
    mocks.projectSuccessorSlotPlansFromSnapshot.mockClear();
    const tx = makeAcceptanceTx();
    const v2Probe = makeV2AcceptedSeedPreparationProbeInput({ blocked: true });

    const result = await prepareV2AcceptedSeedPreparationProbe({
      userId: "user-1",
      mesocycleId: "meso-1",
      reader: tx as never,
      v2Probe,
    });

    expect(result).toMatchObject({
      readOnly: true,
      wouldWriteTransaction: false,
      gates: {
        basePlanValidation: {
          status: "fail",
          passed: false,
          blockerCount: 1,
        },
        materializerStatus: { status: "blocked", passed: false },
        seedShapeCompatibility: { passed: false, compatible: false },
        requiredLaneCoverage: { passed: false },
        noRequiredBlockersRemain: { passed: false },
        promotionReadiness: {
          status: "blocked",
          eligibleForGuardedWrite: false,
          safeToPromoteToProductionWrite: false,
        },
        fallbackPolicy: {
          v2BlockedFailsClosed: true,
          silentlyFallsBackToLegacyProjection: false,
        },
      },
      seedSerializationBoundary: {
        handcraftedSlotPlanSeedJson: false,
        serializerProbe: {
          attempted: false,
          status: "not_attempted",
          blockers: ["slot_count_mismatch"],
        },
      },
      acceptancePreparation: {
        helperOptIn: "disabled",
        wouldWriteTransaction: false,
        dbWriteOccurred: false,
      },
      provenance: {
        source: "v2_disabled",
        dbWriteOccurred: false,
      },
      simulated_opt_in_readiness: {
        status: "blocked",
        readinessWouldBeEligibleForGuardedWrite: false,
        safeToPromoteToProductionWrite: false,
      },
    });
    expect(result.gates.fallbackPolicy.allowedFallbackLabels).toEqual([
      "legacy_projection_seed",
      "fallback_existing_projection",
    ]);
    expect(result.provenance.source).not.toBe("v2_materialized_seed");
    expect(result).not.toHaveProperty("slotPlanSeedJson");
    expect(v2Probe.dependencies.buildSlotPlanSeed).not.toHaveBeenCalled();
    expect(tx.mesocycle.create).not.toHaveBeenCalled();
    expect(tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.loadPreloadedGenerationSnapshot).not.toHaveBeenCalled();
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).not.toHaveBeenCalled();
  });

  it("compares legacy and V2 accepted-seed preparation without writing either result", async () => {
    mocks.loadPreloadedGenerationSnapshot.mockClear();
    mocks.projectSuccessorSlotPlansFromSnapshot.mockClear();
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({ context: {} });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      slotPlans: makeProjectedSlotPlans(),
    });
    const tx = makeAcceptanceTx();
    const v2Probe = makeV2AcceptedSeedPreparationProbeInput({
      slotPlans: makeV2ComparisonSlotPlans(),
      inventory: makeComparisonInventory(),
    });

    const result = await prepareV2AcceptedSeedPreparationCompare({
      userId: "user-1",
      mesocycleId: "meso-1",
      reader: tx as never,
      v2Probe,
    });

    expect(result).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      wouldWriteTransaction: false,
      consumedByProduction: false,
      legacyPreparationAvailable: true,
      v2PreparationAvailable: true,
      v2WouldCallLegacyProjection: false,
      v2WouldCallLegacyRepair: false,
      seedSerializer: "buildMesocycleSlotPlanSeed",
      comparedPreparationAvailability: {
        legacy: {
          available: true,
          sourceLabel: "legacy_projection_seed",
          wouldCallLegacyProjection: true,
          wouldCallLegacyRepair: true,
          dbWriteOccurred: false,
        },
        v2: {
          available: true,
          sourceLabel: "v2_disabled",
          wouldCallLegacyProjection: false,
          wouldCallLegacyRepair: false,
          dbWriteOccurred: false,
          failClosed: false,
        },
      },
      seedShapeComparison: {
        slotCount: {
          legacy: 4,
          v2: 4,
          classification: "v2_preserves",
        },
        slotIdsInOrder: {
          legacy: ["upper_a", "lower_a", "upper_b", "lower_b"],
          v2: ["upper_a", "lower_a", "upper_b", "lower_b"],
          sameOrder: true,
          classification: "v2_preserves",
        },
        executableFieldShape: {
          legacy: ["exerciseId", "role", "setCount"],
          v2: ["exerciseId", "role", "setCount"],
          classification: "v2_preserves",
        },
        seedSerializerIdentity: {
          legacy: "buildMesocycleSlotPlanSeed",
          v2: "buildMesocycleSlotPlanSeed",
          classification: "v2_preserves",
        },
      },
      repairLegacyDependencyComparison: {
        rows: expect.arrayContaining([
          expect.objectContaining({
            item: "support_floor_closure",
            legacyPreparationPathMayUse: true,
            v2PreparationPathUses: false,
            v2AvoidsDependency: true,
            classification: "v2_improves",
          }),
          expect.objectContaining({
            item: "forbidden_cleanup_mutation",
            v2PreparationPathUses: false,
          }),
        ]),
      },
      provenanceNoWriteBoundary: {
        legacySourceLabel: "legacy_projection_seed",
        v2SourceLabel: "v2_disabled",
        transactionStatus: "no_write",
        dbWriteOccurred: false,
        v2ProvenanceCanBeMistakenForPersistedSuccess: false,
        runtimeReplayContract: {
          unchanged: true,
          runtimeConsumedFields: ["exerciseId", "role", "setCount"],
          runtimeIgnoresPlannerMetadata: true,
        },
      },
      seedSerializationBoundary: {
        serializer: "buildMesocycleSlotPlanSeed",
        handcraftedSlotPlanSeedJson: false,
        executableRowFields: ["exerciseId", "role", "setCount"],
        acceptedPlannerIntentRuntimeInert: true,
        runtimeConsumesPlannerMetadata: false,
        previewExposedAsSlotPlanSeedJson: false,
      },
    });
    expect(result.seedShapeComparison.totalSetCount).toEqual({
      legacy: 14,
      v2: 42,
      classification: "unclear",
    });
    expect(result.seedShapeComparison.exerciseCountBySlot).toContainEqual({
      slotId: "lower_a",
      legacy: 1,
      v2: 3,
      classification: "unclear",
    });
    expect(result.exerciseIdentityComparison.rows).toContainEqual(
      expect.objectContaining({
        slotId: "lower_a",
        relationship: "v2_added",
        v2AddedExerciseIds: ["calf-raise", "leg-curl"],
      }),
    );
    expect(result.classLaneCoverageComparison.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "side_delt_direct",
          legacy: false,
          v2: true,
          classification: "v2_improves",
        }),
        expect.objectContaining({
          item: "biceps_direct_support",
          legacy: true,
          v2: true,
          classification: "v2_preserves",
        }),
        expect.objectContaining({
          item: "triceps_direct_support",
          legacy: true,
          v2: true,
          classification: "v2_preserves",
        }),
        expect.objectContaining({
          item: "hamstrings_hinge_curl",
          legacy: false,
          v2: true,
          classification: "v2_improves",
        }),
        expect.objectContaining({
          item: "calves_direct_work",
          legacy: false,
          v2: true,
          classification: "v2_improves",
        }),
      ]),
    );
    expect(result.provenanceNoWriteBoundary.v2SourceLabel).not.toBe(
      "v2_materialized_seed",
    );
    expect(result).not.toHaveProperty("slotPlanSeedJson");
    expect(v2Probe.dependencies.buildSlotPlanSeed).toHaveBeenCalledTimes(2);
    expect(mocks.loadPreloadedGenerationSnapshot).toHaveBeenCalledOnce();
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).toHaveBeenCalledOnce();
    expect(tx.mesocycle.create).not.toHaveBeenCalled();
    expect(tx.mesocycle.update).not.toHaveBeenCalled();
    expect(tx.mesocycle.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when V2 comparison readiness is blocked and does not report persisted V2 success", async () => {
    mocks.loadPreloadedGenerationSnapshot.mockClear();
    mocks.projectSuccessorSlotPlansFromSnapshot.mockClear();
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({ context: {} });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      slotPlans: makeProjectedSlotPlans(),
    });
    const tx = makeAcceptanceTx();
    const v2Probe = makeV2AcceptedSeedPreparationProbeInput({ blocked: true });

    const result = await prepareV2AcceptedSeedPreparationCompare({
      userId: "user-1",
      mesocycleId: "meso-1",
      reader: tx as never,
      v2Probe,
    });

    expect(result).toMatchObject({
      readOnly: true,
      wouldWriteTransaction: false,
      consumedByProduction: false,
      legacyPreparationAvailable: true,
      v2PreparationAvailable: false,
      comparedPreparationAvailability: {
        v2: {
          available: false,
          failClosed: true,
          sourceLabel: "v2_disabled",
          dbWriteOccurred: false,
        },
      },
      provenanceNoWriteBoundary: {
        v2SourceLabel: "v2_disabled",
        baseValidationStatus: "fail",
        transactionStatus: "no_write",
        dbWriteOccurred: false,
        v2ProvenanceCanBeMistakenForPersistedSuccess: false,
      },
    });
    expect(result.comparedPreparationAvailability.v2.blockers).toEqual(
      expect.arrayContaining([
        "required_materialization:upper_a:required_lane_coverage_incomplete",
        "seed_serializer:slot_count_mismatch",
      ]),
    );
    expect(result.provenanceNoWriteBoundary.v2SourceLabel).not.toBe(
      "v2_materialized_seed",
    );
    expect(result).not.toHaveProperty("slotPlanSeedJson");
    expect(v2Probe.dependencies.buildSlotPlanSeed).not.toHaveBeenCalled();
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).toHaveBeenCalledOnce();
    expect(tx.mesocycle.create).not.toHaveBeenCalled();
    expect(tx.mesocycle.update).not.toHaveBeenCalled();
    expect(tx.mesocycle.updateMany).not.toHaveBeenCalled();
  });

  it("leaves default acceptance on the legacy projection path after running the compare", async () => {
    mocks.loadPreloadedGenerationSnapshot.mockClear();
    mocks.projectSuccessorSlotPlansFromSnapshot.mockClear();
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({ context: {} });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      slotPlans: makeProjectedSlotPlans(),
    });

    await prepareV2AcceptedSeedPreparationCompare({
      userId: "user-1",
      mesocycleId: "meso-1",
      reader: makeAcceptanceTx() as never,
      v2Probe: makeV2AcceptedSeedPreparationProbeInput({
        slotPlans: makeV2ComparisonSlotPlans(),
      }),
    });

    mocks.loadPreloadedGenerationSnapshot.mockClear();
    mocks.projectSuccessorSlotPlansFromSnapshot.mockClear();
    const prepared = await prepareMesocycleHandoffAcceptance({
      userId: "user-1",
      mesocycleId: "meso-1",
      reader: makeAcceptanceTx() as never,
    });

    expect(prepared.seedPersistenceProvenance.source).toBe(
      "legacy_projection_seed",
    );
    expect(prepared.seedPersistenceProvenance.dbWriteOccurred).toBe(false);
    expect(mocks.loadPreloadedGenerationSnapshot).toHaveBeenCalledOnce();
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).toHaveBeenCalledOnce();
  });

  it("does not report persisted V2 success when the transaction fails", async () => {
    const tx = makeAcceptanceTx({
      create: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const prepared = await prepareMesocycleHandoffAcceptance({
      userId: "user-1",
      mesocycleId: "meso-1",
      reader: tx as never,
      v2MaterializedSeedWrite: makeReadyV2MaterializedSeedWrite() as never,
    });

    await expect(
      acceptPreparedMesocycleHandoffWithProvenanceInTransaction(
        tx as never,
        prepared
      )
    ).rejects.toThrow("timeout");
    expect(prepared.seedPersistenceProvenance).toMatchObject({
      source: "v2_materialized_seed",
      dbWriteOccurred: false,
      persistedInsideExistingAcceptanceTransaction: false,
    });
  });

  it("is idempotent when retry sees an already-active successor", async () => {
    const recommendedDraft = buildRecommendedDraft();
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({ context: {} });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      slotPlans: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 }],
        },
        {
          slotId: "lower_a",
          intent: "LOWER",
          exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 }],
        },
        {
          slotId: "upper_b",
          intent: "UPPER",
          exercises: [{ exerciseId: "row", role: "ACCESSORY", setCount: 3 }],
        },
        {
          slotId: "lower_b",
          intent: "LOWER",
          exercises: [{ exerciseId: "split-squat", role: "ACCESSORY", setCount: 3 }],
        },
      ],
    });
    const existingSuccessor = {
      id: "meso-2",
      state: "ACTIVE_ACCUMULATION",
      mesoNumber: 2,
      isActive: true,
    };
    const mesocycleCreate = vi.fn();
    const mesocycleUpdate = vi.fn();
    const tx = {
      mesocycle: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            id: "meso-1",
            macroCycleId: "macro-1",
            mesoNumber: 1,
            startWeek: 0,
            durationWeeks: 5,
            focus: "Upper Hypertrophy",
            volumeTarget: "HIGH",
            intensityBias: "HYPERTROPHY",
            sessionsPerWeek: 4,
            daysPerWeek: 4,
            splitType: "UPPER_LOWER",
            accumulationSessionsCompleted: 8,
            deloadSessionsCompleted: 1,
            blocks: [],
            macroCycle: { userId: "user-1" },
          })
          .mockResolvedValueOnce({
            id: "meso-1",
            state: "AWAITING_HANDOFF",
            mesoNumber: 1,
            focus: "Upper Hypertrophy",
            closedAt: new Date("2026-04-01T00:00:00.000Z"),
            handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
            nextSeedDraftJson: recommendedDraft,
          }),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: "meso-1",
            state: "AWAITING_HANDOFF",
            mesoNumber: 1,
            focus: "Upper Hypertrophy",
            closedAt: new Date("2026-04-01T00:00:00.000Z"),
            handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
            nextSeedDraftJson: recommendedDraft,
            macroCycleId: "macro-1",
          })
          .mockResolvedValueOnce(existingSuccessor),
        create: mesocycleCreate,
        update: mesocycleUpdate,
        updateMany: vi.fn(),
      },
    };

    const prepared = await prepareMesocycleHandoffAcceptance({
      userId: "user-1",
      mesocycleId: "meso-1",
      reader: tx as never,
    });

    await expect(
      acceptPreparedMesocycleHandoffInTransaction(tx as never, prepared)
    ).resolves.toBe(existingSuccessor);
    expect(mesocycleCreate).not.toHaveBeenCalled();
    expect(mesocycleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "meso-1" },
        data: { state: "COMPLETED", isActive: false },
      })
    );
  });

  it("does not mark the source completed when successor creation fails", async () => {
    const recommendedDraft = buildRecommendedDraft();
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({ context: {} });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      slotPlans: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 }],
        },
        {
          slotId: "lower_a",
          intent: "LOWER",
          exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 }],
        },
        {
          slotId: "upper_b",
          intent: "UPPER",
          exercises: [{ exerciseId: "row", role: "ACCESSORY", setCount: 3 }],
        },
        {
          slotId: "lower_b",
          intent: "LOWER",
          exercises: [{ exerciseId: "split-squat", role: "ACCESSORY", setCount: 3 }],
        },
      ],
    });
    const mesocycleUpdate = vi.fn();
    const tx = {
      mesocycle: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            id: "meso-1",
            macroCycleId: "macro-1",
            mesoNumber: 1,
            startWeek: 0,
            durationWeeks: 5,
            focus: "Upper Hypertrophy",
            volumeTarget: "HIGH",
            intensityBias: "HYPERTROPHY",
            sessionsPerWeek: 4,
            daysPerWeek: 4,
            splitType: "UPPER_LOWER",
            accumulationSessionsCompleted: 8,
            deloadSessionsCompleted: 1,
            blocks: [],
            macroCycle: { userId: "user-1" },
          })
          .mockResolvedValueOnce({
            id: "meso-1",
            state: "AWAITING_HANDOFF",
            mesoNumber: 1,
            focus: "Upper Hypertrophy",
            closedAt: new Date("2026-04-01T00:00:00.000Z"),
            handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
            nextSeedDraftJson: recommendedDraft,
          }),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: "meso-1",
            state: "AWAITING_HANDOFF",
            mesoNumber: 1,
            focus: "Upper Hypertrophy",
            closedAt: new Date("2026-04-01T00:00:00.000Z"),
            handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
            nextSeedDraftJson: recommendedDraft,
            macroCycleId: "macro-1",
          })
          .mockResolvedValueOnce(null),
        create: vi.fn().mockRejectedValue(new Error("timeout")),
        update: mesocycleUpdate,
        updateMany: vi.fn(),
      },
      trainingBlock: {
        createMany: vi.fn(),
      },
      mesocycleExerciseRole: {
        createMany: vi.fn(),
      },
      constraints: {
        upsert: vi.fn(),
      },
    };

    const prepared = await prepareMesocycleHandoffAcceptance({
      userId: "user-1",
      mesocycleId: "meso-1",
      reader: tx as never,
    });

    await expect(acceptPreparedMesocycleHandoffInTransaction(tx as never, prepared)).rejects.toThrow(
      "timeout"
    );
    expect(mesocycleUpdate).not.toHaveBeenCalled();
  });

  it("refreshes stale pending handoff artifacts before accept sanitizes the stored draft", async () => {
    const staleDraft = {
      ...buildRecommendedDraft(),
      structure: {
        splitType: "PPL" as const,
        sessionsPerWeek: 3,
        daysPerWeek: 3,
        sequenceMode: "ordered_flexible" as const,
        slots: [
          { slotId: "push_a", intent: "PUSH" as const },
          { slotId: "pull_a", intent: "PULL" as const },
          { slotId: "legs_a", intent: "LEGS" as const },
        ],
      },
      carryForwardSelections: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          sessionIntent: "PUSH" as const,
          role: "CORE_COMPOUND" as const,
          action: "keep" as const,
        },
        {
          exerciseId: "row",
          exerciseName: "Chest-Supported Row",
          sessionIntent: "PULL" as const,
          role: "ACCESSORY" as const,
          action: "rotate" as const,
        },
      ],
    };
    const staleSummary = {
      ...buildHandoffSummaryJson(staleDraft),
      recommendedDesign: undefined,
    };
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({
      context: {},
    });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      slotPlans: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 }],
        },
        {
          slotId: "lower_a",
          intent: "LOWER",
          exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 }],
        },
        {
          slotId: "upper_b",
          intent: "UPPER",
          exercises: [{ exerciseId: "row", role: "ACCESSORY", setCount: 3 }],
        },
        {
          slotId: "lower_b",
          intent: "LOWER",
          exercises: [{ exerciseId: "split-squat", role: "ACCESSORY", setCount: 3 }],
        },
      ],
    });

    const mesocycleFindUnique = vi
      .fn()
      .mockResolvedValueOnce({
        id: "meso-1",
        macroCycleId: "macro-1",
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 5,
        focus: "Upper Hypertrophy",
        volumeTarget: "HIGH",
        intensityBias: "HYPERTROPHY",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        accumulationSessionsCompleted: 8,
        deloadSessionsCompleted: 1,
        slotSequenceJson: {
          version: 1,
          source: "handoff_draft",
          sequenceMode: "ordered_flexible",
          slots: [
            { slotId: "upper_a", intent: "UPPER" },
            { slotId: "lower_a", intent: "LOWER" },
            { slotId: "upper_b", intent: "UPPER" },
            { slotId: "lower_b", intent: "LOWER" },
          ],
        },
        blocks: [],
        macroCycle: { userId: "user-1" },
      })
      .mockResolvedValueOnce({
        id: "meso-1",
        state: "AWAITING_HANDOFF",
        mesoNumber: 1,
        focus: "Upper Hypertrophy",
        closedAt: new Date("2026-04-01T00:00:00.000Z"),
        handoffSummaryJson: staleSummary,
        nextSeedDraftJson: staleDraft,
      })
      .mockResolvedValueOnce({
        id: "meso-1",
        macroCycleId: "macro-1",
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 5,
        focus: "Upper Hypertrophy",
        volumeTarget: "HIGH",
        intensityBias: "HYPERTROPHY",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        accumulationSessionsCompleted: 8,
        deloadSessionsCompleted: 1,
        slotSequenceJson: {
          version: 1,
          source: "handoff_draft",
          sequenceMode: "ordered_flexible",
          slots: [
            { slotId: "upper_a", intent: "UPPER" },
            { slotId: "lower_a", intent: "LOWER" },
            { slotId: "upper_b", intent: "UPPER" },
            { slotId: "lower_b", intent: "LOWER" },
          ],
        },
        blocks: [],
        macroCycle: { userId: "user-1" },
      });
    const mesocycleUpdate = vi
      .fn()
      .mockResolvedValueOnce({
        id: "meso-1",
        state: "AWAITING_HANDOFF",
        mesoNumber: 1,
        focus: "Upper Hypertrophy",
        closedAt: new Date("2026-04-01T00:00:00.000Z"),
        handoffSummaryJson: {
          ...staleSummary,
          carryForwardRecommendations: [
            {
              exerciseId: "bench",
              exerciseName: "Bench Press",
              sessionIntent: "UPPER",
              role: "CORE_COMPOUND",
              recommendation: "keep",
              signalQuality: "high",
              reasonCodes: ["required_anchor_continuity_supported_by_receipt_slot"],
            },
            {
              exerciseId: "row",
              exerciseName: "Chest-Supported Row",
              sessionIntent: "UPPER",
              role: "ACCESSORY",
              recommendation: "rotate",
              signalQuality: "medium",
              reasonCodes: ["carry_forward_rotation_ambiguous_slot_target"],
            },
          ],
          recommendedNextSeed: buildRecommendedDraft(),
          recommendedDesign: buildRecommendedDesign(),
        },
        nextSeedDraftJson: buildRecommendedDraft(),
      })
      .mockResolvedValueOnce({ id: "meso-1", state: "COMPLETED" });
    const mesocycleCreate = vi.fn().mockResolvedValue({
      id: "meso-2",
      state: "ACTIVE_ACCUMULATION",
      mesoNumber: 2,
    });

    await expect(
      prepareThenAcceptMesocycleHandoff(
        {
          mesocycle: {
            findUnique: mesocycleFindUnique,
            update: mesocycleUpdate,
            create: mesocycleCreate,
          },
          mesocycleExerciseRole: {
            findMany: vi.fn().mockResolvedValue([
              {
                exerciseId: "bench",
                sessionIntent: "UPPER",
                role: "CORE_COMPOUND",
                exercise: { name: "Bench Press" },
              },
              {
                exerciseId: "row",
                sessionIntent: "UPPER",
                role: "ACCESSORY",
                exercise: { name: "Chest-Supported Row" },
              },
            ]),
            createMany: vi.fn(),
          },
          constraints: {
            findUnique: vi.fn().mockResolvedValue({
              weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
              daysPerWeek: 4,
              splitType: "UPPER_LOWER",
            }),
            upsert: vi.fn(),
          },
          workout: {
            findMany: vi.fn().mockResolvedValue([
              {
                scheduledDate: new Date("2026-03-24T00:00:00.000Z"),
                completedAt: new Date("2026-03-24T01:00:00.000Z"),
                status: "COMPLETED",
                sessionIntent: "UPPER",
                selectionMode: "AUTO",
                selectionMetadata: {
                  sessionDecisionReceipt: {
                    version: 1,
                    cycleContext: {
                      weekInMeso: 4,
                      weekInBlock: 4,
                      phase: "ACCUMULATION",
                      blockType: "accumulation",
                      isDeload: false,
                      source: "computed",
                    },
                    sessionSlot: {
                      slotId: "upper_a",
                      intent: "UPPER",
                      sequenceIndex: 0,
                      source: "mesocycle_slot_sequence",
                    },
                    deloadDecision: {
                      mode: "none",
                      reason: [],
                      reductionPercent: 0,
                      appliedTo: "none",
                    },
                    lifecycleVolume: {
                      source: "lifecycle",
                    },
                    readiness: {
                      wasAutoregulated: false,
                      signalAgeHours: 6,
                      fatigueScoreOverall: 0.72,
                      intensityScaling: {
                        applied: false,
                        exerciseIds: [],
                        scaledUpCount: 0,
                        scaledDownCount: 0,
                      },
                    },
                    plannerDiagnosticsMode: "standard",
                    exceptions: [],
                  },
                },
                advancesSplit: true,
                mesocyclePhaseSnapshot: "ACCUMULATION",
                exercises: [
                  { id: "we-bench-3", exerciseId: "bench" },
                  { id: "we-row-3", exerciseId: "row" },
                ],
              },
            ]),
          },
          readinessSignal: {
            findFirst: vi.fn().mockResolvedValue({
              timestamp: new Date("2026-03-24T06:00:00.000Z"),
              userId: "user-1",
              whoopRecovery: null,
              whoopStrain: null,
              whoopHrv: null,
              whoopSleepQuality: null,
              whoopSleepHours: null,
              subjectiveReadiness: 4,
              subjectiveMotivation: 4,
              subjectiveSoreness: {},
              subjectiveStress: 2,
              performanceRpeDeviation: 0,
              performanceStalls: 0,
              performanceCompliance: 1,
            }),
          },
          trainingBlock: {
            createMany: vi.fn(),
          },
        } as never,
      )
    ).resolves.toMatchObject({
      id: "meso-2",
      state: "ACTIVE_ACCUMULATION",
      mesoNumber: 2,
    });

    expect(mesocycleUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          handoffSummaryJson: expect.objectContaining({
            recommendedDesign: expect.any(Object),
            recommendedNextSeed: expect.objectContaining({
              structure: expect.objectContaining({
                splitType: "UPPER_LOWER",
              }),
            }),
          }),
          nextSeedDraftJson: expect.objectContaining({
            structure: expect.objectContaining({
              splitType: "UPPER_LOWER",
            }),
            carryForwardSelections: [
              expect.objectContaining({
                exerciseId: "bench",
                sessionIntent: "UPPER",
              }),
              expect.objectContaining({
                exerciseId: "row",
                sessionIntent: "UPPER",
              }),
            ],
          }),
        }),
      })
    );
  });

  it("keeps BODY_PART accept behavior unchanged when slot-plan projection is unsupported", async () => {
    const recommendedDraft = buildRecommendedDraft();
    const bodyPartDraft = {
      ...recommendedDraft,
      structure: {
        ...recommendedDraft.structure,
        splitType: "CUSTOM" as const,
        sessionsPerWeek: 1,
        daysPerWeek: 1,
        slots: [{ slotId: "body_part_a", intent: "BODY_PART" as const }],
      },
      carryForwardSelections: recommendedDraft.carryForwardSelections.map((selection) => ({
        ...selection,
        action: "drop" as const,
      })),
    };
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({
      context: {},
    });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      error:
        "MESOCYCLE_HANDOFF_SLOT_PLAN_UNSUPPORTED: BODY_PART slot body_part_a requires target muscles for deterministic projection.",
    });

    const mesocycleFindUnique = vi
      .fn()
      .mockResolvedValueOnce({
        id: "meso-1",
        macroCycleId: "macro-1",
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 5,
        focus: "Upper Hypertrophy",
        volumeTarget: "HIGH",
        intensityBias: "HYPERTROPHY",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        accumulationSessionsCompleted: 8,
        deloadSessionsCompleted: 1,
        blocks: [],
        macroCycle: { userId: "user-1" },
      })
      .mockResolvedValueOnce({
        id: "meso-1",
        state: "AWAITING_HANDOFF",
        handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
        nextSeedDraftJson: bodyPartDraft,
        closedAt: new Date("2026-04-01T00:00:00.000Z"),
      });
    const mesocycleCreate = vi.fn().mockResolvedValue({
      id: "meso-2",
      state: "ACTIVE_ACCUMULATION",
      mesoNumber: 2,
    });

    await expect(
      prepareThenAcceptMesocycleHandoff(
        {
          mesocycle: {
            findUnique: mesocycleFindUnique,
            create: mesocycleCreate,
            update: vi.fn(),
          },
          trainingBlock: {
            createMany: vi.fn(),
          },
          mesocycleExerciseRole: {
            createMany: vi.fn(),
          },
          constraints: {
            upsert: vi.fn(),
          },
        } as never,
      )
    ).resolves.toMatchObject({
      id: "meso-2",
      state: "ACTIVE_ACCUMULATION",
      mesoNumber: 2,
    });

    expect(mesocycleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slotSequenceJson: {
            version: 1,
            source: "handoff_draft",
            sequenceMode: "ordered_flexible",
            slots: [
              {
                slotId: "body_part_a",
                intent: "BODY_PART",
                authoredSemantics: {
                  slotArchetype: "body_part_standard",
                  primaryLaneContract: null,
                  supportCoverageContract: null,
                  continuityScope: "slot",
                },
              },
            ],
          },
        }),
      })
    );
    const createData = mesocycleCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(createData).not.toHaveProperty("slotPlanSeedJson");
  });

  it("rejects acceptance when projection reports unresolved blocking protected coverage", async () => {
    const recommendedDraft = buildRecommendedDraft();
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({
      context: {},
    });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      error: "MESOCYCLE_HANDOFF_SLOT_PLAN_PROTECTED_COVERAGE_UNSATISFIED:Side Delts",
      slotPlans: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 }],
        },
        {
          slotId: "lower_a",
          intent: "LOWER",
          exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 }],
        },
        {
          slotId: "upper_b",
          intent: "UPPER",
          exercises: [{ exerciseId: "row", role: "ACCESSORY", setCount: 3 }],
        },
        {
          slotId: "lower_b",
          intent: "LOWER",
          exercises: [{ exerciseId: "split-squat", role: "ACCESSORY", setCount: 3 }],
        },
      ],
    });

    const mesocycleFindUnique = vi
      .fn()
      .mockResolvedValueOnce({
        id: "meso-1",
        macroCycleId: "macro-1",
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 5,
        focus: "Upper Hypertrophy",
        volumeTarget: "HIGH",
        intensityBias: "HYPERTROPHY",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        accumulationSessionsCompleted: 8,
        deloadSessionsCompleted: 1,
        blocks: [],
        macroCycle: { userId: "user-1" },
      })
      .mockResolvedValueOnce({
        id: "meso-1",
        state: "AWAITING_HANDOFF",
        handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
        nextSeedDraftJson: recommendedDraft,
        closedAt: new Date("2026-04-01T00:00:00.000Z"),
      });
    const mesocycleCreate = vi.fn().mockResolvedValue({
      id: "meso-2",
      state: "ACTIVE_ACCUMULATION",
      mesoNumber: 2,
    });

    await expect(
      prepareThenAcceptMesocycleHandoff(
        {
          mesocycle: {
            findUnique: mesocycleFindUnique,
            create: mesocycleCreate,
            update: vi.fn(),
          },
          trainingBlock: {
            createMany: vi.fn(),
          },
          mesocycleExerciseRole: {
            createMany: vi.fn(),
          },
          constraints: {
            upsert: vi.fn(),
          },
        } as never,
      )
    ).rejects.toThrow("MESOCYCLE_HANDOFF_SLOT_PLAN_PROTECTED_COVERAGE_UNSATISFIED:Side Delts");

    expect(mesocycleCreate).not.toHaveBeenCalled();
  });

  it("rejects acceptance when a kept selection no longer matches the edited split", async () => {
    const recommendedDraft = buildRecommendedDraft();
    const incompatibleDraft = {
      ...recommendedDraft,
      structure: {
        ...recommendedDraft.structure,
        splitType: "PPL" as const,
        sessionsPerWeek: 3,
        daysPerWeek: 3,
        slots: [
          { slotId: "ignore-1", intent: "PUSH" as const },
          { slotId: "ignore-2", intent: "PULL" as const },
          { slotId: "ignore-3", intent: "LEGS" as const },
        ],
      },
    };

    const mesocycleFindUnique = vi
      .fn()
      .mockResolvedValueOnce({
        id: "meso-1",
        macroCycleId: "macro-1",
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 5,
        focus: "Upper Hypertrophy",
        volumeTarget: "HIGH",
        intensityBias: "HYPERTROPHY",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        accumulationSessionsCompleted: 8,
        deloadSessionsCompleted: 1,
        blocks: [],
        macroCycle: { userId: "user-1" },
      })
      .mockResolvedValueOnce({
        id: "meso-1",
        state: "AWAITING_HANDOFF",
        handoffSummaryJson: buildHandoffSummaryJson(recommendedDraft),
        nextSeedDraftJson: incompatibleDraft,
        closedAt: new Date("2026-04-01T00:00:00.000Z"),
      });

    await expect(
      prepareThenAcceptMesocycleHandoff(
        {
          mesocycle: {
            findUnique: mesocycleFindUnique,
            create: vi.fn(),
            update: vi.fn(),
          },
          trainingBlock: {
            createMany: vi.fn(),
          },
          mesocycleExerciseRole: {
            createMany: vi.fn(),
          },
          constraints: {
            upsert: vi.fn(),
          },
        } as never,
      )
    ).rejects.toThrow("MESOCYCLE_HANDOFF_KEEP_SELECTION_CONFLICT:");
  });
});
