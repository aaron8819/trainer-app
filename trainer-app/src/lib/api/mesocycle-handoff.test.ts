import { describe, expect, it, vi } from "vitest";

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
  acceptMesocycleHandoffInTransaction,
  enterMesocycleHandoffInTransaction,
  findIncompatibleCarryForwardKeeps,
  formatCarryForwardConflictMessage,
  loadClosedMesocycleArchive,
  readMesocycleHandoffSummary,
  readNextCycleSeedDraft,
  sanitizeNextCycleSeedDraft,
  toHandoffProjectionSource,
  type NextMesocycleDesign,
  type NextCycleSeedDraft,
  updateMesocycleHandoffDraftInTransaction,
} from "./mesocycle-handoff";

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
              requiredMovementPatterns: ["vertical_pull"],
              avoidDuplicatePatterns: ["horizontal_pull"],
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
              avoidDuplicatePatterns: ["vertical_pull"],
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
        exercises: [{ exerciseId: "bench" }, { exerciseId: "row" }],
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
            { exerciseId: "bench", role: "CORE_COMPOUND" },
            { exerciseId: "machine-press", role: "ACCESSORY" },
          ],
        },
        {
          slotId: "pull_a",
          intent: "PULL",
          exercises: [{ exerciseId: "row", role: "ACCESSORY" }],
        },
        {
          slotId: "legs_a",
          intent: "LEGS",
          exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND" }],
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

    await acceptMesocycleHandoffInTransaction(
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
      "meso-1"
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
                  { exerciseId: "bench", role: "CORE_COMPOUND" },
                  { exerciseId: "machine-press", role: "ACCESSORY" },
                ],
              },
              {
                slotId: "pull_a",
                exercises: [{ exerciseId: "row", role: "ACCESSORY" }],
              },
              {
                slotId: "legs_a",
                exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND" }],
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
    expect(exerciseRoleCreateMany).not.toHaveBeenCalled();
    expect(constraintsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          weeklySchedule: ["PUSH", "PULL", "LEGS"],
        }),
      })
    );
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
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
        },
        {
          slotId: "lower_a",
          intent: "LOWER",
          exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND" }],
        },
        {
          slotId: "upper_b",
          intent: "UPPER",
          exercises: [{ exerciseId: "row", role: "ACCESSORY" }],
        },
        {
          slotId: "lower_b",
          intent: "LOWER",
          exercises: [{ exerciseId: "split-squat", role: "ACCESSORY" }],
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
      acceptMesocycleHandoffInTransaction(
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
                exercises: [{ exerciseId: "bench" }, { exerciseId: "row" }],
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
        "meso-1"
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
      acceptMesocycleHandoffInTransaction(
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
        "meso-1"
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
      acceptMesocycleHandoffInTransaction(
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
        "meso-1"
      )
    ).rejects.toThrow("MESOCYCLE_HANDOFF_KEEP_SELECTION_CONFLICT:");
  });
});
