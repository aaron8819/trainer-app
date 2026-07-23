import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutExerciseFindMany = vi.fn();
  return {
    workoutExerciseFindMany,
    prisma: {
      workoutExercise: {
        findMany: workoutExerciseFindMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import { buildProgressionAnchorAuditPayload } from "./progression-anchor";
import { applyLoadsWithAudit } from "@/lib/engine/apply-loads";
import type { Exercise, WorkoutPlan } from "@/lib/engine/types";

describe("buildProgressionAnchorAuditPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reconstructs saved-session context for legacy workouts without persisted snapshots", async () => {
    mocks.workoutExerciseFindMany.mockResolvedValue([
      {
        exerciseId: "row",
        exercise: {
          name: "T-Bar Row",
          isMainLiftEligible: true,
          isCompound: true,
          exerciseEquipment: [
            {
              equipment: {
                type: "machine",
              },
            },
          ],
        },
        workout: {
          id: "workout-1",
          scheduledDate: new Date("2026-03-09T17:00:05.413Z"),
          revision: 3,
          status: "COMPLETED",
          advancesSplit: true,
          selectionMode: "INTENT",
          sessionIntent: "PULL",
          selectionMetadata: {},
          mesocycleId: "meso-1",
          mesocycleWeekSnapshot: 4,
          mesoSessionSnapshot: 1,
          mesocyclePhaseSnapshot: "ACCUMULATION",
        },
        sets: [
          {
            setIndex: 1,
            targetLoad: 120,
            targetReps: 6,
            targetRepMin: null,
            targetRepMax: null,
            logs: [
              {
                actualLoad: 120,
                actualReps: 8,
                actualRpe: 8.5,
                wasSkipped: false,
              },
            ],
          },
          {
            setIndex: 2,
            targetLoad: 120,
            targetReps: 6,
            targetRepMin: null,
            targetRepMax: null,
            logs: [
              {
                actualLoad: 120,
                actualReps: 7,
                actualRpe: 8.5,
                wasSkipped: false,
              },
            ],
          },
          {
            setIndex: 3,
            targetLoad: 120,
            targetReps: 6,
            targetRepMin: null,
            targetRepMax: null,
            logs: [
              {
                actualLoad: 120,
                actualReps: 7,
                actualRpe: 8.5,
                wasSkipped: false,
              },
            ],
          },
        ],
      },
    ]);

    const payload = await buildProgressionAnchorAuditPayload({
      userId: "user-1",
      workoutId: "workout-1",
      exerciseId: "row",
    });

    expect(payload.sessionSnapshotSource).toBe("reconstructed_saved_only");
    expect(payload.sessionSnapshot?.saved).toMatchObject({
      workoutId: "workout-1",
      status: "COMPLETED",
      advancesSplit: true,
      mesocycleSnapshot: {
        mesocycleId: "meso-1",
        week: 4,
        session: 1,
        phase: "ACCUMULATION",
      },
    });
    expect(payload.canonicalSemantics).toEqual({
      sourceLayer: "saved",
      phase: "ACCUMULATION",
      isDeload: false,
      countsTowardProgressionHistory: true,
      countsTowardPerformanceHistory: true,
      updatesProgressionAnchor: true,
    });
    expect(payload.trace.outcome.action).toBeTypeOf("string");
  });

  it("uses shared calibration equipment resolution for mixed cable and machine exercises", async () => {
    mocks.workoutExerciseFindMany.mockResolvedValue([
      {
        exerciseId: "mixed-cable-row",
        exercise: {
          name: "Cable Machine Row",
          isMainLiftEligible: true,
          isCompound: true,
          exerciseEquipment: [
            {
              equipment: {
                type: "machine",
              },
            },
            {
              equipment: {
                type: "cable",
              },
            },
          ],
        },
        workout: {
          id: "workout-2",
          scheduledDate: new Date("2026-03-10T17:00:05.413Z"),
          revision: 1,
          status: "COMPLETED",
          advancesSplit: true,
          selectionMode: "INTENT",
          sessionIntent: "PULL",
          selectionMetadata: {},
          mesocycleId: "meso-1",
          mesocycleWeekSnapshot: 1,
          mesoSessionSnapshot: 1,
          mesocyclePhaseSnapshot: "ACCUMULATION",
        },
        sets: [
          {
            setIndex: 1,
            targetLoad: 40,
            targetReps: 12,
            targetRepMin: null,
            targetRepMax: null,
            logs: [
              {
                actualLoad: 40,
                actualReps: 12,
                actualRpe: 7,
                wasSkipped: false,
              },
            ],
          },
          {
            setIndex: 2,
            targetLoad: 40,
            targetReps: 12,
            targetRepMin: null,
            targetRepMax: null,
            logs: [
              {
                actualLoad: 40,
                actualReps: 12,
                actualRpe: 7,
                wasSkipped: false,
              },
            ],
          },
        ],
      },
    ]);

    const payload = await buildProgressionAnchorAuditPayload({
      userId: "user-1",
      workoutId: "workout-2",
      exerciseId: "mixed-cable-row",
    });

    expect(payload.trace.equipment).toBe("cable");
    expect(payload.trace.confidence.historyScale).toBe(0.85);
    expect(payload.trace.confidence.reasons).toContain(
      "low load-reliability equipment scaled during early exposure."
    );
  });

  it("excludes warmup/ramp sets from progression anchor audit signal sets", async () => {
    mocks.workoutExerciseFindMany.mockResolvedValue([
      {
        exerciseId: "leg-extension",
        exercise: {
          name: "Leg Extension",
          isMainLiftEligible: false,
          isCompound: false,
          exerciseEquipment: [
            {
              equipment: {
                type: "machine",
              },
            },
          ],
        },
        workout: {
          id: "workout-leg-extension",
          scheduledDate: new Date("2026-03-11T17:00:05.413Z"),
          revision: 1,
          status: "COMPLETED",
          advancesSplit: true,
          selectionMode: "INTENT",
          sessionIntent: "LEGS",
          selectionMetadata: {},
          mesocycleId: "meso-1",
          mesocycleWeekSnapshot: 2,
          mesoSessionSnapshot: 2,
          mesocyclePhaseSnapshot: "ACCUMULATION",
        },
        sets: [
          {
            setIndex: 1,
            targetLoad: 70,
            targetReps: null,
            targetRepMin: 10,
            targetRepMax: 15,
            logs: [
              {
                actualLoad: 55,
                actualReps: 12,
                actualRpe: 8,
                setIntent: "WARMUP",
                wasSkipped: false,
              },
            ],
          },
          {
            setIndex: 2,
            targetLoad: 70,
            targetReps: null,
            targetRepMin: 10,
            targetRepMax: 15,
            logs: [
              {
                actualLoad: 70,
                actualReps: 12,
                actualRpe: 8.5,
                setIntent: "WORK",
                wasSkipped: false,
              },
            ],
          },
          {
            setIndex: 3,
            targetLoad: 75,
            targetReps: null,
            targetRepMin: 10,
            targetRepMax: 15,
            logs: [
              {
                actualLoad: 75,
                actualReps: 12,
                actualRpe: 8.5,
                setIntent: "WORK",
                wasSkipped: false,
              },
            ],
          },
          {
            setIndex: 4,
            targetLoad: 75,
            targetReps: null,
            targetRepMin: 10,
            targetRepMax: 15,
            logs: [
              {
                actualLoad: 75,
                actualReps: 12,
                actualRpe: 8.5,
                setIntent: "WORK",
                wasSkipped: false,
              },
            ],
          },
        ],
      },
    ]);

    const payload = await buildProgressionAnchorAuditPayload({
      userId: "user-1",
      workoutId: "workout-leg-extension",
      exerciseId: "leg-extension",
    });

    expect(payload.trace.anchor).toMatchObject({
      anchorLoad: 75,
      signalSetCount: 3,
      minSignalLoad: 70,
      maxSignalLoad: 75,
    });
    expect(payload.trace.metrics).toMatchObject({
      medianReps: 12,
      modalRpe: 8.5,
    });
  });

  it("Z matches runtime exposure identity, context, increment, path, and final load", async () => {
    const performedSets = [1, 2, 3].map((setIndex) => ({
      exerciseId: "bench",
      setIndex,
      reps: 10,
      rpe: 6,
      load: 100,
      targetLoad: 100,
      targetReps: 10,
      targetRepMin: 8,
      targetRepMax: 10,
      targetRpe: 8,
    }));
    const exercise: Exercise = {
      id: "bench", name: "Bench Press", movementPatterns: ["horizontal_push"],
      splitTags: ["push"], jointStress: "medium", isMainLiftEligible: true,
      isCompound: true, equipment: ["barbell"],
    };
    const workout: WorkoutPlan = {
      id: "next", scheduledDate: "2026-07-21", warmup: [], accessories: [], estimatedMinutes: 30,
      mainLifts: [{ id: "we-next", exercise, orderIndex: 0, isMainLift: true, sets: [
        { setIndex: 1, targetReps: 10, targetRpe: 8 },
        { setIndex: 2, targetReps: 10, targetRpe: 8 },
        { setIndex: 3, targetReps: 10, targetRpe: 8 },
      ] }],
    };
    const runtime = applyLoadsWithAudit(workout, {
      history: [{
        workoutId: "workout-parity", date: "2026-07-20T00:00:00.000Z", completed: true,
        status: "COMPLETED", progressionEligible: true, performanceEligible: true,
        selectionMode: "INTENT", sessionIntent: "push",
        exercises: [{ exerciseId: "bench", plannedWorkingSetCount: 3, sets: performedSets }],
      }],
      baselines: [], exerciseById: { bench: exercise }, primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" }, sessionIntent: "push",
    });

    mocks.workoutExerciseFindMany.mockResolvedValue([{ exerciseId: "bench", exercise: {
      name: "Bench Press", isMainLiftEligible: true, isCompound: true,
      exerciseEquipment: [{ equipment: { type: "barbell" } }],
    }, workout: {
      id: "workout-parity", scheduledDate: new Date("2026-07-20T00:00:00.000Z"), revision: 1,
      status: "COMPLETED", advancesSplit: true, selectionMode: "INTENT", sessionIntent: "PUSH",
      selectionMetadata: {}, mesocycleId: "meso-1", mesocycleWeekSnapshot: 2,
      mesoSessionSnapshot: 1, mesocyclePhaseSnapshot: "ACCUMULATION",
    }, sets: performedSets.map((set) => ({
      setIndex: set.setIndex, targetLoad: set.targetLoad, targetReps: set.targetReps,
      targetRepMin: set.targetRepMin, targetRepMax: set.targetRepMax, targetRpe: set.targetRpe,
      logs: [{ actualLoad: set.load, actualReps: set.reps, actualRpe: set.rpe, setIntent: "WORK", wasSkipped: false }],
    })) }]);

    const audit = await buildProgressionAnchorAuditPayload({
      userId: "user-1", workoutId: "workout-parity", exerciseId: "bench",
    });
    const runtimeTrace = runtime.audit.progressionTraces.bench;
    expect(audit.trace.exposure).toEqual(runtimeTrace.exposure);
    expect(audit.trace.metrics).toEqual(runtimeTrace.metrics);
    expect(audit.trace.outcome).toEqual(runtimeTrace.outcome);
    expect(runtime.workout.mainLifts[0].sets[0].targetLoad).toBe(audit.trace.metrics.nextLoad);
    expect(audit.trace.exposure).toMatchObject({
      selectedExposureId: "workout-parity", contextBound: true, representativeLoad: 100,
      performedReps: 10, actualRpe: 6, priorPrescribedReps: 10, priorPrescribedRpe: 8,
    });
    expect(audit.trace.metrics).toMatchObject({ increment: 5, currentTargetReps: 10, currentTargetRpe: 8, nextLoad: 105 });
  });
});
