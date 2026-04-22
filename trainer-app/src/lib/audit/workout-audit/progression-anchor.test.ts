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
});
