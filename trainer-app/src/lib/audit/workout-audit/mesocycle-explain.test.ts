import { beforeEach, describe, expect, it, vi } from "vitest";

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
        findMany: (...args: unknown[]) => mesocycleExerciseRoleFindMany(...args),
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) => mocks.loadActiveMesocycle(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff", () => ({
  loadHandoffSourceMesocycle: (...args: unknown[]) => mocks.loadHandoffSourceMesocycle(...args),
  readMesocycleHandoffSummary: (...args: unknown[]) => mocks.readMesocycleHandoffSummary(...args),
  toHandoffProjectionSource: (...args: unknown[]) => mocks.toHandoffProjectionSource(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff-artifacts", () => ({
  materializeHandoffArtifacts: (...args: unknown[]) => mocks.materializeHandoffArtifacts(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff-projection", () => ({
  projectSuccessorMesocycle: (...args: unknown[]) => mocks.projectSuccessorMesocycle(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff-slot-plan-projection", () => ({
  projectSuccessorSlotPlansFromSnapshot: (...args: unknown[]) =>
    mocks.projectSuccessorSlotPlansFromSnapshot(...args),
  buildMesocycleSlotPlanSeed: (...args: unknown[]) => mocks.buildMesocycleSlotPlanSeed(...args),
}));

vi.mock("@/lib/api/projected-week-volume-shared", () => ({
  loadPreloadedGenerationSnapshot: (...args: unknown[]) =>
    mocks.loadPreloadedGenerationSnapshot(...args),
  buildMappedGenerationContextFromSnapshot: (...args: unknown[]) =>
    mocks.buildMappedGenerationContextFromSnapshot(...args),
  generateProjectedSession: (...args: unknown[]) => mocks.generateProjectedSession(...args),
  appendWorkoutHistoryEntryToMappedContext: (...args: unknown[]) =>
    mocks.appendWorkoutHistoryEntryToMappedContext(...args),
  buildProjectedWorkoutHistoryEntry: (...args: unknown[]) =>
    mocks.buildProjectedWorkoutHistoryEntry(...args),
  listWorkoutExerciseNames: (...args: unknown[]) => mocks.listWorkoutExerciseNames(...args),
}));

vi.mock("@/lib/api/readiness", () => ({
  getLatestReadinessSignalForReader: (...args: unknown[]) =>
    mocks.getLatestReadinessSignalForReader(...args),
}));

vi.mock("@/lib/evidence/session-decision-receipt", () => ({
  readSessionSlotSnapshot: (...args: unknown[]) => mocks.readSessionSlotSnapshot(...args),
}));

vi.mock("@/lib/evidence/session-audit-snapshot", () => ({
  resolvePersistedOrReconstructedSessionAuditSnapshot: (...args: unknown[]) =>
    mocks.resolvePersistedOrReconstructedSessionAuditSnapshot(...args),
  buildSessionAuditMutationSummary: (...args: unknown[]) =>
    mocks.buildSessionAuditMutationSummary(...args),
}));

vi.mock("@/lib/api/mesocycle-slot-contract", () => ({
  resolveMesocycleSlotContract: (...args: unknown[]) => mocks.resolveMesocycleSlotContract(...args),
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
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Chest" } },
              ],
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
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Chest" } },
              ],
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
          slots: [
            { slotId: "upper_a", intent: "UPPER" },
          ],
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
    mocks.toHandoffProjectionSource.mockImplementation((value: unknown) => value);
    mocks.materializeHandoffArtifacts.mockImplementation(() => {
      throw new Error("should not rematerialize when persisted handoff summary is present");
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
      ])
    );
    expect(payload.preview.projectionDiagnostics.tradeoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "isolation_injection_trigger",
          reason: "injected_direct_isolation_for_deficit",
          why: expect.stringContaining("direct isolation was inserted"),
        }),
      ])
    );
    expect(payload.preview.projectionDiagnostics.softCapOverridesByP0).toEqual([
      expect.objectContaining({
        category: "soft_cap_overridden_by_p0",
        exerciseId: "ex-1",
        why: expect.stringContaining("soft set cap yielded to P0"),
      }),
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
      ])
    );
    expect(payload.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Historical acceptance-time candidate ranking rationale is not persisted"),
        expect.stringContaining("fresh reprojections"),
      ])
    );
  });
});
