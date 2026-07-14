import { describe, expect, it, vi } from "vitest";
import {
  buildExerciseStimulusSnapshot,
  toExerciseStimulusAccountingEvidence,
  type ExerciseStimulusSnapshot,
} from "@/lib/stimulus-accounting/snapshot";
import {
  loadPersistedIncompleteWorkoutProjections,
  projectPersistedIncompleteWorkout,
  type PersistedIncompleteWorkoutExercise,
  type PersistedIncompleteWorkoutRecord,
  type PersistedIncompleteWorkoutSet,
} from "./persisted-incomplete-workout-projection";

function makeSnapshot(
  exerciseId: string,
  stimulusProfile: Record<string, number> = { chest: 1, triceps: 0.333333 }
): ExerciseStimulusSnapshot {
  return buildExerciseStimulusSnapshot(
    {
      id: exerciseId,
      name: exerciseId,
      primaryMuscles: ["Chest"],
      secondaryMuscles: ["Triceps"],
      stimulusProfile: stimulusProfile as never,
    },
    "exact"
  );
}

function makeReceipt(input: {
  slotId?: string | null;
  exceptions?: Array<{ code: string; message: string }>;
  stimulusAccounting?: unknown;
} = {}) {
  return {
    version: input.stimulusAccounting ? 3 : 2,
    cycleContext: {
      weekInMeso: 1,
      weekInBlock: 1,
      mesocycleLength: 5,
      phase: "accumulation",
      blockType: "accumulation",
      isDeload: false,
      source: "computed",
    },
    ...(input.slotId
      ? {
          sessionSlot: {
            slotId: input.slotId,
            intent: "upper",
            sequenceIndex: 0,
            source: "mesocycle_slot_sequence",
          },
        }
      : {}),
    lifecycleVolume: { source: "lifecycle" },
    sorenessSuppressedMuscles: [],
    deloadDecision: {
      mode: "none",
      reason: [],
      reductionPercent: 0,
      appliedTo: "none",
    },
    readiness: {
      wasAutoregulated: false,
      signalAgeHours: null,
      fatigueScoreOverall: null,
      intensityScaling: {
        multiplier: 1,
        scaledUpCount: 0,
        scaledDownCount: 0,
      },
    },
    exceptions: input.exceptions ?? [],
    ...(input.stimulusAccounting
      ? { stimulusAccounting: input.stimulusAccounting }
      : {}),
  };
}

function makeSet(
  id: string,
  log?: Partial<PersistedIncompleteWorkoutSet["logs"][number]> | null
): PersistedIncompleteWorkoutSet {
  return {
    id,
    setIndex: Number(id.replace(/\D/g, "")) || 1,
    targetReps: 10,
    targetRepMin: 8,
    targetRepMax: 12,
    targetRpe: 8,
    targetLoad: 50,
    restSeconds: 90,
    logs:
      log == null
        ? []
        : [
            {
              id: `log-${id}`,
              setIntent: "WORK",
              actualReps: null,
              actualRpe: null,
              actualLoad: null,
              wasSkipped: false,
              completedAt: new Date("2026-07-14T12:00:00.000Z"),
              ...log,
            },
          ],
  };
}

function makeExercise(input: {
  id?: string;
  exerciseId?: string;
  orderIndex?: number;
  section?: "WARMUP" | "MAIN" | "ACCESSORY";
  snapshot?: unknown;
  sets?: PersistedIncompleteWorkoutSet[];
} = {}): PersistedIncompleteWorkoutExercise {
  const id = input.id ?? "we-1";
  const exerciseId = input.exerciseId ?? "cable-fly";
  return {
    id,
    exerciseId,
    orderIndex: input.orderIndex ?? 0,
    section: input.section ?? "ACCESSORY",
    isMainLift: input.section === "MAIN",
    movementPatterns: ["HORIZONTAL_ADDUCTION"],
    stimulusAccountingSnapshot:
      input.snapshot === undefined ? makeSnapshot(exerciseId) : input.snapshot,
    exercise: { id: exerciseId, name: exerciseId },
    sets: input.sets ?? [makeSet("set-1"), makeSet("set-2")],
  };
}

function makeWorkout(input: {
  status?: string;
  advancesSplit?: boolean;
  selectionMode?: string;
  sessionIntent?: string | null;
  selectionMetadata?: unknown;
  exercises?: PersistedIncompleteWorkoutExercise[];
} = {}): PersistedIncompleteWorkoutRecord {
  return {
    id: "workout-1",
    userId: "user-1",
    status: input.status ?? "IN_PROGRESS",
    scheduledDate: new Date("2026-07-14T10:00:00.000Z"),
    mesocycleId: "meso-1",
    mesocycleWeekSnapshot: 1,
    mesoSessionSnapshot: 1,
    advancesSplit: input.advancesSplit ?? true,
    selectionMode: input.selectionMode ?? "INTENT",
    sessionIntent:
      input.sessionIntent === undefined ? "UPPER" : input.sessionIntent,
    selectionMetadata:
      input.selectionMetadata ?? {
        sessionDecisionReceipt: makeReceipt({ slotId: "upper_a" }),
      },
    exercises: input.exercises ?? [makeExercise()],
  };
}

function project(workout: PersistedIncompleteWorkoutRecord) {
  return projectPersistedIncompleteWorkout({
    workout,
    expectedUserId: "user-1",
    expectedMesocycleId: "meso-1",
    expectedWeek: 1,
    requireSlotIdentity: true,
  });
}

describe("projectPersistedIncompleteWorkout", () => {
  it("separates qualifying performed sets from immutable remaining work", () => {
    const result = project(
      makeWorkout({
        exercises: [
          makeExercise({
            sets: [
              makeSet("set-1", { actualReps: 10, actualRpe: 8 }),
              makeSet("set-2"),
            ],
          }),
        ],
      })
    );

    expect(result).toMatchObject({
      status: "reliable",
      performed: {
        qualifyingSets: 1,
        contributionsByMuscle: { Chest: 1, Triceps: 0.333333 },
      },
      remaining: {
        qualifyingSets: 1,
        contributionsByMuscle: { Chest: 1, Triceps: 0.333333 },
      },
      totalProjected: {
        qualifyingSets: 2,
        contributionsByMuscle: { Chest: 2, Triceps: 0.666666 },
      },
    });
  });

  it("keeps warmup and partially entered non-qualifying logs as remaining work", () => {
    const result = project(
      makeWorkout({
        exercises: [
          makeExercise({
            sets: [
              makeSet("set-1", {
                setIntent: "WARMUP",
                actualReps: 12,
                actualRpe: 5,
              }),
              makeSet("set-2", { actualLoad: 50 }),
            ],
          }),
        ],
      })
    );

    expect(result.status).toBe("reliable");
    expect(result.performed.qualifyingSets).toBe(0);
    expect(result.remaining.qualifyingSets).toBe(2);
    expect(result.exercises[0]?.remainingSetIds).toEqual(["set-1", "set-2"]);
  });

  it("excludes skipped sets and an entirely skipped exercise from remaining work", () => {
    const result = project(
      makeWorkout({
        exercises: [
          makeExercise({
            sets: [
              makeSet("set-1", { wasSkipped: true }),
              makeSet("set-2", { wasSkipped: true }),
            ],
          }),
        ],
      })
    );

    expect(result.status).toBe("reliable");
    expect(result.totalProjected.qualifyingSets).toBe(0);
    expect(result.exercises[0]?.excludedSetIds).toEqual(["set-1", "set-2"]);
  });

  it.each([
    ["untouched", [makeSet("set-1"), makeSet("set-2")], 0],
    [
      "partially performed",
      [makeSet("set-1", { actualReps: 10 }), makeSet("set-2")],
      1,
    ],
    [
      "fully performed",
      [
        makeSet("set-1", { actualReps: 10 }),
        makeSet("set-2", { actualReps: 9 }),
      ],
      2,
    ],
  ] as const)(
    "counts only performed reality for a %s non-advancing optional session",
    (_label, sets, expectedPerformedSets) => {
      const result = project(
        makeWorkout({
          advancesSplit: false,
          sessionIntent: "BODY_PART",
          selectionMetadata: {
            sessionDecisionReceipt: makeReceipt({
              slotId: null,
              exceptions: [
                {
                  code: "optional_gap_fill",
                  message: "Marked as optional gap-fill session.",
                },
              ],
            }),
          },
          exercises: [makeExercise({ sets: [...sets] })],
        })
      );

      expect(result.consumesWeeklyScheduleIntent).toBe(false);
      expect(result.performed.qualifyingSets).toBe(expectedPerformedSets);
      expect(result.remaining.qualifyingSets).toBe(0);
    }
  );

  it("includes a runtime-added exercise only with matching exact snapshot evidence", () => {
    const snapshot = makeSnapshot("runtime-curl", { biceps: 1 });
    const result = project(
      makeWorkout({
        selectionMetadata: {
          sessionDecisionReceipt: makeReceipt({ slotId: "upper_a" }),
          runtimeEditReconciliation: {
            version: 1,
            lastReconciledAt: "2026-07-14T11:00:00.000Z",
            ops: [
              {
                kind: "add_exercise",
                source: "api_workouts_add_exercise",
                appliedAt: "2026-07-14T11:00:00.000Z",
                scope: "current_workout_only",
                facts: {
                  workoutExerciseId: "we-added",
                  exerciseId: "runtime-curl",
                  orderIndex: 0,
                  section: "ACCESSORY",
                  setCount: 2,
                  prescriptionSource: "session_accessory_defaults",
                  stimulusAccounting:
                    toExerciseStimulusAccountingEvidence(snapshot),
                },
              },
            ],
            directives: {
              continuityAlias: "none",
              progressionAlias: "none",
              futureSessionGeneration: "ignore",
              futureSeedCarryForward: "ignore",
            },
          },
        },
        exercises: [
          makeExercise({
            id: "we-added",
            exerciseId: "runtime-curl",
            snapshot,
          }),
        ],
      })
    );

    expect(result.status).toBe("reliable");
    expect(result.totalProjected.contributionsByMuscle).toEqual({ Biceps: 2 });
    expect(result.evidence.runtimeEditAttribution).toBe("exact");
  });

  it("uses the replacement snapshot for a swap completed before any logs", () => {
    const fromSnapshot = makeSnapshot("original-row", { upper_back: 1 });
    const toSnapshot = makeSnapshot("replacement-row", { lats: 1 });
    const result = project(
      makeWorkout({
        selectionMetadata: {
          sessionDecisionReceipt: makeReceipt({ slotId: "upper_a" }),
          runtimeEditReconciliation: {
            version: 1,
            lastReconciledAt: "2026-07-14T11:00:00.000Z",
            ops: [
              {
                kind: "replace_exercise",
                source: "api_workouts_swap_exercise",
                appliedAt: "2026-07-14T11:00:00.000Z",
                scope: "current_workout_only",
                facts: {
                  workoutExerciseId: "we-1",
                  fromExerciseId: "original-row",
                  toExerciseId: "replacement-row",
                  reason: "equipment_availability_equivalent_pull_swap",
                  setCount: 2,
                  fromStimulusAccounting:
                    toExerciseStimulusAccountingEvidence(fromSnapshot),
                  toStimulusAccounting:
                    toExerciseStimulusAccountingEvidence(toSnapshot),
                },
              },
            ],
            directives: {
              continuityAlias: "none",
              progressionAlias: "none",
              futureSessionGeneration: "ignore",
              futureSeedCarryForward: "ignore",
            },
          },
        },
        exercises: [
          makeExercise({
            exerciseId: "replacement-row",
            snapshot: toSnapshot,
          }),
        ],
      })
    );

    expect(result.status).toBe("reliable");
    expect(result.totalProjected.contributionsByMuscle).toEqual({ Lats: 2 });
  });

  it("fails closed when a legacy swap claims logs before the replacement", () => {
    const fromSnapshot = makeSnapshot("original-row", { upper_back: 1 });
    const toSnapshot = makeSnapshot("replacement-row", { lats: 1 });
    const result = project(
      makeWorkout({
        selectionMetadata: {
          sessionDecisionReceipt: makeReceipt({ slotId: "upper_a" }),
          runtimeEditReconciliation: {
            version: 1,
            lastReconciledAt: "2026-07-14T11:00:00.000Z",
            ops: [
              {
                kind: "replace_exercise",
                source: "api_workouts_swap_exercise",
                appliedAt: "2026-07-14T11:00:00.000Z",
                scope: "current_workout_only",
                facts: {
                  workoutExerciseId: "we-1",
                  fromExerciseId: "original-row",
                  toExerciseId: "replacement-row",
                  reason: "transition_week_backfill_substitution",
                  setCount: 2,
                  fromStimulusAccounting:
                    toExerciseStimulusAccountingEvidence(fromSnapshot),
                  toStimulusAccounting:
                    toExerciseStimulusAccountingEvidence(toSnapshot),
                },
              },
            ],
            directives: {
              continuityAlias: "none",
              progressionAlias: "none",
              futureSessionGeneration: "ignore",
              futureSeedCarryForward: "ignore",
            },
          },
        },
        exercises: [
          makeExercise({
            exerciseId: "replacement-row",
            snapshot: toSnapshot,
            sets: [
              makeSet("set-1", {
                actualReps: 10,
                completedAt: new Date("2026-07-14T10:00:00.000Z"),
              }),
              makeSet("set-2"),
            ],
          }),
        ],
      })
    );

    expect(result.status).toBe("unreliable");
    expect(result.evidence.runtimeEditAttribution).toBe("ambiguous");
    expect(result.evidence.reasons).toContain(
      "runtime_swap_original_performed_attribution_unavailable:we-1"
    );
  });

  it("excludes an unperformed runtime-added exercise after a supported remove", () => {
    const snapshot = makeSnapshot("removed-curl", { biceps: 1 });
    const evidence = toExerciseStimulusAccountingEvidence(snapshot);
    const result = project(
      makeWorkout({
        selectionMetadata: {
          sessionDecisionReceipt: makeReceipt({ slotId: "upper_a" }),
          runtimeEditReconciliation: {
            version: 1,
            lastReconciledAt: "2026-07-14T11:30:00.000Z",
            ops: [
              {
                kind: "add_exercise",
                source: "api_workouts_add_exercise",
                appliedAt: "2026-07-14T11:00:00.000Z",
                scope: "current_workout_only",
                facts: {
                  workoutExerciseId: "we-removed",
                  exerciseId: "removed-curl",
                  orderIndex: 1,
                  section: "ACCESSORY",
                  setCount: 2,
                  stimulusAccounting: evidence,
                },
              },
              {
                kind: "remove_exercise",
                source: "api_workouts_remove_exercise",
                appliedAt: "2026-07-14T11:30:00.000Z",
                scope: "current_workout_only",
                facts: {
                  workoutExerciseId: "we-removed",
                  exerciseId: "removed-curl",
                  orderIndex: 1,
                  section: "ACCESSORY",
                  setCount: 2,
                },
              },
            ],
            directives: {
              continuityAlias: "none",
              progressionAlias: "none",
              futureSessionGeneration: "ignore",
              futureSeedCarryForward: "ignore",
            },
          },
        },
        exercises: [makeExercise()],
      })
    );

    expect(result.status).toBe("reliable");
    expect(result.evidence.runtimeEditAttribution).toBe("exact");
    expect(result.exercises.map((exercise) => exercise.workoutExerciseId)).toEqual([
      "we-1",
    ]);
  });

  it("fails closed for a missing or corrupt snapshot without current-policy fallback", () => {
    const missing = project(
      makeWorkout({ exercises: [makeExercise({ snapshot: null })] })
    );
    const corrupt = project(
      makeWorkout({
        exercises: [
          makeExercise({
            snapshot: {
              ...makeSnapshot("cable-fly"),
              policyHash: "0".repeat(64),
            },
          }),
        ],
      })
    );

    expect(missing.status).toBe("unreliable");
    expect(corrupt.status).toBe("unreliable");
    expect(missing.totalProjected.contributionsByMuscle).toEqual({});
    expect(corrupt.totalProjected.contributionsByMuscle).toEqual({});
    expect(missing.evidence.reasons).toContain(
      "missing_or_invalid_stimulus_snapshot:we-1"
    );
  });

  it("rejects duplicate/conflicting evidence and completed workouts in the incomplete adapter", () => {
    const duplicateLogSet = makeSet("set-1", { actualReps: 10 });
    duplicateLogSet.logs.push({ ...duplicateLogSet.logs[0]!, id: "log-duplicate" });
    const result = project(
      makeWorkout({
        status: "COMPLETED",
        exercises: [
          makeExercise({
            sets: [
              duplicateLogSet,
              makeSet("set-2", { wasSkipped: true, actualReps: 10 }),
            ],
          }),
        ],
      })
    );

    expect(result.status).toBe("unreliable");
    expect(result.evidence.reasons).toEqual(
      expect.arrayContaining([
        "invalid_incomplete_workout_status:COMPLETED",
        "duplicate_set_log:set-1",
        "contradictory_skipped_set_log:set-2",
      ])
    );
  });

  it("is deterministic for identical persisted inputs", () => {
    const workout = makeWorkout({
      exercises: [
        makeExercise({
          sets: [
            makeSet("set-2"),
            makeSet("set-1", { actualReps: 10, actualRpe: 8 }),
          ],
        }),
      ],
    });

    expect(project(workout)).toEqual(project(workout));
  });
});

describe("loadPersistedIncompleteWorkoutProjections", () => {
  it("loads nested Prisma relations once without catalog stimulus joins", async () => {
    const workout = makeWorkout();
    const findMany = vi.fn().mockResolvedValue([workout]);

    const result = await loadPersistedIncompleteWorkoutProjections(
      { workout: { findMany } } as never,
      {
        userId: "user-1",
        mesocycleId: "meso-1",
        targetWeek: 1,
        requireSlotIdentity: true,
      }
    );

    expect(result).toHaveLength(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          mesocycleId: "meso-1",
          status: { in: ["PLANNED", "IN_PROGRESS"] },
        },
        select: expect.objectContaining({
          exercises: expect.objectContaining({
            select: expect.objectContaining({
              stimulusAccountingSnapshot: true,
              sets: expect.objectContaining({
                select: expect.objectContaining({ logs: expect.any(Object) }),
              }),
            }),
          }),
        }),
      })
    );
    const exerciseSelect = findMany.mock.calls[0]?.[0]?.select?.exercises?.select;
    expect(exerciseSelect.exercise.select).toEqual({ id: true, name: true });
    expect(exerciseSelect.exercise.select).not.toHaveProperty("exerciseMuscles");
  });
});
