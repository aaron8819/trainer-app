import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const workoutExerciseFindMany = vi.fn();
  const generateWorkoutExplanation = vi.fn();

  return {
    workoutFindFirst,
    workoutExerciseFindMany,
    generateWorkoutExplanation,
    prisma: {
      workout: {
        findFirst: workoutFindFirst,
      },
      workoutExercise: {
        findMany: workoutExerciseFindMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("./explainability", () => ({
  generateWorkoutExplanation: (...args: unknown[]) =>
    mocks.generateWorkoutExplanation(...args),
}));

import { loadPostSessionReviewContractForWorkout } from "./post-session-review-producer";

function makeReceipt() {
  return buildSessionDecisionReceipt({
    cycleContext: {
      weekInMeso: 2,
      weekInBlock: 2,
      blockDurationWeeks: 4,
      mesocycleLength: 5,
      phase: "accumulation",
      blockType: "accumulation",
      isDeload: false,
      source: "computed",
    },
    sessionProvenance: {
      mesocycleId: "meso-1",
      compositionSource: "persisted_slot_plan_seed",
    },
    sessionSlot: {
      slotId: "upper_a",
      intent: "upper",
      sequenceIndex: 0,
      sequenceLength: 4,
      source: "mesocycle_slot_sequence",
    },
    lifecycleVolumeTargets: { Chest: 10 },
  });
}

function makeRuntimeEditReconciliation(input: {
  addedExerciseIds?: string[];
  addedSetIds?: string[];
  replacements?: Array<{
    workoutExerciseId: string;
    fromExerciseId: string;
    fromExerciseName?: string;
    toExerciseId: string;
    toExerciseName?: string;
  }>;
} = {}) {
  return {
    version: 1,
    lastReconciledAt: "2026-06-01T12:00:00.000Z",
    directives: {
      continuityAlias: "none",
      progressionAlias: "none",
      futureSessionGeneration: "ignore",
      futureSeedCarryForward: "ignore",
    },
    ops: [
      ...(input.addedExerciseIds ?? []).map((workoutExerciseId, index) => ({
        kind: "add_exercise",
        source: "api_workouts_add_exercise",
        appliedAt: "2026-06-01T12:00:00.000Z",
        scope: "current_workout_only",
        facts: {
          workoutExerciseId,
          exerciseId: `added-exercise-${index + 1}`,
          orderIndex: 10 + index,
          section: "ACCESSORY",
          setCount: 2,
          prescriptionSource: "session_accessory_defaults",
        },
      })),
      ...(input.addedSetIds ?? []).map((workoutSetId, index) => ({
        kind: "add_set",
        source: "api_workouts_add_set",
        appliedAt: "2026-06-01T12:00:00.000Z",
        scope: "current_workout_only",
        facts: {
          workoutExerciseId: "we-planned",
          exerciseId: "bench",
          workoutSetId,
          setIndex: 4 + index,
          clonedFromSetIndex: 3,
        },
      })),
      ...(input.replacements ?? []).map((replacement) => ({
        kind: "replace_exercise",
        source: "api_workouts_swap_exercise",
        appliedAt: "2026-06-01T12:00:00.000Z",
        scope: "current_workout_only",
        facts: {
          ...replacement,
          reason: "equipment_availability_equivalent_pull_swap",
          setCount: 3,
        },
      })),
    ],
  };
}

function makeSet(
  id: string,
  options: {
    setIndex?: number;
    logged?: boolean;
    skipped?: boolean;
    actualReps?: number | null;
    actualLoad?: number | null;
    actualRpe?: number | null;
    targetLoad?: number | null;
  } = {}
) {
  const logged = options.logged ?? true;
  return {
    id,
    setIndex: options.setIndex ?? (Number(id.replace(/\D/g, "")) || 1),
    targetReps: 10,
    targetRepMin: 8,
    targetRepMax: 12,
    targetRpe: 8,
    targetLoad: options.targetLoad ?? 100,
    logs: logged
      ? [
          {
            actualReps: options.actualReps ?? (options.skipped ? null : 10),
            actualLoad: options.actualLoad ?? (options.skipped ? null : 100),
            actualRpe: options.actualRpe ?? (options.skipped ? null : 8),
            completedAt: new Date("2026-06-01T13:00:00.000Z"),
            wasSkipped: options.skipped ?? false,
          },
        ]
      : [],
  };
}

function makeExercise(
  id: string,
  input: {
    exerciseId?: string;
    name?: string;
    orderIndex?: number;
    section?: "MAIN" | "ACCESSORY";
    isMainLift?: boolean;
    sets?: ReturnType<typeof makeSet>[];
  } = {}
) {
  return {
    id,
    exerciseId: input.exerciseId ?? "bench",
    orderIndex: input.orderIndex ?? 0,
    section: input.section ?? "MAIN",
    isMainLift: input.isMainLift ?? true,
    exercise: {
      name: input.name ?? "Bench Press",
    },
    sets: input.sets ?? [
      makeSet(`${id}-set-1`, { setIndex: 1 }),
      makeSet(`${id}-set-2`, { setIndex: 2 }),
      makeSet(`${id}-set-3`, { setIndex: 3 }),
    ],
  };
}

function makeRecentWorkoutExercise(
  id: string,
  input: {
    workoutId?: string;
    exerciseId?: string;
    name?: string;
    scheduledDate?: Date;
    completedAt?: Date | null;
    advancesSplit?: boolean;
    selectionMode?: "INTENT" | "MANUAL";
    sessionIntent?: "UPPER" | "BODY_PART";
    selectionMetadata?: Record<string, unknown>;
    sets?: ReturnType<typeof makeSet>[];
  } = {}
) {
  return {
    id,
    workoutId: input.workoutId ?? `${id}-workout`,
    exerciseId: input.exerciseId ?? "bench",
    orderIndex: 0,
    section: "MAIN",
    isMainLift: true,
    exercise: {
      name: input.name ?? "Bench Press",
    },
    workout: {
      id: input.workoutId ?? `${id}-workout`,
      scheduledDate: input.scheduledDate ?? new Date("2026-05-25T12:00:00.000Z"),
      completedAt: input.completedAt ?? new Date("2026-05-25T13:00:00.000Z"),
      selectionMetadata: {
        sessionDecisionReceipt: makeReceipt(),
        ...(input.selectionMetadata ?? {}),
      },
      advancesSplit: input.advancesSplit ?? true,
      selectionMode: input.selectionMode ?? "INTENT",
      sessionIntent: input.sessionIntent ?? "UPPER",
      templateId: null,
      mesocyclePhaseSnapshot: "ACCUMULATION",
    },
    sets: input.sets ?? [
      makeSet(`${id}-set-1`, { actualLoad: 100, actualReps: 10, actualRpe: 8 }),
      makeSet(`${id}-set-2`, { actualLoad: 100, actualReps: 10, actualRpe: 8 }),
    ],
  };
}

function makeWorkout(
  overrides: Record<string, unknown> = {},
  selectionMetadata: Record<string, unknown> = {}
) {
  return {
    id: "workout-1",
    userId: "user-1",
    user: { email: "owner@local" },
    scheduledDate: new Date("2026-06-01T12:00:00.000Z"),
    status: "COMPLETED",
    revision: 3,
    selectionMode: "INTENT",
    sessionIntent: "UPPER",
    selectionMetadata: {
      sessionDecisionReceipt: makeReceipt(),
      workoutStructureState: {
        version: 1,
        lastReconciledAt: "2026-06-01T12:00:00.000Z",
        currentExercises: [
          {
            exerciseId: "bench",
            orderIndex: 0,
            section: "MAIN",
            setCount: 3,
          },
        ],
        reconciliation: {
          version: 1,
          comparisonState: "matches_generated_snapshot",
          hasDrift: false,
          changedFields: [],
          addedExerciseIds: [],
          removedExerciseIds: [],
          exercisesWithSetCountChanges: [],
          exercisesWithPrescriptionChanges: [],
        },
      },
      ...selectionMetadata,
    },
    advancesSplit: true,
    templateId: null,
    mesocycleId: "meso-1",
    mesocycleWeekSnapshot: 2,
    mesoSessionSnapshot: 1,
    mesocyclePhaseSnapshot: "ACCUMULATION",
    exercises: [makeExercise("we-planned")],
    ...overrides,
  };
}

function mockExplanation(input: {
  nextExposure?: boolean;
  weeklyImpact?: boolean;
} = {}) {
  mocks.generateWorkoutExplanation.mockResolvedValue({
    nextExposureDecisions: input.nextExposure
      ? new Map([
          [
            "bench",
            {
              action: "hold",
              summary: "Hold load next time.",
              reason: "Median reps stayed in range.",
              anchorLoad: 100,
              repRange: { min: 8, max: 12 },
              modalRpe: 8,
              medianReps: 10,
              decisionLog: ["read-only explainability"],
            },
          ],
        ])
      : new Map(),
    volumeCompliance: input.weeklyImpact
      ? [
          {
            muscle: "Chest",
            performedEffectiveVolumeBeforeSession: 6,
            plannedEffectiveVolumeThisSession: 3,
            projectedEffectiveVolume: 9,
            weeklyTarget: 10,
            mev: 8,
            mav: 16,
            status: "APPROACHING_TARGET",
          },
        ]
      : [],
  });
}

describe("loadPostSessionReviewContractForWorkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
    mockExplanation();
  });

  it("returns a contract for a completed user-owned workout", async () => {
    mocks.workoutFindFirst.mockResolvedValue(makeWorkout());

    const result = await loadPostSessionReviewContractForWorkout(
      "user-1",
      "workout-1"
    );

    expect(mocks.workoutFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "workout-1", userId: "user-1" },
      })
    );
    expect(mocks.workoutExerciseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          exerciseId: { in: ["bench"] },
          workoutId: { not: "workout-1" },
          workout: expect.objectContaining({
            userId: "user-1",
            scheduledDate: { lt: new Date("2026-06-01T12:00:00.000Z") },
          }),
        }),
      })
    );
    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected ready contract");
    }
    expect(result.contract.workoutIdentity).toMatchObject({
      userId: "user-1",
      ownerEmail: "owner@local",
      workoutId: "workout-1",
      status: "COMPLETED",
      slotId: "upper_a",
    });
    expect(result.contract.sourceTruth.receipt.available).toBe(true);
    expect(result.contract.sourceTruth.sessionSemantics.evidence).toMatchObject({
      kind: "advancing",
      countsTowardWeeklyVolume: true,
    });
  });

  it("rejects a workout not owned by the user", async () => {
    mocks.workoutFindFirst.mockResolvedValue(null);

    const result = await loadPostSessionReviewContractForWorkout(
      "user-2",
      "workout-1"
    );

    expect(result).toMatchObject({
      status: "blocked",
      reason: "not_found_or_unauthorized",
      contract: null,
    });
    expect(mocks.generateWorkoutExplanation).not.toHaveBeenCalled();
  });

  it("returns not-ready for incomplete workouts", async () => {
    mocks.workoutFindFirst.mockResolvedValue(makeWorkout({ status: "IN_PROGRESS" }));

    const result = await loadPostSessionReviewContractForWorkout(
      "user-1",
      "workout-1"
    );

    expect(result).toMatchObject({
      status: "blocked",
      reason: "not_ready",
    });
    expect(mocks.generateWorkoutExplanation).not.toHaveBeenCalled();
    expect(mocks.workoutExerciseFindMany).not.toHaveBeenCalled();
  });

  it("includes bounded exact-exercise recent calibration history as read-only evidence", async () => {
    mocks.workoutFindFirst.mockResolvedValue(makeWorkout());
    mocks.workoutExerciseFindMany.mockResolvedValue([
      makeRecentWorkoutExercise("prior-heavy", {
        workoutId: "prior-heavy-workout",
        scheduledDate: new Date("2026-05-25T12:00:00.000Z"),
        completedAt: new Date("2026-05-25T13:00:00.000Z"),
        sets: [
          makeSet("prior-heavy-set-1", {
            actualLoad: 100,
            actualReps: 10,
            actualRpe: 9.5,
          }),
          makeSet("prior-heavy-set-2", {
            actualLoad: 100,
            actualReps: 10,
            actualRpe: 9.5,
          }),
        ],
      }),
      makeRecentWorkoutExercise("prior-clean", {
        workoutId: "prior-clean-workout",
        scheduledDate: new Date("2026-05-20T12:00:00.000Z"),
        completedAt: new Date("2026-05-20T13:00:00.000Z"),
      }),
      makeRecentWorkoutExercise("prior-gap-fill", {
        workoutId: "prior-gap-fill-workout",
        scheduledDate: new Date("2026-05-18T12:00:00.000Z"),
        completedAt: new Date("2026-05-18T13:00:00.000Z"),
        advancesSplit: false,
        sessionIntent: "BODY_PART",
        selectionMetadata: {
          sessionDecisionReceipt: {
            ...makeReceipt(),
            exceptions: ["optional_gap_fill"],
          },
        },
      }),
    ]);

    const result = await loadPostSessionReviewContractForWorkout(
      "user-1",
      "workout-1"
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected ready contract");
    }
    expect(result.contract.prescriptionCalibration.recentExposureSummary).toEqual({
      source: "exact_exercise_prior_performed_workouts",
      readOnly: true,
      affectsPrescriptionPolicy: false,
      affectsProgressionPolicy: false,
      rows: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          priorExposureCount: 3,
          lookbackWorkoutLimit: 3,
          latestPerformedAt: "2026-05-25T13:00:00.000Z",
          coherentCount: 2,
          loadTooHeavyCount: 1,
          loadTooLightCount: 0,
          mixedSignalCount: 0,
          lowCoverageCount: 0,
          insufficientEvidenceCount: 0,
          sessionLocalCount: 0,
          evidenceOnly: true,
          affectsPrescriptionPolicy: false,
          affectsProgressionPolicy: false,
        },
      ],
    });
    expect(result.contract.learningSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "calibration_signal",
          severity: "watch",
          summary:
            "Recent exact-exercise calibration history has watch evidence for 1 exercise(s).",
        }),
      ])
    );
  });

  it("includes SetLog-derived performed and skipped reality", async () => {
    mocks.workoutFindFirst.mockResolvedValue(
      makeWorkout({
        status: "PARTIAL",
        exercises: [
          makeExercise("we-planned", {
            sets: [
              makeSet("set-1", { actualReps: 12, actualLoad: 110, actualRpe: 8 }),
              makeSet("set-2", { skipped: true }),
              makeSet("set-3", { logged: false }),
            ],
          }),
        ],
      })
    );

    const result = await loadPostSessionReviewContractForWorkout(
      "user-1",
      "workout-1"
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected ready contract");
    }
    expect(result.contract.executionSummary).toMatchObject({
      completedSetCount: 1,
      skippedSetCount: 1,
      missingLogSetCount: 1,
      partialExerciseCount: 1,
    });
    expect(result.contract.prescriptionCalibration.rows[0]).toMatchObject({
      exerciseId: "bench",
      performedSetCount: 1,
      skippedSetCount: 1,
      medianPerformedLoad: 110,
      medianReps: 12,
      targetRpe: 8,
      medianActualRpe: 8,
      repRangeResult: "in_range",
      effortResult: "near_target",
      performedRealityCoherence: "low_coverage",
    });
    expect(result.contract.performedReality.rows[0]).toMatchObject({
      exerciseId: "bench",
      label: "under_performed",
      completionStatus: "partial",
      plannedSetCount: 3,
      performedSetCount: 1,
      skippedSetCount: 1,
      missingLogSetCount: 1,
      target: {
        reps: { min: 8, max: 12 },
        load: 100,
        rpe: 8,
      },
      actual: {
        medianReps: 12,
        medianLoad: 110,
        medianRpe: 8,
      },
      evidenceOnly: true,
      affectsProgressionPolicy: false,
      affectsPrescriptionPolicy: false,
      seedRuntimeChanged: false,
    });
  });

  it("includes skipped planned exercise evidence", async () => {
    mocks.workoutFindFirst.mockResolvedValue(
      makeWorkout({
        exercises: [
          makeExercise("we-skipped", {
            sets: [
              makeSet("set-1", { skipped: true }),
              makeSet("set-2", { skipped: true }),
            ],
          }),
        ],
      })
    );

    const result = await loadPostSessionReviewContractForWorkout(
      "user-1",
      "workout-1"
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected ready contract");
    }
    expect(result.contract.exerciseReconciliation.rows[0]).toMatchObject({
      status: "skipped",
      skippedSetCount: 2,
      performedSetCount: 0,
    });
  });

  it("includes runtime-added exercise evidence", async () => {
    mocks.workoutFindFirst.mockResolvedValue(
      makeWorkout(
        {
          exercises: [
            makeExercise("we-planned"),
            makeExercise("we-added", {
              exerciseId: "curl",
              name: "Cable Curl",
              orderIndex: 1,
              section: "ACCESSORY",
              isMainLift: false,
              sets: [
                makeSet("added-set-1", { setIndex: 1 }),
                makeSet("added-set-2", { setIndex: 2 }),
              ],
            }),
          ],
        },
        {
          runtimeEditReconciliation: makeRuntimeEditReconciliation({
            addedExerciseIds: ["we-added"],
          }),
        }
      )
    );

    const result = await loadPostSessionReviewContractForWorkout(
      "user-1",
      "workout-1"
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected ready contract");
    }
    expect(
      result.contract.exerciseReconciliation.rows.find(
        (row) => row.workoutExerciseId === "we-added"
      )
    ).toMatchObject({
      status: "runtime_added",
      runtimeAdded: true,
      plannedSetCount: 0,
      addedSetCount: 2,
      seedMutation: false,
      policyMutation: false,
    });
  });

  it("does not double-count runtime-added exercise and set evidence", async () => {
    mocks.workoutFindFirst.mockResolvedValue(
      makeWorkout(
        {
          exercises: [
            makeExercise("we-added", {
              exerciseId: "curl",
              name: "Cable Curl",
              sets: [
                makeSet("added-set-1", { setIndex: 1 }),
                makeSet("added-set-2", { setIndex: 2 }),
              ],
            }),
          ],
        },
        {
          runtimeEditReconciliation: makeRuntimeEditReconciliation({
            addedExerciseIds: ["we-added"],
            addedSetIds: ["added-set-1", "added-set-2"],
          }),
        }
      )
    );

    const result = await loadPostSessionReviewContractForWorkout(
      "user-1",
      "workout-1"
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected ready contract");
    }
    expect(result.contract.executionSummary).toMatchObject({
      plannedSetCount: 0,
      completedSetCount: 2,
      extraSetCount: 2,
    });
    expect(result.contract.exerciseReconciliation.rows[0]).toMatchObject({
      plannedSetCount: 0,
      addedSetCount: 2,
    });
  });

  it("includes replacement-like runtime edit evidence", async () => {
    mocks.workoutFindFirst.mockResolvedValue(
      makeWorkout(
        {
          exercises: [
            makeExercise("we-replaced", {
              exerciseId: "machine-row",
              name: "Machine Row",
            }),
          ],
        },
        {
          runtimeEditReconciliation: makeRuntimeEditReconciliation({
            replacements: [
              {
                workoutExerciseId: "we-replaced",
                fromExerciseId: "barbell-row",
                fromExerciseName: "Barbell Row",
                toExerciseId: "machine-row",
                toExerciseName: "Machine Row",
              },
            ],
          }),
        }
      )
    );

    const result = await loadPostSessionReviewContractForWorkout(
      "user-1",
      "workout-1"
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected ready contract");
    }
    expect(result.contract.exerciseReconciliation.rows[0]).toMatchObject({
      status: "replacement_like",
      replacement: expect.objectContaining({
        source: "runtime_edit_reconciliation",
        fromExerciseId: "barbell-row",
        seedMutation: false,
        policyMutation: false,
      }),
    });
  });

  it("includes next-exposure and weekly impact rows from explainability evidence", async () => {
    mockExplanation({ nextExposure: true, weeklyImpact: true });
    mocks.workoutFindFirst.mockResolvedValue(makeWorkout());

    const result = await loadPostSessionReviewContractForWorkout(
      "user-1",
      "workout-1"
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected ready contract");
    }
    expect(result.contract.nextExposure).toMatchObject({
      available: true,
      rows: [
        expect.objectContaining({
          exerciseId: "bench",
          action: "hold",
          evidenceOnly: true,
          affectsProgressionPolicy: false,
        }),
      ],
    });
    expect(result.contract.weeklyImpact?.rows[0]).toMatchObject({
      muscle: "Chest",
      status: "APPROACHING_TARGET",
    });
  });

  it("preserves read-only boundaries", async () => {
    mocks.workoutFindFirst.mockResolvedValue(makeWorkout());

    const result = await loadPostSessionReviewContractForWorkout(
      "user-1",
      "workout-1"
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected ready contract");
    }
    expect(result.contract.boundaries).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      dbMutation: false,
      workoutChanged: false,
      seedRuntimeChanged: false,
      plannerMaterializerChanged: false,
      selectionMetadataMutated: false,
      receiptMutated: false,
    });
  });

  it("fails closed when adapted source evidence cannot validate", async () => {
    mocks.workoutFindFirst.mockResolvedValue(
      makeWorkout({
        id: "",
        userId: "",
      })
    );

    const result = await loadPostSessionReviewContractForWorkout("", "");

    expect(result).toMatchObject({
      status: "blocked",
      reason: "invalid_contract",
      contract: null,
    });
  });

  it("does not import audit, artifact, persistence, or mutation paths", () => {
    const source = readFileSync(
      "src/lib/api/post-session-review-producer.ts",
      "utf8"
    );
    const schema = readFileSync("prisma/schema.prisma", "utf8");

    expect(source).toContain("./post-session-review-contract-builder");
    expect(source).not.toContain("scripts/workout-audit");
    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("serializer");
    expect(source).not.toContain("artifacts/audits");
    expect(source).not.toContain("writeFile");
    expect(source).not.toContain("prisma.workout.create");
    expect(source).not.toContain("prisma.workout.update");
    expect(source).not.toContain("prisma.workout.upsert");
    expect(source).not.toContain("prisma.workout.delete");
    expect(source).not.toContain("prisma.setLog");
    expect(source).not.toContain("@/lib/engine/apply-loads");
    expect(source).not.toContain("computeDoubleProgressionDecision");
    expect(source).not.toContain("reconcileRuntimeEditSelectionMetadata");
    expect(schema).not.toContain("PostSessionReviewSnapshot");
  });
});
