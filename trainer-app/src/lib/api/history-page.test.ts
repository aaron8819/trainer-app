import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  workoutFindMany: vi.fn(),
  workoutCount: vi.fn(),
  mesocycleFindMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    workout: {
      findMany: mocks.workoutFindMany,
      count: mocks.workoutCount,
    },
    mesocycle: { findMany: mocks.mesocycleFindMany },
  },
}));

vi.mock("@/lib/ui-audit-fixtures/server", () => ({
  getUiAuditFixtureForServer: vi.fn(async () => null),
}));

import { loadHistoryPageData } from "./history-page";

describe("loadHistoryPageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue({ activeMacroCycleId: "plan-v4" });
    mocks.workoutCount.mockResolvedValue(1);
    mocks.mesocycleFindMany.mockResolvedValue([]);
  });

  it("projects persisted authored labels for the initial history page", async () => {
    mocks.workoutFindMany.mockResolvedValue([
      {
        id: "workout-upper-b",
        revision: 3,
        scheduledDate: new Date("2026-08-20T10:00:00.000Z"),
        completedAt: null,
        status: "SKIPPED",
        selectionMode: "INTENT",
        sessionIntent: "UPPER",
        mesocycleId: "meso-v4",
        mesocycleWeekSnapshot: 5,
        mesoSessionSnapshot: 4,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 5,
              weekInBlock: 1,
              phase: "accumulation",
              blockType: "accumulation",
              isDeload: false,
              source: "computed",
            },
            sessionSlot: {
              slotId: "upper-b",
              intent: "upper",
              sequenceIndex: 3,
              sequenceLength: 4,
              source: "mesocycle_slot_sequence",
            },
            lifecycleVolume: { source: "unknown" },
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
                applied: false,
                exerciseIds: [],
                scaledUpCount: 0,
                scaledDownCount: 0,
              },
            },
            exceptions: [],
          },
        },
        mesocycle: {
          macroCycleId: "plan-v4",
          sessionsPerWeek: 4,
          state: "ACTIVE_ACCUMULATION",
          isActive: true,
          slotSequenceJson: {
            version: 1,
            source: "handoff_draft",
            sequenceMode: "ordered_flexible",
            slots: [
              { slotId: "upper-b", intent: "UPPER", label: "Upper B" },
            ],
          },
        },
        _count: { exercises: 0 },
        exercises: [],
      },
    ]);

    const result = await loadHistoryPageData("user-1");

    expect(result.initialWorkouts).toEqual([
      expect.objectContaining({
        id: "workout-upper-b",
        status: "SKIPPED",
        sessionIdentityLabel: "Upper B",
        sessionSlotId: "upper-b",
        sessionSnapshot: { week: 5, session: 4, phase: "ACCUMULATION" },
      }),
    ]);
    expect(mocks.workoutFindMany.mock.calls[0][0].select.mesocycle.select)
      .toMatchObject({ slotSequenceJson: true });
  });
});
