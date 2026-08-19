import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = vi.fn();
  const userFindUnique = vi.fn();
  const macroCycleFindUnique = vi.fn();
  const mesocycleFindMany = vi.fn();
  const constraintsFindUnique = vi.fn();
  const workoutFindFirst = vi.fn();
  const workoutFindMany = vi.fn();
  const mesocycleWeekCloseFindFirst = vi.fn();
  const loadProgramDashboardData = vi.fn();
  const loadProjectedWeekVolumeReport = vi.fn();

  return {
    transaction,
    userFindUnique,
    macroCycleFindUnique,
    mesocycleFindMany,
    constraintsFindUnique,
    workoutFindFirst,
    workoutFindMany,
    mesocycleWeekCloseFindFirst,
    loadProgramDashboardData,
    loadProjectedWeekVolumeReport,
    prisma: {
      $transaction: transaction,
      user: { findUnique: userFindUnique },
      macroCycle: { findUnique: macroCycleFindUnique },
      mesocycle: { findMany: mesocycleFindMany },
      constraints: { findUnique: constraintsFindUnique },
      workout: {
        findFirst: workoutFindFirst,
        findMany: workoutFindMany,
      },
      mesocycleWeekClose: { findFirst: mesocycleWeekCloseFindFirst },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/api/workout-context", () => ({
  findOwnerReadOnly: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@/lib/api/mesocycle-handoff", () => ({
  loadPendingMesocycleHandoff: vi.fn(async () => null),
}));

vi.mock("@/lib/api/mesocycle-week-close", () => ({
  findRelevantWeekCloseForUser: vi.fn(async () => null),
}));

vi.mock("@/lib/api/home-pre-session-readiness", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/home-pre-session-readiness")>();
  return {
    ...actual,
    loadCurrentHomePreSessionReadinessContractCandidate: vi.fn(async () => null),
  };
});

vi.mock("@/lib/ui-audit-fixtures/server", () => ({
  getUiAuditFixtureForServer: vi.fn(async () => null),
}));

vi.mock("@/lib/api/program", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/program")>();
  return {
    ...actual,
    loadProgramDashboardData: (...args: unknown[]) =>
      mocks.loadProgramDashboardData(...args),
  };
});

vi.mock("@/lib/api/projected-week-volume", () => ({
  loadProjectedWeekVolumeReport: (...args: unknown[]) =>
    mocks.loadProjectedWeekVolumeReport(...args),
}));

vi.mock("@/components/DashboardGenerateSection", () => ({
  DashboardGenerateSection: () => <div>Choose a different session</div>,
}));

vi.mock("@/components/ProgramStatusCard", () => ({
  ProgramStatusCard: ({ variant }: { variant?: string }) => (
    <div>{`ProgramStatusCard:${variant ?? "default"}`}</div>
  ),
}));

vi.mock("@/components/OptionalWeekCompletion", () => ({
  OptionalWeekCompletion: () => <div>Optional week completion</div>,
}));

vi.mock("@/components/CloseoutCard", () => ({
  CloseoutCard: () => <div>Closeout schedule claim</div>,
}));

vi.mock("@/components/HomePreSessionReadinessPanel", () => ({
  HomePreSessionReadinessPanel: () => <div>Projected readiness schedule</div>,
}));

vi.mock("@/components/RecentWorkouts", () => ({
  default: () => <div>Recent historical activity</div>,
}));

vi.mock("@/components/CycleAnchorControls", () => ({
  CycleAnchorControls: () => <div>Cycle anchor controls</div>,
}));

vi.mock("@/app/program/WeekCompletionOutlookSection", () => ({
  WeekCompletionOutlookSection: () => <div>Projected finish: Week 5</div>,
}));

vi.mock("@/app/program/VolumeSnapshotSection", () => ({
  VolumeSnapshotSection: () => <div>Projected current-week volume</div>,
}));

import { normalizeAcceptedHypertrophySeedV4 } from "@/lib/api/mesocycle-seed-revision";
import { loadHomePageData } from "@/lib/api/home-page";
import { loadProgramPageData } from "@/lib/api/program-page";
import HomePage from "./page";
import ProgramPage from "./program/page";

function buildAcceptedV4Seed() {
  const weeks = [1, 2, 3, 4, 5].map((week) => ({
    week,
    phase: week === 5 ? ("DELOAD" as const) : ("ACCUMULATION" as const),
  }));
  const slots = [
    ["upper-a", "UPPER"],
    ["lower-a", "LOWER"],
    ["upper-b", "UPPER"],
    ["lower-b", "LOWER"],
  ] as const;

  return {
    version: 4 as const,
    source: "custom_hypertrophy_plan_v2" as const,
    settings: {
      equipmentProfile: "FULL_GYM" as const,
      sessionDurationMinutes: 60 as const,
    },
    weeks,
    slots: slots.map(([slotId, focus]) => ({
      slotId,
      name: slotId,
      focus,
      exercises: [
        {
          placementId: `${slotId}-placement`,
          exerciseId: `${slotId}-exercise`,
          role: "CORE_COMPOUND" as const,
          intent: {
            userRole: "PRIMARY_LIFT" as const,
            target: {
              kind: "movement_pattern" as const,
              movementPattern:
                focus === "UPPER"
                  ? ("horizontal_push" as const)
                  : ("squat" as const),
            },
          },
          measurement: {
            profile: "REPS_EXTERNAL_LOAD" as const,
            loadConvention: "BARBELL_TOTAL" as const,
            repBasis: "TOTAL" as const,
          },
          prescriptions: weeks.map(({ week, phase }) => ({
            week,
            status: "PRESCRIBE" as const,
            setCount: phase === "DELOAD" ? 2 : 3,
            reps: { kind: "RANGE" as const, min: 6, max: 10 },
            rir: { kind: "TARGET_RANGE" as const, min: 1, max: 3 },
          })),
        },
      ],
    })),
  };
}

function buildHistoricalWorkout() {
  return {
    id: "historical-workout",
    revision: 4,
    scheduledDate: new Date("2026-08-10T12:00:00.000Z"),
    completedAt: new Date("2026-08-10T13:00:00.000Z"),
    status: "COMPLETED",
    selectionMode: "INTENT",
    sessionIntent: "LOWER",
    mesocycleId: "meso-v4",
    mesocycleWeekSnapshot: 1,
    mesoSessionSnapshot: 2,
    mesocyclePhaseSnapshot: "ACCUMULATION",
    selectionMetadata: null,
    mesocycle: {
      macroCycleId: "macro-1",
      sessionsPerWeek: 4,
      state: "ACTIVE_ACCUMULATION",
      isActive: true,
    },
    _count: { exercises: 1 },
    exercises: [],
  };
}

describe("blocked exact V4 schedule surfaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const seedPayload = buildAcceptedV4Seed();
    const normalized = normalizeAcceptedHypertrophySeedV4(seedPayload);
    const revision = {
      id: "revision-v4",
      revision: 1,
      seedPayload,
      payloadHash: normalized.hash,
      hashAlgorithm: "sha256",
      provenanceStatus: "exact",
    };
    const slotSequenceJson = {
      version: 1,
      source: "custom_hypertrophy_plan_v2",
      sequenceMode: "ordered_flexible",
      sessionsPerWeek: 4,
      slots: [
        { slotId: "upper-a", intent: "UPPER" },
        { slotId: "lower-a", intent: "LOWER" },
        { slotId: "upper-b", intent: "UPPER" },
        { slotId: "lower-b", intent: "LOWER" },
      ],
    };
    const activeMesocycle = {
      id: "meso-v4",
      macroCycleId: "macro-1",
      mesoNumber: 2,
      focus: "Exact V4",
      durationWeeks: 5,
      sessionsPerWeek: 4,
      startWeek: 0,
      state: "ACTIVE_ACCUMULATION",
      isActive: true,
      accumulationSessionsCompleted: 11,
      deloadSessionsCompleted: 0,
      completedSessions: 11,
      volumeTarget: "MODERATE",
      slotPlanSeedJson: seedPayload,
      slotSequenceJson,
      currentSeedRevisionId: revision.id,
      currentSeedRevision: revision,
      seedRevisions: [],
      blocks: [],
      macroCycle: {
        id: "macro-1",
        userId: "user-1",
        name: "V4 plan",
        startDate: new Date("2026-08-03T00:00:00.000Z"),
        endDate: new Date("2026-09-07T00:00:00.000Z"),
        durationWeeks: 5,
        primaryGoal: "HYPERTROPHY",
      },
    };
    const receiptlessReleasedWorkout = {
      id: "released-upper-a",
      status: "PLANNED",
      scheduledDate: new Date("2026-08-17T12:00:00.000Z"),
      mesocycleId: activeMesocycle.id,
      mesocycleWeekSnapshot: 1,
      mesocyclePhaseSnapshot: "ACCUMULATION",
      mesoSessionSnapshot: 1,
      advancesSplit: false,
      selectionMode: "AUTO",
      sessionIntent: null,
      seedRevisionId: revision.id,
      seedRevisionNumber: revision.revision,
      seedPayloadHash: revision.payloadHash,
      seedRevision: revision,
      exercises: [],
      selectionMetadata: {
        sessionDecisionReceipt: {
          version: 2,
          cycleContext: {
            weekInMeso: 1,
            weekInBlock: 1,
            mesocycleLength: 5,
            phase: "accumulation",
            blockType: "accumulation",
            isDeload: false,
            source: "computed",
          },
          sessionProvenance: {
            mesocycleId: activeMesocycle.id,
            compositionSource: "persisted_slot_plan_seed",
            seedProvenance: {
              revisionId: revision.id,
              revision: revision.revision,
              hash: revision.payloadHash,
            },
          },
          sessionSlot: {
            slotId: "upper-a",
            intent: "upper",
            sequenceIndex: 0,
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
    };
    const historicalWorkout = buildHistoricalWorkout();

    mocks.transaction.mockImplementation(
      async (callback: (client: typeof mocks.prisma) => unknown) =>
        callback(mocks.prisma),
    );
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      email: "owner@test.local",
      activeMacroCycleId: "macro-1",
    });
    mocks.macroCycleFindUnique.mockResolvedValue(activeMesocycle.macroCycle);
    mocks.mesocycleFindMany.mockImplementation(async (args: { where?: { isActive?: boolean } }) =>
      args.where?.isActive
        ? [activeMesocycle]
        : [
            {
              id: activeMesocycle.id,
              macroCycleId: activeMesocycle.macroCycleId,
              mesoNumber: activeMesocycle.mesoNumber,
              state: activeMesocycle.state,
              closedAt: null,
            },
          ],
    );
    mocks.constraintsFindUnique.mockResolvedValue({
      weeklySchedule: ["upper", "lower", "upper", "lower"],
    });
    mocks.mesocycleWeekCloseFindFirst.mockResolvedValue(null);
    mocks.workoutFindFirst.mockResolvedValue(historicalWorkout);
    mocks.workoutFindMany.mockImplementation(async (args: {
      take?: number;
      where?: {
        status?: { in?: string[] };
        mesocycleWeekSnapshot?: number;
      };
      orderBy?: unknown;
    }) => {
      if (args.take === 10) return [historicalWorkout];
      if (args.take === 20) return [receiptlessReleasedWorkout];
      if (args.where?.mesocycleWeekSnapshot != null) return [];
      if (args.where?.status?.in) return [];
      return [receiptlessReleasedWorkout];
    });
    mocks.loadProgramDashboardData.mockResolvedValue({
      activeMeso: {
        mesoNumber: 2,
        focus: "Exact V4",
        durationWeeks: 5,
        completedSessions: 11,
        volumeTarget: "moderate",
        currentBlockType: "accumulation",
        blocks: [],
      },
      currentWeek: 3,
      viewedWeek: 3,
      viewedBlockType: "accumulation",
      sessionsUntilDeload: 5,
      volumeThisWeek: [
        {
          muscle: "Chest",
          effectiveSets: 9,
          directSets: 9,
          indirectSets: 0,
          target: 12,
          mev: 8,
          mav: 14,
          mrv: 18,
          weightedSetsLabel: "9 weighted sets",
          targetLabel: "Preferred target: 12 weighted sets",
          statusLabel: "Productive zone",
          statusDescription: "Performed current-week volume",
          deltaLabel: "-3 sets",
          badges: [],
          opportunityScore: 50,
          opportunityState: "optional",
          opportunityRationale: "Fallback current-week opportunity",
        },
      ],
      deloadReadiness: null,
      rirTarget: { min: 1, max: 3 },
      coachingCue: "Fallback current-week coaching",
    });
    mocks.loadProjectedWeekVolumeReport.mockResolvedValue({
      currentWeek: 3,
      projectedWeek: 5,
      projectedFinish: "Week 5",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("suppresses Home schedule claims while retaining the blocker and history", async () => {
    const data = await loadHomePageData("user-1");

    expect(data.homeProgram?.isExactScheduleBlocked).toBe(true);
    expect(data.primaryAction).toMatchObject({
      state: "blocked",
      label: "Refresh workout schedule",
      href: "/program",
    });
    expect(data.headerContext).toBe(
      "Workout schedule needs attention. Refresh before continuing.",
    );
    expect(data.decision).toMatchObject({
      nextSessionLabel: null,
      activeWeekLabel: null,
      activeWeekSessions: [],
      completedAdvancingSessionsThisWeek: 0,
      totalAdvancingSessionsThisWeek: 0,
    });
    expect(data.closeout).toBeNull();
    expect(data.continuity).toMatchObject({
      nextDueLabel: null,
      nextDueDescriptor: null,
    });
    expect(data.continuity?.lastCompleted?.id).toBe("historical-workout");

    render(await HomePage());

    expect(screen.getByText("Refresh workout schedule")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review program" })).toHaveAttribute(
      "href",
      "/program",
    );
    expect(screen.getByText("Last Completed")).toBeInTheDocument();
    expect(screen.getByText("Recent historical activity")).toBeInTheDocument();
    expect(screen.queryByText(/Week 3/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Next Due")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Week")).not.toBeInTheDocument();
    expect(screen.queryByText("Choose a different session")).not.toBeInTheDocument();
    expect(screen.queryByText("Optional week completion")).not.toBeInTheDocument();
    expect(screen.queryByText("Projected readiness schedule")).not.toBeInTheDocument();
    expect(screen.queryByText("ProgramStatusCard:homeCompact")).not.toBeInTheDocument();
    expect(screen.queryByText(/sessions? complete/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sessions? until deload/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/projected finish/i)).not.toBeInTheDocument();
  });

  it("suppresses Program fallback, planned rows, and projection while rendering recovery", async () => {
    const data = await loadProgramPageData("user-1");

    expect(data.isExactScheduleBlocked).toBe(true);
    expect(data.lifecycleBlocker).toMatchObject({
      code: "V4_SCHEDULE_RESOLUTION_BLOCKED",
    });
    expect(data.overview).toBeNull();
    expect(data.currentWeekPlan).toBeNull();
    expect(data.closeout).toBeNull();
    expect(data.weekCompletionOutlook).toBeNull();
    expect(data.advancedActions.availableActions).toEqual([]);
    expect(mocks.loadProjectedWeekVolumeReport).not.toHaveBeenCalled();

    render(await ProgramPage());

    expect(screen.getByText("Refresh workout schedule")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Refresh program" })).toHaveAttribute(
      "href",
      "/program",
    );
    expect(screen.queryByText("Active Mesocycle")).not.toBeInTheDocument();
    expect(screen.queryByText("Current Week Plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Next Workout")).not.toBeInTheDocument();
    expect(screen.queryByText("ProgramStatusCard:default")).not.toBeInTheDocument();
    expect(screen.queryByText("Projected current-week volume")).not.toBeInTheDocument();
    expect(screen.queryByText("Projected finish: Week 5")).not.toBeInTheDocument();
    expect(screen.queryByText(/sessions? until deload/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Week 3/i)).not.toBeInTheDocument();
  });
});
