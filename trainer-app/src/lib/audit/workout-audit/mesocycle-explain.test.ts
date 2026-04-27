import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findDistributionGuardActionInvariantViolations,
  findFinalSlotForbiddenPrescriptionViolations,
} from "./planning-reality-invariants.test-helper";

const mocks = vi.hoisted(() => {
  const mesocycleFindFirst = vi.fn();
  const constraintsFindUnique = vi.fn();
  const workoutFindMany = vi.fn();
  const mesocycleExerciseRoleFindMany = vi.fn();
  const loadActiveMesocycle = vi.fn();
  const loadHandoffSourceMesocycle = vi.fn();
  const readMesocycleHandoffSummary = vi.fn();
  const toHandoffProjectionSource = vi.fn();
  const materializeHandoffArtifacts = vi.fn();
  const projectSuccessorMesocycle = vi.fn();
  const projectSuccessorSlotPlansFromSnapshot = vi.fn();
  const buildMesocycleSlotPlanSeed = vi.fn();
  const loadPreloadedGenerationSnapshot = vi.fn();
  const buildMappedGenerationContextFromSnapshot = vi.fn();
  const generateProjectedSession = vi.fn();
  const appendWorkoutHistoryEntryToMappedContext = vi.fn();
  const buildProjectedWorkoutHistoryEntry = vi.fn();
  const listWorkoutExerciseNames = vi.fn();
  const getLatestReadinessSignalForReader = vi.fn();
  const readSessionSlotSnapshot = vi.fn();
  const resolvePersistedOrReconstructedSessionAuditSnapshot = vi.fn();
  const buildSessionAuditMutationSummary = vi.fn();
  const resolveMesocycleSlotContract = vi.fn();

  return {
    mesocycleFindFirst,
    constraintsFindUnique,
    workoutFindMany,
    mesocycleExerciseRoleFindMany,
    loadActiveMesocycle,
    loadHandoffSourceMesocycle,
    readMesocycleHandoffSummary,
    toHandoffProjectionSource,
    materializeHandoffArtifacts,
    projectSuccessorMesocycle,
    projectSuccessorSlotPlansFromSnapshot,
    buildMesocycleSlotPlanSeed,
    loadPreloadedGenerationSnapshot,
    buildMappedGenerationContextFromSnapshot,
    generateProjectedSession,
    appendWorkoutHistoryEntryToMappedContext,
    buildProjectedWorkoutHistoryEntry,
    listWorkoutExerciseNames,
    getLatestReadinessSignalForReader,
    readSessionSlotSnapshot,
    resolvePersistedOrReconstructedSessionAuditSnapshot,
    buildSessionAuditMutationSummary,
    resolveMesocycleSlotContract,
    prisma: {
      mesocycle: {
        findFirst: (...args: unknown[]) => mesocycleFindFirst(...args),
      },
      constraints: {
        findUnique: (...args: unknown[]) => constraintsFindUnique(...args),
      },
      workout: {
        findMany: (...args: unknown[]) => workoutFindMany(...args),
      },
      mesocycleExerciseRole: {
        findMany: (...args: unknown[]) =>
          mesocycleExerciseRoleFindMany(...args),
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) =>
    mocks.loadActiveMesocycle(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff", () => ({
  loadHandoffSourceMesocycle: (...args: unknown[]) =>
    mocks.loadHandoffSourceMesocycle(...args),
  readMesocycleHandoffSummary: (...args: unknown[]) =>
    mocks.readMesocycleHandoffSummary(...args),
  toHandoffProjectionSource: (...args: unknown[]) =>
    mocks.toHandoffProjectionSource(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff-artifacts", () => ({
  materializeHandoffArtifacts: (...args: unknown[]) =>
    mocks.materializeHandoffArtifacts(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff-projection", () => ({
  projectSuccessorMesocycle: (...args: unknown[]) =>
    mocks.projectSuccessorMesocycle(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff-slot-plan-projection", () => ({
  projectSuccessorSlotPlansFromSnapshot: (...args: unknown[]) =>
    mocks.projectSuccessorSlotPlansFromSnapshot(...args),
  buildMesocycleSlotPlanSeed: (...args: unknown[]) =>
    mocks.buildMesocycleSlotPlanSeed(...args),
}));

vi.mock("@/lib/api/projected-week-volume-shared", () => ({
  loadPreloadedGenerationSnapshot: (...args: unknown[]) =>
    mocks.loadPreloadedGenerationSnapshot(...args),
  buildMappedGenerationContextFromSnapshot: (...args: unknown[]) =>
    mocks.buildMappedGenerationContextFromSnapshot(...args),
  generateProjectedSession: (...args: unknown[]) =>
    mocks.generateProjectedSession(...args),
  appendWorkoutHistoryEntryToMappedContext: (...args: unknown[]) =>
    mocks.appendWorkoutHistoryEntryToMappedContext(...args),
  buildProjectedWorkoutHistoryEntry: (...args: unknown[]) =>
    mocks.buildProjectedWorkoutHistoryEntry(...args),
  listWorkoutExerciseNames: (...args: unknown[]) =>
    mocks.listWorkoutExerciseNames(...args),
}));

vi.mock("@/lib/api/readiness", () => ({
  getLatestReadinessSignalForReader: (...args: unknown[]) =>
    mocks.getLatestReadinessSignalForReader(...args),
}));

vi.mock("@/lib/evidence/session-decision-receipt", () => ({
  readSessionSlotSnapshot: (...args: unknown[]) =>
    mocks.readSessionSlotSnapshot(...args),
}));

vi.mock("@/lib/evidence/session-audit-snapshot", () => ({
  resolvePersistedOrReconstructedSessionAuditSnapshot: (...args: unknown[]) =>
    mocks.resolvePersistedOrReconstructedSessionAuditSnapshot(...args),
  buildSessionAuditMutationSummary: (...args: unknown[]) =>
    mocks.buildSessionAuditMutationSummary(...args),
}));

vi.mock("@/lib/api/mesocycle-slot-contract", () => ({
  resolveMesocycleSlotContract: (...args: unknown[]) =>
    mocks.resolveMesocycleSlotContract(...args),
}));

import { buildMesocycleExplainAuditPayload } from "./mesocycle-explain";

describe("buildMesocycleExplainAuditPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const mesocycle = {
      id: "meso-1",
      macroCycleId: "macro-1",
      mesoNumber: 2,
      startWeek: 5,
      durationWeeks: 5,
      focus: "Hypertrophy",
      volumeTarget: "MEDIUM",
      intensityBias: "MODERATE",
      isActive: true,
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      splitType: "UPPER_LOWER",
      slotSequenceJson: { version: 1, slots: [] },
      slotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [
              { exerciseId: "ex-1", role: "CORE_COMPOUND", setCount: 4 },
            ],
          },
        ],
      },
      handoffSummaryJson: { version: 1 },
      nextSeedDraftJson: null,
      closedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      blocks: [
        {
          id: "block-1",
          mesocycleId: "meso-1",
          blockNumber: 1,
          blockType: "ACCUMULATION",
          startWeek: 5,
          durationWeeks: 5,
          volumeTarget: "MEDIUM",
          intensityBias: "MODERATE",
          adaptationType: "HYPERTROPHY",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      macroCycle: {
        userId: "user-1",
      },
    };

    mocks.mesocycleFindFirst.mockResolvedValue(mesocycle);
    mocks.constraintsFindUnique.mockResolvedValue({
      weeklySchedule: ["UPPER", "LOWER"],
    });
    mocks.workoutFindMany.mockResolvedValue([
      {
        id: "workout-1",
        scheduledDate: new Date("2026-02-01T00:00:00.000Z"),
        status: "COMPLETED",
        revision: 2,
        advancesSplit: true,
        selectionMode: "INTENT",
        sessionIntent: "upper",
        selectionMetadata: {},
        mesocycleId: "meso-1",
        mesocycleWeekSnapshot: 1,
        mesoSessionSnapshot: 1,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        exercises: [
          {
            id: "we-1",
            exerciseId: "ex-1",
            orderIndex: 0,
            section: "main",
            isMainLift: true,
            exercise: {
              name: "Incline Dumbbell Press",
              aliases: [],
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }],
            },
            sets: [],
          },
          {
            id: "we-2",
            exerciseId: "ex-2",
            orderIndex: 1,
            section: "accessory",
            isMainLift: false,
            exercise: {
              name: "Cable Fly",
              aliases: [],
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }],
            },
            sets: [],
          },
        ],
      },
    ]);
    mocks.loadHandoffSourceMesocycle.mockResolvedValue(mesocycle);
    mocks.readMesocycleHandoffSummary.mockReturnValue({
      recommendedDesign: {
        version: 1,
        designedAt: "2026-02-01T00:00:00.000Z",
        sourceMesocycleId: "meso-1",
        profile: {
          focus: "Hypertrophy",
          durationWeeks: 5,
          volumeTarget: "MEDIUM",
          intensityBias: "MODERATE",
          blocks: [
            {
              blockNumber: 1,
              blockType: "ACCUMULATION",
              durationWeeks: 5,
              volumeTarget: "MEDIUM",
              intensityBias: "MODERATE",
              adaptationType: "HYPERTROPHY",
            },
          ],
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
                slotArchetype: "upper_primary",
                continuityScope: "slot",
                primaryLaneContract: null,
                supportCoverageContract: null,
              },
            },
          ],
        },
        carryForward: {
          decisions: [
            {
              exerciseId: "ex-1",
              role: "CORE_COMPOUND",
              priorIntent: "UPPER",
              action: "keep",
              targetIntent: "UPPER",
              targetSlotId: "upper_a",
              signalQuality: "high",
              reasonCodes: ["carry_forward_keep"],
            },
          ],
        },
        startingPoint: {
          volumeEntry: "conservative",
          baselineSource: "accumulation_preferred",
          allowNonDeloadFallback: true,
        },
        explainability: {
          profileReasonCodes: ["profile_reason"],
          profileSignalQuality: "high",
          structureReasonCodes: ["structure_reason"],
          structureSignalQuality: "high",
          startingPointReasonCodes: ["starting_point_reason"],
          startingPointSignalQuality: "high",
        },
      },
      recommendedNextSeed: {
        version: 1,
        sourceMesocycleId: "meso-1",
        createdAt: "2026-02-01T00:00:00.000Z",
        structure: {
          splitType: "UPPER_LOWER",
          sessionsPerWeek: 4,
          daysPerWeek: 4,
          sequenceMode: "ordered_flexible",
          slots: [{ slotId: "upper_a", intent: "UPPER" }],
        },
        startingPoint: {
          volumeEntry: "conservative",
          baselineSource: "accumulation_preferred",
          allowNonDeloadFallback: true,
        },
        carryForwardSelections: [],
      },
      carryForwardRecommendations: [
        {
          exerciseId: "ex-1",
          exerciseName: "Incline Dumbbell Press",
          sessionIntent: "UPPER",
          role: "CORE_COMPOUND",
          recommendation: "keep",
          signalQuality: "high",
          reasonCodes: ["carry_forward_keep"],
        },
      ],
    });
    mocks.toHandoffProjectionSource.mockImplementation(
      (value: unknown) => value,
    );
    mocks.materializeHandoffArtifacts.mockImplementation(() => {
      throw new Error(
        "should not rematerialize when persisted handoff summary is present",
      );
    });
    mocks.projectSuccessorMesocycle.mockReturnValue({
      mesocycle: {
        macroCycleId: "macro-1",
        mesoNumber: 3,
        startWeek: 10,
        durationWeeks: 5,
        focus: "Hypertrophy",
        volumeTarget: "MEDIUM",
        intensityBias: "MODERATE",
        splitType: "UPPER_LOWER",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        weeklySchedule: ["UPPER"],
        slotSequence: {
          slots: [
            {
              slotId: "upper_a",
              intent: "UPPER",
              sequenceIndex: 0,
              authoredSemantics: {
                slotArchetype: "upper_primary",
                continuityScope: "slot",
                primaryLaneContract: null,
                supportCoverageContract: null,
              },
            },
          ],
        },
      },
      trainingBlocks: [
        {
          blockNumber: 1,
          blockType: "ACCUMULATION",
          startWeek: 10,
          durationWeeks: 5,
          volumeTarget: "MEDIUM",
          intensityBias: "MODERATE",
          adaptationType: "HYPERTROPHY",
        },
      ],
    });
    mocks.projectSuccessorSlotPlansFromSnapshot.mockReturnValue({
      slotPlans: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          exercises: [
            { exerciseId: "ex-1", role: "CORE_COMPOUND", setCount: 3 },
          ],
        },
      ],
      diagnostics: {
        protectedCoverage: {
          repairedSlotIds: [],
        },
        weeklyObligations: {
          plan: {
            muscles: {},
          },
          slotEvaluations: [
            {
              slotId: "upper_a",
              muscle: "Chest",
              minEffectiveSets: 4,
              projectedEffectiveSets: 3,
              shortfall: 1,
              zeroContribution: false,
            },
          ],
          zeroContributionSlots: [],
          weeklyHardMuscleTotals: {
            Chest: 3,
          },
        },
        duplicateExerciseReuse: [
          {
            exerciseId: "ex-1",
            name: "Incline Dumbbell Press",
            repeatedInSlotId: "upper_a",
            previousSlotIds: ["upper_b"],
            role: "main",
            hasCompatibleAlternative: false,
            reason: "main_lift_continuity_allowed",
          },
        ],
        programQuality: {
          constraintPriority: {
            P0: "weekly_obligations_slot_identity",
            P1: "movement_pattern_coverage",
            P2: "per_exercise_efficiency",
            P3: "stimulus_diversity",
            P4: "duplicate_penalties",
            P5: "isolation_completeness",
          },
          penaltyModel: {
            type: "additive",
            monotonic: true,
          },
          appliedDiagnostics: [
            {
              priority: "P2",
              constraint: "per_exercise_efficiency",
              penalty: 0,
              slotId: "upper_a",
              exerciseId: "ex-1",
              name: "Incline Dumbbell Press",
              muscle: "Chest",
              reason: "redistribution_blocked_stacking_allowed",
              blockReason: "no_compatible_exercise",
              details: {
                fromSetCount: 5,
                redistributionScope: "added_alternative",
              },
            },
            {
              priority: "P5",
              constraint: "isolation_completeness",
              penalty: 0,
              slotId: "upper_a",
              exerciseId: "ex-3",
              name: "Cable Lateral Raise",
              muscle: "Side Delts",
              reason: "injected_direct_isolation_for_deficit",
              details: {
                projectedEffectiveSets: 1,
                threshold: 2,
              },
            },
          ],
          evaluation: {
            totalPenalty: 5,
            constraintCounts: {
              per_exercise_efficiency: 1,
              stimulus_diversity: 1,
              cross_slot_duplicate: 1,
              weekly_pattern_balance: 1,
            },
            diagnostics: [
              {
                priority: "P2",
                constraint: "per_exercise_efficiency",
                penalty: 1.25,
                slotId: "upper_a",
                exerciseId: "ex-1",
                name: "Incline Dumbbell Press",
                muscle: "Chest",
                reason: "soft_cap_exceeded_higher_priority_or_capacity_bound",
                details: {
                  setCount: 5,
                  softCap: 4,
                  hardCap: 5,
                },
              },
              {
                priority: "P3",
                constraint: "stimulus_diversity",
                penalty: 1,
                muscle: "Chest",
                pattern: "push",
                reason: "single_pattern_share_exceeded",
                details: {
                  muscleSets: 10,
                  patternSets: 8,
                  share: 0.8,
                  maxShare: 0.7,
                },
              },
              {
                priority: "P4",
                constraint: "cross_slot_duplicate",
                penalty: 0.5,
                slotId: "upper_a",
                exerciseId: "ex-1",
                name: "Incline Dumbbell Press",
                reason: "main_lift_continuity_allowed",
                details: {
                  previousSlotIds: ["upper_b"],
                  role: "main",
                  hasCompatibleAlternative: false,
                },
              },
              {
                priority: "P1",
                constraint: "weekly_pattern_balance",
                penalty: 2,
                pattern: "hinge",
                reason: "lower_hinge_share_exceeded",
                details: {
                  hingeSets: 7,
                  lowerPatternSets: 10,
                  share: 0.7,
                  maxShare: 0.6,
                },
              },
            ],
          },
        },
        planningReality: {
          label: "weekly demand / slot allocation diagnostics",
          readOnly: true,
          affectsScoringOrGeneration: false,
          summary: {
            planningShape: "mixed_upstream_plus_repair_shaped",
            explicitWeeklyDemandMuscles: 4,
            inferredDemandMuscles: 3,
            slotsWithExplicitWeeklyDemand: 1,
            slotsWithOnlyLocalOrInferredSemantics: 0,
            materialRepairCount: 1,
            majorRepairCount: 0,
            highExerciseConcentrationCount: 1,
            warningCodes: ["EXERCISE_CONCENTRATION_HIGH"],
          },
          weeklyMuscleDemand: [
            {
              muscle: "Chest",
              targetTier: "A_PRIMARY",
              targetKind: "hard",
              targetStatus: "hard",
              targetRange: null,
              preferredTarget: 10,
              mev: 10,
              mav: 16,
              explicitUpstream: true,
              inferredDownstream: false,
              source: ["weekly_obligation_plan:getWeeklyVolumeTarget(week=1)"],
            },
          ],
          slotDemandAllocation: [],
          shadowWeeklyDemand: [
            {
              muscle: "Chest",
              targetTier: "A_PRIMARY",
              targetStatus: "hard",
              minEffectiveSets: 10,
              preferredEffectiveSets: 10,
              maxEffectiveSets: 16,
              desiredExposureCount: 1,
              priority: "primary",
              source: ["weekly_obligation_plan:getWeeklyVolumeTarget(week=1)"],
              rationale: [
                "A primary driver has an explicit Week 1 weekly obligation before slot composition.",
              ],
            },
          ],
          shadowSlotDemandAllocation: [
            {
              slotId: "upper_a",
              slotIndex: 0,
              slotArchetype: "upper_horizontal_balanced",
              intent: "upper",
              allocatedMuscles: [
                {
                  muscle: "Chest",
                  role: "primary",
                  targetStatus: "hard",
                  minEffectiveSets: 4,
                  preferredEffectiveSets: 4,
                  maxEffectiveSets: 16,
                  allocationReason: [
                    "weekly_obligation_allocated_to_compatible_slot",
                  ],
                },
              ],
            },
          ],
          initialSlotComposition: [
            {
              slotId: "upper_a",
              slotIndex: 0,
              intent: "upper",
              exerciseCount: 1,
              totalSets: 6,
              projectedEffectiveStimulusByMuscle: {
                Chest: 6,
              },
              exercises: [
                {
                  exerciseId: "ex-1",
                  exerciseName: "Incline Dumbbell Press",
                  role: "main",
                  setCount: 6,
                  primaryMuscles: ["Chest"],
                  movementPatterns: ["horizontal_push"],
                  effectiveStimulusByMuscle: {
                    Chest: 6,
                  },
                },
              ],
            },
          ],
          finalSlotPlan: [
            {
              slotId: "upper_a",
              slotIndex: 0,
              intent: "upper",
              exerciseCount: 2,
              totalSets: 8,
              projectedEffectiveStimulusByMuscle: {
                Chest: 6,
                "Side Delts": 2,
              },
              exercises: [
                {
                  exerciseId: "ex-1",
                  exerciseName: "Incline Dumbbell Press",
                  role: "main",
                  setCount: 5,
                  primaryMuscles: ["Chest"],
                  movementPatterns: ["horizontal_push"],
                  effectiveStimulusByMuscle: {
                    Chest: 6,
                  },
                },
                {
                  exerciseId: "ex-3",
                  exerciseName: "Cable Lateral Raise",
                  role: "accessory",
                  setCount: 3,
                  primaryMuscles: ["Side Delts"],
                  movementPatterns: ["isolation"],
                  effectiveStimulusByMuscle: {
                    "Side Delts": 2,
                  },
                },
              ],
            },
          ],
          allocationVsInitialDelta: [
            {
              slotId: "upper_a",
              slotIndex: 0,
              comparison: "allocation_vs_initial",
              responsibilityLoad: "clear",
              underAllocatedMuscles: [
                {
                  muscle: "Chest",
                  role: "primary",
                  targetStatus: "hard",
                  expectedEffectiveSets: 10,
                  actualEffectiveSets: 6,
                  shortfall: 4,
                },
              ],
              unallocatedStimulusMuscles: [],
              notes: ["planner-only dry-run leaves hard Chest demand unresolved"],
            },
          ],
          allocationVsFinalDelta: [],
          repairMaterialityAfterShadowAllocation: [
            {
              repairMechanism: "support_floor_closure",
              materiality: "major",
              muscle: "Side Delts",
              slotId: "upper_a",
              exerciseId: "ex-3",
              exerciseName: "Cable Lateral Raise",
              action: "added",
              effectiveStimulusAdded: 2,
              effectiveStimulusDelta: 2,
              rawSetsAdded: 3,
              rawSetDelta: 3,
              changedExerciseIdentity: true,
              changedSlotShapeMaterially: true,
              behaviorClass: "program_shaping",
              source: "support_floor_closure",
              rationale: "support floor closed after planner-only selection",
              likelyAvoidableWithShadowAllocation: true,
              shadowAllocationBasis: "slot_owned_muscle_before_selection",
              shadowRationale: ["repair_would_be_needed_here"],
            },
          ],
          shadowRepairSummary: {
            materialRepairCount: 1,
            majorRepairCount: 1,
            likelyAvoidableMaterialRepairCount: 1,
            remainingMaterialRepairCount: 0,
            likelyAvoidableMajorRepairCount: 1,
            remainingMajorRepairCount: 0,
            likelyAvoidableByMuscle: { "Side Delts": 1 },
            remainingByMuscle: {},
          },
          suspiciousRepairsNotEligibleForPromotion: [],
          promotionCandidates: [],
          slotPrescriptionIntents: [
            {
              version: 1,
              slotId: "upper_a",
              slotIndex: 0,
              intent: "upper",
              slotArchetype: "upper_primary",
              musclePrescriptions: [
                {
                  muscle: "Chest",
                  role: "primary",
                  targetStatus: "hard",
                  demandType: "direct_required",
                  desiredEffectiveSets: 4,
                  minEffectiveSets: 4,
                  maxEffectiveSets: 16,
                  allowedPatterns: ["horizontal_push", "vertical_push"],
                  allowedExerciseClasses: ["press"],
                  forbiddenPatterns: [],
                  forbiddenExerciseClasses: [],
                  collateralLimits: [
                    { muscle: "Front Delts", maxAddedEffectiveSets: 2 },
                  ],
                  reasons: ["weekly_obligation_allocated_to_compatible_slot"],
                },
              ],
              movementLanePrescriptions: [
                {
                  lane: "press",
                  required: true,
                  preferredPatterns: ["horizontal_push"],
                  fallbackPatterns: ["vertical_push"],
                  maxSamePatternCount: 2,
                },
              ],
              setBudget: {
                minTotalSets: 7,
                preferredTotalSets: 10,
                maxTotalSets: 25,
                maxSetsPerMain: 5,
                maxSetsPerAccessory: 4,
                maxDirectIsolationExercises: 2,
              },
              diversityBudget: {
                maxExerciseShareByMuscle: 0.5,
                maxPatternShareByMuscle: 0.7,
                maxDuplicateIsolationVariantsByMuscle: 1,
                maxDuplicateResistanceProfiles: 1,
              },
              fatigueBudget: {
                systemic: "moderate",
                axial: "low",
                collateralMaxByMuscle: {
                  "Front Delts": 2,
                },
              },
              diagnostic: {
                priorRepairsPrevented: [
                  "upper_a:Chest:direct_required:slot_preselection_demand",
                ],
                priorRepairsStillRepairOwned: [],
                blockedRepairs: [],
              },
            },
          ],
          setDistributionIntents: [
            {
              version: 1,
              slotId: "upper_a",
              slotIndex: 0,
              intent: "upper",
              slotArchetype: "upper_primary",
              musclePolicies: [
                {
                  muscle: "Chest",
                  role: "primary",
                  targetStatus: "hard",
                  demandType: "direct_required",
                  preferredEffectiveSets: 4,
                  minEffectiveSets: 4,
                  maxEffectiveSets: 16,
                  maxSingleExerciseShare: 0.5,
                  maxSinglePatternShare: 0.7,
                  maxSetsPerExercise: 5,
                  maxDirectExercises: 2,
                  maxDuplicateExerciseClasses: 1,
                  preferredDistribution: "two_exercise_split",
                  whenAtLimit: "prefer_alternative",
                },
              ],
              slotBudget: {
                preferredTotalSets: 10,
                maxTotalSets: 25,
                maxMainLifts: 2,
                maxAccessories: 5,
                maxDirectIsolationExercises: 2,
              },
              evidence: {
                concentrationRows: [
                  "upper_a:Incline Dumbbell Press:Chest:57.1%",
                ],
                capCleanupRows: [],
                repairRowsStillRepairOwned: [],
              },
              readOnly: true,
              affectsScoringOrGeneration: false,
            },
          ],
          distributionGuardActions: [],
          preselectionFeasibility: [],
          preselectionDistributionPolicyByWeek: {
            mesocycleId: "meso-1",
            source: "diagnostic_shadow_planner",
            readOnly: true,
            affectsScoringOrGeneration: false,
            limitations: [
              "weeks_2_to_4_unprojected",
              "missing_weekly_demand_curve",
              "missing_accumulation_progression_policy",
              "missing_per_week_slot_distribution",
              "missing_fatigue_carryover_model",
              "deload_distribution_not_projected",
              "missing_deload_identity_preservation_policy",
              "missing_deload_set_reduction_projection",
            ],
            limitationCatalog: {
              L1: "week_1_evidence_only",
              L2: "diagnostic_shadow_policy_not_behavior",
            },
            evidenceCatalog: {
              E1: "upper_a:Chest:hard:direct_required",
              E2: "upper_a:Incline Dumbbell Press:Chest:57.1%",
            },
            affectsCatalog: {
              A1: {
                volumeProgression: true,
                exerciseContinuity: true,
                setDistribution: true,
                fatigueManagement: false,
                deloadPreservation: true,
                runtimeAdaptation: false,
              },
            },
            weeks: [
              {
                week: 1,
                phase: "accumulation",
                projectionStatus: "projected_from_current_week_evidence",
                weekScope: "week_1_only",
                slots: [
                  {
                    slotId: "upper_a",
                    slotArchetype: "upper_primary",
                    muscleDistributions: [
                      {
                        muscle: "Chest",
                        targetStatus: "hard",
                        role: "primary",
                        demandType: "direct_required",
                        targetEffectiveSets: 4,
                        minEffectiveSets: 4,
                        maxEffectiveSets: 16,
                        requiredExerciseClasses: ["press"],
                        maxSingleExerciseShare: 0.5,
                        maxSinglePatternShare: 0.7,
                        preferredSetSplit: "two_distinct_exercises",
                        duplicatePolicy: "discourage_if_alternative_exists",
                        unresolvedBehavior: "allow_repair_safety_net",
                        affectsRef: "A1",
                        evidenceRefs: ["E1", "E2"],
                        limitationRefs: ["L1", "L2"],
                      },
                    ],
                  },
                ],
                weekLevelWarnings: [
                  "EXERCISE_CONCENTRATION_HIGH:upper_a:Incline Dumbbell Press",
                ],
              },
              {
                week: 2,
                phase: "accumulation",
                projectionStatus: "not_projected_missing_weekly_demand_curve",
                weekScope: "accumulation_weeks",
                slots: [],
                weekLevelWarnings: ["weeks_2_to_4_unprojected"],
              },
              {
                week: 3,
                phase: "accumulation",
                projectionStatus: "not_projected_missing_accumulation_policy",
                weekScope: "accumulation_weeks",
                slots: [],
                weekLevelWarnings: ["missing_accumulation_progression_policy"],
              },
              {
                week: 4,
                phase: "accumulation",
                projectionStatus: "not_projected_missing_accumulation_policy",
                weekScope: "accumulation_weeks",
                slots: [],
                weekLevelWarnings: ["missing_per_week_slot_distribution"],
              },
              {
                week: 5,
                phase: "deload",
                projectionStatus: "not_projected_missing_deload_policy",
                weekScope: "deload_week",
                slots: [],
                weekLevelWarnings: ["deload_distribution_not_projected"],
              },
            ],
            candidateBehaviorSlices: [
              {
                candidate: "chest_upper_slot_distinct_exercise_distribution",
                weekScope: "accumulation_weeks",
                expectedBenefit:
                  "Chest is under target and needs distinct upper-slot distribution once weeks are projected.",
                risk: "Not immediate behavior without week-by-week projection.",
                prereqs: [
                  "inventory/class visibility for distinct chest press/fly options",
                  "week-by-week Chest demand",
                  "duplicate continuity justification",
                ],
                recommendation: "best_future_behavior",
              },
              {
                candidate: "hamstrings_weekly_overdelivery_control",
                weekScope: "accumulation_weeks",
                expectedBenefit: "Can control overdelivery later.",
                risk: "Hamstrings are already high.",
                prereqs: ["week-by-week Hamstrings demand"],
                recommendation: "not_first",
              },
              {
                candidate: "side_delt_second_slot_support",
                weekScope: "accumulation_weeks",
                expectedBenefit: "Keeps second-slot support visible.",
                risk: "Avoid OHP/lateral raise spam.",
                prereqs: ["per-week Side Delts support demand"],
                recommendation: "diagnostic_only",
              },
              {
                candidate: "duplicate_main_lift_suppression",
                weekScope: "whole_mesocycle",
                expectedBenefit: "Reduces repeated anchor fatigue.",
                risk: "Needs persisted duplicate justification model.",
                prereqs: ["persisted duplicate justification model"],
                recommendation: "not_first",
              },
              {
                candidate: "calf_duplicate_suppression",
                weekScope: "accumulation_weeks",
                expectedBenefit: "Reduces duplicate calf-isolation noise.",
                risk: "Low architecture leverage.",
                prereqs: ["per-week Calves support demand"],
                recommendation: "later_cleanup",
              },
            ],
            recommendedNextStep: "add_weekly_demand_curve_diagnostic",
          },
          slotDemandAllocationByWeek: {
            mesocycleId: "meso-1",
            source: "diagnostic_shadow_planner",
            readOnly: true,
            affectsScoringOrGeneration: false,
            weeks: [
              {
                week: 1,
                phase: "entry",
                projectionStatus: "allocated_from_current_week_evidence",
                slots: [
                  {
                    slotId: "upper_a",
                    slotIndex: 0,
                    slotArchetype: "upper_primary",
                    intent: "upper",
                    allocatedMuscles: [
                      {
                        muscle: "Chest",
                        role: "primary",
                        targetStatus: "hard",
                        minEffectiveSets: 4,
                        preferredEffectiveSets: 4,
                        maxEffectiveSets: 16,
                        weekScope: "week_1_only",
                        allocationConfidence: "high",
                        allocationReason: [
                          "weekly_obligation_allocated_to_compatible_slot",
                        ],
                        limitations: [
                          "week_1_current_projection_evidence_only",
                        ],
                      },
                    ],
                    slotLevelWarnings: [],
                  },
                ],
                weekLevelWarnings: [
                  "week_1_current_projection_evidence_only",
                ],
              },
              {
                week: 2,
                phase: "accumulation",
                projectionStatus: "not_allocated_missing_weekly_projection",
                slots: [],
                weekLevelWarnings: ["missing_per_week_slot_composition"],
              },
              {
                week: 5,
                phase: "deload",
                projectionStatus: "not_allocated_missing_deload_policy",
                slots: [],
                weekLevelWarnings: ["deload_slot_allocation_unprojected"],
              },
            ],
            crossWeekAllocationWarnings: [
              {
                code: "WEEKLY_SLOT_ALLOCATION_POLICY_MISSING",
                evidence: ["missing_per_week_slot_distribution"],
                severity: "info",
              },
            ],
          },
          accumulationWeekProjection: {
            mesocycleId: "meso-1",
            source: "diagnostic_shadow_planner",
            readOnly: true,
            affectsScoringOrGeneration: false,
            projectionBasis: {
              sourceWeek: 1,
              method: "repeat_week_1_final_shape",
              limitations: [
                "does_not_apply_true_progression_policy",
                "does_not_project_deload_identity_or_set_reduction",
              ],
            },
            weeks: [
              {
                week: 2,
                phase: "accumulation",
                projectionStatus: "partially_projected_missing_progression",
                projectedMuscles: [
                  {
                    muscle: "Chest",
                    targetStatus: "hard",
                    projectedEffectiveSets: 7,
                    preferredEffectiveSets: 10,
                    minEffectiveSets: 10,
                    maxEffectiveSets: 16,
                    status: "below",
                    trend: "persistent_under_target",
                    evidence: ["week1_final=7:preferred=10"],
                    limitations: ["repeated_week_1_final_shape_only"],
                  },
                ],
                projectedSlotRisks: [
                  {
                    slotId: "upper_a",
                    risk: "duplicate_exercise_reuse",
                    severity: "warning",
                    evidence: ["Incline Dumbbell Press"],
                  },
                ],
                weekLevelWarnings: [
                  "missing_true_accumulation_progression_policy",
                ],
              },
            ],
            crossWeekWarnings: [
              {
                code: "CHEST_UNDER_TARGET_ACROSS_ACCUMULATION",
                muscle: "Chest",
                evidence: ["week1_final=7:preferred=10"],
                severity: "warning",
              },
              {
                code: "DELOAD_PRESERVATION_STILL_UNPROJECTED",
                evidence: ["missing_deload_identity_preservation_policy"],
                severity: "warning",
              },
            ],
            candidateBehaviorReadiness: [
              {
                candidate: "chest_upper_slot_distinct_exercise_distribution",
                readiness: "ready_for_bounded_trial",
                reason: "Chest remains under target.",
                requiredGuardrails: [
                  "bounded_to_upper_chest_distribution_only",
                ],
              },
            ],
          },
          rearDeltCollateralSummary: {
            directRearDeltStimulusBefore: 0,
            directRearDeltStimulusAfter: 2,
            rearDeltPreselectionConsumed: true,
            upperBackCollateralDelta: 0,
            pullPatternConcentrationDelta: 0,
            suspiciousRepairDelta: 0,
            capTrimOrRemovalDelta: 0,
            verdict: "clean_improvement",
            reasons: [
              "rear_delt_preselection_consumed",
              "direct_rear_delt_stimulus_increased",
            ],
          },
          projectedDelivery: [],
          repairMateriality: [
            {
              repairMechanism: "support_floor_closure",
              materiality: "major",
              muscle: "Side Delts",
              slotId: "upper_a",
              exerciseId: "ex-3",
              exerciseName: "Cable Lateral Raise",
              action: "added",
              effectiveStimulusAdded: 2,
              effectiveStimulusDelta: 2,
              rawSetsAdded: 3,
              rawSetDelta: 3,
              changedExerciseIdentity: true,
              changedSlotShapeMaterially: true,
              behaviorClass: "program_shaping",
              source: "support_floor_closure",
              rationale: "support floor closed after planner-only selection",
            },
          ],
          exerciseConcentration: [],
          warnings: [
            {
              code: "EXERCISE_CONCENTRATION_HIGH",
              severity: "warning",
              message:
                "One exercise supplies a high share of a muscle's projected weekly stimulus.",
              evidence: ["upper_a:Incline Dumbbell Press"],
            },
          ],
          limitations: ["read-only test diagnostic"],
        },
      },
    });
    mocks.buildMesocycleSlotPlanSeed.mockReturnValue({
      version: 1,
      source: "handoff_slot_plan_projection",
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            { exerciseId: "ex-1", role: "CORE_COMPOUND", setCount: 3 },
          ],
        },
      ],
    });
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({
      context: {},
      activeMesocycle: mesocycle,
      rotationContext: new Map(),
      mesocycleRoleRows: [],
      phaseBlockContext: {},
    });
    mocks.buildMappedGenerationContextFromSnapshot.mockReturnValue({
      history: [],
      rotationContext: new Map(),
      activeMesocycle: mesocycle,
    });
    mocks.generateProjectedSession.mockResolvedValue({
      workout: {
        warmup: [],
        mainLifts: [
          {
            exercise: { id: "ex-1" },
            sets: [{}, {}, {}],
          },
        ],
        accessories: [],
      },
    });
    mocks.buildProjectedWorkoutHistoryEntry.mockReturnValue({});
    mocks.listWorkoutExerciseNames.mockReturnValue(["Incline Dumbbell Press"]);
    mocks.getLatestReadinessSignalForReader.mockResolvedValue(null);
    mocks.readSessionSlotSnapshot.mockReturnValue({
      slotId: "upper_a",
      sequenceIndex: 0,
    });
    mocks.resolvePersistedOrReconstructedSessionAuditSnapshot.mockReturnValue({
      sessionSnapshot: {
        version: 1,
        generated: {
          selectionMode: "INTENT",
          sessionIntent: "upper",
          semantics: {
            kind: "advancing",
          },
          exerciseCount: 1,
          hardSetCount: 3,
          exercises: [
            {
              exerciseId: "ex-1",
              exerciseName: "Incline Dumbbell Press",
              orderIndex: 0,
              section: "main",
              isMainLift: true,
              prescribedSetCount: 3,
              prescribedSets: [],
            },
          ],
          traces: {
            progression: {},
          },
        },
        saved: {
          workoutId: "workout-1",
          status: "COMPLETED",
          advancesSplit: true,
          semantics: {
            kind: "advancing",
          },
        },
      },
      snapshotSource: "persisted",
    });
    mocks.buildSessionAuditMutationSummary.mockReturnValue({
      version: 1,
      comparisonState: "comparable",
      hasDrift: true,
      changedFields: ["exercise_added"],
      addedExerciseIds: ["ex-2"],
      removedExerciseIds: [],
      exercisesWithSetCountChanges: [],
      exercisesWithPrescriptionChanges: [],
      generatedSelectionMode: "INTENT",
      savedSelectionMode: "INTENT",
      generatedSessionIntent: "upper",
      savedSessionIntent: "upper",
      generatedSemanticsKind: "advancing",
      savedSemanticsKind: "advancing",
    });
    mocks.resolveMesocycleSlotContract.mockReturnValue({
      slots: [
        {
          slotId: "upper_a",
          intent: "UPPER",
          authoredSemantics: {
            slotArchetype: "upper_primary",
            continuityScope: "slot",
            primaryLaneContract: null,
            supportCoverageContract: null,
          },
        },
      ],
    });
  });

  it("builds a truthful preview/seed/reality artifact with explicit source labeling and limitations", async () => {
    const payload = await buildMesocycleExplainAuditPayload({
      userId: "user-1",
      ownerEmail: "aaron8819@gmail.com",
      sourceMesocycleId: "meso-1",
      retrospectiveMesocycleId: "meso-1",
      plannerDiagnosticsMode: "debug",
    });

    expect(payload.version).toBe(1);
    expect(payload.preview.slotPlans).toHaveLength(1);
    expect(payload.seed.slotPlans).toHaveLength(1);
    expect(payload.seed.slotPlans[0]?.exercises[0]).toMatchObject({
      exerciseId: "ex-1",
      setCount: 4,
    });
    expect(payload.reality.generatedVsSaved).toHaveLength(1);
    expect(payload.comparison.previewVsSeed.slotDiffs).toHaveLength(1);
    expect(payload.comparison.previewVsSeed).toMatchObject({
      comparable: false,
      comparisonBasis: "fresh_reprojection",
    });
    expect(payload.comparison.previewVsSeed.slotDiffs[0]).toMatchObject({
      comparable: false,
      exactMatch: false,
      setCountMismatches: [
        {
          exerciseId: "ex-1",
          previewSetCount: 3,
          retrospectiveSetCount: 4,
        },
      ],
    });

    expect(payload.preview.exerciseRationale[0]).toMatchObject({
      exerciseId: "ex-1",
      reasonSource: "persisted",
      ranking: null,
    });
    expect(payload.preview.projectionDiagnostics).toMatchObject({
      label: "projection diagnostics",
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        setStackingPressure: 1,
        duplicateExercisePressure: 1,
        diversityPenalties: 1,
        hingeSquatBalance: 1,
        isolationInjectionTriggers: 1,
        softCapsOverriddenByP0: 1,
      },
    });
    expect(payload.preview.projectionDiagnostics.constraintsTriggered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "projection diagnostics",
          category: "set_stacking_pressure",
          constraint: "per_exercise_efficiency",
          reason: "soft_cap_exceeded_higher_priority_or_capacity_bound",
        }),
        expect.objectContaining({
          label: "projection diagnostics",
          category: "duplicate_exercise_pressure",
          constraint: "cross_slot_duplicate",
        }),
        expect.objectContaining({
          label: "projection diagnostics",
          category: "diversity_penalty",
          constraint: "stimulus_diversity",
        }),
        expect.objectContaining({
          label: "projection diagnostics",
          category: "hinge_squat_balance",
          constraint: "weekly_pattern_balance",
        }),
      ]),
    );
    expect(payload.preview.projectionDiagnostics.tradeoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "isolation_injection_trigger",
          reason: "injected_direct_isolation_for_deficit",
          why: expect.stringContaining("direct isolation was inserted"),
        }),
        expect.objectContaining({
          category: "other_projection_quality",
          reason: "redistribution_blocked_stacking_allowed",
          blockReason: "no_compatible_exercise",
        }),
      ]),
    );
    expect(payload.preview.projectionDiagnostics.softCapOverridesByP0).toEqual([
      expect.objectContaining({
        category: "soft_cap_overridden_by_p0",
        exerciseId: "ex-1",
        why: expect.stringContaining("soft set cap yielded to P0"),
      }),
    ]);
    expect(payload.preview.projectionDiagnostics.planningReality).toMatchObject(
      {
        label: "weekly demand / slot allocation diagnostics",
        readOnly: true,
        affectsScoringOrGeneration: false,
        summary: {
          planningShape: "mixed_upstream_plus_repair_shaped",
          explicitWeeklyDemandMuscles: 4,
          warningCodes: ["EXERCISE_CONCENTRATION_HIGH"],
        },
        weeklyMuscleDemand: [
          expect.objectContaining({
            muscle: "Chest",
            targetStatus: "hard",
            explicitUpstream: true,
          }),
        ],
        shadowWeeklyDemand: [
          expect.objectContaining({
            muscle: "Chest",
            targetStatus: "hard",
            priority: "primary",
          }),
        ],
        shadowSlotDemandAllocation: [
          expect.objectContaining({
            slotId: "upper_a",
            allocatedMuscles: [
              expect.objectContaining({
                muscle: "Chest",
                role: "primary",
              }),
            ],
          }),
        ],
        slotPrescriptionIntents: [
          expect.objectContaining({
            slotId: "upper_a",
            musclePrescriptions: [
              expect.objectContaining({
                muscle: "Chest",
                demandType: "direct_required",
              }),
            ],
            diagnostic: expect.objectContaining({
              priorRepairsPrevented: [
                "upper_a:Chest:direct_required:slot_preselection_demand",
              ],
            }),
          }),
        ],
        setDistributionIntents: [
          expect.objectContaining({
            slotId: "upper_a",
            readOnly: true,
            affectsScoringOrGeneration: false,
            musclePolicies: [
              expect.objectContaining({
                muscle: "Chest",
                preferredDistribution: "two_exercise_split",
                whenAtLimit: "prefer_alternative",
              }),
            ],
            evidence: expect.objectContaining({
              concentrationRows: ["upper_a:Incline Dumbbell Press:Chest:57.1%"],
            }),
          }),
        ],
        preselectionDistributionPolicyByWeek: expect.objectContaining({
          source: "diagnostic_shadow_planner",
          readOnly: true,
          affectsScoringOrGeneration: false,
          limitations: expect.arrayContaining([
            "weeks_2_to_4_unprojected",
            "missing_weekly_demand_curve",
            "deload_distribution_not_projected",
          ]),
          weeks: expect.arrayContaining([
            expect.objectContaining({
              week: 1,
              projectionStatus: "projected_from_current_week_evidence",
              slots: expect.arrayContaining([
                expect.objectContaining({
                  slotId: "upper_a",
                  muscleDistributions: expect.arrayContaining([
                    expect.objectContaining({
                      muscle: "Chest",
                      targetStatus: "hard",
                      role: "primary",
                      demandType: "direct_required",
                    }),
                  ]),
                }),
              ]),
            }),
            expect.objectContaining({
              week: 2,
              projectionStatus: "not_projected_missing_weekly_demand_curve",
              slots: [],
            }),
            expect.objectContaining({
              week: 5,
              projectionStatus: "not_projected_missing_deload_policy",
              slots: [],
            }),
          ]),
          candidateBehaviorSlices: expect.arrayContaining([
            expect.objectContaining({
              candidate: "chest_upper_slot_distinct_exercise_distribution",
              recommendation: "best_future_behavior",
            }),
            expect.objectContaining({
              candidate: "hamstrings_weekly_overdelivery_control",
              recommendation: "not_first",
            }),
            expect.objectContaining({
              candidate: "side_delt_second_slot_support",
              recommendation: "diagnostic_only",
            }),
            expect.objectContaining({
              candidate: "duplicate_main_lift_suppression",
              recommendation: "not_first",
            }),
            expect.objectContaining({
              candidate: "calf_duplicate_suppression",
              recommendation: "later_cleanup",
            }),
          ]),
        }),
        slotDemandAllocationByWeek: expect.objectContaining({
          source: "diagnostic_shadow_planner",
          readOnly: true,
          affectsScoringOrGeneration: false,
          weeks: expect.arrayContaining([
            expect.objectContaining({
              week: 1,
              projectionStatus: "allocated_from_current_week_evidence",
              slots: expect.arrayContaining([
                expect.objectContaining({
                  slotId: "upper_a",
                  allocatedMuscles: expect.arrayContaining([
                    expect.objectContaining({
                      muscle: "Chest",
                      targetStatus: "hard",
                      role: "primary",
                    }),
                  ]),
                }),
              ]),
            }),
            expect.objectContaining({
              week: 2,
              projectionStatus: "not_allocated_missing_weekly_projection",
              slots: [],
            }),
            expect.objectContaining({
              week: 5,
              projectionStatus: "not_allocated_missing_deload_policy",
              slots: [],
            }),
          ]),
          crossWeekAllocationWarnings: expect.arrayContaining([
            expect.objectContaining({
              code: "WEEKLY_SLOT_ALLOCATION_POLICY_MISSING",
            }),
          ]),
        }),
        accumulationWeekProjection: expect.objectContaining({
          source: "diagnostic_shadow_planner",
          readOnly: true,
          affectsScoringOrGeneration: false,
          projectionBasis: expect.objectContaining({
            sourceWeek: 1,
            method: "repeat_week_1_final_shape",
            limitations: expect.arrayContaining([
              "does_not_apply_true_progression_policy",
              "does_not_project_deload_identity_or_set_reduction",
            ]),
          }),
          weeks: expect.arrayContaining([
            expect.objectContaining({
              week: 2,
              projectionStatus: "partially_projected_missing_progression",
              projectedMuscles: expect.arrayContaining([
                expect.objectContaining({
                  muscle: "Chest",
                  status: "below",
                  trend: "persistent_under_target",
                }),
              ]),
            }),
          ]),
          crossWeekWarnings: expect.arrayContaining([
            expect.objectContaining({
              code: "CHEST_UNDER_TARGET_ACROSS_ACCUMULATION",
              muscle: "Chest",
            }),
            expect.objectContaining({
              code: "DELOAD_PRESERVATION_STILL_UNPROJECTED",
            }),
          ]),
          candidateBehaviorReadiness: expect.arrayContaining([
            expect.objectContaining({
              candidate: "chest_upper_slot_distinct_exercise_distribution",
              readiness: "ready_for_bounded_trial",
            }),
          ]),
        }),
        rearDeltCollateralSummary: expect.objectContaining({
          rearDeltPreselectionConsumed: true,
          verdict: "clean_improvement",
        }),
      },
    );
    const planningReality =
      payload.preview.projectionDiagnostics.planningReality;
    expect(
      findFinalSlotForbiddenPrescriptionViolations(planningReality),
    ).toEqual([]);
    expect(
      findDistributionGuardActionInvariantViolations({
        ...planningReality,
        distributionGuardActions: [
          {
            slotId: "upper_a",
            exerciseName: "Incline Dumbbell Press",
            muscle: "Chest",
            attemptedAction: "set_bump",
            decision: "left_unresolved",
            reason: "single_exercise_share_limit",
          },
        ],
      }),
    ).toEqual([]);
    expect(
      findFinalSlotForbiddenPrescriptionViolations({
        ...planningReality,
        finalSlotPlan: [
          ...(planningReality?.finalSlotPlan ?? []),
          {
            slotId: "lower_b",
            exercises: [
              {
                exerciseId: "cable-crossover",
                exerciseName: "Cable Crossover",
                primaryMuscles: ["Chest"],
              },
            ],
          },
        ],
        slotPrescriptionIntents: [
          ...(planningReality?.slotPrescriptionIntents ?? []),
          {
            slotId: "lower_b",
            musclePrescriptions: [
              {
                muscle: "Chest",
                targetStatus: "forbidden",
                demandType: "do_not_train_here",
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        slotId: "lower_b",
        muscle: "Chest",
        exerciseId: "cable-crossover",
        exerciseName: "Cable Crossover",
      },
    ]);
    expect(payload.seed.exerciseRationale[0]).toMatchObject({
      exerciseId: "ex-1",
      reasonSource: "persisted",
    });
    expect(payload.reality.exerciseRationale).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "ex-1",
          reasonSource: "persisted",
        }),
        expect.objectContaining({
          exerciseId: "ex-2",
          reasonSource: "reconstructed",
        }),
      ]),
    );
    expect(payload.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Historical acceptance-time candidate ranking rationale is not persisted",
        ),
        expect.stringContaining("fresh reprojections"),
      ]),
    );
    expect(payload.plannerOnlyDryRun).toBeUndefined();
  });

  it("emits a compact read-only planner-only comparison only when both dry-run flags are enabled", async () => {
    const payload = await buildMesocycleExplainAuditPayload({
      userId: "user-1",
      ownerEmail: "aaron8819@gmail.com",
      sourceMesocycleId: "meso-1",
      retrospectiveMesocycleId: "meso-1",
      plannerDiagnosticsMode: "debug",
      plannerOnlyDryRun: {
        enabled: true,
        compareRepaired: true,
      },
    });

    expect(payload.preview.slotPlans).toHaveLength(1);
    expect(payload.plannerOnlyDryRun).toMatchObject({
      enabled: true,
      compareRepaired: true,
      readOnly: true,
      affectsScoringOrGeneration: false,
      canReplaceRepairedProjection: false,
      summary: {
        status: "fail",
        unresolvedDemandCount: expect.any(Number),
        disabledRepairDependencyCount: expect.any(Number),
      },
    });
    expect(payload.plannerOnlyDryRun?.slotComparisons[0]).toMatchObject({
      slotId: "upper_a",
      repairedExercises: expect.arrayContaining([
        expect.stringContaining("Cable Lateral Raise"),
      ]),
      plannerOnlyExercises: expect.arrayContaining([
        expect.stringContaining("Incline Dumbbell Press"),
      ]),
      unresolvedDemand: expect.arrayContaining([
        expect.stringContaining("repair_would_be_needed_here:Chest"),
      ]),
      setDistributionViolations: expect.arrayContaining([
        expect.stringContaining("set_count_gt_5"),
      ]),
    });
    expect(payload.plannerOnlyDryRun?.weeklyMuscleComparison).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          repairedEffectiveSets: 6,
          plannerOnlyEffectiveSets: 6,
          targetStatus: "below",
        }),
      ]),
    );
    expect(payload.plannerOnlyDryRun?.acceptanceChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "materialRepairCount = 0 for basic shape",
          status: "fail",
          evidence: ["materialRepairCount:1"],
        }),
      ]),
    );
    expect(payload.plannerOnlyDryRun?.repairDependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "support-floor closure",
          wouldHaveActed: true,
          consequenceWithoutRepair: expect.stringContaining(
            "repair_would_be_needed_here",
          ),
        }),
      ]),
    );
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.buildMesocycleSlotPlanSeed).toHaveBeenCalledTimes(1);
  });
});
