import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mesocycleFindUnique = vi.fn();
  const mesocycleUpdate = vi.fn();
  const txMesoFindFirst = vi.fn();
  const txMesoFindUnique = vi.fn();
  const txMesoUpdate = vi.fn();
  const txMesoUpdateMany = vi.fn();
  const txMesoCreate = vi.fn();
  const txWorkoutUpdate = vi.fn();
  const txConstraintsFindUnique = vi.fn();
  const txTrainingBlockCreateMany = vi.fn();
  const txRoleFindMany = vi.fn();
  const txRoleCreateMany = vi.fn();
  const txWorkoutFindMany = vi.fn();
  const txReadinessFindFirst = vi.fn();
  const resolveActivePlanContext = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      mesocycle: {
        findFirst: txMesoFindFirst,
        findUnique: txMesoFindUnique,
        update: txMesoUpdate,
        updateMany: txMesoUpdateMany,
        create: txMesoCreate,
      },
      trainingBlock: {
        createMany: txTrainingBlockCreateMany,
      },
      constraints: {
        findUnique: txConstraintsFindUnique,
      },
      mesocycleExerciseRole: {
        findMany: txRoleFindMany,
        createMany: txRoleCreateMany,
      },
      workout: {
        findMany: txWorkoutFindMany,
        update: txWorkoutUpdate,
      },
      readinessSignal: {
        findFirst: txReadinessFindFirst,
      },
    })
  );

  return {
    mesocycleFindUnique,
    mesocycleUpdate,
    txMesoFindFirst,
    txMesoFindUnique,
    txMesoUpdate,
    txMesoUpdateMany,
    txMesoCreate,
    txWorkoutUpdate,
    txConstraintsFindUnique,
    txTrainingBlockCreateMany,
    txRoleFindMany,
    txRoleCreateMany,
    txWorkoutFindMany,
    txReadinessFindFirst,
    resolveActivePlanContext,
    transaction,
    prisma: {
      mesocycle: {
        findUnique: mesocycleFindUnique,
        update: mesocycleUpdate,
      },
      $transaction: transaction,
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));
vi.mock("./active-plan-context", async (importOriginal) => {
  const original = await importOriginal<typeof import("./active-plan-context")>();
  return {
    ...original,
    claimSelectedPlanForTransitionInTransaction: vi.fn(async () => undefined),
    resolveActivePlanContext: mocks.resolveActivePlanContext,
  };
});

import {
  deriveCurrentMesocycleSession,
  deriveNextAdvancingIntentByWeeklySubtraction,
  deriveNextAdvancingSession,
  finishDeloadEarly,
  finishDeloadEarlyInTransaction,
  FinishDeloadEarlyBlockedWorkoutError,
  finishMesocycleEarly,
  FinishMesocycleEarlyBlockedWorkoutError,
  getLifecycleSetTargets,
  getCurrentMesoWeek,
  getRirTarget,
  getWeeklyVolumeTarget,
  initializeNextMesocycle,
  loadActiveMesocycle,
  resolveStrictFrozenLegacyAuthoredScheduleLifecycle,
  transitionMesocycleState,
  transitionMesocycleStateInTransaction,
} from "./mesocycle-lifecycle";
import {
  CANONICAL_DELOAD_RIR_TARGET,
  CANONICAL_DELOAD_SET_TARGETS,
  CANONICAL_DELOAD_VOLUME_FRACTION,
} from "@/lib/deload/semantics";

const LEGACY_FOUR_DAY_SLOT_SEQUENCE = {
  version: 1,
  source: "handoff_draft",
  sequenceMode: "ordered_flexible",
  slots: [
    { slotId: "upper_a", intent: "UPPER" },
    { slotId: "lower_a", intent: "LOWER" },
    { slotId: "upper_b", intent: "UPPER" },
    { slotId: "lower_b", intent: "LOWER" },
  ],
};

function buildLegacyScheduleWorkout(input: {
  week: number;
  session: number;
  status?: "PLANNED" | "IN_PROGRESS" | "PARTIAL" | "COMPLETED" | "SKIPPED";
  id?: string;
  advancesSplit?: boolean;
  intent?: string;
  selectionMetadata?: unknown;
}) {
  const expectedIntent = input.session === 1 || input.session === 3 ? "UPPER" : "LOWER";
  const slotIds = ["upper_a", "lower_a", "upper_b", "lower_b"];
  const phase = input.week === 5 ? "DELOAD" : "ACCUMULATION";
  return {
    id: input.id ?? `legacy-${input.week}-${input.session}`,
    status: input.status ?? "COMPLETED",
    mesocycleId: "legacy-meso",
    mesocycleWeekSnapshot: input.week,
    mesocyclePhaseSnapshot: phase,
    mesoSessionSnapshot: input.session,
    advancesSplit: input.advancesSplit ?? true,
    selectionMode: "INTENT",
    sessionIntent: input.intent ?? expectedIntent,
    selectionMetadata:
      input.selectionMetadata === undefined
        ? {
            sessionDecisionReceipt: {
              version: 2,
              cycleContext: {
                weekInMeso: input.week,
                weekInBlock: input.week,
                mesocycleLength: 5,
                phase: phase.toLowerCase(),
                blockType: phase.toLowerCase(),
                isDeload: phase === "DELOAD",
                source: "computed",
              },
              sessionProvenance: {
                mesocycleId: "legacy-meso",
                compositionSource: "runtime_selection",
              },
              sessionSlot: {
                slotId: slotIds[input.session - 1],
                intent: expectedIntent.toLowerCase(),
                sequenceIndex: input.session - 1,
                sequenceLength: 4,
                source: "mesocycle_slot_sequence",
              },
              lifecycleVolume: { source: "unknown" },
              sorenessSuppressedMuscles: [],
              deloadDecision: {
                mode: phase === "DELOAD" ? "scheduled" : "none",
                reason: [],
                reductionPercent: 0,
                appliedTo: "none",
              },
              readiness: {
                wasAutoregulated: false,
                signalAgeHours: null,
                fatigueScoreOverall: null,
                intensityScaling: {
                  applied: false,
                  exerciseIds: [],
                  scaledUpCount: 0,
                  scaledDownCount: 0,
                },
              },
              exceptions: [],
            },
          }
        : input.selectionMetadata,
  };
}

function buildLegacyFiveWeekSchedule(
  override?: (workout: ReturnType<typeof buildLegacyScheduleWorkout>) => void,
) {
  const workouts = Array.from({ length: 5 }, (_, weekIndex) =>
    Array.from({ length: 4 }, (_, sessionIndex) =>
      buildLegacyScheduleWorkout({
        week: weekIndex + 1,
        session: sessionIndex + 1,
      }),
    ),
  ).flat();
  workouts.forEach((workout) => override?.(workout));
  return workouts;
}

function mutateLegacyReceipt(
  workout: ReturnType<typeof buildLegacyScheduleWorkout>,
  mutate: (receipt: Record<string, unknown>) => void,
) {
  const copy = structuredClone(workout);
  const metadata = copy.selectionMetadata as {
    sessionDecisionReceipt: Record<string, unknown>;
  };
  mutate(metadata.sessionDecisionReceipt);
  return copy;
}

describe("mesocycle-lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.txMesoUpdateMany.mockResolvedValue({ count: 1 });
  });

  describe("compatible legacy authored-schedule resolution", () => {
    const mesocycle = {
      id: "legacy-meso",
      durationWeeks: 5,
      sessionsPerWeek: 4,
      slotSequenceJson: LEGACY_FOUR_DAY_SLOT_SEQUENCE,
      currentSeedRevision: {
        seedPayload: { version: 2, source: "legacy_accepted_seed" },
      },
    };

    it("closes a five-week schedule when the final deload obligation is skipped without counting it as performed", () => {
      const workouts = buildLegacyFiveWeekSchedule((workout) => {
        if (workout.mesocycleWeekSnapshot === 5 && workout.mesoSessionSnapshot === 4) {
          workout.status = "SKIPPED";
        }
      });

      expect(resolveStrictFrozenLegacyAuthoredScheduleLifecycle({ mesocycle, workouts })).toMatchObject({
        status: "available",
        expectedObligationCount: 20,
        resolvedObligationCount: 20,
        performedCompletionCount: 19,
        accumulationCompletionCount: 16,
        deloadCompletionCount: 3,
        allAccumulationResolved: true,
        allResolved: true,
      });
    });

    it("allows an earlier skip to remain resolved when the final outstanding obligation completes", () => {
      const workouts = buildLegacyFiveWeekSchedule((workout) => {
        if (workout.mesocycleWeekSnapshot === 2 && workout.mesoSessionSnapshot === 2) {
          workout.status = "SKIPPED";
        }
      });

      expect(resolveStrictFrozenLegacyAuthoredScheduleLifecycle({ mesocycle, workouts })).toMatchObject({
        status: "available",
        resolvedObligationCount: 20,
        performedCompletionCount: 19,
        allResolved: true,
      });
    });

    it("keeps the schedule unresolved for PARTIAL or any other outstanding authored obligation", () => {
      const workouts = buildLegacyFiveWeekSchedule((workout) => {
        if (workout.mesocycleWeekSnapshot === 3 && workout.mesoSessionSnapshot === 1) {
          workout.status = "PARTIAL";
        }
      });

      expect(resolveStrictFrozenLegacyAuthoredScheduleLifecycle({ mesocycle, workouts })).toMatchObject({
        status: "available",
        resolvedObligationCount: 19,
        performedCompletionCount: 19,
        allResolved: false,
      });
    });

    it("ignores stale out-of-schedule rows and explicit non-advancing rows", () => {
      const workouts = [
        ...buildLegacyFiveWeekSchedule(),
        {
          ...buildLegacyScheduleWorkout({
            week: 6,
            session: 1,
            status: "IN_PROGRESS",
            id: "stale-future",
          }),
          selectionMetadata: {
            sessionDecisionReceipt: { malformed: true },
          },
        },
        buildLegacyScheduleWorkout({
          week: 5,
          session: 4,
          status: "PLANNED",
          id: "optional-extra",
          advancesSplit: false,
        }),
      ];

      expect(resolveStrictFrozenLegacyAuthoredScheduleLifecycle({ mesocycle, workouts })).toMatchObject({
        status: "available",
        expectedObligationCount: 20,
        resolvedObligationCount: 20,
        performedCompletionCount: 20,
        allResolved: true,
      });
    });

    it("fails closed on duplicate or malformed claims against an authored obligation", () => {
      const duplicate = [
        ...buildLegacyFiveWeekSchedule(),
        buildLegacyScheduleWorkout({
          week: 5,
          session: 4,
          status: "SKIPPED",
          id: "duplicate-lower-b",
        }),
      ];
      expect(resolveStrictFrozenLegacyAuthoredScheduleLifecycle({ mesocycle, workouts: duplicate })).toEqual({
        status: "blocked",
        reason: "duplicate_legacy_authored_claim:5:4",
      });

      const malformed = buildLegacyFiveWeekSchedule((workout) => {
        if (workout.mesocycleWeekSnapshot === 5 && workout.mesoSessionSnapshot === 4) {
          workout.sessionIntent = "UPPER";
        }
      });
      expect(resolveStrictFrozenLegacyAuthoredScheduleLifecycle({ mesocycle, workouts: malformed })).toEqual({
        status: "blocked",
        reason: "legacy_intent_identity_conflict:legacy-5-4",
      });
    });

    it("requires canonical authoritative identity for every strict frozen claim", () => {
      const valid = buildLegacyScheduleWorkout({ week: 5, session: 4 });
      const cases: Array<{
        label: string;
        workout: ReturnType<typeof buildLegacyScheduleWorkout>;
        reason: string;
      }> = [
        {
          label: "receiptless in-range stale row",
          workout: { ...valid, selectionMetadata: null },
          reason: `strict_frozen_receipt_missing:${valid.id}`,
        },
        {
          label: "missing session slot",
          workout: mutateLegacyReceipt(valid, (receipt) => {
            delete receipt.sessionSlot;
          }),
          reason: `strict_frozen_session_slot_missing:${valid.id}`,
        },
        {
          label: "non-authoritative slot source",
          workout: mutateLegacyReceipt(valid, (receipt) => {
            (receipt.sessionSlot as Record<string, unknown>).source =
              "legacy_weekly_schedule";
          }),
          reason: `strict_frozen_slot_source_non_authoritative:${valid.id}`,
        },
        {
          label: "wrong frozen slot id",
          workout: mutateLegacyReceipt(valid, (receipt) => {
            (receipt.sessionSlot as Record<string, unknown>).slotId = "upper_a";
          }),
          reason: `legacy_slot_identity_conflict:${valid.id}`,
        },
        {
          label: "wrong slot index",
          workout: mutateLegacyReceipt(valid, (receipt) => {
            (receipt.sessionSlot as Record<string, unknown>).sequenceIndex = 0;
          }),
          reason: `legacy_session_identity_conflict:${valid.id}`,
        },
        {
          label: "wrong sequence length",
          workout: mutateLegacyReceipt(valid, (receipt) => {
            (receipt.sessionSlot as Record<string, unknown>).sequenceLength = 3;
          }),
          reason: `legacy_slot_identity_conflict:${valid.id}`,
        },
        {
          label: "wrong mesocycle provenance",
          workout: mutateLegacyReceipt(valid, (receipt) => {
            (
              receipt.sessionProvenance as Record<string, unknown>
            ).mesocycleId = "other-mesocycle";
          }),
          reason: `strict_frozen_mesocycle_provenance_invalid:${valid.id}`,
        },
        {
          label: "missing mesocycle provenance",
          workout: mutateLegacyReceipt(valid, (receipt) => {
            delete receipt.sessionProvenance;
          }),
          reason: `strict_frozen_mesocycle_provenance_invalid:${valid.id}`,
        },
      ];

      for (const testCase of cases) {
        const workouts = buildLegacyFiveWeekSchedule();
        workouts[workouts.length - 1] = testCase.workout;
        expect(
          resolveStrictFrozenLegacyAuthoredScheduleLifecycle({
            mesocycle,
            workouts,
          }),
          testCase.label,
        ).toEqual({ status: "blocked", reason: testCase.reason });
      }
    });

    it.each([
      { label: "null", phaseSnapshot: null },
      { label: "missing", phaseSnapshot: undefined },
      { label: "malformed", phaseSnapshot: "recovery" },
      { label: "wrong", phaseSnapshot: "ACCUMULATION" },
    ])("rejects a $label workout phase snapshot for a strict deload claim", ({ phaseSnapshot }) => {
      const finalClaim = buildLegacyScheduleWorkout({ week: 5, session: 4 });
      const invalidClaim = { ...finalClaim } as Record<string, unknown>;
      if (phaseSnapshot === undefined) {
        delete invalidClaim.mesocyclePhaseSnapshot;
      } else {
        invalidClaim.mesocyclePhaseSnapshot = phaseSnapshot;
      }
      const workouts = buildLegacyFiveWeekSchedule();
      workouts[workouts.length - 1] = invalidClaim as ReturnType<
        typeof buildLegacyScheduleWorkout
      >;

      expect(
        resolveStrictFrozenLegacyAuthoredScheduleLifecycle({
          mesocycle,
          workouts,
        }),
      ).toEqual({
        status: "blocked",
        reason: `legacy_phase_identity_conflict:${finalClaim.id}`,
      });
    });

    it("accepts the exact phase snapshot and blocks final closure when the only apparent final claim lacks it", () => {
      const exact = buildLegacyFiveWeekSchedule();
      expect(
        resolveStrictFrozenLegacyAuthoredScheduleLifecycle({
          mesocycle,
          workouts: exact,
        }),
      ).toMatchObject({ status: "available", allResolved: true });

      const missingFinalPhase = buildLegacyFiveWeekSchedule();
      delete (missingFinalPhase[missingFinalPhase.length - 1] as unknown as Record<
        string,
        unknown
      >).mesocyclePhaseSnapshot;
      const blocked = resolveStrictFrozenLegacyAuthoredScheduleLifecycle({
        mesocycle,
        workouts: missingFinalPhase,
      });
      expect(blocked).toEqual({
        status: "blocked",
        reason: "legacy_phase_identity_conflict:legacy-5-4",
      });
      expect(blocked).not.toMatchObject({ status: "available", allResolved: true });
    });
  });

  it("returns mesocycle unchanged when below accumulation threshold", async () => {
    // Counter is pre-incremented in the save transaction; transitionMesocycleState only checks thresholds.
    // accumulationSessionsCompleted=3 is well below threshold (12) → no update, no state change.
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 3,
      deloadSessionsCompleted: 0,
      durationWeeks: 5,
      sessionsPerWeek: 3,
      macroCycle: { primaryGoal: "HYPERTROPHY" },
    });

    const updated = await transitionMesocycleState("m1");
    expect(updated.accumulationSessionsCompleted).toBe(3);
    expect(updated.state).toBe("ACTIVE_ACCUMULATION");
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
  });

  it("transitions ACTIVE_ACCUMULATION to ACTIVE_DELOAD at the duration-aware accumulation threshold", async () => {
    // durationWeeks=5 and sessionsPerWeek=3 => 4 accumulation weeks => threshold 12.
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
      durationWeeks: 5,
      sessionsPerWeek: 3,
      macroCycle: { primaryGoal: "HYPERTROPHY" },
    });
    mocks.txMesoUpdate.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_DELOAD",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
    });

    const updated = await transitionMesocycleState("m1");
    expect(updated.state).toBe("ACTIVE_DELOAD");
    // Counter write is absent — only state changes here.
    expect(mocks.txMesoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { state: "ACTIVE_DELOAD" },
      })
    );
  });

  it("completes a terminal strength plan after its final deload session", async () => {
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "strength-meso",
      state: "ACTIVE_DELOAD",
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 4,
      durationWeeks: 5,
      sessionsPerWeek: 4,
      macroCycle: { primaryGoal: "STRENGTH" },
    });
    mocks.txMesoUpdate.mockResolvedValue({
      id: "strength-meso",
      state: "COMPLETED",
      isActive: false,
    });

    const updated = await transitionMesocycleState("strength-meso");

    expect(updated).toMatchObject({
      state: "COMPLETED",
      isActive: false,
    });
    expect(mocks.txMesoUpdate).toHaveBeenCalledWith({
      where: { id: "strength-meso" },
      data: {
        state: "COMPLETED",
        isActive: false,
        closedAt: expect.any(Date),
      },
    });
    expect(mocks.txMesoCreate).not.toHaveBeenCalled();
  });

  it("loads the current accepted Strength revision as runtime seed authority", async () => {
    const acceptedSeed = {
      version: 1,
      source: "strength_plan_policy_v1",
      slots: [
        {
          slotId: "strength_upper_b",
          exercises: [
            {
              exerciseId: "accepted-press",
              role: "CORE_COMPOUND",
              setCount: 4,
            },
          ],
        },
      ],
    };
    const compatibilitySeed = {
      version: 1,
      source: "strength_plan_policy_v1",
      slots: [
        {
          slotId: "strength_upper_b",
          exercises: [
            {
              exerciseId: "stale-press",
              role: "CORE_COMPOUND",
              setCount: 2,
            },
          ],
        },
      ],
    };
    mocks.resolveActivePlanContext.mockResolvedValue({
      status: "READY",
      activeMesocycle: {
        id: "strength-meso",
        slotPlanSeedJson: compatibilitySeed,
        currentSeedRevision: {
          id: "strength-revision-1",
          revision: 1,
          seedPayload: acceptedSeed,
          payloadHash: "accepted-hash",
          hashAlgorithm: "sha256",
          provenanceStatus: "exact",
        },
      },
    });

    const mesocycle = await loadActiveMesocycle("user-1");

    expect(mesocycle?.slotPlanSeedJson).toEqual(acceptedSeed);
    expect(mesocycle?.slotPlanSeedJson).not.toEqual(compatibilitySeed);
  });

  it("preserves accepted V2/V4 envelopes and projects only accepted V3 for runtime", async () => {
    const intent = {
      userRole: "PRIMARY_LIFT",
      target: { kind: "movement_pattern", movementPattern: "squat" },
    };
    const acceptedV2 = {
      version: 2,
      source: "custom_hypertrophy_plan_v1",
      settings: { equipmentProfile: "FULL_GYM", sessionDurationMinutes: 60 },
      slots: ["lower_a", "lower_b"].map((slotId) => ({
        slotId,
        name: slotId,
        focus: "LOWER",
        exercises: [
          { exerciseId: "squat", role: "CORE_COMPOUND", setCount: 3, intent },
        ],
      })),
    };
    mocks.resolveActivePlanContext.mockResolvedValue({
      status: "READY",
      activeMesocycle: {
        id: "hypertrophy-meso",
        slotPlanSeedJson: null,
        currentSeedRevision: { seedPayload: acceptedV2 },
      },
    });

    expect((await loadActiveMesocycle("user-1"))?.slotPlanSeedJson).toEqual(
      acceptedV2,
    );

    const acceptedV3 = {
      ...acceptedV2,
      version: 3,
      slots: acceptedV2.slots.map((slot) => ({
        ...slot,
        exercises: slot.exercises.map((exercise) => ({
          ...exercise,
          measurement: {
            profile: "REPS_EXTERNAL_LOAD",
            loadConvention: "BARBELL_TOTAL",
            repBasis: "TOTAL",
          },
        })),
      })),
    };
    mocks.resolveActivePlanContext.mockResolvedValue({
      status: "READY",
      activeMesocycle: {
        id: "hypertrophy-meso",
        slotPlanSeedJson: null,
        currentSeedRevision: { seedPayload: acceptedV3 },
      },
    });

    expect((await loadActiveMesocycle("user-1"))?.slotPlanSeedJson).toEqual({
      version: 2,
      slots: ["lower_a", "lower_b"].map((slotId) => ({
        slotId,
        exercises: [
          {
            exerciseId: "squat",
            role: "CORE_COMPOUND",
            setCount: 3,
            measurement: {
              profile: "REPS_EXTERNAL_LOAD",
              loadConvention: "BARBELL_TOTAL",
              repBasis: "TOTAL",
            },
          },
        ],
      })),
    });

    const acceptedV4 = {
      version: 4,
      source: "custom_hypertrophy_plan_v2",
      settings: acceptedV2.settings,
      weeks: [{ week: 1, phase: "ACCUMULATION" }],
      slots: acceptedV3.slots.map((slot) => ({
        slotId: slot.slotId,
        name: slot.name,
        focus: slot.focus,
        exercises: slot.exercises.map((exercise) => ({
          placementId: `${slot.slotId}-${exercise.exerciseId}`,
          exerciseId: exercise.exerciseId,
          role: exercise.role,
          intent: exercise.intent,
          measurement: exercise.measurement,
          prescriptions: [{
            week: 1,
            status: "PRESCRIBE",
            setCount: exercise.setCount,
            reps: { kind: "RANGE", min: 6, max: 8 },
            rir: { kind: "TARGET_RANGE", min: 2, max: 3 },
          }],
        })),
      })),
    };
    mocks.resolveActivePlanContext.mockResolvedValue({
      status: "READY",
      activeMesocycle: {
        id: "hypertrophy-meso",
        slotPlanSeedJson: { version: 1, slots: [] },
        currentSeedRevision: { seedPayload: acceptedV4 },
      },
    });

    expect((await loadActiveMesocycle("user-1"))?.slotPlanSeedJson).toEqual(
      acceptedV4,
    );
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["malformed", 42],
    ["future unsupported", "POWER"],
  ])(
    "rejects %s plan type before terminal lifecycle mutation",
    async (_label, primaryGoal) => {
      mocks.txMesoFindUnique.mockResolvedValue({
        id: "unsupported-meso",
        state: "ACTIVE_DELOAD",
        accumulationSessionsCompleted: 16,
        deloadSessionsCompleted: 4,
        durationWeeks: 5,
        sessionsPerWeek: 4,
        macroCycle:
          primaryGoal === undefined ? {} : { primaryGoal },
      });

      await expect(
        transitionMesocycleStateInTransaction(
          {
            mesocycle: {
              findUnique: mocks.txMesoFindUnique,
              update: mocks.txMesoUpdate,
            },
          } as never,
          "unsupported-meso",
        ),
      ).rejects.toThrow("UNSUPPORTED_PLAN_TYPE");
      expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
      expect(mocks.txMesoCreate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["below threshold", "ACTIVE_ACCUMULATION", 0, 0],
    ["already completed", "COMPLETED", 12, 3],
    ["already awaiting handoff", "AWAITING_HANDOFF", 12, 3],
  ])(
    "rejects an unsupported plan type when the lifecycle is %s",
    async (_label, state, accumulationSessionsCompleted, deloadSessionsCompleted) => {
      mocks.txMesoFindUnique.mockResolvedValue({
        id: "unsupported-meso",
        state,
        accumulationSessionsCompleted,
        deloadSessionsCompleted,
        durationWeeks: 5,
        sessionsPerWeek: 3,
        macroCycle: { primaryGoal: "FUTURE_PLAN" },
      });

      await expect(
        transitionMesocycleStateInTransaction(
          {
            mesocycle: {
              findUnique: mocks.txMesoFindUnique,
              update: mocks.txMesoUpdate,
            },
          } as never,
          "unsupported-meso",
        ),
      ).rejects.toThrow("UNSUPPORTED_PLAN_TYPE");
      expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
      expect(mocks.txMesoCreate).not.toHaveBeenCalled();
    },
  );

  it("rejects unsupported owner-scoped early completion before touching workouts", async () => {
    mocks.txMesoFindFirst.mockResolvedValue({
      id: "unsupported-meso",
      macroCycleId: "unsupported-plan",
      state: "ACTIVE_DELOAD",
      isActive: true,
      handoffSummaryJson: null,
      nextSeedDraftJson: null,
      closedAt: null,
      macroCycle: { primaryGoal: "FUTURE_PLAN" },
    });

    await expect(
      finishDeloadEarlyInTransaction(
        {
          mesocycle: {
            findFirst: mocks.txMesoFindFirst,
            update: mocks.txMesoUpdate,
          },
          workout: {
            findMany: mocks.txWorkoutFindMany,
            update: mocks.txWorkoutUpdate,
          },
        } as never,
        { userId: "user-1", mesocycleId: "unsupported-meso" },
      ),
    ).rejects.toThrow("UNSUPPORTED_PLAN_TYPE");
    expect(mocks.txWorkoutFindMany).not.toHaveBeenCalled();
    expect(mocks.txWorkoutUpdate).not.toHaveBeenCalled();
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
  });

  it("transitions ACTIVE_DELOAD to AWAITING_HANDOFF at session 3 and persists handoff artifacts", async () => {
    // Save transaction has already incremented deloadSessionsCompleted to 3; transitionMesocycleState reads 3 >= threshold.
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_DELOAD",
      macroCycleId: "macro-1",
      mesoNumber: 1,
      startWeek: 0,
      focus: "Hypertrophy",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      isActive: true,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      durationWeeks: 5,
      sessionsPerWeek: 3,
      daysPerWeek: 3,
      splitType: "PPL",
      macroCycle: {
        userId: "user-1",
        primaryGoal: "HYPERTROPHY",
      },
      blocks: [],
    });
    mocks.txMesoUpdate.mockResolvedValue({
      id: "m1",
      macroCycleId: "macro-1",
      mesoNumber: 1,
      startWeek: 0,
      durationWeeks: 5,
      focus: "Hypertrophy",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      isActive: false,
      state: "AWAITING_HANDOFF",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      sessionsPerWeek: 3,
      daysPerWeek: 3,
      splitType: "PPL",
      closedAt: new Date("2026-03-10T00:00:00.000Z"),
      handoffSummaryJson: { version: 1 },
      nextSeedDraftJson: { version: 1 },
    });
    mocks.txConstraintsFindUnique.mockResolvedValue({
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
    });
    mocks.txRoleFindMany.mockResolvedValue([]);
    mocks.txWorkoutFindMany.mockResolvedValue([]);
    mocks.txReadinessFindFirst.mockResolvedValue(null);

    const updated = await transitionMesocycleState("m1");
    expect(updated.state).toBe("AWAITING_HANDOFF");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.txMesoCreate).not.toHaveBeenCalled();
    expect(mocks.txMesoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "AWAITING_HANDOFF",
          isActive: false,
          handoffSummaryJson: expect.objectContaining({ version: 1 }),
          nextSeedDraftJson: expect.objectContaining({ version: 1 }),
        }),
      })
    );
  });

  it("finishes accumulation early through the handoff seam without inflating lifecycle counters", async () => {
    const closedAt = new Date("2026-07-12T00:00:00.000Z");
    const plannedWorkout = {
      id: "planned-lower",
      status: "PLANNED",
      advancesSplit: true,
      selectionMode: "INTENT",
      sessionIntent: "LOWER",
      mesocyclePhaseSnapshot: "ACCUMULATION",
      selectionMetadata: { sessionDecisionReceipt: { version: 1 } },
      exercises: [{ sets: [{ logs: [] }] }],
    };
    mocks.txMesoFindFirst.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_ACCUMULATION",
      isActive: true,
      handoffSummaryJson: null,
      nextSeedDraftJson: null,
      closedAt: null,
      macroCycle: { primaryGoal: "HYPERTROPHY" },
    });
    mocks.txWorkoutFindMany
      .mockResolvedValueOnce([plannedWorkout])
      .mockResolvedValueOnce([]);
    mocks.txWorkoutUpdate.mockResolvedValue({ id: "planned-lower", status: "SKIPPED" });
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_ACCUMULATION",
      macroCycleId: "macro-1",
      mesoNumber: 4,
      startWeek: 15,
      focus: "Strength-Hypertrophy",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      isActive: true,
      accumulationSessionsCompleted: 11,
      deloadSessionsCompleted: 0,
      durationWeeks: 5,
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      splitType: "UPPER_LOWER",
      slotSequenceJson: {},
      macroCycle: {
        userId: "user-1",
        primaryGoal: "HYPERTROPHY",
      },
      blocks: [],
    });
    mocks.txMesoUpdate.mockResolvedValue({
      id: "m1",
      state: "AWAITING_HANDOFF",
      isActive: false,
      closedAt,
      handoffSummaryJson: { version: 1 },
      nextSeedDraftJson: { version: 1 },
      accumulationSessionsCompleted: 11,
      deloadSessionsCompleted: 0,
    });
    mocks.txConstraintsFindUnique.mockResolvedValue({
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
    });
    mocks.txRoleFindMany.mockResolvedValue([]);
    mocks.txReadinessFindFirst.mockResolvedValue(null);

    const result = await finishMesocycleEarly({
      userId: "user-1",
      mesocycleId: "m1",
    });

    expect(result.mesocycle.state).toBe("AWAITING_HANDOFF");
    expect(result.skippedWorkoutIds).toEqual(["planned-lower"]);
    expect(result.handoffSummaryCreated).toBe(true);
    expect(result.nextSeedDraftCreated).toBe(true);
    expect(mocks.txWorkoutUpdate).toHaveBeenCalledWith({
      where: { id: "planned-lower" },
      data: {
        status: "SKIPPED",
        selectionMetadata: expect.objectContaining({
          finishMesocycleEarly: expect.objectContaining({
            reason: "user_ended_accumulation_early",
            terminalStatus: "SKIPPED",
          }),
          sessionDecisionReceipt: { version: 1 },
        }),
      },
    });
    expect(mocks.txMesoUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accumulationSessionsCompleted: expect.anything(),
          deloadSessionsCompleted: expect.anything(),
        }),
      })
    );
  });

  it("rejects accumulation early-close when an incomplete workout has performed logs", async () => {
    mocks.txMesoFindFirst.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_ACCUMULATION",
      isActive: true,
      handoffSummaryJson: null,
      nextSeedDraftJson: null,
      closedAt: null,
      macroCycle: { primaryGoal: "HYPERTROPHY" },
    });
    mocks.txWorkoutFindMany.mockResolvedValue([
      {
        id: "partial-lower",
        status: "PARTIAL",
        advancesSplit: true,
        selectionMode: "INTENT",
        sessionIntent: "LOWER",
        mesocyclePhaseSnapshot: "ACCUMULATION",
        selectionMetadata: {},
        exercises: [
          {
            sets: [
              {
                logs: [
                  {
                    wasSkipped: false,
                    actualReps: 8,
                    actualRpe: 8,
                    actualLoad: 100,
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    await expect(
      finishMesocycleEarly({ userId: "user-1", mesocycleId: "m1" })
    ).rejects.toBeInstanceOf(FinishMesocycleEarlyBlockedWorkoutError);
    expect(mocks.txWorkoutUpdate).not.toHaveBeenCalled();
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
  });

  it("rejects accumulation early-close outside an active accumulation mesocycle", async () => {
    mocks.txMesoFindFirst.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_DELOAD",
      isActive: true,
      handoffSummaryJson: null,
      nextSeedDraftJson: null,
      closedAt: null,
      macroCycle: { primaryGoal: "HYPERTROPHY" },
    });

    await expect(
      finishMesocycleEarly({ userId: "user-1", mesocycleId: "m1" })
    ).rejects.toThrow("MESOCYCLE_FINISH_EARLY_INVALID_STATE");
    expect(mocks.txWorkoutUpdate).not.toHaveBeenCalled();
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
  });

  it("finishes deload early through the handoff seam without inflating deload counters", async () => {
    const closedAt = new Date("2026-03-10T00:00:00.000Z");
    mocks.txMesoFindFirst.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_DELOAD",
      isActive: true,
      handoffSummaryJson: null,
      nextSeedDraftJson: null,
      closedAt: null,
      macroCycle: { primaryGoal: "HYPERTROPHY" },
    });
    mocks.txWorkoutFindMany.mockResolvedValue([
      {
        id: "planned-deload",
        status: "PLANNED",
        advancesSplit: true,
        selectionMode: "INTENT",
        sessionIntent: "UPPER",
        mesocyclePhaseSnapshot: "DELOAD",
        selectionMetadata: { sessionDecisionReceipt: { version: 1 } },
        exercises: [
          {
            sets: [
              {
                logs: [],
              },
            ],
          },
        ],
      },
    ]);
    mocks.txWorkoutUpdate.mockResolvedValue({ id: "planned-deload", status: "SKIPPED" });
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_DELOAD",
      macroCycleId: "macro-1",
      mesoNumber: 1,
      startWeek: 0,
      focus: "Hypertrophy",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      isActive: true,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 2,
      durationWeeks: 5,
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      splitType: "UPPER_LOWER",
      macroCycle: {
        userId: "user-1",
        primaryGoal: "HYPERTROPHY",
      },
      blocks: [],
    });
    mocks.txMesoUpdate.mockResolvedValue({
      id: "m1",
      state: "AWAITING_HANDOFF",
      isActive: false,
      closedAt,
      handoffSummaryJson: { version: 1 },
      nextSeedDraftJson: { version: 1 },
      deloadSessionsCompleted: 2,
    });
    mocks.txConstraintsFindUnique.mockResolvedValue({
      weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
    });
    mocks.txRoleFindMany.mockResolvedValue([]);
    mocks.txWorkoutFindMany.mockResolvedValueOnce([
      {
        id: "planned-deload",
        status: "PLANNED",
        advancesSplit: true,
        selectionMode: "INTENT",
        sessionIntent: "UPPER",
        mesocyclePhaseSnapshot: "DELOAD",
        selectionMetadata: { sessionDecisionReceipt: { version: 1 } },
        exercises: [{ sets: [{ logs: [] }] }],
      },
    ]).mockResolvedValueOnce([]);
    mocks.txReadinessFindFirst.mockResolvedValue(null);

    const result = await finishDeloadEarly({
      userId: "user-1",
      mesocycleId: "m1",
    });

    expect(result.mesocycle.state).toBe("AWAITING_HANDOFF");
    expect(result.skippedWorkoutIds).toEqual(["planned-deload"]);
    expect(result.handoffSummaryCreated).toBe(true);
    expect(result.nextSeedDraftCreated).toBe(true);
    expect(mocks.txWorkoutUpdate).toHaveBeenCalledWith({
      where: { id: "planned-deload" },
      data: {
        status: "SKIPPED",
        selectionMetadata: expect.objectContaining({
          finishDeloadEarly: expect.objectContaining({
            reason: "user_finished_deload_early",
            terminalStatus: "SKIPPED",
          }),
          sessionDecisionReceipt: { version: 1 },
        }),
      },
    });
    expect(mocks.txMesoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "AWAITING_HANDOFF",
          isActive: false,
          handoffSummaryJson: expect.objectContaining({ version: 1 }),
          nextSeedDraftJson: expect.objectContaining({ version: 1 }),
        }),
      })
    );
    expect(mocks.txMesoUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deloadSessionsCompleted: expect.anything(),
        }),
      })
    );
  });

  it("rejects finish-deload early for non-owner mesocycles", async () => {
    mocks.txMesoFindFirst.mockResolvedValue(null);

    await expect(
      finishDeloadEarly({ userId: "other-user", mesocycleId: "m1" })
    ).rejects.toThrow("MESOCYCLE_FINISH_DELOAD_NOT_FOUND");
    expect(mocks.txWorkoutUpdate).not.toHaveBeenCalled();
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
  });

  it("rejects finish-deload early outside ACTIVE_DELOAD", async () => {
    mocks.txMesoFindFirst.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_ACCUMULATION",
      isActive: true,
      handoffSummaryJson: null,
      nextSeedDraftJson: null,
      closedAt: null,
      macroCycle: { primaryGoal: "HYPERTROPHY" },
    });

    await expect(
      finishDeloadEarly({ userId: "user-1", mesocycleId: "m1" })
    ).rejects.toThrow("MESOCYCLE_FINISH_DELOAD_INVALID_STATE");
    expect(mocks.txWorkoutUpdate).not.toHaveBeenCalled();
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
  });

  it("rejects finish-deload early when an incomplete deload workout has performed logs", async () => {
    mocks.txMesoFindFirst.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_DELOAD",
      isActive: true,
      handoffSummaryJson: null,
      nextSeedDraftJson: null,
      closedAt: null,
      macroCycle: { primaryGoal: "HYPERTROPHY" },
    });
    mocks.txWorkoutFindMany.mockResolvedValue([
      {
        id: "in-progress-deload",
        status: "IN_PROGRESS",
        advancesSplit: true,
        selectionMode: "INTENT",
        sessionIntent: "UPPER",
        mesocyclePhaseSnapshot: "DELOAD",
        selectionMetadata: {},
        exercises: [
          {
            sets: [
              {
                logs: [
                  {
                    wasSkipped: false,
                    actualReps: 8,
                    actualRpe: 5,
                    actualLoad: 100,
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    await expect(
      finishDeloadEarly({ userId: "user-1", mesocycleId: "m1" })
    ).rejects.toBeInstanceOf(FinishDeloadEarlyBlockedWorkoutError);
    expect(mocks.txWorkoutUpdate).not.toHaveBeenCalled();
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
  });

  it("rejects finish-deload early when an incomplete source workout is not deload-scoped", async () => {
    mocks.txMesoFindFirst.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_DELOAD",
      isActive: true,
      handoffSummaryJson: null,
      nextSeedDraftJson: null,
      closedAt: null,
      macroCycle: { primaryGoal: "HYPERTROPHY" },
    });
    mocks.txWorkoutFindMany.mockResolvedValue([
      {
        id: "old-accumulation-plan",
        status: "PLANNED",
        advancesSplit: true,
        selectionMode: "INTENT",
        sessionIntent: "UPPER",
        mesocyclePhaseSnapshot: "ACCUMULATION",
        selectionMetadata: {},
        exercises: [{ sets: [{ logs: [] }] }],
      },
    ]);

    await expect(
      finishDeloadEarly({ userId: "user-1", mesocycleId: "m1" })
    ).rejects.toBeInstanceOf(FinishDeloadEarlyBlockedWorkoutError);
    expect(mocks.txWorkoutUpdate).not.toHaveBeenCalled();
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
  });

  it("rejects finish-deload early when handoff artifacts already exist", async () => {
    mocks.txMesoFindFirst.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_DELOAD",
      isActive: true,
      handoffSummaryJson: { version: 1 },
      nextSeedDraftJson: null,
      closedAt: null,
      macroCycle: { primaryGoal: "HYPERTROPHY" },
    });

    await expect(
      finishDeloadEarly({ userId: "user-1", mesocycleId: "m1" })
    ).rejects.toThrow("MESOCYCLE_FINISH_DELOAD_HANDOFF_EXISTS");
    expect(mocks.txWorkoutUpdate).not.toHaveBeenCalled();
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
  });

  it("no-ops transition for already COMPLETED mesocycle", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      state: "COMPLETED",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      durationWeeks: 5,
      sessionsPerWeek: 3,
      macroCycle: { primaryGoal: "HYPERTROPHY" },
    });

    const updated = await transitionMesocycleState("m1");
    expect(updated.state).toBe("COMPLETED");
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("no-ops transition for already AWAITING_HANDOFF mesocycle", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      state: "AWAITING_HANDOFF",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      durationWeeks: 5,
      sessionsPerWeek: 3,
      macroCycle: { primaryGoal: "HYPERTROPHY" },
    });

    const updated = await transitionMesocycleState("m1");
    expect(updated.state).toBe("AWAITING_HANDOFF");
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("derives current mesocycle week correctly for a 5-week mesocycle", () => {
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 0,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toBe(1);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 3,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toBe(2);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 6,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toBe(3);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 9,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toBe(4);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 12,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toBe(4);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_DELOAD",
        accumulationSessionsCompleted: 12,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toBe(5);
  });

  it("derives current mesocycle week correctly for a 4-week mesocycle", () => {
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 0,
        sessionsPerWeek: 3,
        durationWeeks: 4,
      })
    ).toBe(1);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 3,
        sessionsPerWeek: 3,
        durationWeeks: 4,
      })
    ).toBe(2);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 6,
        sessionsPerWeek: 3,
        durationWeeks: 4,
      })
    ).toBe(3);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 9,
        sessionsPerWeek: 3,
        durationWeeks: 4,
      })
    ).toBe(3);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_DELOAD",
        accumulationSessionsCompleted: 9,
        sessionsPerWeek: 3,
        durationWeeks: 4,
      })
    ).toBe(4);
  });

  it("derives current mesocycle week correctly for a 6-week mesocycle", () => {
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 6,
        sessionsPerWeek: 3,
        durationWeeks: 6,
      })
    ).toBe(3);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 12,
        sessionsPerWeek: 3,
        durationWeeks: 6,
      })
    ).toBe(5);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_DELOAD",
        accumulationSessionsCompleted: 15,
        sessionsPerWeek: 3,
        durationWeeks: 6,
      })
    ).toBe(6);
  });

  it("derives the canonical next advancing accumulation slot from lifecycle counters", () => {
    expect(
      deriveCurrentMesocycleSession({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 7,
        deloadSessionsCompleted: 0,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toEqual({
      week: 3,
      session: 2,
      phase: "ACCUMULATION",
    });
  });

  it("derives next advancing intent from the weekly schedule instead of legacy completedSessions", () => {
    expect(
      deriveNextAdvancingSession(
        {
          state: "ACTIVE_ACCUMULATION",
          accumulationSessionsCompleted: 7,
          deloadSessionsCompleted: 0,
          sessionsPerWeek: 3,
          durationWeeks: 5,
        },
        ["push", "pull", "legs"]
      )
    ).toEqual({
      week: 3,
      session: 2,
      phase: "ACCUMULATION",
      intent: "pull",
      scheduleIndex: 1,
    });
  });

  it("returns no next advancing intent when all unique weekly intents are already performed", () => {
    expect(
      deriveNextAdvancingIntentByWeeklySubtraction(
        ["pull", "push", "legs"],
        ["pull", "push", "legs"]
      )
    ).toEqual({
      intent: null,
      scheduleIndex: null,
      remainingIntents: [],
      usesSubtraction: true,
    });
  });

  it("falls back from subtraction for duplicate-intent schedules until slot identity exists", () => {
    expect(
      deriveNextAdvancingIntentByWeeklySubtraction(
        ["push", "pull", "push"],
        ["push"]
      )
    ).toEqual({
      intent: null,
      scheduleIndex: null,
      remainingIntents: ["push", "pull", "push"],
      usesSubtraction: false,
    });
  });

  it("derives deterministic current and next sessions for identical lifecycle counters", () => {
    const mesocycle = {
      state: "ACTIVE_ACCUMULATION" as const,
      accumulationSessionsCompleted: 10,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      durationWeeks: 5,
    };

    const firstCurrent = deriveCurrentMesocycleSession(mesocycle);
    const secondCurrent = deriveCurrentMesocycleSession(mesocycle);
    expect(firstCurrent).toEqual(secondCurrent);

    const firstNext = deriveNextAdvancingSession(mesocycle, ["push", "pull", "legs"]);
    const secondNext = deriveNextAdvancingSession(mesocycle, ["push", "pull", "legs"]);
    expect(firstNext).toEqual(secondNext);
  });

  it("uses evidence-based landmarks for rear delts, lats, and upper back", () => {
    const meso = { durationWeeks: 5 };

    expect(getWeeklyVolumeTarget(meso, "Rear delts", 1)).toBe(4);
    expect(getWeeklyVolumeTarget(meso, "Rear delts", 4)).toBe(12);
    expect(getWeeklyVolumeTarget(meso, "Lats", 1)).toBe(8);
    expect(getWeeklyVolumeTarget(meso, "Lats", 4)).toBe(16);
    expect(getWeeklyVolumeTarget(meso, "Upper Back", 1)).toBe(6);
    expect(getWeeklyVolumeTarget(meso, "Upper Back", 4)).toBe(14);
  });

  it("interpolates accumulation volume targets monotonically for all configured muscle groups", () => {
    const meso = { durationWeeks: 5 };
    const muscles = [
      "lats",
      "upper_back",
      "rear_delts",
      "biceps",
      "chest",
      "front_delts",
      "side_delts",
      "quads",
      "hamstrings",
      "glutes",
      "triceps",
      "calves",
      "core",
      "forearms",
      "adductors",
      "neck",
      "lower_back",
      "abductors",
      "abs",
      "traps",
      "rotator_cuff",
    ];

    for (const muscle of muscles) {
      const w1 = getWeeklyVolumeTarget(meso, muscle, 1);
      const w2 = getWeeklyVolumeTarget(meso, muscle, 2);
      const w3 = getWeeklyVolumeTarget(meso, muscle, 3);
      const w4 = getWeeklyVolumeTarget(meso, muscle, 4);
      expect(w2).toBeGreaterThanOrEqual(w1);
      expect(w3).toBeGreaterThanOrEqual(w2);
      expect(w4).toBeGreaterThanOrEqual(w3);

      const maxAllowedJump = (w4 - w1) / 2;
      expect(w2 - w1).toBeLessThanOrEqual(maxAllowedJump);
      expect(w3 - w2).toBeLessThanOrEqual(maxAllowedJump);
      expect(w4 - w3).toBeLessThanOrEqual(maxAllowedJump);
    }
  });

  it("keeps deload target near 45% of W4 volume", () => {
    const meso = { durationWeeks: 5 };
    const w4 = getWeeklyVolumeTarget(meso, "Lats", 4);
    const w5 = getWeeklyVolumeTarget(meso, "Lats", 5);
    expect(w5).toBe(Math.round(w4 * CANONICAL_DELOAD_VOLUME_FRACTION));
  });

  it("uses real block context to preserve the default 5-week target path", () => {
    const meso = { durationWeeks: 5 };
    const blockContext = {
      mesocycle: {
        blocks: [
          {
            blockType: "accumulation",
            startWeek: 0,
            durationWeeks: 2,
            volumeTarget: "high",
            intensityBias: "hypertrophy",
          },
          {
            blockType: "intensification",
            startWeek: 2,
            durationWeeks: 2,
            volumeTarget: "moderate",
            intensityBias: "hypertrophy",
          },
          {
            blockType: "deload",
            startWeek: 4,
            durationWeeks: 1,
            volumeTarget: "low",
            intensityBias: "hypertrophy",
          },
        ],
      },
    } as const;

    expect(getWeeklyVolumeTarget(meso, "Lats", 2, { blockContext })).toBe(11);
    expect(getWeeklyVolumeTarget(meso, "Lats", 3, { blockContext })).toBe(13);
    expect(getWeeklyVolumeTarget(meso, "Lats", 5, { blockContext })).toBe(7);
  });

  it("reduces targets in a realization block when block context includes a low-volume peak phase", () => {
    const meso = { durationWeeks: 6 };
    const blockContext = {
      mesocycle: {
        blocks: [
          {
            blockType: "accumulation",
            startWeek: 0,
            durationWeeks: 2,
            volumeTarget: "high",
            intensityBias: "hypertrophy",
          },
          {
            blockType: "intensification",
            startWeek: 2,
            durationWeeks: 2,
            volumeTarget: "moderate",
            intensityBias: "hypertrophy",
          },
          {
            blockType: "realization",
            startWeek: 4,
            durationWeeks: 1,
            volumeTarget: "low",
            intensityBias: "strength",
          },
          {
            blockType: "deload",
            startWeek: 5,
            durationWeeks: 1,
            volumeTarget: "low",
            intensityBias: "hypertrophy",
          },
        ],
      },
    } as const;

    expect(getWeeklyVolumeTarget(meso, "Lats", 4, { blockContext })).toBe(16);
    expect(getWeeklyVolumeTarget(meso, "Lats", 5, { blockContext })).toBeLessThan(
      getWeeklyVolumeTarget(meso, "Lats", 4, { blockContext })
    );
    expect(getWeeklyVolumeTarget(meso, "Lats", 5, { blockContext })).toBe(13);
  });

  it("uses mesocycle.blocks as the canonical block-aware target source without explicit blockContext", () => {
    const meso = {
      durationWeeks: 6,
      blocks: [
        {
          blockType: "ACCUMULATION",
          startWeek: 0,
          durationWeeks: 2,
          volumeTarget: "HIGH",
          intensityBias: "HYPERTROPHY",
        },
        {
          blockType: "INTENSIFICATION",
          startWeek: 2,
          durationWeeks: 2,
          volumeTarget: "MODERATE",
          intensityBias: "HYPERTROPHY",
        },
        {
          blockType: "REALIZATION",
          startWeek: 4,
          durationWeeks: 1,
          volumeTarget: "LOW",
          intensityBias: "STRENGTH",
        },
        {
          blockType: "DELOAD",
          startWeek: 5,
          durationWeeks: 1,
          volumeTarget: "LOW",
          intensityBias: "HYPERTROPHY",
        },
      ],
    };

    expect(getWeeklyVolumeTarget(meso, "Lats", 4)).toBe(16);
    expect(getWeeklyVolumeTarget(meso, "Lats", 5)).toBe(13);
    expect(getWeeklyVolumeTarget(meso, "Lats", 6)).toBe(7);
  });

  it("returns corrected default RIR bands for a 4-week mesocycle", () => {
    const meso = {
      state: "ACTIVE_ACCUMULATION" as const,
      durationWeeks: 4,
    };

    expect(getRirTarget(meso, 1)).toEqual({ min: 3, max: 4 });
    expect(getRirTarget(meso, 2)).toEqual({ min: 2, max: 3 });
    expect(getRirTarget(meso, 3)).toEqual({ min: 1, max: 2 });
    expect(getRirTarget(meso, 4)).toEqual(CANONICAL_DELOAD_RIR_TARGET);
  });

  it("returns corrected default RIR bands for a 5-week mesocycle", () => {
    const meso = {
      state: "ACTIVE_ACCUMULATION" as const,
      durationWeeks: 5,
    };

    expect(getRirTarget(meso, 1)).toEqual({ min: 3, max: 4 });
    expect(getRirTarget(meso, 2)).toEqual({ min: 2, max: 3 });
    expect(getRirTarget(meso, 3)).toEqual({ min: 1, max: 2 });
    expect(getRirTarget(meso, 4)).toEqual({ min: 0, max: 1 });
    expect(getRirTarget(meso, 5)).toEqual(CANONICAL_DELOAD_RIR_TARGET);
  });

  it("preserves current 5-week hypertrophy RIR and set progression when using the default block definitions", () => {
    const meso = {
      state: "ACTIVE_ACCUMULATION" as const,
      durationWeeks: 5,
    };

    expect(
      getRirTarget(meso, 1, {
        blockType: "accumulation",
        weekInBlock: 1,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ min: 3, max: 4 });
    expect(
      getRirTarget(meso, 2, {
        blockType: "accumulation",
        weekInBlock: 2,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ min: 2, max: 3 });
    expect(
      getRirTarget(meso, 3, {
        blockType: "intensification",
        weekInBlock: 1,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ min: 1, max: 2 });
    expect(
      getRirTarget(meso, 4, {
        blockType: "intensification",
        weekInBlock: 2,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ min: 0, max: 1 });
    expect(
      getRirTarget(meso, 5, {
        blockType: "deload",
        weekInBlock: 1,
        blockDurationWeeks: 1,
        isDeload: true,
      })
    ).toEqual(CANONICAL_DELOAD_RIR_TARGET);

    expect(
      getLifecycleSetTargets(5, 1, false, {
        blockType: "accumulation",
        weekInBlock: 1,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ main: 3, accessory: 2 });
    expect(
      getLifecycleSetTargets(5, 2, false, {
        blockType: "accumulation",
        weekInBlock: 2,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ main: 4, accessory: 3 });
    expect(
      getLifecycleSetTargets(5, 3, false, {
        blockType: "intensification",
        weekInBlock: 1,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ main: 5, accessory: 4 });
    expect(
      getLifecycleSetTargets(5, 4, false, {
        blockType: "intensification",
        weekInBlock: 2,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ main: 5, accessory: 5 });
    expect(
      getLifecycleSetTargets(5, 5, true, {
        blockType: "deload",
        weekInBlock: 1,
        blockDurationWeeks: 1,
        isDeload: true,
      })
    ).toEqual(CANONICAL_DELOAD_SET_TARGETS);
  });

  it("returns corrected default RIR bands for a 6-week mesocycle", () => {
    const meso = {
      state: "ACTIVE_ACCUMULATION" as const,
      durationWeeks: 6,
    };

    expect(getRirTarget(meso, 1)).toEqual({ min: 3, max: 4 });
    expect(getRirTarget(meso, 2)).toEqual({ min: 2, max: 3 });
    expect(getRirTarget(meso, 3)).toEqual({ min: 1, max: 2 });
    expect(getRirTarget(meso, 4)).toEqual({ min: 0, max: 1 });
    expect(getRirTarget(meso, 5)).toEqual({ min: 0, max: 1 });
    expect(getRirTarget(meso, 6)).toEqual(CANONICAL_DELOAD_RIR_TARGET);
  });

  it("returns explicit 5-week hypertrophy set targets", () => {
    expect(getLifecycleSetTargets(5, 1)).toEqual({ main: 3, accessory: 2 });
    expect(getLifecycleSetTargets(5, 2)).toEqual({ main: 4, accessory: 3 });
    expect(getLifecycleSetTargets(5, 3)).toEqual({ main: 5, accessory: 4 });
    expect(getLifecycleSetTargets(5, 4)).toEqual({ main: 5, accessory: 5 });
    expect(getLifecycleSetTargets(5, 5, true)).toEqual(CANONICAL_DELOAD_SET_TARGETS);
  });

  it("initializeNextMesocycle is fenced so callers cannot bypass the handoff contract", async () => {
    await expect(
      initializeNextMesocycle({
        id: "m1",
        macroCycleId: "macro-1",
        mesoNumber: 3,
        durationWeeks: 5,
        focus: "Hypertrophy",
        volumeTarget: "MODERATE",
        intensityBias: "HYPERTROPHY",
        isActive: true,
        state: "COMPLETED",
        accumulationSessionsCompleted: 12,
        deloadSessionsCompleted: 3,
        sessionsPerWeek: 3,
        daysPerWeek: 3,
        splitType: "PPL",
      } as never)
    ).rejects.toThrow("MESOCYCLE_HANDOFF_REQUIRED");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
