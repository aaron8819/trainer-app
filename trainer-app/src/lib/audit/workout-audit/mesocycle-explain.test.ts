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

import {
  buildMesocycleExplainAuditPayload,
  buildPlannerOnlyDryRunComparison,
  buildPlannerOnlyNoRepairComparison,
} from "./mesocycle-explain";

type PlannerOnlyPlanningReality = NonNullable<
  Parameters<typeof buildPlannerOnlyDryRunComparison>[0]
>;

function makeCalfPlanningReality(overrides: {
  lowerACalfSets?: number;
  lowerBCalfShapes?: Array<{ name: string; sets: number }>;
  lowerBHingeCurl?: boolean;
  weeksProjected?: boolean;
  materialRepairCount?: number;
  majorRepairCount?: number;
  suspiciousRepairCount?: number;
  lowerAFourSetAllocation?: boolean;
  lowerACalfUnresolved?: boolean;
  capKnown?: boolean;
}) {
  const lowerACalfSets = overrides.lowerACalfSets ?? 2;
  const lowerBCalfShapes = overrides.lowerBCalfShapes ?? [
    { name: "Seated Calf Raise", sets: 4 },
    { name: "Leg Press Calf Raise", sets: 4 },
  ];
  const lowerBHamstringExercises = overrides.lowerBHingeCurl === false
    ? [
        {
          exerciseId: "sldl",
          exerciseName: "Stiff-Legged Deadlift",
          role: "main",
          setCount: 3,
          primaryMuscles: ["Hamstrings"],
          movementPatterns: ["hinge"],
          effectiveStimulusByMuscle: { Hamstrings: 3 },
        },
      ]
    : [
        {
          exerciseId: "sldl",
          exerciseName: "Stiff-Legged Deadlift",
          role: "main",
          setCount: 3,
          primaryMuscles: ["Hamstrings"],
          movementPatterns: ["hinge"],
          effectiveStimulusByMuscle: { Hamstrings: 3 },
        },
        {
          exerciseId: "curl",
          exerciseName: "Nordic Hamstring Curl",
          role: "accessory",
          setCount: 3,
          primaryMuscles: ["Hamstrings"],
          movementPatterns: ["flexion"],
          effectiveStimulusByMuscle: { Hamstrings: 3 },
        },
      ];
  const weekTwoStatus = overrides.weeksProjected
    ? "allocated_from_policy"
    : "not_allocated_missing_weekly_projection";
  const preselectionWeekTwoStatus = overrides.weeksProjected
    ? "projected_from_policy"
    : "not_projected_missing_weekly_demand_curve";
  const lowerATarget = overrides.lowerAFourSetAllocation ? 4 : 8;
  const capKnown = overrides.capKnown !== false;
  const suspiciousRows = Array.from(
    { length: overrides.suspiciousRepairCount ?? 0 },
    (_, index) => ({
      slotId: "lower_b",
      muscle: "Calves",
      exerciseName: `Suspicious Calf ${index + 1}`,
      repairMechanism: "support_floor",
      reason: "test suspicious repair",
      recommendation: "Do not promote this repair upstream.",
    }),
  );

  return {
    label: "weekly demand / slot allocation diagnostics",
    readOnly: true,
    affectsScoringOrGeneration: false,
    summary: {
      planningShape: "mostly_upstream_planned",
      explicitWeeklyDemandMuscles: 1,
      inferredDemandMuscles: 0,
      slotsWithExplicitWeeklyDemand: 2,
      slotsWithOnlyLocalOrInferredSemantics: 0,
      materialRepairCount: overrides.materialRepairCount ?? 0,
      majorRepairCount: overrides.majorRepairCount ?? 0,
      highExerciseConcentrationCount: 0,
      warningCodes: [],
    },
    weeklyMuscleDemand: [
      {
        muscle: "Calves",
        targetTier: "B_SUPPORT",
        targetKind: "soft",
        targetStatus: "soft",
        targetRange: null,
        preferredTarget: 8,
        mev: 8,
        mav: 14,
        explicitUpstream: true,
        inferredDownstream: false,
        source: ["test"],
      },
    ],
    slotDemandAllocation: [],
    shadowWeeklyDemand: [
      {
        muscle: "Calves",
        targetTier: "B_SUPPORT",
        targetStatus: "soft",
        minEffectiveSets: 8,
        preferredEffectiveSets: 8,
        maxEffectiveSets: 14,
        desiredExposureCount: 2,
        priority: "support",
        source: ["test"],
        rationale: ["test"],
      },
    ],
    shadowSlotDemandAllocation: [
      {
        slotId: "lower_a",
        slotIndex: 0,
        slotArchetype: "lower_squat",
        intent: "lower",
        allocatedMuscles: [
          {
            muscle: "Calves",
            role: "support",
            targetStatus: "soft",
            minEffectiveSets: lowerATarget,
            preferredEffectiveSets: lowerATarget,
            maxEffectiveSets: 14,
            allocationReason: ["test"],
          },
        ],
      },
      {
        slotId: "lower_b",
        slotIndex: 1,
        slotArchetype: "lower_hinge",
        intent: "lower",
        allocatedMuscles: [
          {
            muscle: "Calves",
            role: "support",
            targetStatus: "soft",
            minEffectiveSets: 4,
            preferredEffectiveSets: 4,
            maxEffectiveSets: 14,
            allocationReason: ["test"],
          },
        ],
      },
    ],
    initialSlotComposition: [
      {
        slotId: "lower_a",
        slotIndex: 0,
        intent: "lower",
        exerciseCount: 1,
        totalSets: lowerACalfSets,
        projectedEffectiveStimulusByMuscle: { Calves: lowerACalfSets },
        exercises: [
          {
            exerciseId: "standing-calf",
            exerciseName: "Standing Calf Raise",
            role: "accessory",
            setCount: lowerACalfSets,
            primaryMuscles: ["Calves"],
            movementPatterns: ["isolation"],
            effectiveStimulusByMuscle: { Calves: lowerACalfSets },
          },
        ],
      },
      {
        slotId: "lower_b",
        slotIndex: 1,
        intent: "lower",
        exerciseCount: lowerBCalfShapes.length + lowerBHamstringExercises.length,
        totalSets:
          lowerBCalfShapes.reduce((sum, row) => sum + row.sets, 0) +
          lowerBHamstringExercises.reduce((sum, row) => sum + row.setCount, 0),
        projectedEffectiveStimulusByMuscle: {
          Calves: lowerBCalfShapes.reduce((sum, row) => sum + row.sets, 0),
          Hamstrings: lowerBHamstringExercises.reduce(
            (sum, row) => sum + (row.effectiveStimulusByMuscle.Hamstrings ?? 0),
            0,
          ),
        },
        exercises: [
          ...lowerBHamstringExercises,
          ...lowerBCalfShapes.map((row, index) => ({
            exerciseId: `lower-b-calf-${index + 1}`,
            exerciseName: row.name,
            role: "accessory",
            setCount: row.sets,
            primaryMuscles: ["Calves"],
            movementPatterns: ["isolation"],
            effectiveStimulusByMuscle: { Calves: row.sets },
          })),
        ],
      },
    ],
    finalSlotPlan: [],
    allocationVsInitialDelta: overrides.lowerACalfUnresolved === false
      ? []
      : [
          {
            slotId: "lower_a",
            slotIndex: 0,
            comparison: "allocation_vs_initial",
            responsibilityLoad: "clear",
            underAllocatedMuscles: [
              {
                muscle: "Calves",
                role: "support",
                targetStatus: "soft",
                expectedEffectiveSets: lowerATarget,
                actualEffectiveSets: lowerACalfSets,
                shortfall: Math.max(0, lowerATarget - lowerACalfSets),
              },
            ],
            unallocatedStimulusMuscles: [],
            notes: [],
          },
        ],
    allocationVsFinalDelta: [],
    repairMaterialityAfterShadowAllocation: [],
    shadowRepairSummary: {
      materialRepairCount: overrides.materialRepairCount ?? 0,
      majorRepairCount: overrides.majorRepairCount ?? 0,
      likelyAvoidableMaterialRepairCount: 0,
      remainingMaterialRepairCount: 0,
      likelyAvoidableMajorRepairCount: 0,
      remainingMajorRepairCount: 0,
      likelyAvoidableByMuscle: {},
      remainingByMuscle: {},
    },
    suspiciousRepairsNotEligibleForPromotion: suspiciousRows,
    promotionCandidates: [],
    slotPrescriptionIntents: [],
    setDistributionIntents: [
      {
        version: 1,
        slotId: "lower_a",
        slotIndex: 0,
        intent: "lower",
        slotArchetype: "lower_squat",
        musclePolicies: [
          {
            muscle: "Calves",
            role: "support",
            targetStatus: "soft",
            demandType: "soft_direct_allowed",
            preferredEffectiveSets: lowerATarget,
            minEffectiveSets: lowerATarget,
            maxEffectiveSets: 14,
            maxSingleExerciseShare: 1,
            maxSinglePatternShare: 1,
            maxSetsPerExercise: 4,
            maxDirectExercises: 1,
            maxDuplicateExerciseClasses: 1,
            preferredDistribution: "single_exercise",
            whenAtLimit: "leave_unresolved",
          },
        ],
        slotBudget: {
          preferredTotalSets: 12,
          maxTotalSets: capKnown ? 25 : null,
          maxMainLifts: 2,
          maxAccessories: 5,
          maxDirectIsolationExercises: 2,
        },
        evidence: {
          concentrationRows: [],
          capCleanupRows: [],
          repairRowsStillRepairOwned: [],
        },
        readOnly: true,
        affectsScoringOrGeneration: false,
      },
      {
        version: 1,
        slotId: "lower_b",
        slotIndex: 1,
        intent: "lower",
        slotArchetype: "lower_hinge",
        musclePolicies: [
          {
            muscle: "Calves",
            role: "support",
            targetStatus: "soft",
            demandType: "soft_direct_allowed",
            preferredEffectiveSets: 4,
            minEffectiveSets: 4,
            maxEffectiveSets: 14,
            maxSingleExerciseShare: 1,
            maxSinglePatternShare: 1,
            maxSetsPerExercise: 4,
            maxDirectExercises: 1,
            maxDuplicateExerciseClasses: 1,
            preferredDistribution: "single_exercise",
            whenAtLimit: "leave_unresolved",
          },
        ],
        slotBudget: {
          preferredTotalSets: 16,
          maxTotalSets: capKnown ? 25 : null,
          maxMainLifts: 2,
          maxAccessories: 5,
          maxDirectIsolationExercises: 2,
        },
        evidence: {
          concentrationRows: [],
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
      limitations: overrides.weeksProjected ? [] : ["weeks_2_to_4_unprojected"],
      weeks: [
        { week: 1, phase: "accumulation", projectionStatus: "projected_from_current_week_evidence", slots: [], weekLevelWarnings: [] },
        { week: 2, phase: "accumulation", projectionStatus: preselectionWeekTwoStatus, slots: [], weekLevelWarnings: [] },
        { week: 3, phase: "accumulation", projectionStatus: preselectionWeekTwoStatus, slots: [], weekLevelWarnings: [] },
        { week: 4, phase: "accumulation", projectionStatus: preselectionWeekTwoStatus, slots: [], weekLevelWarnings: [] },
      ],
      candidateBehaviorSlices: [],
      recommendedNextStep: "test",
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
              slotId: "lower_a",
              slotIndex: 0,
              slotArchetype: "lower_squat",
              intent: "lower",
              allocatedMuscles: [
                {
                  muscle: "Calves",
                  role: "support",
                  targetStatus: "soft",
                  minEffectiveSets: lowerATarget,
                  preferredEffectiveSets: lowerATarget,
                  maxEffectiveSets: 14,
                  weekScope: "week_1_only",
                  allocationConfidence: "high",
                  allocationReason: ["test"],
                  limitations: [],
                },
              ],
              slotLevelWarnings: [],
            },
          ],
          weekLevelWarnings: [],
        },
        { week: 2, phase: "accumulation", projectionStatus: weekTwoStatus, slots: [], weekLevelWarnings: [] },
        { week: 3, phase: "accumulation", projectionStatus: weekTwoStatus, slots: [], weekLevelWarnings: [] },
        { week: 4, phase: "accumulation", projectionStatus: weekTwoStatus, slots: [], weekLevelWarnings: [] },
      ],
      crossWeekAllocationWarnings: [],
    },
    projectedDelivery: [],
    repairMateriality: [
      {
        repairMechanism: "support_floor_closure",
        materiality: "minor",
        muscle: "Calves",
        slotId: "lower_a",
        exerciseId: "standing-calf",
        exerciseName: "Standing Calf Raise",
        action: "set_bumped",
        effectiveStimulusAdded: 1,
        effectiveStimulusDelta: 1,
        rawSetsAdded: 1,
        rawSetDelta: 1,
        changedExerciseIdentity: false,
        changedSlotShapeMaterially: false,
        behaviorClass: "program_shaping",
        source: "support_floor_closure",
        rationale: "support floor closure",
      },
    ],
    exerciseClassUnresolvedCauses: [],
    duplicateContinuityJustification: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      version: 1,
      source: "test",
      summary: {
        totalDuplicates: lowerBCalfShapes.length > 1 ? 1 : 0,
        justifiedDuplicates: 0,
        unjustifiedOrUnknown: lowerBCalfShapes.length > 1 ? 1 : 0,
        cleanAlternativeAvailable: 0,
        highRiskDuplicates: 0,
      },
      duplicates: lowerBCalfShapes.length > 1
        ? [
            {
              exerciseId: "calf-duplicate",
              exerciseName: "Leg Press Calf Raise + Seated Calf Raise",
              exerciseClass: "calf_raise",
              movementPatterns: ["isolation"],
              primaryMuscles: ["Calves"],
              duplicateType: "same_session_variant",
              duplicatedInSlots: ["lower_b"],
              roleBySlot: { lower_b: "accessory" },
              setCountBySlot: { lower_b: 8 },
              compatibleAlternativeExists: false,
              compatibleAlternatives: [],
              justification: "unjustified",
              policyRecommendation: "discourage_duplicate",
              risk: "low",
              evidence: [],
              limitations: [],
            },
          ]
        : [],
    },
    exerciseConcentration: [],
    warnings: [],
    limitations: [],
  } as unknown as PlannerOnlyPlanningReality;
}

type TestNoRepairExercise = {
  slotId: string;
  intent?: string;
  exerciseId?: string;
  exerciseName: string;
  setCount?: number;
  role?: "main" | "accessory";
  isCompound?: boolean;
  primaryMuscles: string[];
  movementPatterns?: string[];
  stimulus: Record<string, number>;
  percentages?: Record<string, number>;
  producedOrIncreasedByRepair?: boolean;
  flags?: Array<
    | "COMPOUND_GT_5_SETS"
    | "ISOLATION_GT_5_SETS"
    | "EXERCISE_SUPPLIES_OVER_50_PERCENT_WEEKLY_STIMULUS"
    | "EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS"
    | "EXERCISE_ADDED_BY_REPAIR"
    | "SET_COUNT_INCREASED_BY_REPAIR"
  >;
};

function makeNoRepairConcentrationPlanningReality(input: {
  exercises: TestNoRepairExercise[];
  demands?: Array<{
    muscle: string;
    priority: "primary" | "support" | "secondary" | "implicit";
    targetStatus: "hard" | "soft" | "diagnostic";
    minEffectiveSets: number | null;
    preferredEffectiveSets?: number | null;
    maxEffectiveSets?: number | null;
  }>;
  setDistributionRows?: string[];
  setDistributionRowsBySlot?: Record<string, string[]>;
  validationFailuresBySlot?: Record<string, string[]>;
}): PlannerOnlyPlanningReality {
  const base = makeCalfPlanningReality({
    lowerBCalfShapes: [],
    lowerACalfUnresolved: false,
    materialRepairCount: 0,
    majorRepairCount: 0,
    suspiciousRepairCount: 0,
  });
  const exercisesBySlot = new Map<string, TestNoRepairExercise[]>();
  for (const exercise of input.exercises) {
    exercisesBySlot.set(exercise.slotId, [
      ...(exercisesBySlot.get(exercise.slotId) ?? []),
      exercise,
    ]);
  }
  const slots = Array.from(exercisesBySlot.entries()).map(
    ([slotId, exercises], index) => ({
      slotId,
      slotIndex: index,
      intent: exercises[0]?.intent ?? (slotId.startsWith("lower") ? "lower" : "upper"),
      exerciseCount: exercises.length,
      totalSets: exercises.reduce((sum, exercise) => sum + (exercise.setCount ?? 3), 0),
      projectedEffectiveStimulusByMuscle: exercises.reduce<Record<string, number>>(
        (totals, exercise) => {
          for (const [muscle, value] of Object.entries(exercise.stimulus)) {
            totals[muscle] = Math.round(((totals[muscle] ?? 0) + value) * 10) / 10;
          }
          return totals;
        },
        {},
      ),
      exercises: exercises.map((exercise, exerciseIndex) => ({
        exerciseId: exercise.exerciseId ?? `${slotId}-${exerciseIndex}`,
        exerciseName: exercise.exerciseName,
        role: exercise.role ?? "accessory",
        setCount: exercise.setCount ?? 3,
        primaryMuscles: exercise.primaryMuscles,
        movementPatterns: exercise.movementPatterns ?? ["isolation"],
        effectiveStimulusByMuscle: exercise.stimulus,
      })),
      validationFailures: input.validationFailuresBySlot?.[slotId] ?? [],
    }),
  );
  const defaultDemands = [
    {
      muscle: "Rear Delts",
      priority: "support" as const,
      targetStatus: "soft" as const,
      minEffectiveSets: 4,
      preferredEffectiveSets: 6,
      maxEffectiveSets: 12,
    },
  ];

  return {
    ...base,
    summary: {
      ...base.summary,
      materialRepairCount: 0,
      majorRepairCount: 0,
    },
    initialSlotComposition: slots,
    finalSlotPlan: slots,
    allocationVsInitialDelta: [],
    allocationVsFinalDelta: [],
    shadowWeeklyDemand: (input.demands ?? defaultDemands).map((demand) => ({
      muscle: demand.muscle,
      targetTier:
        demand.priority === "primary"
          ? "A_PRIMARY"
          : demand.priority === "support"
            ? "B_SUPPORT"
            : demand.priority === "secondary"
              ? "C_SECONDARY"
              : "IMPLICIT",
      targetStatus: demand.targetStatus,
      minEffectiveSets: demand.minEffectiveSets,
      preferredEffectiveSets: demand.preferredEffectiveSets ?? demand.minEffectiveSets,
      maxEffectiveSets: demand.maxEffectiveSets ?? null,
      desiredExposureCount: null,
      priority: demand.priority,
      source: ["test"],
      rationale: ["test"],
    })),
    setDistributionIntents: Array.from(exercisesBySlot.keys()).map((slotId) => ({
      ...base.setDistributionIntents[0],
      slotId,
      evidence: {
        concentrationRows:
          input.setDistributionRowsBySlot?.[slotId] ??
          (slotId === input.exercises[0]?.slotId ? input.setDistributionRows ?? [] : []),
        capCleanupRows: [],
        repairRowsStillRepairOwned: [],
      },
    })),
    duplicateContinuityJustification: {
      ...base.duplicateContinuityJustification,
      summary: {
        totalDuplicates: 0,
        justifiedDuplicates: 0,
        unjustifiedOrUnknown: 0,
        cleanAlternativeAvailable: 0,
        highRiskDuplicates: 0,
      },
      duplicates: [],
    },
    exerciseConcentration: input.exercises.map((exercise, index) => ({
      slotId: exercise.slotId,
      intent: exercise.intent ?? (exercise.slotId.startsWith("lower") ? "lower" : "upper"),
      exerciseId: exercise.exerciseId ?? `${exercise.slotId}-${index}`,
      exerciseName: exercise.exerciseName,
      setCount: exercise.setCount ?? 3,
      role: exercise.role ?? "accessory",
      isCompound: exercise.isCompound ?? false,
      primaryMuscles: exercise.primaryMuscles,
      effectiveStimulusContributionByMuscle: exercise.stimulus,
      percentageOfWeeklyProjectedStimulusByMuscle: exercise.percentages ?? exercise.stimulus,
      producedOrIncreasedByRepair: exercise.producedOrIncreasedByRepair ?? false,
      flags:
        exercise.flags ??
        (Object.values(exercise.percentages ?? {}).some((value) => value >= 60)
          ? ["EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS"]
          : Object.values(exercise.percentages ?? {}).some((value) => value >= 50)
            ? ["EXERCISE_SUPPLIES_OVER_50_PERCENT_WEEKLY_STIMULUS"]
            : []),
    })),
  } as unknown as PlannerOnlyPlanningReality;
}

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
    expect(payload.plannerOnlyNoRepair).toBeUndefined();
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.projectSuccessorSlotPlansFromSnapshot.mock.calls[0]?.[0]).not.toHaveProperty(
      "plannerOnlyPolicyOverride",
    );
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
      policyOverride: {
        id: "calves_4_4_lower_slot_allocation",
        readOnly: true,
        appliesOnlyTo: "planner_only_dry_run",
        status: "active",
        affectsScoringOrGeneration: false,
      },
      canReplaceRepairedProjection: false,
      summary: {
        status: "fail",
        unresolvedDemandCount: expect.any(Number),
        disabledRepairDependencyCount: expect.any(Number),
      },
    });
    expect(payload.plannerOnlyDryRun?.projectionComparisons).toMatchObject({
      baselineRepaired: expect.any(Object),
      plannerOnlyBase: expect.any(Object),
      plannerOnlyWithOverride: expect.any(Object),
      deltas: {
        overrideVsBaselineRepaired: expect.any(Object),
        overrideVsPlannerOnlyBase: expect.any(Object),
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
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.projectSuccessorSlotPlansFromSnapshot.mock.calls[0]?.[0]).not.toHaveProperty(
      "plannerOnlyPolicyOverride",
    );
    expect(mocks.projectSuccessorSlotPlansFromSnapshot.mock.calls[1]?.[0]).toMatchObject({
      plannerOnlyPolicyOverride: {
        id: "calves_4_4_lower_slot_allocation",
        readOnly: true,
        appliesOnlyTo: "planner_only_dry_run",
      },
    });
    expect(mocks.buildMesocycleSlotPlanSeed).toHaveBeenCalledTimes(1);
  });

  it("keeps Calves 4+4 diagnostic read-only and blocks behavior when materiality or cross-week risk is unknown", async () => {
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

    expect(payload.plannerOnlyDryRun?.calvesFourFourCandidate).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "blocked",
      recommendation: expect.not.stringMatching("safe_to_trial_behavior"),
      blockedReasons: expect.arrayContaining([
        "weeks_2_to_4_unprojected",
        "insufficient_candidate_evidence",
        "would_risk_lower_b_hamstrings_route",
      ]),
    });
    expect(payload.plannerOnlyDryRun?.calvesFourFourCandidate?.materialityEstimate.evidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining("actual_materialRepairCount_delta:"),
      ]),
    );
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.buildMesocycleSlotPlanSeed).toHaveBeenCalledTimes(1);
  });

  it("emits planner-only no-repair only when flagged and leaves normal preview unchanged", async () => {
    const repairedProjection = mocks.projectSuccessorSlotPlansFromSnapshot();
    const repairedReality = repairedProjection.diagnostics.planningReality;
    const noRepairSlots = repairedReality.initialSlotComposition as Array<{
      slotId: string;
      intent: string;
      exercises: Array<{
        exerciseId: string;
        exerciseName: string;
        setCount: number;
      }>;
    }>;
    const noRepairReality = {
      ...repairedReality,
      summary: {
        ...repairedReality.summary,
        materialRepairCount: 0,
        majorRepairCount: 0,
      },
      finalSlotPlan: repairedReality.initialSlotComposition,
      allocationVsFinalDelta: repairedReality.allocationVsInitialDelta,
      repairMateriality: [],
      repairMaterialityAfterShadowAllocation: [],
      shadowRepairSummary: {
        materialRepairCount: 0,
        majorRepairCount: 0,
        likelyAvoidableMaterialRepairCount: 0,
        remainingMaterialRepairCount: 0,
        likelyAvoidableMajorRepairCount: 0,
        remainingMajorRepairCount: 0,
        likelyAvoidableByMuscle: {},
        remainingByMuscle: {},
      },
      topDownMesocyclePlan: {
        summary: {
          matchedTargetLanes: 0,
          partialTargetLanes: 1,
          missingTargetLanes: 1,
          repairShapedTargetLanes: 0,
          blockedMigrationCandidates: 0,
          readyMigrationCandidates: 0,
        },
        slotTargets: [
          {
            slotId: "upper_a",
            targetIntent: "upper_horizontal",
            slotStatus: "partial",
            requiredClassLanes: [
              {
                lane: "chest_anchor",
                preferredClasses: ["press"],
                targetSets: "3-4",
                currentStatus: "partial",
                evidenceRefs: ["stim:upper_a:Chest=6"],
                limitations: [],
              },
              {
                lane: "chest_secondary",
                preferredClasses: ["fly_press"],
                targetSets: "2-3",
                currentStatus: "missing",
                evidenceRefs: [],
                limitations: [],
              },
            ],
          },
        ],
      },
    };
    mocks.projectSuccessorSlotPlansFromSnapshot.mockClear();
    mocks.projectSuccessorSlotPlansFromSnapshot
      .mockReturnValueOnce(repairedProjection)
      .mockReturnValueOnce({
        ...repairedProjection,
        slotPlans: noRepairSlots.map((slot) => ({
          slotId: slot.slotId,
          intent: slot.intent.toUpperCase(),
          exercises: slot.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            name: exercise.exerciseName,
            role: "CORE_COMPOUND",
            setCount: exercise.setCount,
          })),
        })),
        diagnostics: {
          ...repairedProjection.diagnostics,
          planningReality: noRepairReality,
        },
      });

    const payload = await buildMesocycleExplainAuditPayload({
      userId: "user-1",
      ownerEmail: "aaron8819@gmail.com",
      sourceMesocycleId: "meso-1",
      retrospectiveMesocycleId: "meso-1",
      plannerDiagnosticsMode: "debug",
      plannerOnlyNoRepair: {
        enabled: true,
        compareRepaired: true,
      },
    });

    expect(payload.plannerOnlyDryRun).toBeUndefined();
    expect(payload.plannerOnlyNoRepair).toMatchObject({
      enabled: true,
      readOnly: true,
      affectsScoringOrGeneration: false,
      canReplaceRepairedProjection: false,
      summary: {
        status: "fail",
        targetLanesSatisfied: 0,
        unresolvedDemandCount: expect.any(Number),
        validationFailureCount: expect.any(Number),
      },
      comparisonToRepaired: {
        repairedPasses: true,
        noRepairPasses: false,
      },
    });
    expect(payload.plannerOnlyNoRepair?.v2MesocyclePlan).toMatchObject({
      version: 1,
      source: "v2_planner_no_repair_experimental",
      readOnly: true,
      affectsScoringOrGeneration: false,
      planStatus: "experimental",
      skeleton: {
        split: "upper_lower_4x",
        weeks: 5,
        slotSequence: ["upper_a", "lower_a", "upper_b", "lower_b"],
        slots: expect.arrayContaining([
          expect.objectContaining({
            slotId: "upper_a",
            intent: "horizontal push/pull + rear delt/triceps support",
            lanes: expect.arrayContaining([
              expect.objectContaining({
                laneId: "chest_anchor",
                required: true,
                role: "anchor",
                currentWeek1Status: "partial",
              }),
              expect.objectContaining({
                laneId: "chest_secondary",
                currentWeek1Status: "missing",
              }),
            ]),
          }),
          expect.objectContaining({
            slotId: "lower_b",
            intent: "hinge-dominant + quad support + calves",
            lanes: expect.arrayContaining([
              expect.objectContaining({ laneId: "hinge_anchor" }),
              expect.objectContaining({ laneId: "knee_flexion_curl" }),
              expect.objectContaining({
                laneId: "optional_glute_core_if_recoverable",
                required: false,
              }),
            ]),
          }),
        ]),
      },
      weeklyProgressionModel: {
        weeks: [
          expect.objectContaining({
            week: 1,
            phase: "entry_calibration",
            volumeMultiplier: 0.875,
            rirTarget: "3-4",
          }),
          expect.objectContaining({
            week: 2,
            phase: "accumulation",
            volumeMultiplier: 1,
            limitations: expect.arrayContaining([
              "derived_from_stable_skeleton_not_independent_plan",
            ]),
          }),
          expect.objectContaining({
            week: 3,
            phase: "hard_accumulation",
            volumeMultiplier: 1.075,
          }),
          expect.objectContaining({
            week: 4,
            phase: "peak_overreach_lite",
            rirTarget: "0-1 isolations; 1-2 compounds",
          }),
          expect.objectContaining({
            week: 5,
            phase: "deload",
            volumeMultiplier: 0.5,
            progressionIntent: "reduce_fatigue",
          }),
        ],
      },
      deloadTransform: {
        preserveExerciseIdentities: true,
        targetVolumeReductionPercent: { min: 40, max: 60 },
        targetRir: "4-5",
        introduceNewMovements: false,
        projectionStatus: "partially_modeled",
      },
      replacementReadiness: {
        canReplaceRepairedProjection: false,
        reason: expect.arrayContaining([
          "weeks_2_to_4_derived_not_fully_projected",
          "deload_transform_not_production_projected",
          "read_only_non_generative_artifact",
        ]),
      },
    });
    expect(payload.plannerOnlyNoRepair?.v2TargetVsNoRepairDiff).toMatchObject({
      version: 1,
      source: "v2_planner_no_repair_experimental",
      readOnly: true,
      affectsScoringOrGeneration: false,
      replacementReadinessImpact: {
        canReplaceRepairedProjection: false,
      },
    });
    expect(
      payload.plannerOnlyNoRepair?.v2TargetVsNoRepairDiff.summary.targetLaneCount,
    ).toBeGreaterThan(0);
    expect(
      payload.plannerOnlyNoRepair?.v2TargetVsNoRepairDiff.slotDiffs
        .find((slot) => slot.slotId === "upper_a")
        ?.laneDiffs.find((lane) => lane.laneId === "chest_anchor"),
    ).toMatchObject({
      currentStatus: "blocked",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining(["setPolicy:hard_blocker"]),
      },
    });
    expect(payload.plannerOnlyNoRepair?.v2SetDistributionIntent).toMatchObject({
      version: 1,
      source: "v2_planner_policy",
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        weekCount: 5,
        slotCount: 4,
        laneCount: expect.any(Number),
      },
      guardrails: {
        doesNotUseRepairedProjectionAsTarget: true,
        doesNotUseAcceptedSeedAsTarget: true,
        doesNotAffectSelection: true,
        doesNotAffectRepair: true,
        doesNotAffectRuntimeReplay: true,
      },
    });
    expect(
      payload.plannerOnlyNoRepair?.v2SetDistributionIntent.weeks[1].slots.find(
        (slot) => slot.slotId === "upper_a",
      )?.lanes.find((lane) => lane.laneId === "chest_anchor"),
    ).toMatchObject({
      setBudget: {
        min: 3,
        preferred: 4,
        max: 4,
        basis: "target_lane",
      },
      capPolicy: {
        maxSetsPerExerciseWithoutJustification: 5,
      },
      concentrationPolicy: {
        warningShare: 0.5,
        blockerShare: 0.6,
        appliesTo: "primary_target",
      },
    });
    expect(
      payload.plannerOnlyNoRepair?.v2SetDistributionIntent.weeks[4].slots[0].lanes[0].setBudget.basis,
    ).toBe("deload_transform");
    expect(
      payload.plannerOnlyNoRepair?.v2MesocyclePlan.validationRules.map(
        (rule) => rule.ruleId,
      ),
    ).toEqual([
      "primary_muscles_above_minimum",
      "required_lanes_present",
      "required_class_intent_satisfied",
      "no_forbidden_slot_primary_solution",
      "no_back_extension_as_clean_hamstrings_closure",
      "no_unjustified_gt_5_sets",
      "no_unjustified_primary_concentration",
      "no_unjustified_duplicate_main_lift",
      "runtime_seed_replay_deterministic",
      "repair_not_required_for_basic_shape",
      "full_mesocycle_progression_projected",
      "deload_transform_projected",
    ]);
    expect(
      payload.plannerOnlyNoRepair?.v2MesocyclePlan.validationRules.find(
        (rule) => rule.ruleId === "full_mesocycle_progression_projected",
      ),
    ).toMatchObject({
      severity: "migration_scoreboard",
      week1Status: "not_applicable",
      fullMesocycleStatus: "limited",
    });
    expect(
      JSON.stringify(payload.plannerOnlyNoRepair?.v2MesocyclePlan).length,
    ).toBeLessThan(12000);
    expect(
      JSON.stringify(payload.plannerOnlyNoRepair?.v2TargetVsNoRepairDiff).length,
    ).toBeLessThan(16000);
    expect(
      JSON.stringify(payload.plannerOnlyNoRepair?.v2SetDistributionIntent).length,
    ).toBeLessThan(80000);
    expect(payload.plannerOnlyNoRepair?.slotPlans[0]).toMatchObject({
      slotId: "upper_a",
      exercises: [
        {
          exerciseName: "Incline Dumbbell Press",
          lane: "chest_anchor",
          exerciseClass: "chest_press",
          sets: 6,
        },
      ],
      missingLanes: expect.arrayContaining([
        "chest_anchor:partial",
        "chest_secondary:missing",
      ]),
      unresolvedDemand: expect.arrayContaining([
        expect.stringContaining("Chest:shortfall_4"),
      ]),
    });
    expect(payload.plannerOnlyNoRepair?.acceptanceChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "primary muscles above minimum",
          status: "fail",
        }),
      ]),
    );
    expect(mocks.projectSuccessorSlotPlansFromSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.projectSuccessorSlotPlansFromSnapshot.mock.calls[0]?.[0]).not.toHaveProperty(
      "experimentalPlannerOnlyNoRepair",
    );
    expect(mocks.projectSuccessorSlotPlansFromSnapshot.mock.calls[1]?.[0]).toMatchObject({
      experimentalPlannerOnlyNoRepair: true,
    });
    expect(mocks.buildMesocycleSlotPlanSeed).toHaveBeenCalledTimes(1);
  });

  it("classifies diagnostic and collateral concentration rows without failing no-repair acceptance", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Rear Delt Fly",
            primaryMuscles: ["Rear Delts"],
            stimulus: { "Rear Delts": 4 },
            percentages: { "Rear Delts": 64.5 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Machine Shoulder Press",
            isCompound: true,
            primaryMuscles: ["Side Delts"],
            stimulus: { "Front Delts": 3.5 },
            percentages: { "Front Delts": 70 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Barbell Curl",
            primaryMuscles: ["Biceps"],
            stimulus: { Forearms: 1 },
            percentages: { Forearms: 100 },
          },
          {
            slotId: "lower_b",
            exerciseName: "Goblet Squat",
            isCompound: true,
            primaryMuscles: ["Quads"],
            stimulus: { Core: 1 },
            percentages: { Core: 100 },
          },
          {
            slotId: "lower_a",
            exerciseName: "Hack Squat",
            isCompound: true,
            primaryMuscles: ["Quads"],
            stimulus: { Adductors: 3 },
            percentages: { Adductors: 54.5 },
          },
        ],
        demands: [
          {
            muscle: "Rear Delts",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 4,
            preferredEffectiveSets: 6,
            maxEffectiveSets: 12,
          },
          {
            muscle: "Front Delts",
            priority: "implicit",
            targetStatus: "diagnostic",
            minEffectiveSets: null,
          },
          {
            muscle: "Forearms",
            priority: "secondary",
            targetStatus: "diagnostic",
            minEffectiveSets: 2,
            maxEffectiveSets: 6,
          },
          {
            muscle: "Core",
            priority: "secondary",
            targetStatus: "diagnostic",
            minEffectiveSets: 4,
            maxEffectiveSets: 12,
          },
          {
            muscle: "Adductors",
            priority: "secondary",
            targetStatus: "diagnostic",
            minEffectiveSets: 2,
            maxEffectiveSets: 8,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    expect(noRepair.acceptanceFailures).toEqual([]);
    expect(noRepair.qualityWarnings).toEqual([
      expect.objectContaining({
        severity: "quality_warning",
        slotId: "upper_a",
        exerciseName: "Cable Rear Delt Fly",
        muscle: "Rear Delts",
        reason: "support_direct_isolation_concentrated_but_clean_and_near_or_at_target",
      }),
    ]);
    expect(noRepair.diagnosticRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "diagnostic_only",
          slotId: "upper_b",
          exerciseName: "Machine Shoulder Press",
          muscle: "Front Delts",
        }),
        expect.objectContaining({
          severity: "diagnostic_only",
          slotId: "lower_a",
          exerciseName: "Hack Squat",
          muscle: "Adductors",
        }),
      ]),
    );
    expect(noRepair.ignoredRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "ignored_for_acceptance",
          slotId: "upper_b",
          exerciseName: "Barbell Curl",
          muscle: "Forearms",
        }),
        expect.objectContaining({
          severity: "ignored_for_acceptance",
          slotId: "lower_b",
          exerciseName: "Goblet Squat",
          muscle: "Core",
        }),
      ]),
    );
    expect(
      noRepair.acceptanceChecks.find(
        (check) => check.check === "no concentration acceptance blockers",
      ),
    ).toMatchObject({
      status: "pass",
      evidence: ["quality_warnings:1", "diagnostic_rows:2", "ignored_rows:2"],
    });
    expect(noRepair.slotPlans.flatMap((slot) => slot.validationFailures)).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("Cable Rear Delt Fly:Rear Delts"),
        expect.stringContaining("Machine Shoulder Press:Front Delts"),
        expect.stringContaining("Barbell Curl:Forearms"),
        expect.stringContaining("Goblet Squat:Core"),
        expect.stringContaining("Hack Squat:Adductors"),
      ]),
    );
    expect(noRepair.acceptanceClassification).toMatchObject({
      basicMesocycleShapeStatus: "pass_with_warnings",
      replacementReadinessStatus: "not_ready",
      hardBlockers: [],
      migrationScoreboard: {
        canReplaceRepairedProjection: false,
      },
    });
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact.blockers,
    ).not.toEqual(
      expect.arrayContaining([
        "secondary_or_implicit_collateral_not_acceptance_target",
        "compound_or_curl_collateral_denominator_artifact",
        "read_only_non_generative_artifact",
        "blocked_lanes:0",
        "repair_dependent_lanes:0",
      ]),
    );
    expect(noRepair.summary.status).toBe("pass_with_warnings");
  });

  it("classifies the current artifact-like no-repair shape as basic pass-with-warnings and replacement not-ready", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Incline Dumbbell Press",
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_press"],
            stimulus: { Chest: 5 },
          },
          {
            slotId: "upper_a",
            exerciseName: "Lat Pulldown",
            primaryMuscles: ["Lats"],
            movementPatterns: ["vertical_pull"],
            stimulus: { Lats: 4.5 },
          },
          {
            slotId: "upper_a",
            exerciseName: "Cable Rear Delt Fly",
            primaryMuscles: ["Rear Delts"],
            stimulus: { "Rear Delts": 4 },
            percentages: { "Rear Delts": 64.5 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Machine Chest Press",
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_press"],
            stimulus: { Chest: 5 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Seated Cable Row",
            primaryMuscles: ["Lats"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { Lats: 4.4 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Machine Shoulder Press",
            isCompound: true,
            primaryMuscles: ["Side Delts"],
            movementPatterns: ["vertical_press"],
            stimulus: { "Side Delts": 3, "Front Delts": 3.5 },
            percentages: { "Front Delts": 70 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Machine Lateral Raise",
            primaryMuscles: ["Side Delts"],
            movementPatterns: ["isolation"],
            stimulus: { "Side Delts": 3 },
            percentages: { "Side Delts": 50 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Barbell Curl",
            primaryMuscles: ["Biceps"],
            stimulus: { Forearms: 1 },
            percentages: { Forearms: 100 },
          },
          {
            slotId: "lower_a",
            exerciseName: "Hack Squat",
            isCompound: true,
            primaryMuscles: ["Quads"],
            movementPatterns: ["squat"],
            setCount: 4,
            stimulus: { Quads: 4, Adductors: 3 },
            percentages: { Quads: 50, Adductors: 54.5 },
          },
          {
            slotId: "lower_a",
            exerciseName: "Leg Extension",
            primaryMuscles: ["Quads"],
            movementPatterns: ["isolation"],
            setCount: 2,
            stimulus: { Quads: 2 },
            percentages: { Quads: 25 },
          },
          {
            slotId: "lower_a",
            exerciseName: "Standing Calf Raise",
            primaryMuscles: ["Calves"],
            stimulus: { Calves: 4 },
          },
          {
            slotId: "lower_b",
            exerciseName: "Romanian Deadlift",
            primaryMuscles: ["Hamstrings"],
            movementPatterns: ["hinge"],
            stimulus: { Hamstrings: 3.3 },
          },
          {
            slotId: "lower_b",
            exerciseName: "Seated Leg Curl",
            primaryMuscles: ["Hamstrings"],
            movementPatterns: ["knee_flexion"],
            stimulus: { Hamstrings: 3 },
          },
          {
            slotId: "lower_b",
            exerciseName: "Seated Calf Raise",
            primaryMuscles: ["Calves"],
            stimulus: { Calves: 4 },
          },
          {
            slotId: "lower_b",
            exerciseName: "Goblet Squat",
            isCompound: true,
            primaryMuscles: ["Quads"],
            movementPatterns: ["squat"],
            stimulus: { Quads: 2, Core: 1 },
            percentages: { Quads: 25, Core: 100 },
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 10,
            preferredEffectiveSets: 10,
            maxEffectiveSets: 16,
          },
          {
            muscle: "Hamstrings",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 6,
            preferredEffectiveSets: 6,
            maxEffectiveSets: 16,
          },
          {
            muscle: "Lats",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 8,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 16,
          },
          {
            muscle: "Quads",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 8,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 16,
          },
          {
            muscle: "Side Delts",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 4,
            preferredEffectiveSets: 6,
            maxEffectiveSets: 19,
          },
          {
            muscle: "Calves",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 8,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 16,
          },
          {
            muscle: "Rear Delts",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 4,
            preferredEffectiveSets: 6,
            maxEffectiveSets: 12,
          },
          {
            muscle: "Front Delts",
            priority: "implicit",
            targetStatus: "diagnostic",
            minEffectiveSets: null,
          },
          {
            muscle: "Forearms",
            priority: "secondary",
            targetStatus: "diagnostic",
            minEffectiveSets: 2,
            maxEffectiveSets: 6,
          },
          {
            muscle: "Core",
            priority: "secondary",
            targetStatus: "diagnostic",
            minEffectiveSets: 4,
            maxEffectiveSets: 12,
          },
          {
            muscle: "Adductors",
            priority: "secondary",
            targetStatus: "diagnostic",
            minEffectiveSets: 2,
            maxEffectiveSets: 8,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    expect(noRepair.acceptanceClassification).toMatchObject({
      basicMesocycleShapeStatus: "pass_with_warnings",
      replacementReadinessStatus: "not_ready",
      hardBlockers: [],
    });
    expect(noRepair.acceptanceClassification.qualityWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "primary_hard_target_50_to_60_share_warning_threshold",
          evidence: expect.arrayContaining([
            expect.stringContaining("lower_a:Hack Squat:Quads:50%"),
          ]),
        }),
        expect.objectContaining({
          code: "support_direct_isolation_concentrated_but_clean_and_near_or_at_target",
        }),
      ]),
    );
    expect(noRepair.qualityWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "quality_warning",
          slotId: "lower_a",
          exerciseName: "Hack Squat",
          muscle: "Quads",
          percentageOfWeeklyStimulus: 50,
          reason: "primary_hard_target_50_to_60_share_warning_threshold",
        }),
      ]),
    );
    expect(
      noRepair.v2TargetVsNoRepairDiff.slotDiffs
        .find((slot) => slot.slotId === "lower_a")
        ?.laneDiffs.find((lane) => lane.laneId === "squat_anchor"),
    ).toMatchObject({
      currentStatus: "partial",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "keep_diagnostic_only",
      severity: "quality_warning",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Hack Squat",
            sets: 4,
            matchedClass: "squat_or_quad_support",
          }),
        ],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:quality_warning",
          "setBudget:within_preferred",
          "concentration:primary_anchor",
          "concentration:anchor_expected",
          "concentration:quality_warning",
          "justification:squat_anchor",
          "justification:second_quad_exposure",
          "justification:weekly_target_met",
        ]),
      },
    });
    expect(
      noRepair.v2TargetVsNoRepairDiff.slotDiffs
        .find((slot) => slot.slotId === "lower_a")
        ?.laneDiffs.find((lane) => lane.laneId === "squat_anchor")?.currentEvidence
        .selectedExercises,
    ).toHaveLength(1);
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact
        .nextBestMigrationSlice,
    ).toBeNull();
    expect(noRepair.acceptanceClassification.diagnosticOnly).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "secondary_or_implicit_collateral_not_acceptance_target",
        }),
        expect.objectContaining({
          code: "compound_or_curl_collateral_denominator_artifact",
        }),
      ]),
    );
  });

  it("keeps squat-anchor concentration strict to lane-owned squat evidence and downgrades only when justified", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "lower_a",
            exerciseName: "Hack Squat",
            isCompound: true,
            role: "main",
            setCount: 4,
            primaryMuscles: ["Quads"],
            movementPatterns: ["squat"],
            stimulus: { Quads: 7 },
            percentages: { Quads: 70 },
          },
          {
            slotId: "lower_a",
            exerciseName: "Leg Extension",
            setCount: 2,
            primaryMuscles: ["Quads"],
            movementPatterns: ["isolation"],
            stimulus: { Quads: 1.5 },
            percentages: { Quads: 15 },
          },
          {
            slotId: "lower_b",
            exerciseName: "Goblet Squat",
            isCompound: true,
            setCount: 2,
            primaryMuscles: ["Quads"],
            movementPatterns: ["squat"],
            stimulus: { Quads: 1.5 },
            percentages: { Quads: 15 },
          },
        ],
        demands: [
          {
            muscle: "Quads",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 10,
            preferredEffectiveSets: 10,
            maxEffectiveSets: 16,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "lower_a")
      ?.laneDiffs.find((row) => row.laneId === "squat_anchor");

    expect(lane).toMatchObject({
      currentStatus: "partial",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "keep_diagnostic_only",
      severity: "quality_warning",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Hack Squat",
            sets: 4,
            matchedClass: "squat_or_quad_support",
          }),
        ],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:quality_warning",
          "concentration:primary_anchor",
          "concentration:over_60_share",
          "concentration:anchor_expected",
          "concentration:quality_warning",
          "justification:squat_anchor",
          "justification:second_quad_exposure",
          "justification:weekly_target_met",
        ]),
      },
    });
    expect(lane?.currentEvidence.selectedExercises).toHaveLength(1);
    expect(lane?.currentEvidence.selectedExercises).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ name: "Leg Extension" }),
        expect.objectContaining({ name: "Goblet Squat" }),
      ]),
    );
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact
        .nextBestMigrationSlice,
    ).not.toBe("chest_second_exposure:needs_concentration_justification");
  });

  it("keeps primary-anchor over-60 concentration actionable without second exposure", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "lower_a",
            exerciseName: "Hack Squat",
            isCompound: true,
            role: "main",
            setCount: 4,
            primaryMuscles: ["Quads"],
            movementPatterns: ["squat"],
            stimulus: { Quads: 7 },
            percentages: { Quads: 100 },
          },
        ],
        demands: [
          {
            muscle: "Quads",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 7,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 16,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "lower_a")
      ?.laneDiffs.find((row) => row.laneId === "squat_anchor");

    expect(lane).toMatchObject({
      currentStatus: "blocked",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "needs_concentration_justification",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:over_60_share",
          "concentration:primary_anchor",
          "concentration:over_60_share",
          "concentration:true_blocker",
          "concentration:needs_diversification",
        ]),
      },
    });
  });

  it("keeps squat-anchor over-five and axial or systemic fatigue risk actionable", () => {
    const overFive = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "lower_a",
            exerciseName: "Hack Squat",
            isCompound: true,
            role: "main",
            setCount: 6,
            primaryMuscles: ["Quads"],
            movementPatterns: ["squat"],
            stimulus: { Quads: 6 },
            percentages: { Quads: 60 },
          },
          {
            slotId: "lower_b",
            exerciseName: "Goblet Squat",
            isCompound: true,
            setCount: 2,
            primaryMuscles: ["Quads"],
            movementPatterns: ["squat"],
            stimulus: { Quads: 2 },
            percentages: { Quads: 40 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });
    const axialRisk = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "lower_a",
            exerciseName: "Hack Squat",
            isCompound: true,
            role: "main",
            setCount: 4,
            primaryMuscles: ["Quads"],
            movementPatterns: ["squat", "axial_fatigue"],
            stimulus: { Quads: 4 },
            percentages: { Quads: 50 },
          },
          {
            slotId: "lower_a",
            exerciseName: "Leg Extension",
            setCount: 2,
            primaryMuscles: ["Quads"],
            movementPatterns: ["isolation"],
            stimulus: { Quads: 2 },
            percentages: { Quads: 25 },
          },
          {
            slotId: "lower_b",
            exerciseName: "Goblet Squat",
            isCompound: true,
            setCount: 2,
            primaryMuscles: ["Quads"],
            movementPatterns: ["squat"],
            stimulus: { Quads: 2 },
            percentages: { Quads: 25 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const overFiveLane = overFive.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "lower_a")
      ?.laneDiffs.find((row) => row.laneId === "squat_anchor");
    const axialLane = axialRisk.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "lower_a")
      ?.laneDiffs.find((row) => row.laneId === "squat_anchor");

    expect(overFiveLane).toMatchObject({
      currentStatus: "blocked",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:gt_5_sets",
        ]),
      },
    });
    expect(axialLane).toMatchObject({
      currentStatus: "blocked",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:axial_fatigue",
          "risk:axial_fatigue",
        ]),
      },
    });
  });

  it("does not use repaired projection as squat-anchor target policy", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "lower_a",
            exerciseName: "Hack Squat",
            isCompound: true,
            role: "main",
            setCount: 4,
            primaryMuscles: ["Quads"],
            movementPatterns: ["squat"],
            stimulus: { Quads: 7 },
            percentages: { Quads: 100 },
          },
        ],
        demands: [
          {
            muscle: "Quads",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 7,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 16,
          },
        ],
      }),
      repairedPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "lower_a",
            exerciseName: "Hack Squat",
            isCompound: true,
            role: "main",
            setCount: 4,
            primaryMuscles: ["Quads"],
            movementPatterns: ["squat"],
            stimulus: { Quads: 7 },
            percentages: { Quads: 70 },
          },
          {
            slotId: "lower_a",
            exerciseName: "Leg Extension",
            setCount: 2,
            primaryMuscles: ["Quads"],
            movementPatterns: ["isolation"],
            stimulus: { Quads: 3 },
            percentages: { Quads: 30 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "lower_a")
      ?.laneDiffs.find((row) => row.laneId === "squat_anchor");

    expect(lane).toMatchObject({
      currentStatus: "blocked",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "needs_concentration_justification",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.not.arrayContaining([
          "justification:second_quad_exposure",
        ]),
      },
    });
    expect(noRepair.v2SetDistributionIntent.guardrails).toMatchObject({
      doesNotUseRepairedProjectionAsTarget: true,
      doesNotUseAcceptedSeedAsTarget: true,
    });
  });

  it("blocks primary hard targets above 60 percent even when the target is met", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Incline Dumbbell Press",
            isCompound: true,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_press"],
            stimulus: { Chest: 7 },
            percentages: { Chest: 70 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Machine Chest Press",
            isCompound: true,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_press"],
            stimulus: { Chest: 3 },
            percentages: { Chest: 30 },
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 10,
            preferredEffectiveSets: 10,
            maxEffectiveSets: 16,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    expect(noRepair.acceptanceFailures).toEqual([
      expect.objectContaining({
        severity: "acceptance_blocker",
        slotId: "upper_a",
        exerciseName: "Incline Dumbbell Press",
        muscle: "Chest",
        reason: "primary_hard_target_excessive_single_exercise_share_unjustified",
      }),
    ]);
    expect(
      noRepair.acceptanceChecks.find(
        (check) => check.check === "no concentration acceptance blockers",
      ),
    ).toMatchObject({ status: "fail" });
    expect(noRepair.acceptanceClassification).toMatchObject({
      basicMesocycleShapeStatus: "fail",
      replacementReadinessStatus: "blocked",
      hardBlockers: expect.arrayContaining([
        expect.objectContaining({
          code: "primary_hard_target_excessive_single_exercise_share_unjustified",
        }),
      ]),
    });
    expect(
      noRepair.v2TargetVsNoRepairDiff.slotDiffs
        .find((slot) => slot.slotId === "upper_a")
        ?.laneDiffs.find((lane) => lane.laneId === "chest_anchor"),
    ).toMatchObject({
      currentStatus: "blocked",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "needs_concentration_justification",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:over_60_share",
        ]),
      },
    });
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact
        .nextBestMigrationSlice,
    ).toBe("chest_anchor:needs_concentration_justification");
  });

  it("adds compact row-anchor set-budget evidence from V2 policy without using repaired projection as target", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Chest-Supported T-Bar Row",
            isCompound: true,
            setCount: 3,
            primaryMuscles: ["Lats", "Upper Back"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { Lats: 3, "Upper Back": 3 },
            percentages: { Lats: 37.5, "Upper Back": 37.5 },
          },
        ],
        demands: [
          {
            muscle: "Lats",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 3,
            preferredEffectiveSets: 4,
            maxEffectiveSets: 8,
          },
        ],
      }),
      repairedPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Chest-Supported T-Bar Row",
            isCompound: true,
            setCount: 6,
            primaryMuscles: ["Lats", "Upper Back"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { Lats: 6, "Upper Back": 6 },
            percentages: { Lats: 75, "Upper Back": 75 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    expect(
      noRepair.v2TargetVsNoRepairDiff.slotDiffs
        .find((slot) => slot.slotId === "upper_a")
        ?.laneDiffs.find((lane) => lane.laneId === "row_anchor"),
    ).toMatchObject({
      currentStatus: "satisfied",
      gapCause: "none",
      migrationRecommendation: "no_action",
      severity: "pass",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:in_budget",
          "setBudget:within_preferred",
          "justification:none",
        ]),
      },
    });
    expect(noRepair.v2SetDistributionIntent.guardrails).toMatchObject({
      doesNotUseRepairedProjectionAsTarget: true,
      doesNotUseAcceptedSeedAsTarget: true,
    });
  });

  it("classifies row-anchor over allowed expansion as requiring justification rather than a hard blocker", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Chest-Supported T-Bar Row",
            setCount: 3,
            primaryMuscles: ["Lats", "Upper Back"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { Lats: 3, "Upper Back": 3 },
            percentages: { Lats: 34, "Upper Back": 34 },
          },
          {
            slotId: "upper_a",
            exerciseName: "Seated Cable Row",
            setCount: 3,
            primaryMuscles: ["Lats", "Upper Back"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { Lats: 3, "Upper Back": 3 },
            percentages: { Lats: 33, "Upper Back": 33 },
          },
          {
            slotId: "upper_a",
            exerciseName: "Machine Row",
            setCount: 3,
            primaryMuscles: ["Lats", "Upper Back"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { Lats: 3, "Upper Back": 3 },
            percentages: { Lats: 33, "Upper Back": 33 },
          },
        ],
        demands: [
          {
            muscle: "Lats",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 6,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 12,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    expect(
      noRepair.v2TargetVsNoRepairDiff.slotDiffs
        .find((slot) => slot.slotId === "upper_a")
        ?.laneDiffs.find((lane) => lane.laneId === "row_anchor"),
    ).toMatchObject({
      currentStatus: "partial",
      gapCause: "set_distribution_gap",
      migrationRecommendation: "needs_set_budget_justification",
      severity: "quality_warning",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:requires_justification",
          "setPolicyReason:over_allowed_expansion",
          "setBudget:requires_justification",
          "justification:slot_anchor",
        ]),
      },
    });
  });

  it("allows justified row-anchor overage as a warning/partial lane instead of blocking it", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Chest-Supported T-Bar Row",
            isCompound: true,
            setCount: 5,
            primaryMuscles: ["Lats", "Upper Back"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { Lats: 5, "Upper Back": 5 },
            percentages: { Lats: 50, "Upper Back": 50 },
          },
        ],
        demands: [
          {
            muscle: "Lats",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 5,
            preferredEffectiveSets: 6,
            maxEffectiveSets: 10,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    expect(
      noRepair.v2TargetVsNoRepairDiff.slotDiffs
        .find((slot) => slot.slotId === "upper_a")
        ?.laneDiffs.find((lane) => lane.laneId === "row_anchor"),
    ).toMatchObject({
      currentStatus: "partial",
      severity: "quality_warning",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:allowed_expansion",
          "setBudget:allowed_expansion",
          "justification:phase_expansion",
          "justification:slot_anchor",
        ]),
      },
    });
    expect(
      noRepair.v2TargetVsNoRepairDiff.slotDiffs
        .find((slot) => slot.slotId === "upper_a")
        ?.laneDiffs.find((lane) => lane.laneId === "row_anchor")?.currentStatus,
    ).not.toBe("blocked");
  });

  it("classifies chest-secondary set budget with strict lane-owned evidence only", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Crossover",
            setCount: 3,
            primaryMuscles: ["Chest"],
            movementPatterns: ["isolation"],
            stimulus: { Chest: 3 },
            percentages: { Chest: 33 },
          },
          {
            slotId: "upper_a",
            exerciseName: "Deficit Push-Up",
            setCount: 3,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_push"],
            stimulus: { Chest: 3 },
            percentages: { Chest: 33 },
          },
          {
            slotId: "upper_a",
            exerciseName: "Chest-Supported T-Bar Row",
            setCount: 2,
            primaryMuscles: ["Biceps"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { Biceps: 2 },
            percentages: { Biceps: 100 },
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 6,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 12,
          },
        ],
      }),
      repairedPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Deficit Push-Up",
            setCount: 5,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_push"],
            stimulus: { Chest: 5 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "chest_secondary");

    expect(lane).toMatchObject({
      currentStatus: "satisfied",
      gapCause: "none",
      migrationRecommendation: "no_action",
      severity: "pass",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Cable Crossover",
            sets: 3,
            matchedClass: "chest_isolation",
          }),
        ],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:in_budget",
          "setBudget:within_preferred",
          "justification:none",
        ]),
      },
    });
    expect(lane?.currentEvidence.selectedExercises).toHaveLength(1);
    expect(lane?.currentEvidence.relevantDiagnostics).not.toContain(
      "setPolicy:requires_justification",
    );
    expect(lane?.currentEvidence.relevantDiagnostics).toEqual([
      "setPolicy:in_budget",
      "setBudget:within_preferred",
      "justification:none",
    ]);
    expect(
      lane?.currentEvidence.relevantDiagnostics.some((row) =>
        row.includes("Biceps")
      )
    ).toBe(false);
  });

  it("classifies chest-secondary above preferred as requiring justification rather than hard blocking", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Crossover",
            role: "main",
            setCount: 5,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_push"],
            stimulus: { Chest: 5 },
            percentages: { Chest: 45 },
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 5,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 12,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "chest_secondary");

    expect(lane).toMatchObject({
      currentStatus: "partial",
      gapCause: "set_distribution_gap",
      migrationRecommendation: "needs_set_budget_justification",
      severity: "quality_warning",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:requires_justification",
          "setPolicyReason:over_role_cap",
          "setBudget:requires_justification",
          "justification:none",
        ]),
      },
    });
    expect(lane?.currentStatus).not.toBe("blocked");
    expect(lane?.currentEvidence.relevantDiagnostics).not.toContain(
      "setPolicy:hard_blocker",
    );
  });

  it("allows justified chest-secondary overage as a warning/partial lane instead of blocking it", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Crossover",
            role: "accessory",
            setCount: 4,
            primaryMuscles: ["Chest"],
            movementPatterns: ["isolation"],
            stimulus: { Chest: 4 },
            percentages: { Chest: 45 },
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 4,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 12,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "chest_secondary");

    expect(lane).toMatchObject({
      currentStatus: "partial",
      severity: "quality_warning",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:allowed_expansion",
          "setBudget:allowed_expansion",
          "justification:low_systemic_fatigue",
        ]),
      },
    });
    expect(lane?.currentStatus).not.toBe("blocked");
  });

  it("keeps true chest-secondary set and share blockers blocked", () => {
    const overFive = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Crossover",
            setCount: 6,
            primaryMuscles: ["Chest"],
            movementPatterns: ["isolation"],
            stimulus: { Chest: 6 },
            percentages: { Chest: 55 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });
    const overSixtyShare = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Crossover",
            setCount: 4,
            primaryMuscles: ["Chest"],
            movementPatterns: ["isolation"],
            stimulus: { Chest: 4 },
            percentages: { Chest: 64 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const overFiveLane = overFive.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "chest_secondary");
    const overSixtyLane = overSixtyShare.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "chest_secondary");

    expect(overFiveLane).toMatchObject({
      currentStatus: "blocked",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:gt_5_sets",
        ]),
      },
    });
    expect(overSixtyLane).toMatchObject({
      currentStatus: "blocked",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:over_60_share",
        ]),
      },
    });
  });

  it("classifies chest-second exposure with strict lane-owned chest evidence only", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Deficit Push-Up",
            setCount: 3,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_push"],
            stimulus: { Chest: 3 },
            percentages: { Chest: 42.9 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Cable Fly",
            setCount: 4,
            primaryMuscles: ["Chest"],
            movementPatterns: ["isolation"],
            stimulus: { Chest: 4 },
            percentages: { Chest: 57.1 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Machine Shoulder Press",
            setCount: 3,
            primaryMuscles: ["Side Delts", "Front Delts"],
            movementPatterns: ["vertical_press"],
            stimulus: { Chest: 2, "Side Delts": 3 },
            percentages: { Chest: 100, "Side Delts": 100 },
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 7,
            preferredEffectiveSets: 10,
            maxEffectiveSets: 16,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "chest_second_exposure");

    expect(lane).toMatchObject({
      currentStatus: "partial",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "keep_diagnostic_only",
      severity: "quality_warning",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Cable Fly",
            sets: 4,
            matchedClass: "chest_isolation",
          }),
        ],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:quality_warning",
          "setBudget:within_preferred",
          "concentration:chest_primary",
          "concentration:second_exposure",
          "concentration:quality_warning",
          "concentration:class_distinct",
          "concentration:exercise_distinct",
          "justification:second_chest_exposure",
          "justification:weekly_target_met",
          "justification:upper_slot_distribution",
        ]),
      },
    });
    expect(lane?.currentEvidence.selectedExercises).toHaveLength(1);
    expect(lane?.currentEvidence.selectedExercises).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ name: "Machine Shoulder Press" }),
      ]),
    );
    expect(noRepair.weeklyMuscleTotals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          projectedEffectiveSets: 9,
          status: "within",
        }),
      ]),
    );
  });

  it("keeps chest-second primary concentration actionable above 60 percent when distinct exposure is not justified", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Deficit Push-Up",
            setCount: 3,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_push"],
            stimulus: { Chest: 3 },
            percentages: { Chest: 30 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Machine Chest Press",
            setCount: 4,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_push"],
            stimulus: { Chest: 7 },
            percentages: { Chest: 70 },
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 10,
            preferredEffectiveSets: 10,
            maxEffectiveSets: 16,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "chest_second_exposure");

    expect(lane).toMatchObject({
      currentStatus: "blocked",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "needs_concentration_justification",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:over_60_share",
          "concentration:chest_primary",
          "concentration:second_exposure",
          "concentration:over_60_share",
          "concentration:needs_distinct_exposure",
          "concentration:true_blocker",
        ]),
      },
    });
  });

  it("downgrades in-budget distinct chest-second exposure to a diagnostic quality warning", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Deficit Push-Up",
            setCount: 3,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_push"],
            stimulus: { Chest: 3 },
            percentages: { Chest: 42.9 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Cable Fly",
            setCount: 4,
            primaryMuscles: ["Chest"],
            movementPatterns: ["isolation"],
            stimulus: { Chest: 4 },
            percentages: { Chest: 57.1 },
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 7,
            preferredEffectiveSets: 10,
            maxEffectiveSets: 16,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "chest_second_exposure");

    expect(lane).toMatchObject({
      currentStatus: "partial",
      migrationRecommendation: "keep_diagnostic_only",
      severity: "quality_warning",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:quality_warning",
          "setBudget:within_preferred",
          "concentration:class_distinct",
          "concentration:exercise_distinct",
          "justification:class_distinct",
          "justification:second_chest_exposure",
          "justification:weekly_target_met",
        ]),
      },
    });
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact
        .nextBestMigrationSlice,
    ).not.toBe("chest_second_exposure:needs_concentration_justification");
  });

  it("keeps duplicate or same-class chest-second exposure actionable when distinct exposure is required", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Deficit Push-Up",
            setCount: 3,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_push"],
            stimulus: { Chest: 3 },
            percentages: { Chest: 45 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Machine Chest Press",
            setCount: 4,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_push"],
            stimulus: { Chest: 4 },
            percentages: { Chest: 55 },
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 7,
            preferredEffectiveSets: 10,
            maxEffectiveSets: 16,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "chest_second_exposure");

    expect(lane).toMatchObject({
      currentStatus: "partial",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "needs_concentration_justification",
      severity: "quality_warning",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:quality_warning",
          "concentration:needs_distinct_exposure",
          "justification:none",
        ]),
      },
    });
  });

  it("keeps dirty or forbidden chest-second evidence actionable", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Deficit Push-Up",
            setCount: 3,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_push"],
            stimulus: { Chest: 3 },
            percentages: { Chest: 42.9 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Cable Fly",
            setCount: 4,
            primaryMuscles: ["Chest"],
            movementPatterns: ["isolation"],
            stimulus: { Chest: 4 },
            percentages: { Chest: 57.1 },
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 7,
            preferredEffectiveSets: 10,
            maxEffectiveSets: 16,
          },
        ],
        setDistributionRowsBySlot: {
          upper_b: ["forbidden_slot_primary_solution:Chest:upper_b"],
        },
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "chest_second_exposure");

    expect(lane).toMatchObject({
      currentStatus: "blocked",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "needs_concentration_justification",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "forbidden_slot_primary_solution:Chest:upper_b",
          "concentration:second_exposure",
        ]),
      },
    });
  });

  it("does not use repaired projection as the chest-second target policy", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Deficit Push-Up",
            setCount: 3,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_push"],
            stimulus: { Chest: 3 },
            percentages: { Chest: 100 },
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 7,
            preferredEffectiveSets: 10,
            maxEffectiveSets: 16,
          },
        ],
      }),
      repairedPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Cable Fly",
            setCount: 4,
            primaryMuscles: ["Chest"],
            movementPatterns: ["isolation"],
            stimulus: { Chest: 4 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "chest_second_exposure");

    expect(lane).toMatchObject({
      currentStatus: "repair_dependent",
      gapCause: "repair_dependency",
      severity: "migration_candidate",
      currentEvidence: {
        selectedExercises: [],
        relevantDiagnostics: expect.arrayContaining([
          "repair_dependent:repaired_projection_has_lane",
        ]),
      },
    });
    expect(noRepair.v2SetDistributionIntent.guardrails).toMatchObject({
      doesNotUseRepairedProjectionAsTarget: true,
      doesNotUseAcceptedSeedAsTarget: true,
    });
  });

  it("classifies rear-delt set budget with strict lane-owned evidence only", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Rear Delt Fly",
            setCount: 2,
            primaryMuscles: ["Rear Delts"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { "Rear Delts": 2 },
            percentages: { "Rear Delts": 40 },
          },
          {
            slotId: "upper_a",
            exerciseName: "Chest-Supported Row",
            setCount: 3,
            primaryMuscles: ["Upper Back", "Lats"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { "Rear Delts": 1.5, "Upper Back": 3, Lats: 3 },
            percentages: { "Rear Delts": 30, "Upper Back": 50, Lats: 50 },
          },
          {
            slotId: "upper_a",
            exerciseName: "Machine Shoulder Press",
            setCount: 3,
            primaryMuscles: ["Side Delts", "Front Delts"],
            movementPatterns: ["vertical_push"],
            stimulus: { "Rear Delts": 0.5, "Side Delts": 3 },
            percentages: { "Rear Delts": 10, "Side Delts": 50 },
          },
        ],
        demands: [
          {
            muscle: "Rear Delts",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 2,
            preferredEffectiveSets: 4,
            maxEffectiveSets: 8,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "rear_delt");

    expect(lane).toMatchObject({
      currentStatus: "satisfied",
      gapCause: "none",
      migrationRecommendation: "no_action",
      severity: "pass",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Cable Rear Delt Fly",
            sets: 2,
            matchedClass: "rear_delt_isolation",
          }),
        ],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:in_budget",
          "setBudget:within_preferred",
          "justification:none",
        ]),
      },
    });
    expect(lane?.currentEvidence.selectedExercises).toHaveLength(1);
    expect(
      lane?.currentEvidence.selectedExercises.some((exercise) =>
        exercise.name.includes("Row") || exercise.name.includes("Shoulder")
      )
    ).toBe(false);
  });

  it("classifies rear-delt above preferred as requiring justification rather than hard blocking", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Rear Delt Fly",
            role: "main",
            setCount: 5,
            primaryMuscles: ["Rear Delts"],
            movementPatterns: ["isolation"],
            stimulus: { "Rear Delts": 5 },
            percentages: { "Rear Delts": 45 },
          },
        ],
        demands: [
          {
            muscle: "Rear Delts",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 5,
            preferredEffectiveSets: 6,
            maxEffectiveSets: 10,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "rear_delt");

    expect(lane).toMatchObject({
      currentStatus: "partial",
      gapCause: "set_distribution_gap",
      migrationRecommendation: "needs_set_budget_justification",
      severity: "quality_warning",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:requires_justification",
          "setPolicyReason:over_role_cap",
          "setBudget:requires_justification",
          "justification:none",
        ]),
      },
    });
    expect(lane?.currentStatus).not.toBe("blocked");
    expect(lane?.currentEvidence.relevantDiagnostics).not.toContain(
      "setPolicy:hard_blocker",
    );
  });

  it("keeps rear-delt >5-set blockers blocked while downgrading clean low-denominator share", () => {
    const overFive = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Rear Delt Fly",
            setCount: 6,
            primaryMuscles: ["Rear Delts"],
            movementPatterns: ["isolation"],
            stimulus: { "Rear Delts": 6 },
            percentages: { "Rear Delts": 55 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });
    const overSixtyShare = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Rear Delt Fly",
            setCount: 2,
            primaryMuscles: ["Rear Delts"],
            movementPatterns: ["isolation"],
            stimulus: { "Rear Delts": 2 },
            percentages: { "Rear Delts": 64 },
          },
        ],
        demands: [
          {
            muscle: "Rear Delts",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 2,
            preferredEffectiveSets: 4,
            maxEffectiveSets: 8,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const overFiveLane = overFive.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "rear_delt");
    const overSixtyLane = overSixtyShare.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "rear_delt");

    expect(overFiveLane).toMatchObject({
      currentStatus: "blocked",
      severity: "hard_blocker",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Cable Rear Delt Fly",
            sets: 6,
          }),
        ],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:gt_5_sets",
        ]),
      },
    });
    expect(overSixtyLane).toMatchObject({
      currentStatus: "partial",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "keep_diagnostic_only",
      severity: "quality_warning",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Cable Rear Delt Fly",
            sets: 2,
          }),
        ],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:quality_warning",
          "setBudget:within_preferred",
          "concentration:support_tier",
          "concentration:small_denominator",
          "concentration:quality_warning",
          "concentration:justified_direct_isolation",
          "justification:low_systemic_fatigue",
          "justification:small_target_denominator",
        ]),
      },
    });
    expect(overSixtyLane?.currentEvidence.relevantDiagnostics).not.toEqual(
      expect.arrayContaining(["setPolicy:hard_blocker", "setPolicyReason:over_60_share"]),
    );
    expect(
      overSixtyLane?.currentEvidence.relevantDiagnostics.some((entry) =>
        entry.toLowerCase().includes("hard_blocker"),
      ),
    ).toBe(false);
    expect(
      overSixtyShare.v2TargetVsNoRepairDiff.replacementReadinessImpact
        .nextBestMigrationSlice,
    ).toBeNull();
  });

  it("classifies triceps concentration from lane-owned direct evidence, not pressing collateral", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Incline Dumbbell Bench Press",
            isCompound: true,
            setCount: 3,
            primaryMuscles: ["Chest", "Triceps"],
            movementPatterns: ["horizontal_push"],
            stimulus: { Chest: 3, Triceps: 4 },
            percentages: { Chest: 40, Triceps: 69 },
          },
          {
            slotId: "upper_a",
            exerciseName: "Cable Triceps Pushdown",
            setCount: 2,
            primaryMuscles: ["Triceps"],
            movementPatterns: ["isolation"],
            stimulus: { Triceps: 2 },
            percentages: { Triceps: 31 },
          },
        ],
        demands: [
          {
            muscle: "Triceps",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 2,
            preferredEffectiveSets: 4,
            maxEffectiveSets: 10,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "triceps");

    expect(lane).toMatchObject({
      currentStatus: "satisfied",
      gapCause: "none",
      migrationRecommendation: "no_action",
      severity: "pass",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Cable Triceps Pushdown",
            sets: 2,
            matchedClass: "triceps_isolation",
          }),
        ],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:in_budget",
          "setBudget:within_preferred",
          "justification:none",
        ]),
      },
    });
    expect(lane?.currentEvidence.selectedExercises).toHaveLength(1);
    expect(
      lane?.currentEvidence.selectedExercises.some((exercise) =>
        exercise.name.includes("Bench")
      )
    ).toBe(false);
    expect(lane?.currentEvidence.relevantDiagnostics).not.toContain(
      "concentration:quality_warning",
    );
  });

  it("downgrades explained triceps support isolation concentration to diagnostic-only", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Triceps Pushdown",
            setCount: 2,
            primaryMuscles: ["Triceps"],
            movementPatterns: ["isolation"],
            stimulus: { Triceps: 2 },
            percentages: { Triceps: 69 },
          },
        ],
        demands: [
          {
            muscle: "Triceps",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 2,
            preferredEffectiveSets: 4,
            maxEffectiveSets: 10,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "triceps");

    expect(lane).toMatchObject({
      currentStatus: "partial",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "keep_diagnostic_only",
      severity: "quality_warning",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Cable Triceps Pushdown",
            sets: 2,
            matchedClass: "triceps_isolation",
          }),
        ],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:quality_warning",
          "setBudget:within_preferred",
          "concentration:support_tier",
          "concentration:small_denominator",
          "concentration:quality_warning",
          "concentration:justified_direct_isolation",
          "justification:low_systemic_fatigue",
          "justification:small_target_denominator",
        ]),
      },
    });
    expect(
      lane?.currentEvidence.relevantDiagnostics.some((entry) =>
        entry.toLowerCase().includes("hard_blocker")
      )
    ).toBe(false);
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact
        .nextBestMigrationSlice,
    ).toBeNull();
  });

  it("keeps unexplained and true-hard-blocker triceps concentration actionable", () => {
    const unexplained = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Triceps Pushdown",
            role: "main",
            setCount: 2,
            primaryMuscles: ["Triceps"],
            movementPatterns: ["isolation"],
            stimulus: { Triceps: 2 },
            percentages: { Triceps: 55 },
          },
        ],
        demands: [
          {
            muscle: "Triceps",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 2,
            preferredEffectiveSets: 4,
            maxEffectiveSets: 10,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });
    const overFive = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Triceps Pushdown",
            setCount: 6,
            primaryMuscles: ["Triceps"],
            movementPatterns: ["isolation"],
            stimulus: { Triceps: 6 },
            percentages: { Triceps: 55 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const unexplainedLane = unexplained.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "triceps");
    const overFiveLane = overFive.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "triceps");

    expect(unexplainedLane).toMatchObject({
      currentStatus: "partial",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "needs_concentration_justification",
      severity: "quality_warning",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:quality_warning",
          "concentration:support_tier",
          "concentration:quality_warning",
          "justification:none",
        ]),
      },
    });
    expect(overFiveLane).toMatchObject({
      currentStatus: "blocked",
      gapCause: "capacity_gap",
      migrationRecommendation: "needs_set_budget_justification",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:gt_5_sets",
        ]),
      },
    });
  });

  it("does not use repaired projection as the triceps target policy", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Deficit Push-Up",
            setCount: 3,
            primaryMuscles: ["Chest", "Triceps"],
            movementPatterns: ["horizontal_push"],
            stimulus: { Chest: 3, Triceps: 1 },
            percentages: { Chest: 50, Triceps: 100 },
          },
        ],
      }),
      repairedPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Triceps Pushdown",
            setCount: 2,
            primaryMuscles: ["Triceps"],
            movementPatterns: ["isolation"],
            stimulus: { Triceps: 2 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "triceps");

    expect(lane).toMatchObject({
      currentStatus: "repair_dependent",
      gapCause: "repair_dependency",
      severity: "migration_candidate",
      currentEvidence: {
        selectedExercises: [],
        relevantDiagnostics: expect.arrayContaining([
          "repair_dependent:repaired_projection_has_lane",
        ]),
      },
    });
    expect(noRepair.v2SetDistributionIntent.guardrails).toMatchObject({
      doesNotUseRepairedProjectionAsTarget: true,
      doesNotUseAcceptedSeedAsTarget: true,
    });
  });

  it("classifies biceps from strict lane-owned curl evidence, not pulling collateral", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Close-Grip Lat Pulldown",
            setCount: 3,
            primaryMuscles: ["Lats"],
            movementPatterns: ["vertical_pull"],
            stimulus: { Lats: 3, Biceps: 2.4 },
            percentages: { Lats: 65, Biceps: 46.2 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Close-Grip Seated Cable Row",
            setCount: 2,
            primaryMuscles: ["Upper Back", "Lats"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { "Upper Back": 2, Lats: 2, Biceps: 0.8 },
            percentages: { "Upper Back": 65, Lats: 35, Biceps: 15.4 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Barbell Curl",
            setCount: 2,
            primaryMuscles: ["Biceps"],
            movementPatterns: ["isolation"],
            stimulus: { Biceps: 2 },
            percentages: { Biceps: 38.5 },
          },
        ],
        demands: [
          {
            muscle: "Biceps",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 6,
            preferredEffectiveSets: 6,
            maxEffectiveSets: 14,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "biceps");

    expect(lane).toMatchObject({
      currentStatus: "partial",
      gapCause: "set_distribution_gap",
      migrationRecommendation: "needs_set_distribution_policy",
      severity: "quality_warning",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Barbell Curl",
            sets: 2,
            matchedClass: "biceps_curl",
          }),
        ],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:in_budget",
          "setBudget:within_preferred",
          "target_delivery:below_min",
          "exposure:single_direct_curl",
          "concentration:pulling_collateral",
        ]),
      },
    });
    expect(lane?.currentEvidence.selectedExercises).toHaveLength(1);
    expect(
      lane?.currentEvidence.selectedExercises.some((exercise) =>
        exercise.name.includes("Pulldown") || exercise.name.includes("Row")
      )
    ).toBe(false);
    expect(lane?.currentEvidence.relevantDiagnostics).not.toContain(
      "concentration:dirty_collateral",
    );
  });

  it("clears biceps set-distribution action when direct curl rises to three sets and weekly target is met", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Close-Grip Lat Pulldown",
            setCount: 3,
            primaryMuscles: ["Lats"],
            movementPatterns: ["vertical_pull"],
            stimulus: { Lats: 3, Biceps: 2.4 },
            percentages: { Lats: 65, Biceps: 38.7 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Close-Grip Seated Cable Row",
            setCount: 2,
            primaryMuscles: ["Upper Back", "Lats"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { "Upper Back": 2, Lats: 2, Biceps: 0.8 },
            percentages: { "Upper Back": 65, Lats: 35, Biceps: 12.9 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Barbell Curl",
            setCount: 3,
            primaryMuscles: ["Biceps"],
            movementPatterns: ["isolation"],
            stimulus: { Biceps: 3 },
            percentages: { Biceps: 48.4 },
          },
        ],
        demands: [
          {
            muscle: "Biceps",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 6,
            preferredEffectiveSets: 6,
            maxEffectiveSets: 14,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "biceps");

    expect(lane).toMatchObject({
      currentStatus: "satisfied",
      gapCause: "none",
      migrationRecommendation: "no_action",
      severity: "pass",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Barbell Curl",
            sets: 3,
            matchedClass: "biceps_curl",
          }),
        ],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:in_budget",
          "setBudget:within_preferred",
          "exposure:single_direct_curl",
          "concentration:pulling_collateral",
        ]),
      },
    });
    expect(lane?.currentEvidence.relevantDiagnostics).not.toContain(
      "target_delivery:below_min",
    );
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact
        .nextBestMigrationSlice,
    ).not.toBe("biceps:needs_set_distribution_policy");
  });

  it("does not select quality-warning or optional diagnostic rows as next migration slice", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Close-Grip Lat Pulldown",
            setCount: 3,
            primaryMuscles: ["Lats"],
            movementPatterns: ["vertical_pull"],
            stimulus: { Lats: 3, Biceps: 2.4 },
            percentages: { Lats: 40, Biceps: 46.2 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Close-Grip Seated Cable Row",
            setCount: 2,
            primaryMuscles: ["Upper Back", "Lats"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { "Upper Back": 2, Lats: 2, Biceps: 0.8 },
            percentages: { "Upper Back": 40, Lats: 35, Biceps: 15.4 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Barbell Curl",
            setCount: 2,
            primaryMuscles: ["Biceps"],
            movementPatterns: ["isolation"],
            stimulus: { Biceps: 2 },
            percentages: { Biceps: 38.5 },
          },
          {
            slotId: "lower_b",
            exerciseName: "Glute Bridge",
            setCount: 3,
            primaryMuscles: ["Glutes"],
            movementPatterns: ["hinge"],
            stimulus: { Glutes: 3 },
            percentages: { Glutes: 40 },
          },
          {
            slotId: "lower_b",
            exerciseName: "Goblet Squat",
            setCount: 2,
            primaryMuscles: ["Quads", "Glutes"],
            movementPatterns: ["squat"],
            stimulus: { Glutes: 2, Core: 2 },
            percentages: { Core: 100, Glutes: 26.7 },
          },
        ],
        demands: [
          {
            muscle: "Biceps",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 6,
            preferredEffectiveSets: 6,
            maxEffectiveSets: 14,
          },
          {
            muscle: "Glutes",
            priority: "secondary",
            targetStatus: "diagnostic",
            minEffectiveSets: 6,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 16,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const upperB = noRepair.v2TargetVsNoRepairDiff.slotDiffs.find(
      (slot) => slot.slotId === "upper_b",
    );
    const lowerB = noRepair.v2TargetVsNoRepairDiff.slotDiffs.find(
      (slot) => slot.slotId === "lower_b",
    );
    const biceps = upperB?.laneDiffs.find((row) => row.laneId === "biceps");
    const optionalGluteCore = lowerB?.laneDiffs.find(
      (row) => row.laneId === "optional_glute_core_if_recoverable",
    );

    expect(biceps).toMatchObject({
      currentStatus: "partial",
      gapCause: "set_distribution_gap",
      migrationRecommendation: "needs_set_distribution_policy",
      severity: "quality_warning",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "target_delivery:below_min",
        ]),
      },
    });
    expect(optionalGluteCore).toMatchObject({
      currentStatus: "partial",
      gapCause: "set_distribution_gap",
      migrationRecommendation: "keep_diagnostic_only",
      severity: "diagnostic_only",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:requires_justification",
          "setBudget:requires_justification",
        ]),
      },
    });
    expect(noRepair.v2TargetVsNoRepairDiff.summary.migrationCandidateCount).toBe(0);
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact
        .nextBestMigrationSlice,
    ).toBeNull();
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact.blockers,
    ).toEqual([]);
  });

  it("can still select an optional lane when it has a true hard blocker", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "lower_b",
            exerciseName: "Cable Crunch",
            setCount: 6,
            primaryMuscles: ["Core"],
            movementPatterns: ["isolation"],
            stimulus: { Core: 6 },
            percentages: { Core: 100 },
          },
        ],
        demands: [
          {
            muscle: "Core",
            priority: "secondary",
            targetStatus: "diagnostic",
            minEffectiveSets: 4,
            preferredEffectiveSets: 6,
            maxEffectiveSets: 16,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const optionalGluteCore = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "lower_b")
      ?.laneDiffs.find(
        (row) => row.laneId === "optional_glute_core_if_recoverable",
      );

    expect(optionalGluteCore).toMatchObject({
      currentStatus: "blocked",
      gapCause: "capacity_gap",
      migrationRecommendation: "needs_set_budget_justification",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:gt_5_sets",
        ]),
      },
    });
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact
        .nextBestMigrationSlice,
    ).toBe("optional_glute_core_if_recoverable:needs_set_budget_justification");
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact.blockers,
    ).toEqual(
      expect.arrayContaining([
        "blocked_lanes:1",
        "optional_glute_core_if_recoverable:needs_set_budget_justification",
      ]),
    );
  });

  it("does not let pulling collateral directly solve biceps lane evidence", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Close-Grip Lat Pulldown",
            setCount: 3,
            primaryMuscles: ["Lats"],
            movementPatterns: ["vertical_pull"],
            stimulus: { Lats: 3, Biceps: 3 },
            percentages: { Lats: 60, Biceps: 100 },
          },
        ],
        demands: [
          {
            muscle: "Biceps",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 2,
            preferredEffectiveSets: 6,
            maxEffectiveSets: 14,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "biceps");

    expect(lane).toMatchObject({
      currentStatus: "missing",
      gapCause: "set_distribution_gap",
      migrationRecommendation: "needs_set_distribution_policy",
      severity: "quality_warning",
      currentEvidence: {
        selectedExercises: [],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:under_budget",
          "exposure:missing_direct_curl",
          "concentration:pulling_collateral",
        ]),
      },
    });
  });

  it("relabels stale Calves shortfall diagnostics when weekly and lane targets are satisfied", () => {
    const planningReality = makeNoRepairConcentrationPlanningReality({
      exercises: [
        {
          slotId: "lower_a",
          exerciseName: "Standing Calf Raise",
          setCount: 4,
          primaryMuscles: ["Calves"],
          movementPatterns: ["isolation"],
          stimulus: { Calves: 4 },
          percentages: { Calves: 49 },
        },
        {
          slotId: "lower_b",
          exerciseName: "Seated Calf Raise",
          setCount: 4,
          primaryMuscles: ["Calves"],
          movementPatterns: ["isolation"],
          stimulus: { Calves: 4 },
          percentages: { Calves: 49 },
        },
      ],
      demands: [
        {
          muscle: "Calves",
          priority: "support",
          targetStatus: "soft",
          minEffectiveSets: 8,
          preferredEffectiveSets: 8,
          maxEffectiveSets: 14,
        },
      ],
    });
    planningReality.allocationVsFinalDelta = [
      {
        slotId: "lower_a",
        slotIndex: 0,
        comparison: "allocation_vs_final",
        responsibilityLoad: "clear",
        underAllocatedMuscles: [
          {
            muscle: "Calves",
            role: "support",
            targetStatus: "soft",
            expectedEffectiveSets: 8,
            actualEffectiveSets: 4,
            shortfall: 4,
          },
        ],
        unallocatedStimulusMuscles: [],
        notes: [],
      },
    ] as PlannerOnlyPlanningReality["allocationVsFinalDelta"];
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: planningReality,
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const calvesLane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "lower_a")
      ?.laneDiffs.find((row) => row.laneId === "calves");

    expect(noRepair.weeklyMuscleTotals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Calves",
          projectedEffectiveSets: 8,
          targetMin: 8,
          status: "within",
        }),
      ]),
    );
    expect(calvesLane).toMatchObject({
      currentStatus: "satisfied",
      gapCause: "none",
      migrationRecommendation: "no_action",
      severity: "pass",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "readout_note:stale_calves_shortfall_suppressed_weekly_within_lane_satisfied",
        ]),
      },
    });
    expect(calvesLane?.currentEvidence.relevantDiagnostics).not.toEqual(
      expect.arrayContaining([
        "Calves:shortfall_4",
        "Calves:repair_would_be_needed_here",
        "target_delivery:below_min",
      ]),
    );
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact.blockers,
    ).not.toEqual(
      expect.arrayContaining([
        "required_calves_lower_slot_distribution_missing",
        "non_blocking_session_shaping_rows",
        "calves:needs_set_distribution_policy",
      ]),
    );
  });

  it("downgrades explained biceps support isolation concentration to diagnostic-only", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Barbell Curl",
            setCount: 2,
            primaryMuscles: ["Biceps"],
            movementPatterns: ["isolation"],
            stimulus: { Biceps: 2 },
            percentages: { Biceps: 69 },
          },
        ],
        demands: [
          {
            muscle: "Biceps",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 2,
            preferredEffectiveSets: 4,
            maxEffectiveSets: 14,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "biceps");

    expect(lane).toMatchObject({
      currentStatus: "partial",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "keep_diagnostic_only",
      severity: "quality_warning",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Barbell Curl",
            sets: 2,
            matchedClass: "biceps_curl",
          }),
        ],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:quality_warning",
          "setBudget:within_preferred",
          "concentration:support_tier",
          "concentration:small_denominator",
          "concentration:quality_warning",
          "concentration:justified_direct_isolation",
          "justification:low_systemic_fatigue",
          "justification:small_target_denominator",
        ]),
      },
    });
    expect(
      lane?.currentEvidence.relevantDiagnostics.some((entry) =>
        entry.toLowerCase().includes("hard_blocker")
      )
    ).toBe(false);
  });

  it("keeps biceps missing direct exposure, over-five sets, and repaired-only evidence actionable", () => {
    const repairedOnly = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Close-Grip Lat Pulldown",
            setCount: 3,
            primaryMuscles: ["Lats"],
            movementPatterns: ["vertical_pull"],
            stimulus: { Lats: 3, Biceps: 1 },
            percentages: { Lats: 60, Biceps: 100 },
          },
        ],
      }),
      repairedPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Barbell Curl",
            setCount: 2,
            primaryMuscles: ["Biceps"],
            movementPatterns: ["isolation"],
            stimulus: { Biceps: 2 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });
    const overFive = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Barbell Curl",
            setCount: 6,
            primaryMuscles: ["Biceps"],
            movementPatterns: ["isolation"],
            stimulus: { Biceps: 6 },
            percentages: { Biceps: 100 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const repairedOnlyLane = repairedOnly.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "biceps");
    const overFiveLane = overFive.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "biceps");

    expect(repairedOnlyLane).toMatchObject({
      currentStatus: "repair_dependent",
      gapCause: "repair_dependency",
      severity: "migration_candidate",
      currentEvidence: {
        selectedExercises: [],
        relevantDiagnostics: expect.arrayContaining([
          "repair_dependent:repaired_projection_has_lane",
          "exposure:missing_direct_curl",
        ]),
      },
    });
    expect(overFiveLane).toMatchObject({
      currentStatus: "blocked",
      gapCause: "capacity_gap",
      migrationRecommendation: "needs_set_budget_justification",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:gt_5_sets",
        ]),
      },
    });
    expect(repairedOnly.v2SetDistributionIntent.guardrails).toMatchObject({
      doesNotUseRepairedProjectionAsTarget: true,
      doesNotUseAcceptedSeedAsTarget: true,
    });
  });

  it("classifies vertical press concentration from strict lane-owned pressing evidence", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Machine Shoulder Press",
            isCompound: true,
            setCount: 3,
            primaryMuscles: ["Side Delts"],
            movementPatterns: ["vertical_press"],
            stimulus: { "Side Delts": 3, "Front Delts": 3 },
            percentages: { "Side Delts": 50, "Front Delts": 70 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Close-Grip Lat Pulldown",
            setCount: 3,
            primaryMuscles: ["Lats"],
            movementPatterns: ["vertical_pull"],
            stimulus: { Lats: 3 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Machine Lateral Raise",
            setCount: 3,
            primaryMuscles: ["Side Delts"],
            movementPatterns: ["isolation"],
            stimulus: { "Side Delts": 3 },
            percentages: { "Side Delts": 50 },
          },
        ],
        demands: [
          {
            muscle: "Side Delts",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 8,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 19,
          },
          {
            muscle: "Front Delts",
            priority: "implicit",
            targetStatus: "diagnostic",
            minEffectiveSets: null,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "vertical_press");

    expect(lane).toMatchObject({
      currentStatus: "partial",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "keep_diagnostic_only",
      severity: "quality_warning",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Machine Shoulder Press",
            sets: 3,
            matchedClass: "vertical_press",
          }),
        ],
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:quality_warning",
          "setBudget:within_preferred",
          "concentration:vertical_press",
          "concentration:pressing_collateral",
          "concentration:primary_anchor",
          "concentration:quality_warning",
          "justification:vertical_press_lane",
          "justification:direct_side_delt_exposure",
          "justification:front_delt_collateral_expected",
        ]),
      },
    });
    expect(lane?.currentEvidence.selectedExercises).toHaveLength(1);
    expect(
      lane?.currentEvidence.selectedExercises.some((exercise) =>
        exercise.name.includes("Pulldown") || exercise.name.includes("Lateral Raise")
      )
    ).toBe(false);
    expect(
      lane?.currentEvidence.relevantDiagnostics.some((entry) =>
        entry.toLowerCase().includes("hard_blocker")
      )
    ).toBe(false);
    expect(noRepair.weeklyMuscleTotals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Side Delts",
          projectedEffectiveSets: 6,
          status: "below",
        }),
        expect.objectContaining({
          muscle: "Front Delts",
          projectedEffectiveSets: 3,
          status: "diagnostic",
        }),
      ]),
    );
  });

  it("does not let pressing collateral directly solve side-delt or triceps lanes", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Machine Shoulder Press",
            isCompound: true,
            setCount: 3,
            primaryMuscles: ["Side Delts", "Front Delts"],
            movementPatterns: ["vertical_press"],
            stimulus: { "Side Delts": 3, "Front Delts": 3, Triceps: 2 },
            percentages: { "Side Delts": 75, "Front Delts": 75, Triceps: 100 },
          },
        ],
        demands: [
          {
            muscle: "Side Delts",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 3,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 12,
          },
          {
            muscle: "Triceps",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 2,
            preferredEffectiveSets: 5,
            maxEffectiveSets: 12,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const upperB = noRepair.v2TargetVsNoRepairDiff.slotDiffs.find(
      (slot) => slot.slotId === "upper_b",
    );
    const sideDelt = upperB?.laneDiffs.find(
      (row) => row.laneId === "side_delt_isolation",
    );
    const triceps = upperB?.laneDiffs.find(
      (row) => row.laneId === "optional_triceps_if_under_target",
    );

    expect(sideDelt).toMatchObject({
      currentStatus: "blocked",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "needs_concentration_justification",
      severity: "hard_blocker",
    });
    expect(triceps).toMatchObject({
      currentStatus: "missing",
      currentEvidence: {
        selectedExercises: [],
      },
      migrationRecommendation: "keep_diagnostic_only",
    });
  });

  it("does not use repaired projection as the vertical-press target policy", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Machine Lateral Raise",
            setCount: 3,
            primaryMuscles: ["Side Delts"],
            movementPatterns: ["isolation"],
            stimulus: { "Side Delts": 3 },
          },
        ],
      }),
      repairedPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Machine Shoulder Press",
            setCount: 3,
            primaryMuscles: ["Side Delts", "Front Delts"],
            movementPatterns: ["vertical_press"],
            stimulus: { "Side Delts": 3, "Front Delts": 3 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "vertical_press");

    expect(lane).toMatchObject({
      currentStatus: "repair_dependent",
      gapCause: "repair_dependency",
      severity: "migration_candidate",
      currentEvidence: {
        selectedExercises: [],
        relevantDiagnostics: expect.arrayContaining([
          "repair_dependent:repaired_projection_has_lane",
        ]),
      },
    });
    expect(noRepair.v2SetDistributionIntent.guardrails).toMatchObject({
      doesNotUseRepairedProjectionAsTarget: true,
      doesNotUseAcceptedSeedAsTarget: true,
    });
  });

  it("keeps vertical-press over-five and fatigue risks actionable", () => {
    const overFive = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Machine Shoulder Press",
            isCompound: true,
            setCount: 6,
            primaryMuscles: ["Side Delts", "Front Delts"],
            movementPatterns: ["vertical_press"],
            stimulus: { "Side Delts": 6, "Front Delts": 6 },
            percentages: { "Side Delts": 75, "Front Delts": 75 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });
    const systemicRisk = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Machine Shoulder Press",
            isCompound: true,
            setCount: 3,
            primaryMuscles: ["Side Delts", "Front Delts"],
            movementPatterns: ["vertical_press", "systemic_fatigue"],
            stimulus: { "Side Delts": 3, "Front Delts": 3 },
            percentages: { "Side Delts": 50, "Front Delts": 70 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Machine Lateral Raise",
            setCount: 3,
            primaryMuscles: ["Side Delts"],
            movementPatterns: ["isolation"],
            stimulus: { "Side Delts": 3 },
            percentages: { "Side Delts": 50 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const overFiveLane = overFive.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "vertical_press");
    const systemicLane = systemicRisk.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "vertical_press");

    expect(overFiveLane).toMatchObject({
      currentStatus: "blocked",
      gapCause: "capacity_gap",
      migrationRecommendation: "needs_set_budget_justification",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:gt_5_sets",
        ]),
      },
    });
    expect(systemicLane).toMatchObject({
      currentStatus: "blocked",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:systemic_fatigue",
          "risk:systemic_fatigue",
        ]),
      },
    });
  });

  it("still blocks dirty collateral concentration when it solves a support target", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_b",
            exerciseName: "Machine Shoulder Press",
            isCompound: true,
            setCount: 3,
            primaryMuscles: ["Side Delts", "Front Delts"],
            movementPatterns: ["vertical_push"],
            stimulus: { "Side Delts": 3, "Front Delts": 3 },
            percentages: { "Side Delts": 75, "Front Delts": 75 },
          },
        ],
        demands: [
          {
            muscle: "Side Delts",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 3,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 12,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_b")
      ?.laneDiffs.find((row) => row.laneId === "side_delt_isolation");

    expect(lane).toMatchObject({
      currentStatus: "blocked",
      gapCause: "concentration_policy_gap",
      migrationRecommendation: "needs_concentration_justification",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:over_60_share",
          "concentration:support_tier",
        ]),
      },
    });
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact
        .nextBestMigrationSlice,
    ).toBe("vertical_press:needs_concentration_justification");
  });

  it("does not use repaired projection as the rear-delt target policy", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Chest-Supported Row",
            setCount: 3,
            primaryMuscles: ["Upper Back", "Lats"],
            movementPatterns: ["horizontal_pull"],
            stimulus: { "Rear Delts": 1.5, "Upper Back": 3, Lats: 3 },
            percentages: { "Rear Delts": 50, "Upper Back": 50, Lats: 50 },
          },
        ],
      }),
      repairedPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Rear Delt Fly",
            setCount: 3,
            primaryMuscles: ["Rear Delts"],
            movementPatterns: ["isolation"],
            stimulus: { "Rear Delts": 3 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    const lane = noRepair.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "upper_a")
      ?.laneDiffs.find((row) => row.laneId === "rear_delt");

    expect(lane).toMatchObject({
      currentStatus: "repair_dependent",
      gapCause: "repair_dependency",
      severity: "migration_candidate",
      currentEvidence: {
        selectedExercises: [],
        relevantDiagnostics: expect.arrayContaining([
          "repair_dependent:repaired_projection_has_lane",
        ]),
      },
    });
    expect(noRepair.v2SetDistributionIntent.guardrails).toMatchObject({
      doesNotUseRepairedProjectionAsTarget: true,
      doesNotUseAcceptedSeedAsTarget: true,
    });
  });

  it("hard-blocks 50-60 percent primary concentration when the primary muscle is below minimum", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Incline Dumbbell Press",
            isCompound: true,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_press"],
            stimulus: { Chest: 5.5 },
            percentages: { Chest: 57.9 },
          },
          {
            slotId: "upper_b",
            exerciseName: "Machine Chest Press",
            isCompound: true,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_press"],
            stimulus: { Chest: 4 },
            percentages: { Chest: 42.1 },
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 10,
            preferredEffectiveSets: 10,
            maxEffectiveSets: 16,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    expect(noRepair.acceptanceFailures).toEqual([
      expect.objectContaining({
        severity: "acceptance_blocker",
        slotId: "upper_a",
        exerciseName: "Incline Dumbbell Press",
        muscle: "Chest",
        percentageOfWeeklyStimulus: 57.9,
        reason: "primary_hard_target_excessive_single_exercise_share_unjustified",
      }),
    ]);
    expect(noRepair.acceptanceClassification).toMatchObject({
      basicMesocycleShapeStatus: "fail",
      replacementReadinessStatus: "blocked",
      hardBlockers: expect.arrayContaining([
        expect.objectContaining({
          code: "primary_hard_target_below_minimum",
        }),
        expect.objectContaining({
          code: "primary_hard_target_excessive_single_exercise_share_unjustified",
        }),
      ]),
    });
  });

  it("blocks no-repair compound/hinge/press exercises above five sets and repair-created concentration", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Machine Chest Press",
            isCompound: true,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_press"],
            setCount: 6,
            stimulus: { Chest: 6 },
            percentages: { Chest: 60 },
            flags: [
              "COMPOUND_GT_5_SETS",
              "EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS",
            ],
          },
          {
            slotId: "upper_b",
            exerciseName: "Cable Lateral Raise",
            primaryMuscles: ["Side Delts"],
            stimulus: { "Side Delts": 4 },
            percentages: { "Side Delts": 66.7 },
            producedOrIncreasedByRepair: true,
            flags: [
              "EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS",
              "SET_COUNT_INCREASED_BY_REPAIR",
            ],
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 10,
            maxEffectiveSets: 16,
          },
          {
            muscle: "Side Delts",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 4,
            maxEffectiveSets: 19,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    expect(noRepair.acceptanceFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseName: "Machine Chest Press",
          muscle: "Chest",
          reason: "exercise_gt_5_sets_without_planner_justification",
        }),
        expect.objectContaining({
          exerciseName: "Cable Lateral Raise",
          muscle: "Side Delts",
          reason: "concentration_created_by_repair_or_set_bump",
        }),
      ]),
    );
    expect(noRepair.acceptanceClassification.hardBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "compound_hinge_or_press_gt_5_sets_without_justification",
        }),
      ]),
    );
    expect(
      noRepair.v2TargetVsNoRepairDiff.slotDiffs
        .find((slot) => slot.slotId === "upper_a")
        ?.laneDiffs.find((lane) => lane.laneId === "chest_anchor"),
    ).toMatchObject({
      currentStatus: "blocked",
      gapCause: "capacity_gap",
      migrationRecommendation: "needs_set_budget_justification",
      severity: "hard_blocker",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "setPolicy:hard_blocker",
          "setPolicyReason:gt_5_sets",
        ]),
      },
    });
  });

  it("keeps migration repair scoreboards out of basic no-repair shape blockers", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Rear Delt Fly",
            primaryMuscles: ["Rear Delts"],
            stimulus: { "Rear Delts": 4 },
            percentages: { "Rear Delts": 64.5 },
          },
        ],
        demands: [
          {
            muscle: "Rear Delts",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 4,
            preferredEffectiveSets: 6,
            maxEffectiveSets: 12,
          },
        ],
      }),
      repairedPlanningReality: makeCalfPlanningReality({
        lowerBCalfShapes: [],
        materialRepairCount: 2,
        majorRepairCount: 1,
        suspiciousRepairCount: 1,
      }) as unknown as PlannerOnlyPlanningReality,
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    expect(noRepair.acceptanceClassification).toMatchObject({
      basicMesocycleShapeStatus: "pass_with_warnings",
      replacementReadinessStatus: "not_ready",
      hardBlockers: [],
      migrationScoreboard: {
        materialRepairCount: 2,
        majorRepairCount: 1,
        suspiciousRepairs: 1,
        canReplaceRepairedProjection: false,
      },
    });
    expect(noRepair.v2MesocyclePlan).toMatchObject({
      planStatus: "full_mesocycle_limited",
      readOnly: true,
      affectsScoringOrGeneration: false,
      replacementReadiness: {
        canReplaceRepairedProjection: false,
        reason: expect.arrayContaining([
          "week_1_basic_shape_valid",
          "weeks_2_to_4_derived_not_fully_projected",
          "deload_transform_not_production_projected",
        ]),
      },
    });
    expect(
      noRepair.v2MesocyclePlan.validationRules.find(
        (rule) => rule.ruleId === "repair_not_required_for_basic_shape",
      ),
    ).toMatchObject({
      week1Status: "pass_with_warning",
      fullMesocycleStatus: "limited",
    });
  });

  it("classifies V2 target lanes against no-repair output without optimizing toward repaired projection", () => {
    const noRepairReality = makeNoRepairConcentrationPlanningReality({
      exercises: [
        {
          slotId: "upper_a",
          exerciseId: "bench",
          exerciseName: "Bench Press",
          role: "main",
          isCompound: true,
          setCount: 4,
          primaryMuscles: ["Chest"],
          movementPatterns: ["horizontal_push"],
          stimulus: { Chest: 4 },
        },
      ],
      demands: [
        {
          muscle: "Chest",
          priority: "primary",
          targetStatus: "hard",
          minEffectiveSets: 4,
          preferredEffectiveSets: 4,
          maxEffectiveSets: 8,
        },
      ],
    });
    const repairedReality = makeNoRepairConcentrationPlanningReality({
      exercises: [
        {
          slotId: "upper_a",
          exerciseId: "bench",
          exerciseName: "Bench Press",
          role: "main",
          isCompound: true,
          setCount: 4,
          primaryMuscles: ["Chest"],
          movementPatterns: ["horizontal_push"],
          stimulus: { Chest: 4 },
        },
        {
          slotId: "upper_a",
          exerciseId: "reverse-pec-deck",
          exerciseName: "Reverse Pec Deck",
          setCount: 3,
          primaryMuscles: ["Rear Delts"],
          movementPatterns: ["isolation"],
          stimulus: { "Rear Delts": 3 },
        },
      ],
      demands: [
        {
          muscle: "Chest",
          priority: "primary",
          targetStatus: "hard",
          minEffectiveSets: 4,
          preferredEffectiveSets: 4,
          maxEffectiveSets: 8,
        },
      ],
    });

    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: noRepairReality,
      repairedPlanningReality: repairedReality,
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });
    const upperA = noRepair.v2TargetVsNoRepairDiff.slotDiffs.find(
      (slot) => slot.slotId === "upper_a",
    );

    expect(noRepair.v2TargetVsNoRepairDiff).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      replacementReadinessImpact: {
        canReplaceRepairedProjection: false,
      },
    });
    expect(upperA?.laneDiffs.find((lane) => lane.laneId === "chest_anchor")).toMatchObject({
      currentStatus: "satisfied",
      gapCause: "none",
      migrationRecommendation: "no_action",
      severity: "pass",
      currentEvidence: {
        selectedExercises: [
          expect.objectContaining({
            name: "Bench Press",
            sets: 4,
          }),
        ],
      },
    });
    expect(upperA?.laneDiffs.find((lane) => lane.laneId === "rear_delt")).toMatchObject({
      currentStatus: "repair_dependent",
      gapCause: "repair_dependency",
      severity: "migration_candidate",
      currentEvidence: {
        relevantDiagnostics: expect.arrayContaining([
          "repair_dependent:repaired_projection_has_lane",
        ]),
      },
    });
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact
        .nextBestMigrationSlice,
    ).toBe("rear_delt:promote_to_planner_later");
    expect(noRepair.v2TargetVsNoRepairDiff.summary.satisfiedLaneCount).toBeGreaterThan(0);
    expect(noRepair.v2TargetVsNoRepairDiff.summary.repairDependentLaneCount).toBeGreaterThan(0);
    expect(noRepair.v2TargetVsNoRepairDiff.summary.migrationCandidateCount).toBeGreaterThan(0);
  });

  it("keeps session-shaping rows visible without promoting them into replacement blockers", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "lower_a",
            exerciseName: "Standing Calf Raise",
            setCount: 4,
            primaryMuscles: ["Calves"],
            movementPatterns: ["isolation"],
            stimulus: { Calves: 4 },
            percentages: { Calves: 50 },
          },
          {
            slotId: "lower_b",
            exerciseName: "Seated Calf Raise",
            setCount: 4,
            primaryMuscles: ["Calves"],
            movementPatterns: ["isolation"],
            stimulus: { Calves: 4 },
            percentages: { Calves: 50 },
          },
        ],
        demands: [
          {
            muscle: "Calves",
            priority: "support",
            targetStatus: "soft",
            minEffectiveSets: 8,
            preferredEffectiveSets: 8,
            maxEffectiveSets: 14,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    expect(noRepair.acceptanceClassification.sessionShaping).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "planner_owned_set_allocation_changes",
        }),
      ]),
    );
    expect(
      noRepair.v2TargetVsNoRepairDiff.replacementReadinessImpact.blockers,
    ).not.toEqual(
      expect.arrayContaining([
        "planner_owned_set_allocation_changes",
        "non_blocking_session_shaping_rows",
        "blocked_lanes:0",
        "repair_dependent_lanes:0",
      ]),
    );
  });

  it("separates Week 1 basic shape from cross-week replacement readiness", () => {
    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Cable Rear Delt Fly",
            primaryMuscles: ["Rear Delts"],
            stimulus: { "Rear Delts": 4 },
            percentages: { "Rear Delts": 64.5 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    expect(noRepair.crossWeekProjectionGate).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      week1Status: {
        status: "pass_with_warnings",
        basis: expect.arrayContaining([
          "basicMesocycleShapeStatus:pass_with_warnings",
          "does_not_imply_replacement_readiness",
        ]),
      },
      replacementReadinessStatus: "not_ready",
      safeToPromoteBehavior: false,
    });
    expect(noRepair.acceptanceClassification).toMatchObject({
      basicMesocycleShapeStatus: "pass_with_warnings",
      replacementReadinessStatus: "not_ready",
    });
  });

  it("labels Weeks 2-4 as planner-owned read-only projection with limitations", () => {
    const planningReality = makeNoRepairConcentrationPlanningReality({
      exercises: [
        {
          slotId: "upper_a",
          exerciseName: "Cable Rear Delt Fly",
          primaryMuscles: ["Rear Delts"],
          stimulus: { "Rear Delts": 4 },
          percentages: { "Rear Delts": 64.5 },
        },
      ],
    });
    planningReality.preselectionDistributionPolicyByWeek.weeks[2] = {
      ...planningReality.preselectionDistributionPolicyByWeek.weeks[2],
      projectionStatus: "not_projected_missing_accumulation_policy",
    };
    planningReality.preselectionDistributionPolicyByWeek.weeks[3] = {
      ...planningReality.preselectionDistributionPolicyByWeek.weeks[3],
      projectionStatus: "not_projected_missing_accumulation_policy",
    };

    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: planningReality,
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    expect(noRepair.crossWeekProjectionGate.accumulationWeeksStatus).toMatchObject({
      status: "projected_with_limitations",
      weeks: [
        expect.objectContaining({
          week: 2,
          projectionBasis: "planner_owned_read_only_projection",
          safeForBehaviorPromotion: false,
          limitations: expect.arrayContaining([
            "planner_owned_week_projection_exists_but_is_diagnostic_only",
            "accepted_seed_runtime_consumption_missing",
            "v2_set_distribution_intent_used_as_lane_budget_policy_only",
          ]),
        }),
        expect.objectContaining({
          week: 3,
          projectionBasis: "planner_owned_read_only_projection",
          limitations: expect.arrayContaining([
            "planner_owned_week_projection_exists_but_is_diagnostic_only",
          ]),
        }),
        expect.objectContaining({
          week: 4,
          projectionBasis: "planner_owned_read_only_projection",
          limitations: expect.arrayContaining([
            "planner_owned_week_projection_exists_but_is_diagnostic_only",
          ]),
        }),
      ],
    });
    expect(noRepair.crossWeekProjectionGate.blockers).toEqual(
      expect.arrayContaining(["weeks_2_to_4_planner_owned_projection_read_only_not_consumed"]),
    );
    expect(noRepair.crossWeekProjectionGate.safeToPromoteBehavior).toBe(false);
    expect(noRepair.plannerOwnedAccumulationProjection).toMatchObject({
      version: 1,
      source: "v2_planner_policy",
      readOnly: true,
      affectsScoringOrGeneration: false,
      weeks: expect.arrayContaining([
        expect.objectContaining({
          week: 2,
          projectionStatus: "planner_owned_read_only",
          safeForBehaviorPromotion: false,
          slots: expect.arrayContaining([
            expect.objectContaining({
              slotId: "upper_a",
              classLanes: expect.arrayContaining([
                expect.objectContaining({
                  laneId: "chest_anchor",
                  setBudget: expect.objectContaining({ preferred: expect.any(Number) }),
                }),
              ]),
            }),
          ]),
        }),
      ]),
    });
    expect(
      noRepair.plannerOwnedAccumulationProjection.weeks.map((week) =>
        week.validation.missingInputs.includes("repair_output_as_target"),
      ),
    ).toEqual([false, false, false]);
  });

  it("labels deload transform as diagnostic-only until seed/runtime consumption exists", () => {
    const planningReality = makeNoRepairConcentrationPlanningReality({
      exercises: [
        {
          slotId: "upper_a",
          exerciseName: "Cable Rear Delt Fly",
          primaryMuscles: ["Rear Delts"],
          stimulus: { "Rear Delts": 4 },
          percentages: { "Rear Delts": 64.5 },
        },
      ],
    });
    planningReality.weeklyDemandCurve = {
      mesocycleId: "meso-1",
      source: "diagnostic_shadow_planner",
      readOnly: true,
      affectsScoringOrGeneration: false,
      designBasis: {
        durationWeeks: 5,
        intensityBias: "MODERATE",
        focus: "Hypertrophy",
        volumeTarget: "MEDIUM",
        splitType: "UPPER_LOWER",
        sessionsPerWeek: 4,
      },
      sourceCatalog: {},
      limitationCatalog: {},
      muscleCatalog: {},
      weeks: [
        {
          week: 5,
          phase: "deload",
          projectionStatus: "not_projected_missing_policy",
          muscles: [],
          weekLevelLimitations: ["missing_deload_identity_set_reduction_policy"],
        },
      ],
      crossWeekWarnings: [],
      candidateBehaviorGate: {
        status: "blocked_until_weekly_curve_is_visible",
        likelyBestFutureBehavior: "chest_upper_slot_distinct_exercise_distribution",
        requiredQuestions: [
          "would_this_improve_weeks_1_to_4_not_just_week_1",
          "would_this_preserve_deload_quality",
          "would_this_increase_fatigue_concentration",
        ],
        evidence: [],
      },
    };
    planningReality.slotDemandAllocationByWeek.weeks.push({
      week: 5,
      phase: "deload",
      projectionStatus: "not_allocated_missing_deload_policy",
      slots: [],
      weekLevelWarnings: [],
    });
    planningReality.preselectionDistributionPolicyByWeek.weeks.push({
      week: 5,
      phase: "deload",
      projectionStatus: "not_projected_missing_deload_policy",
      weekScope: "deload_week",
      slots: [],
      weekLevelWarnings: [],
    });

    const noRepair = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: planningReality,
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });

    expect(noRepair.crossWeekProjectionGate.deloadStatus).toMatchObject({
      status: "diagnostic_projection_only",
      projectionBasis: "v2_deload_transform_read_only",
      preserveIdentities: true,
      targetVolumeReductionPercent: { min: 40, max: 60 },
      targetRir: "4-5",
      safeForBehaviorPromotion: false,
      limitations: expect.arrayContaining([
        "not_applied_to_slotPlanSeedJson",
        "not_used_by_runtime_replay",
        "weeklyDemandCurve:week_5:not_projected_missing_policy",
        "slotDemandAllocationByWeek:week_5:not_allocated_missing_deload_policy",
        "preselectionDistributionPolicyByWeek:week_5:not_projected_missing_deload_policy",
        "accepted_seed_identity_set_reduction_projection_missing",
        "runtime_replay_consumption_path_missing",
      ]),
    });
    expect(noRepair.crossWeekProjectionGate.deloadSummary).toMatchObject({
      preserveExerciseIdentities: true,
      introducesNewMovements: false,
      projectionBasis: "v2_deload_transform_read_only",
    });
    expect(noRepair.crossWeekProjectionGate.blockers).toEqual(
      expect.arrayContaining(["deload_seed_runtime_projection_missing"]),
    );
    expect(noRepair.crossWeekProjectionGate.replacementReadinessStatus).toBe(
      "not_ready",
    );
  });

  it("hard-fails required lanes, dirty Back Extension closure, and runtime replay failure", () => {
    const missingLane = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseName: "Incline Dumbbell Press",
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_press"],
            stimulus: { Chest: 10 },
            percentages: { Chest: 100 },
          },
        ],
        demands: [
          {
            muscle: "Chest",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 10,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });
    expect(missingLane.acceptanceClassification.hardBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "required_chest_upper_exposures_missing",
        }),
      ]),
    );

    const backExtension = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "lower_b",
            exerciseName: "Back Extension (45 Degree)",
            primaryMuscles: ["Hamstrings"],
            movementPatterns: ["hinge"],
            stimulus: { Hamstrings: 8 },
            percentages: { Hamstrings: 100 },
          },
        ],
        demands: [
          {
            muscle: "Hamstrings",
            priority: "primary",
            targetStatus: "hard",
            minEffectiveSets: 6,
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });
    expect(backExtension.acceptanceClassification.hardBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "back_extension_hamstrings_closure",
        }),
      ]),
    );

    const replayFailure = buildPlannerOnlyNoRepairComparison({
      noRepairPlanningReality: makeNoRepairConcentrationPlanningReality({
        exercises: [
          {
            slotId: "upper_a",
            exerciseId: "",
            exerciseName: "Cable Rear Delt Fly",
            primaryMuscles: ["Rear Delts"],
            stimulus: { "Rear Delts": 4 },
            percentages: { "Rear Delts": 64.5 },
          },
        ],
      }),
      compareRepaired: true,
      repairedProjectionAvailable: true,
    });
    expect(replayFailure.acceptanceClassification.hardBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "runtime_seed_replay_failure",
        }),
      ]),
    );
  });

  it("reports blocked when one-slot calf cleanup cannot satisfy the floor without lower_a policy", () => {
    const dryRun = buildPlannerOnlyDryRunComparison(
      makeCalfPlanningReality({
        lowerAFourSetAllocation: false,
        materialRepairCount: 19,
        majorRepairCount: 8,
        suspiciousRepairCount: 6,
      }),
      true,
    );

    expect(dryRun.calvesFourFourCandidate).toMatchObject({
      status: "blocked",
      lowerAProjectedCalfSets: 4,
      lowerBProjectedCalfSets: 4,
      weeklyProjectedCalfEffectiveSets: 8,
      wouldRemoveLowerBSameSessionCalfDuplicate: true,
      wouldReduceSupportFloorClosureRows: true,
      wouldIncreaseCapTrimRows: false,
      preservesLowerBHingeCurlRoute: true,
      lowerASafety: {
        status: "pass",
        currentTotalSets: 2,
        projectedTotalSets: 4,
        slotSetCap: 25,
        wouldExceedSlotCap: false,
        wouldDisplaceHardPrimary: false,
      },
      materialityEstimate: {
        status: "partial",
        expectedMaterialRepairDelta: null,
        expectedMajorRepairDelta: null,
        expectedSuspiciousRepairDelta: -6,
        wouldReduceSupportFloorClosureRows: true,
        wouldIncreaseCapTrimRows: false,
        removableRows: expect.arrayContaining([
          expect.objectContaining({
            category: "support_floor_closure",
            slotId: "lower_a",
            muscle: "Calves",
            exerciseName: "Standing Calf Raise",
          }),
          expect.objectContaining({
            category: "set_bump",
            slotId: "lower_a",
            muscle: "Calves",
            exerciseName: "Standing Calf Raise",
          }),
          expect.objectContaining({
            category: "duplicate_variant",
            slotId: "lower_b",
            muscle: "Calves",
          }),
        ]),
        stillUnknown: expect.arrayContaining([
          "exact_repair_reclassification_requires_full_generation",
          "weeks_2_to_4_unprojected",
        ]),
      },
      policyReadiness: {
        behaviorReadiness: "needs_more_projection",
        remainingBlockers: expect.arrayContaining([
          "weeks_2_to_4_unprojected",
          "materiality_delta_unknown",
        ]),
      },
      recommendation: "needs_more_projection",
      blockedReasons: expect.arrayContaining([
        "weeks_2_to_4_unprojected",
        "materiality_delta_unknown",
      ]),
    });
  });

  it("does not mark behavior safe when Lower A safety is unknown", () => {
    const dryRun = buildPlannerOnlyDryRunComparison(
      makeCalfPlanningReality({
        lowerAFourSetAllocation: true,
        weeksProjected: true,
        materialRepairCount: 0,
        majorRepairCount: 0,
        suspiciousRepairCount: 0,
        capKnown: false,
      }),
      true,
    );

    expect(dryRun.calvesFourFourCandidate).toMatchObject({
      status: "blocked",
      lowerASafety: {
        status: "unknown",
        currentTotalSets: 2,
        projectedTotalSets: 4,
        slotSetCap: null,
        wouldExceedSlotCap: null,
        wouldDisplaceHardPrimary: null,
      },
      policyReadiness: {
        behaviorReadiness: "blocked_by_lower_a_safety",
        remainingBlockers: expect.arrayContaining(["cap_trim_risk_unknown"]),
      },
      recommendation: expect.not.stringMatching("safe_to_trial_behavior"),
    });
  });

  it("does not mark behavior safe when materiality delta is unknown", () => {
    const dryRun = buildPlannerOnlyDryRunComparison(
      makeCalfPlanningReality({
        lowerAFourSetAllocation: true,
        weeksProjected: true,
        materialRepairCount: 19,
        majorRepairCount: 8,
        suspiciousRepairCount: 6,
      }),
      true,
    );

    expect(dryRun.calvesFourFourCandidate).toMatchObject({
      status: "blocked",
      lowerASafety: { status: "pass" },
      materialityEstimate: {
        status: "partial",
        expectedMaterialRepairDelta: null,
        expectedMajorRepairDelta: null,
        expectedSuspiciousRepairDelta: -6,
        stillUnknown: expect.arrayContaining([
          "exact_repair_reclassification_requires_full_generation",
        ]),
      },
      policyReadiness: {
        behaviorReadiness: "needs_more_projection",
        remainingBlockers: expect.arrayContaining(["materiality_delta_unknown"]),
      },
      recommendation: expect.not.stringMatching("safe_to_trial_behavior"),
    });
  });

  it("can mark Week 1 safe while accumulation weeks remain unprojected", () => {
    const dryRun = buildPlannerOnlyDryRunComparison(
      makeCalfPlanningReality({
        lowerAFourSetAllocation: true,
        weeksProjected: false,
        materialRepairCount: 0,
        majorRepairCount: 0,
        suspiciousRepairCount: 0,
      }),
      true,
    );

    expect(dryRun.calvesFourFourCandidate).toMatchObject({
      status: "blocked",
      lowerASafety: { status: "pass" },
      materialityEstimate: {
        status: "improves",
        expectedMaterialRepairDelta: 0,
        expectedMajorRepairDelta: 0,
        expectedSuspiciousRepairDelta: 0,
        removableRows: expect.arrayContaining([
          expect.objectContaining({ category: "support_floor_closure" }),
          expect.objectContaining({ category: "set_bump" }),
          expect.objectContaining({ category: "duplicate_variant" }),
        ]),
        potentialNewRows: [],
        stillUnknown: expect.arrayContaining([
          "weeks_2_to_4_unprojected",
          "cross_week_progression_unknown",
        ]),
      },
      policyReadiness: {
        behaviorReadiness: "needs_more_projection",
        remainingBlockers: ["weeks_2_to_4_unprojected"],
      },
      recommendation: "needs_more_projection",
      blockedReasons: ["weeks_2_to_4_unprojected"],
    });
  });

  it("can report pass when 4+4 Calves distribution is feasible and all gate metrics are safe", () => {
    const dryRun = buildPlannerOnlyDryRunComparison(
      makeCalfPlanningReality({
        lowerAFourSetAllocation: true,
        weeksProjected: true,
        materialRepairCount: 0,
        majorRepairCount: 0,
        suspiciousRepairCount: 0,
      }),
      true,
    );

    expect(dryRun.calvesFourFourCandidate).toMatchObject({
      status: "pass",
      readOnly: true,
      affectsScoringOrGeneration: false,
      lowerAProjectedCalfSets: 4,
      lowerBProjectedCalfSets: 4,
      weeklyProjectedCalfEffectiveSets: 8,
      wouldRemoveLowerBSameSessionCalfDuplicate: true,
      wouldReduceSupportFloorClosureRows: true,
      wouldReduceSetBumps: true,
      wouldIncreaseCapTrimRows: false,
      wouldChangeMaterialRepairCount: "flat",
      wouldChangeMajorRepairCount: "flat",
      wouldChangeSuspiciousRepairCount: "flat",
      preservesLowerBHingeCurlRoute: true,
      lowerASafety: {
        status: "pass",
        currentTotalSets: 2,
        projectedTotalSets: 4,
        slotSetCap: 25,
        wouldExceedSlotCap: false,
        wouldDisplaceHardPrimary: false,
      },
      materialityEstimate: {
        status: "improves",
        expectedMaterialRepairDelta: 0,
        expectedMajorRepairDelta: 0,
        expectedSuspiciousRepairDelta: 0,
        removableRows: expect.arrayContaining([
          expect.objectContaining({ category: "support_floor_closure" }),
          expect.objectContaining({ category: "set_bump" }),
          expect.objectContaining({ category: "duplicate_variant" }),
        ]),
        potentialNewRows: [],
        stillUnknown: [],
      },
      policyReadiness: {
        behaviorReadiness: "safe_to_trial_behavior",
        remainingBlockers: [],
      },
      blockedReasons: [],
      recommendation: "safe_to_trial_behavior",
    });
  });
});
