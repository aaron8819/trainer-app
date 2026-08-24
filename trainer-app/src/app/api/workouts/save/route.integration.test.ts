/**
 * Protects: Save API is action-based (save_plan / mark_completed / mark_partial / mark_skipped), with backward inference that cannot bypass gating.
 * Why it matters: Save behavior is the highest-risk workflow boundary and must remain deterministic under mixed legacy/new payloads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalWritePause = process.env.TRAINER_WRITE_PAUSE;

afterEach(() => {
  if (originalWritePause === undefined) delete process.env.TRAINER_WRITE_PAUSE;
  else process.env.TRAINER_WRITE_PAUSE = originalWritePause;
});

const mocks = vi.hoisted(() => {
  const workoutFindUnique = vi.fn();
  const workoutIdentityFindFirst = vi.fn();
  const workoutFindFirst = vi.fn();
  const workoutFindMany = vi.fn();
  const workoutUpdateMany = vi.fn();
  const workoutCreate = vi.fn();
  const workoutUpsert = vi.fn();
  const workoutExerciseFindMany = vi.fn();
  const workoutExerciseCreate = vi.fn();
  const exerciseFindUnique = vi.fn();
  const transitionMesocycleStateInTransaction = vi.fn();
  const claimSelectedPlanForTransitionInTransaction = vi.fn();
  const autoDismissPendingWeekCloseOnForwardProgress = vi.fn();
  const evaluateWeekCloseAtBoundary = vi.fn();
  const linkOptionalWorkoutToWeekClose = vi.fn();
  const resolveWeekCloseOnOptionalGapFillCompletion = vi.fn();
  const dismissPendingWeekClose = vi.fn();
  const createPostSessionReviewSnapshotInTransaction = vi.fn();
  const enterMesocycleHandoffInTransaction = vi.fn();
  const provisionOwnerForMutation = vi.fn(async () => ({ id: "user-1" }));
  let terminalDiscoveryFixture: Record<string, unknown> | null | undefined;

  const tx = {
    workout: {
      findUnique: async (args: Record<string, unknown>) => {
        const authoritative = await workoutFindUnique(args);
        const discovered = terminalDiscoveryFixture;
        terminalDiscoveryFixture = undefined;
        if (!discovered) return authoritative;
        const authoritativeRecord =
          authoritative && typeof authoritative === "object"
            ? (authoritative as Record<string, unknown>)
            : {};
        return {
          ...discovered,
          ...authoritativeRecord,
          exercises:
            authoritativeRecord.exercises ?? discovered.exercises ?? [],
        };
      },
      findFirst: async (args: Record<string, unknown>) => {
        const select = args.select as Record<string, unknown> | undefined;
        const where = args.where as Record<string, unknown> | undefined;
        if (
          select?.id === true &&
          select.mesocycleId === true &&
          Object.keys(select).length === 2 &&
          where?.userId !== undefined
        ) {
          return workoutIdentityFindFirst(args);
        }
        return workoutFindFirst(args);
      },
      findMany: workoutFindMany,
      updateMany: workoutUpdateMany,
      create: workoutCreate,
      upsert: workoutUpsert,
    },
    workoutTemplate: {
      findFirst: vi.fn(),
    },
    mesocycle: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    mesocycleSeedRevision: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    workoutExercise: {
      findMany: workoutExerciseFindMany,
      deleteMany: vi.fn(),
      create: workoutExerciseCreate,
    },
    workoutSet: {
      deleteMany: vi.fn(),
    },
    exercise: {
      findUnique: exerciseFindUnique,
    },
    filteredExercise: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    setLog: {
      count: vi.fn(),
    },
    mesocycleWeekClose: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
  };

  const prisma = {
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<void>) => callback(tx)),
  };

  return {
    tx,
    prisma,
    workoutFindUnique,
    workoutIdentityFindFirst,
    workoutFindFirst,
    workoutFindMany,
    workoutUpdateMany,
    workoutCreate,
    workoutUpsert,
    workoutExerciseFindMany,
    workoutExerciseCreate,
    exerciseFindUnique,
    transitionMesocycleStateInTransaction,
    claimSelectedPlanForTransitionInTransaction,
    autoDismissPendingWeekCloseOnForwardProgress,
    evaluateWeekCloseAtBoundary,
    linkOptionalWorkoutToWeekClose,
    resolveWeekCloseOnOptionalGapFillCompletion,
    dismissPendingWeekClose,
    createPostSessionReviewSnapshotInTransaction,
    enterMesocycleHandoffInTransaction,
    provisionOwnerForMutation,
    rememberTerminalDiscovery: (
      workout: Record<string, unknown> | null,
    ) => {
      terminalDiscoveryFixture = workout;
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/active-plan-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/active-plan-context")>();
  return {
    ...actual,
    claimSelectedPlanForTransitionInTransaction:
      mocks.claimSelectedPlanForTransitionInTransaction,
  };
});

vi.mock("@/lib/api/workout-context", () => ({
  provisionOwnerForMutation: () => mocks.provisionOwnerForMutation(),
}));

vi.mock("@/lib/api/post-session-review-snapshot", () => ({
  createPostSessionReviewSnapshotInTransaction: (...args: unknown[]) =>
    mocks.createPostSessionReviewSnapshotInTransaction(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff", () => ({
  enterMesocycleHandoffInTransaction: (...args: unknown[]) =>
    mocks.enterMesocycleHandoffInTransaction(...args),
}));

vi.mock("@/lib/api/mesocycle-lifecycle-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/mesocycle-lifecycle-state")>();
  return {
    ...actual,
    resolveActivePlanContextInTransaction: vi.fn(
      async (client: typeof mocks.tx) => {
        const activeMesocycle = await client.mesocycle.findFirst();
        return activeMesocycle
          ? {
              status: "READY",
              owner: {
                id: "user-1",
                email: "owner@test.local",
                activeMacroCycleId: "macro-1",
              },
              activeMacroCycle: { id: "macro-1", userId: "user-1" },
              activeMesocycle,
            }
          : {
              status: "NO_SELECTED_PLAN",
              owner: {
                id: "user-1",
                email: "owner@test.local",
                activeMacroCycleId: null,
              },
              activeMacroCycle: null,
              activeMesocycle: null,
            };
      }
    ),
    claimSelectedPlanForTransitionInTransaction:
      mocks.claimSelectedPlanForTransitionInTransaction,
    transitionMesocycleStateInTransaction: mocks.transitionMesocycleStateInTransaction,
  };
});

vi.mock("@/lib/api/mesocycle-week-close", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/mesocycle-week-close")>();
  return {
    ...actual,
    autoDismissPendingWeekCloseOnForwardProgress: mocks.autoDismissPendingWeekCloseOnForwardProgress,
    evaluateWeekCloseAtBoundary: mocks.evaluateWeekCloseAtBoundary,
    linkOptionalWorkoutToWeekClose: mocks.linkOptionalWorkoutToWeekClose,
    resolveWeekCloseOnOptionalGapFillCompletion: mocks.resolveWeekCloseOnOptionalGapFillCompletion,
    dismissPendingWeekClose: mocks.dismissPendingWeekClose,
  };
});

import { POST as saveWorkoutPost } from "./route";
import {
  finishDeloadEarly,
  finishMesocycleEarly,
} from "@/lib/api/mesocycle-lifecycle-state";
import { fingerprintShortTodaySaveExercises } from "@/lib/api/save-workout/session-capacity";
import { buildV4CustomPlanReferenceAcceptedSeed } from "@/lib/engine/hypertrophy-plan-authoring-v4.fixture";
import {
  buildScheduledSlotReceipt,
  resolveV4ScheduleAuthority,
  type V4RequiredSlot,
  type V4ScheduleAuthority,
} from "@/lib/api/v4-scheduled-slot-resolution";

describe("production write pause", () => {
  beforeEach(() => {
    mocks.rememberTerminalDiscovery(null);
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (trx: typeof mocks.tx) => Promise<void>) =>
        callback(mocks.tx),
    );
    mocks.claimSelectedPlanForTransitionInTransaction.mockReset();
    mocks.claimSelectedPlanForTransitionInTransaction.mockResolvedValue(undefined);
    mocks.enterMesocycleHandoffInTransaction.mockReset();
    vi.clearAllMocks();
    delete process.env.TRAINER_WRITE_PAUSE;
  });

  it("returns 503 before owner resolution, revision CAS, transaction, or receipt snapshot writes", async () => {
    process.env.TRAINER_WRITE_PAUSE = "enabled";
    const response = await saveWorkoutPost(
      new Request("http://localhost/api/workouts/save", { method: "POST" }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({ code: "PRODUCTION_WRITE_PAUSED" });
    expect(mocks.provisionOwnerForMutation).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();
    expect(mocks.createPostSessionReviewSnapshotInTransaction).not.toHaveBeenCalled();
  });
});

async function POST(request: Request) {
  const body = (await request.clone().json()) as Record<string, unknown>;
  if (
    typeof body.action === "string" &&
    body.action !== "save_plan" &&
    body.expectedRevision == null
  ) {
    body.expectedRevision = 1;
  }
  return saveWorkoutPost(
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(body),
    }),
  );
}

function buildCanonicalSelectionMetadata(overrides?: Record<string, unknown>) {
  return {
    sessionDecisionReceipt: {
      version: 1,
      cycleContext: {
        weekInMeso: 4,
        weekInBlock: 2,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      lifecycleVolume: {
        source: "unknown",
      },
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
    ...overrides,
  };
}

function buildV4RouteFixture(input?: {
  status?: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";
  advancesSplit?: boolean;
  includeScheduledReceipt?: boolean;
}) {
  const seed = buildV4CustomPlanReferenceAcceptedSeed();
  const acceptedRevisionHash =
    "3d4e807cbafdb89bd52dc0fb475842b8c18761e2212967614e41acf5e22913b9";
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
  const slot = slotSequenceJson.slots[0]!;
  const scheduledSlotReceipt = {
    version: 1,
    mesocycleId: "meso-v4",
    acceptedRevisionId: "revision-v4",
    acceptedRevisionNumber: 1,
    acceptedRevisionHash,
    weekInMeso: 1,
    slotId: slot.slotId,
    sequenceIndex: 0,
    sequenceLength: 4,
  };
  const selectionMetadata = {
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
        mesocycleId: "meso-v4",
        compositionSource: "persisted_slot_plan_seed",
        seedProvenance: {
          revisionId: "revision-v4",
          revision: 1,
          hash: acceptedRevisionHash,
        },
      },
      sessionSlot: {
        slotId: slot.slotId,
        intent: slot.intent.toLowerCase(),
        sequenceIndex: 0,
        sequenceLength: 4,
        source: "mesocycle_slot_sequence",
      },
      ...(input?.includeScheduledReceipt ? { scheduledSlotReceipt } : {}),
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
  };
  const mesocycle = {
    id: "meso-v4",
    macroCycleId: "macro-1",
    state: "ACTIVE_ACCUMULATION",
    durationWeeks: 5,
    accumulationSessionsCompleted: 0,
    deloadSessionsCompleted: 0,
    sessionsPerWeek: 4,
    slotSequenceJson,
    currentSeedRevisionId: "revision-v4",
    currentSeedRevision: {
      id: "revision-v4",
      mesocycleId: "meso-v4",
      revision: 1,
      seedPayload: seed,
      payloadHash: acceptedRevisionHash,
      hashAlgorithm: "sha256",
      provenanceStatus: "exact",
    },
    startWeek: 0,
    macroCycle: { startDate: new Date("2026-01-05T00:00:00.000Z") },
  };
  const workout = {
    id: "workout-v4",
    userId: "user-1",
    status: input?.status ?? "PLANNED",
    scheduledDate: new Date("2026-01-05T00:00:00.000Z"),
    completedAt: null,
    revision: 1,
    mesocycleId: "meso-v4",
    mesocycleWeekSnapshot: 1,
    mesocyclePhaseSnapshot: "ACCUMULATION",
    mesoSessionSnapshot: 1,
    advancesSplit: input?.advancesSplit ?? false,
    selectionMode: "AUTO",
    sessionIntent: null,
    selectionMetadata,
    seedRevisionId: "revision-v4",
    seedRevisionNumber: 1,
    seedPayloadHash: acceptedRevisionHash,
  };
  return { mesocycle, workout, selectionMetadata, scheduledSlotReceipt, slot };
}

function buildGeneratedSnapshotSelectionMetadata() {
  return buildCanonicalSelectionMetadata({
    sessionAuditSnapshot: {
      version: 1,
      generated: {
        selectionMode: "INTENT",
        sessionIntent: "push",
        exerciseCount: 1,
        hardSetCount: 3,
        exercises: [
          {
            exerciseId: "bench",
            exerciseName: "Bench Press",
            orderIndex: 0,
            section: "main",
            isMainLift: true,
            prescribedSetCount: 3,
            prescribedSets: [
              { setIndex: 1, targetReps: 8, targetRpe: 8 },
              { setIndex: 2, targetReps: 8, targetRpe: 8 },
              { setIndex: 3, targetReps: 8, targetRpe: 8 },
            ],
          },
        ],
        semantics: {
          kind: "advancing",
          effectiveSelectionMode: "INTENT",
          isDeload: false,
          isStrictGapFill: false,
          isStrictSupplemental: false,
          advancesLifecycle: true,
          consumesWeeklyScheduleIntent: true,
          countsTowardCompliance: true,
          countsTowardRecentStimulus: true,
          countsTowardWeeklyVolume: true,
          countsTowardProgressionHistory: true,
          countsTowardPerformanceHistory: true,
          updatesProgressionAnchor: true,
          eligibleForUniqueIntentSubtraction: true,
          reasons: [],
          trace: {
            advancesSplitInput: true,
          },
        },
        traces: {
          progression: {},
        },
      },
    },
  });
}

function buildOptionalGapFillSelectionMetadata() {
  return buildCanonicalSelectionMetadata({
    sessionDecisionReceipt: {
      version: 1,
      cycleContext: {
        weekInMeso: 4,
        weekInBlock: 4,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
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
      exceptions: [{ code: "optional_gap_fill", message: "Marked as optional gap-fill session." }],
    },
  });
}

function buildSupplementalDeficitSelectionMetadata() {
  return buildCanonicalSelectionMetadata({
    sessionDecisionReceipt: {
      version: 1,
      cycleContext: {
        weekInMeso: 4,
        weekInBlock: 4,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
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
      exceptions: [
        {
          code: "supplemental_deficit_session",
          message: "Marked as supplemental deficit session.",
        },
      ],
    },
  });
}

function buildCloseoutSelectionMetadata() {
  return buildCanonicalSelectionMetadata({
    weekCloseId: "week-close-1",
    sessionDecisionReceipt: {
      version: 1,
      cycleContext: {
        weekInMeso: 4,
        weekInBlock: 4,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      sessionSlot: {
        slotId: "upper_b",
        intent: "upper",
        sequenceIndex: 2,
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
      exceptions: [
        {
          code: "closeout_session",
          message: "Marked as closeout session.",
        },
      ],
    },
  });
}

type TerminalRaceState = "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD";
type TerminalOperation = "natural" | "early";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function terminalWorkout(
  authority: V4ScheduleAuthority,
  slot: V4RequiredSlot,
  status: "PLANNED" | "COMPLETED" | "SKIPPED",
) {
  const selectionMetadata = {
    sessionDecisionReceipt: {
      version: 2,
      cycleContext: {
        weekInMeso: slot.weekInMeso,
        weekInBlock: slot.phase === "DELOAD" ? 1 : slot.weekInMeso,
        mesocycleLength: 5,
        phase: slot.phase.toLowerCase(),
        blockType: slot.phase.toLowerCase(),
        isDeload: slot.phase === "DELOAD",
        source: "computed",
      },
      sessionProvenance: {
        mesocycleId: authority.mesocycleId,
        compositionSource:
          slot.phase === "DELOAD"
            ? "deload_seed_replay"
            : "persisted_slot_plan_seed",
        seedProvenance: {
          revisionId: authority.revisionId,
          revision: authority.revisionNumber,
          hash: authority.revisionHash,
        },
      },
      sessionSlot: {
        slotId: slot.slotId,
        intent: slot.intent,
        sequenceIndex: slot.sequenceIndex,
        sequenceLength: slot.sequenceLength,
        source: "mesocycle_slot_sequence",
      },
      scheduledSlotReceipt: buildScheduledSlotReceipt(authority, slot),
      lifecycleVolume: { source: "unknown" },
      sorenessSuppressedMuscles: [],
      deloadDecision: {
        mode: slot.phase === "DELOAD" ? "scheduled" : "none",
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
  };
  return {
    id: `workout-${slot.weekInMeso}-${slot.slotId}`,
    userId: "user-1",
    status,
    scheduledDate: new Date("2026-08-20T10:00:00.000Z"),
    completedAt: null as Date | null,
    revision: 1,
    mesocycleId: authority.mesocycleId,
    mesocycleWeekSnapshot: slot.weekInMeso,
    mesocyclePhaseSnapshot: slot.phase,
    mesoSessionSnapshot: slot.sequenceIndex + 1,
    advancesSplit: true,
    selectionMode: "AUTO",
    sessionIntent: slot.intent.toUpperCase(),
    selectionMetadata,
    seedRevisionId: authority.revisionId,
    seedRevisionNumber: authority.revisionNumber,
    seedPayloadHash: authority.revisionHash,
  };
}

function buildTerminalRaceFixture(state: TerminalRaceState) {
  const base = buildV4RouteFixture();
  const mesocycle = {
    ...base.mesocycle,
    state: state as TerminalRaceState | "COMPLETED",
    mesoNumber: 2,
    startWeek: 5,
    completedSessions: 19,
    accumulationSessionsCompleted: 16,
    deloadSessionsCompleted: 3,
    isActive: true,
    closedAt: null as Date | null,
    handoffSummaryJson: null,
    nextSeedDraftJson: null,
    macroCycle: {
      id: "macro-1",
      userId: "user-1",
      startDate: new Date("2026-07-16T00:00:00.000Z"),
      primaryGoal: "HYPERTROPHY",
      durationWeeks: 10,
      mesocycles: [
        {
          id: "meso-previous",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          state: "COMPLETED",
        },
        {
          id: base.mesocycle.id,
          mesoNumber: 2,
          startWeek: 5,
          durationWeeks: 5,
          state,
        },
      ],
    },
  };
  const resolution = resolveV4ScheduleAuthority(mesocycle);
  if (resolution.status !== "available") {
    throw new Error(`Invalid terminal route fixture: ${resolution.status}`);
  }
  const authority = resolution.authority;
  const finalSlot = authority.requiredSlots.at(-1)!;
  const workouts = authority.requiredSlots.map((slot) =>
    terminalWorkout(
      authority,
      slot,
      slot === finalSlot ? "PLANNED" : "COMPLETED",
    ),
  );
  return {
    authority,
    mesocycle,
    workouts,
    finalWorkoutId: `workout-${finalSlot.weekInMeso}-${finalSlot.slotId}`,
  };
}

type TerminalRaceFixture = ReturnType<typeof buildTerminalRaceFixture>;
type TerminalRaceWorkout = TerminalRaceFixture["workouts"][number];

function lockAwareTerminalHarness(
  state: TerminalRaceState,
  winner: TerminalOperation,
  performedLogCount = 1,
) {
  const fixture = buildTerminalRaceFixture(state);
  let committed = structuredClone({
    activeMacroCycleId: "macro-1",
    mesocycle: fixture.mesocycle,
    workouts: fixture.workouts,
  });
  const lockOwners: Record<"user" | "mesocycle", string | null> = {
    user: null,
    mesocycle: null,
  };
  const waiters: Record<"user" | "mesocycle", Array<() => void>> = {
    user: [],
    mesocycle: [],
  };
  const labels: TerminalOperation[] = [];
  const started = new Map<TerminalOperation, ReturnType<typeof deferred>>();
  const events = new Map<TerminalOperation, string[]>();
  const errors = new Map<TerminalOperation, string>();
  const rolledBackWorkoutWrites = new Map<TerminalOperation, number>();
  const winnerHasBothLocks = deferred();
  const releaseWinner = deferred();
  const contenderBlocked = deferred();
  let terminalWrites = 0;
  let transactionSequence = 0;

  function queue(label: TerminalOperation) {
    labels.push(label);
    const signal = deferred();
    started.set(label, signal);
    events.set(label, []);
    return signal.promise;
  }

  async function acquire(
    txId: string,
    label: TerminalOperation,
    held: Set<"user" | "mesocycle">,
    lock: "user" | "mesocycle",
  ) {
    if (held.has(lock)) throw new Error(`TEST_LOCK_REACQUIRED:${lock}`);
    if (lock === "mesocycle" && !held.has("user")) {
      throw new Error("TEST_MESOCYCLE_LOCK_BEFORE_USER_LOCK");
    }
    if (lockOwners[lock] != null) {
      if (label !== winner) contenderBlocked.resolve();
      await new Promise<void>((resolve) => waiters[lock].push(resolve));
    }
    lockOwners[lock] = txId;
    held.add(lock);
    events.get(label)!.push(lock);
  }

  function release(txId: string, held: Set<"user" | "mesocycle">) {
    for (const lock of ["mesocycle", "user"] as const) {
      if (!held.has(lock) || lockOwners[lock] !== txId) continue;
      lockOwners[lock] = null;
      waiters[lock].shift()?.();
    }
  }

  function assertWorkoutLocks(
    label: TerminalOperation,
    held: Set<"user" | "mesocycle">,
    event: string,
  ) {
    if (!held.has("user") || !held.has("mesocycle")) {
      throw new Error(`TEST_WORKOUT_BEFORE_LOCKS:${event}`);
    }
    events.get(label)!.push(event);
  }

  async function transaction<T>(
    label: TerminalOperation,
    callback: (tx: object) => Promise<T>,
  ) {
    const txId = `${label}-${++transactionSequence}`;
    const held = new Set<"user" | "mesocycle">();
    let local = structuredClone(committed);
    let localTerminalWrites = 0;
    let localWorkoutWrites = 0;
    let paused = false;

    const tx = {
      user: {
        updateMany: async (args: { where: { id: string; activeMacroCycleId: string } }) => {
          await acquire(txId, label, held, "user");
          return {
            count:
              args.where.id === "user-1" &&
              committed.activeMacroCycleId === args.where.activeMacroCycleId
                ? 1
                : 0,
          };
        },
        findUnique: async () => ({
          activeMacroCycleId: committed.activeMacroCycleId,
        }),
      },
      mesocycle: {
        findFirst: async () => structuredClone(local.mesocycle),
        findUnique: async () => structuredClone(local.mesocycle),
        updateMany: async (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          if (args.data.state !== "COMPLETED") {
            await acquire(txId, label, held, "mesocycle");
            local = structuredClone(committed);
            const matches =
              local.mesocycle.id === args.where.id &&
              local.mesocycle.macroCycleId === args.where.macroCycleId &&
              local.mesocycle.state === args.where.state &&
              local.mesocycle.currentSeedRevisionId ===
                args.where.currentSeedRevisionId;
            if (!matches) return { count: 0 };
            if (label === winner && !paused) {
              paused = true;
              winnerHasBothLocks.resolve();
              await releaseWinner.promise;
            }
            return { count: 1 };
          }
          assertWorkoutLocks(label, held, "terminal-cas");
          const matches =
            local.mesocycle.state === args.where.state &&
            local.mesocycle.isActive === true &&
            local.mesocycle.closedAt == null &&
            local.mesocycle.currentSeedRevisionId ===
              args.where.currentSeedRevisionId;
          if (!matches) return { count: 0 };
          local.mesocycle.state = "COMPLETED";
          local.mesocycle.isActive = false;
          local.mesocycle.closedAt = args.data.closedAt as Date;
          local.mesocycle.macroCycle.mesocycles.at(-1)!.state = "COMPLETED";
          localTerminalWrites += 1;
          return { count: 1 };
        },
        update: async (args: { data: Record<string, unknown> }) => {
          assertWorkoutLocks(label, held, "mesocycle-counter");
          const completed = args.data.completedSessions as
            | { increment: number }
            | undefined;
          const accumulation = args.data.accumulationSessionsCompleted as
            | { increment: number }
            | undefined;
          const deload = args.data.deloadSessionsCompleted as
            | { increment: number }
            | undefined;
          if (completed) local.mesocycle.completedSessions += completed.increment;
          if (accumulation) {
            local.mesocycle.accumulationSessionsCompleted += accumulation.increment;
          }
          if (deload) {
            local.mesocycle.deloadSessionsCompleted += deload.increment;
          }
          return structuredClone(local.mesocycle);
        },
      },
      workout: {
        findUnique: async (args: Record<string, unknown>) => {
          assertWorkoutLocks(label, held, "workout-read");
          const workout = local.workouts.find(
            (candidate) => candidate.id === fixture.finalWorkoutId,
          );
          if (!workout) return null;
          const select = args.select as Record<string, unknown> | undefined;
          if ("include" in args || select?.exercises) {
            return {
              ...structuredClone(workout),
              exercises: [
                {
                  sets: [
                    {
                      logs:
                        performedLogCount > 0
                          ? [
                              {
                                wasSkipped: false,
                                actualReps: 8,
                                actualRpe: 8,
                                actualLoad: 135,
                              },
                            ]
                          : [],
                    },
                  ],
                },
              ],
            };
          }
          return structuredClone(workout);
        },
        findFirst: async (args: Record<string, unknown>) => {
          const select = args.select as Record<string, unknown> | undefined;
          const where = args.where as Record<string, unknown> | undefined;
          if (
            select?.id === true &&
            select.mesocycleId === true &&
            Object.keys(select).length === 2
          ) {
            if (
              where?.id !== fixture.finalWorkoutId ||
              where?.userId !== "user-1" ||
              Object.keys(where).length !== 2
            ) {
              throw new Error("TEST_INVALID_WORKOUT_IDENTITY_DISCOVERY");
            }
            events.get(label)!.push("workout-identity-discovery");
            const workout = local.workouts.find(
              (candidate) => candidate.id === fixture.finalWorkoutId,
            );
            return workout
              ? { id: workout.id, mesocycleId: workout.mesocycleId }
              : null;
          }
          assertWorkoutLocks(label, held, "workout-read");
          return structuredClone(
            local.workouts.find(
              (candidate) => candidate.id === fixture.finalWorkoutId,
            ) ?? null,
          );
        },
        findMany: async (args?: {
          where?: { status?: { in?: string[] } };
        }) => {
          assertWorkoutLocks(label, held, "workout-read");
          const statuses = args?.where?.status?.in;
          const workouts = statuses
            ? local.workouts.filter((workout) =>
                statuses.includes(workout.status),
              )
            : local.workouts;
          return structuredClone(
            workouts.map((workout) => ({ ...workout, exercises: [] })),
          );
        },
        updateMany: async (args: {
          where: { id: string; userId: string; revision: number; status: string };
          data: Record<string, unknown> & { revision: { increment: number } };
        }) => {
          assertWorkoutLocks(label, held, "workout-write");
          const workout = local.workouts.find(
            (candidate) => candidate.id === args.where.id,
          );
          if (
            !workout ||
            workout.userId !== args.where.userId ||
            workout.revision !== args.where.revision ||
            workout.status !== args.where.status
          ) {
            return { count: 0 };
          }
          Object.assign(workout, args.data, {
            revision: workout.revision + args.data.revision.increment,
          });
          localWorkoutWrites += 1;
          return { count: 1 };
        },
        update: async (args: {
          where: { id: string };
          data: { status: "SKIPPED"; selectionMetadata: unknown };
        }) => {
          assertWorkoutLocks(label, held, "workout-write");
          const workout = local.workouts.find(
            (candidate) => candidate.id === args.where.id,
          );
          if (!workout) throw new Error("WORKOUT_NOT_FOUND");
          workout.status = args.data.status;
          workout.selectionMetadata = args.data.selectionMetadata as TerminalRaceWorkout["selectionMetadata"];
          localWorkoutWrites += 1;
          return structuredClone(workout);
        },
      },
      workoutTemplate: { findFirst: async () => null },
      mesocycleSeedRevision: { findFirst: async () => null },
      setLog: {
        count: async () => {
          assertWorkoutLocks(label, held, "set-log-read");
          return 0;
        },
      },
      filteredExercise: {
        deleteMany: async () => ({ count: 0 }),
        createMany: async () => ({ count: 0 }),
      },
    };

    try {
      started.get(label)!.resolve();
      const result = await callback(tx);
      committed = structuredClone(local);
      terminalWrites += localTerminalWrites;
      return result;
    } catch (error) {
      errors.set(label, error instanceof Error ? error.message : String(error));
      rolledBackWorkoutWrites.set(label, localWorkoutWrites);
      throw error;
    } finally {
      release(txId, held);
    }
  }

  mocks.prisma.$transaction.mockImplementation(
    (async (callback: (tx: object) => Promise<unknown>) => {
      const label = labels.shift();
      if (!label) throw new Error("TEST_TRANSACTION_LABEL_MISSING");
      return transaction(label, callback);
    }) as never,
  );
  mocks.claimSelectedPlanForTransitionInTransaction.mockImplementation(
    async (tx: { user: { updateMany: (args: object) => Promise<{ count: number }> } }) => {
      const claimed = await tx.user.updateMany({
        where: { id: "user-1", activeMacroCycleId: "macro-1" },
        data: { activeMacroCycleId: "macro-1" },
      });
      if (claimed.count !== 1) throw new Error("ACTIVE_PLAN_SELECTION_CONFLICT");
    },
  );

  return {
    fixture,
    queue,
    waitForWinnerLocks: () => winnerHasBothLocks.promise,
    waitForContender: () => contenderBlocked.promise,
    releaseWinner: releaseWinner.resolve,
    events: (label: TerminalOperation) => events.get(label) ?? [],
    error: (label: TerminalOperation) => errors.get(label),
    rolledBackWorkoutWrites: (label: TerminalOperation) =>
      rolledBackWorkoutWrites.get(label) ?? 0,
    terminalWrites: () => terminalWrites,
    state: () => committed,
  };
}

describe("POST /api/workouts/save", () => {
  beforeEach(() => {
    mocks.rememberTerminalDiscovery(null);
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (trx: typeof mocks.tx) => Promise<void>) =>
        callback(mocks.tx),
    );
    mocks.claimSelectedPlanForTransitionInTransaction.mockReset();
    mocks.claimSelectedPlanForTransitionInTransaction.mockResolvedValue(undefined);
    mocks.enterMesocycleHandoffInTransaction.mockReset();
    mocks.workoutFindUnique.mockReset();
    mocks.workoutIdentityFindFirst.mockReset();
    mocks.workoutFindFirst.mockReset();
    mocks.workoutFindMany.mockReset();
    mocks.workoutUpdateMany.mockReset();
    mocks.workoutCreate.mockReset();
    mocks.workoutUpsert.mockReset();
    mocks.workoutExerciseFindMany.mockReset();
    mocks.workoutExerciseCreate.mockReset();
    mocks.exerciseFindUnique.mockReset();
    mocks.transitionMesocycleStateInTransaction.mockReset();
    mocks.autoDismissPendingWeekCloseOnForwardProgress.mockReset();
    mocks.evaluateWeekCloseAtBoundary.mockReset();
    mocks.linkOptionalWorkoutToWeekClose.mockReset();
    mocks.resolveWeekCloseOnOptionalGapFillCompletion.mockReset();
    mocks.dismissPendingWeekClose.mockReset();
    mocks.createPostSessionReviewSnapshotInTransaction.mockReset();
    mocks.createPostSessionReviewSnapshotInTransaction.mockResolvedValue({
      created: true,
      snapshot: { id: "review-snapshot-1" },
    });
    mocks.tx.mesocycle.findUnique.mockReset();
    mocks.tx.mesocycle.findFirst.mockReset();
    mocks.tx.mesocycle.update.mockReset();
    mocks.tx.mesocycle.updateMany.mockReset();
    mocks.tx.mesocycle.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.mesocycleSeedRevision.findFirst.mockReset();
    mocks.tx.mesocycleSeedRevision.findUnique.mockReset();
    mocks.tx.mesocycleWeekClose.findFirst.mockReset();
    mocks.tx.mesocycleWeekClose.findUnique.mockReset();
    mocks.tx.setLog.count.mockReset();
    mocks.tx.setLog.count.mockResolvedValue(0);
    mocks.workoutFindUnique.mockResolvedValue(null);
    mocks.workoutIdentityFindFirst.mockImplementation(async (args) => {
      const discovered = await mocks.workoutFindUnique(args);
      const normalizedDiscovery = discovered
        ? { ...discovered, mesocycleId: discovered.mesocycleId ?? null }
        : null;
      mocks.rememberTerminalDiscovery(normalizedDiscovery);
      return discovered
        ? {
            id: discovered.id,
            mesocycleId: discovered.mesocycleId ?? null,
          }
        : null;
    });
    mocks.workoutFindMany.mockResolvedValue([]);
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      revision: 2,
      mesocycleId: null,
    });
    mocks.workoutUpdateMany.mockImplementation(async (args) => {
      mocks.workoutUpsert({ update: args.data, create: args.data });
      return { count: 1 };
    });
    mocks.workoutCreate.mockImplementation(async (args) => {
      mocks.workoutUpsert({ update: args.data, create: args.data });
      return { id: "workout-1", revision: 1, mesocycleId: null };
    });
    mocks.workoutUpsert.mockResolvedValue({ id: "workout-1", revision: 1 });
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
    mocks.exerciseFindUnique.mockResolvedValue({
      id: "bench",
      name: "Bench Press",
      movementPatterns: [],
      aliases: [],
      exerciseMuscles: [
        { role: "PRIMARY", muscle: { name: "Chest" } },
        { role: "SECONDARY", muscle: { name: "Triceps" } },
        { role: "SECONDARY", muscle: { name: "Front Delts" } },
      ],
    });
    mocks.workoutExerciseCreate.mockResolvedValue({ id: "we-1" });
    mocks.tx.mesocycle.findUnique.mockResolvedValue(null);
    mocks.tx.mesocycleSeedRevision.findFirst.mockResolvedValue(null);
    mocks.tx.mesocycle.findFirst.mockResolvedValue({
      id: "meso-active",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 0,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });
    mocks.tx.mesocycle.update.mockResolvedValue({});
    mocks.transitionMesocycleStateInTransaction.mockResolvedValue({
      mesocycle: {
        id: "meso-active",
        state: "ACTIVE_ACCUMULATION",
      },
      advanced: false,
    });
    mocks.autoDismissPendingWeekCloseOnForwardProgress.mockResolvedValue({
      weekCloseId: null,
      status: null,
      resolution: null,
      weekCloseState: null,
      advancedLifecycle: false,
      outcome: "not_found",
    });
    mocks.evaluateWeekCloseAtBoundary.mockResolvedValue({
      weekCloseId: "wc-1",
      status: "RESOLVED",
      resolution: "NO_GAP_FILL_NEEDED",
      weekCloseState: {
        workflowState: "COMPLETED",
        deficitState: "CLOSED",
        remainingDeficitSets: 0,
      },
      deficitSnapshot: {
        version: 1,
        policy: {
          requiredSessionsPerWeek: 3,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
        summary: {
          totalDeficitSets: 0,
          qualifyingMuscleCount: 0,
          topTargetMuscles: [],
        },
        muscles: [],
      },
      advancedLifecycle: true,
    });
    mocks.linkOptionalWorkoutToWeekClose.mockResolvedValue("linked");
    mocks.resolveWeekCloseOnOptionalGapFillCompletion.mockResolvedValue({
      weekCloseId: "wc-1",
      status: "RESOLVED",
      resolution: "GAP_FILL_COMPLETED",
      weekCloseState: {
        workflowState: "COMPLETED",
        deficitState: "PARTIAL",
        remainingDeficitSets: 4,
      },
      advancedLifecycle: false,
      outcome: "resolved",
    });
    mocks.dismissPendingWeekClose.mockResolvedValue({
      weekCloseId: "wc-1",
      status: "RESOLVED",
      resolution: "GAP_FILL_DISMISSED",
      weekCloseState: {
        workflowState: "COMPLETED",
        deficitState: "PARTIAL",
        remainingDeficitSets: 4,
      },
      advancedLifecycle: false,
      outcome: "resolved",
    });
    mocks.tx.mesocycleWeekClose.findFirst.mockResolvedValue(null);
    mocks.tx.mesocycleWeekClose.findUnique.mockResolvedValue(null);
  });

  function terminalSaveRequest(
    workoutId: string,
    action: "mark_completed" | "mark_skipped",
  ) {
    return POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId, action, expectedRevision: 1 }),
      }),
    );
  }

  function earlyFinish(state: TerminalRaceState) {
    const input = { userId: "user-1", mesocycleId: "meso-v4" };
    return state === "ACTIVE_ACCUMULATION"
      ? finishMesocycleEarly(input)
      : finishDeloadEarly(input);
  }

  function expectCanonicalTerminalEvents(events: string[]) {
    expect(events.filter((event) => event === "user")).toHaveLength(1);
    expect(events.filter((event) => event === "mesocycle")).toHaveLength(1);
    const lockStart = events.includes("workout-identity-discovery") ? 1 : 0;
    if (lockStart === 1) {
      expect(events[0]).toBe("workout-identity-discovery");
    }
    expect(events.slice(lockStart, lockStart + 2)).toEqual(["user", "mesocycle"]);
    expect(
      events
        .filter(
          (event) =>
            (event.startsWith("workout") &&
              event !== "workout-identity-discovery") ||
            event === "set-log-read" ||
            event === "terminal-cas",
        )
        .every((event) => events.indexOf(event) > lockStart + 1),
    ).toBe(true);
  }

  it.each([
    [
      "natural final save wins against accumulation early finish",
      "ACTIVE_ACCUMULATION",
      "natural",
    ],
    [
      "accumulation early finish wins against natural final save",
      "ACTIVE_ACCUMULATION",
      "early",
    ],
    [
      "natural final save wins against deload early finish",
      "ACTIVE_DELOAD",
      "natural",
    ],
    [
      "deload early finish wins against natural final save",
      "ACTIVE_DELOAD",
      "early",
    ],
  ] as const)("serializes %s", async (_label, state, winner) => {
    const loser: TerminalOperation = winner === "natural" ? "early" : "natural";
    const harness = lockAwareTerminalHarness(state, winner);

    const winnerStarted = harness.queue(winner);
    const winnerResult =
      winner === "natural"
        ? terminalSaveRequest(harness.fixture.finalWorkoutId, "mark_completed")
        : earlyFinish(state);
    await winnerStarted;
    await harness.waitForWinnerLocks();

    const loserStarted = harness.queue(loser);
    const loserResult =
      loser === "natural"
        ? terminalSaveRequest(harness.fixture.finalWorkoutId, "mark_completed")
        : earlyFinish(state);
    await loserStarted;
    await harness.waitForContender();
    harness.releaseWinner();

    const [winnerOutcome, loserOutcome] = await Promise.allSettled([
      winnerResult,
      loserResult,
    ]);

    if (winnerOutcome.status === "rejected") {
      throw new Error(
        `TEST_WINNER_FAILED:${harness.error(winner) ?? String(winnerOutcome.reason)}\n${
          winnerOutcome.reason instanceof Error ? winnerOutcome.reason.stack : ""
        }`,
      );
    }
    if (winner === "natural" && winnerOutcome.status === "fulfilled") {
      expect((winnerOutcome.value as Response).status).toBe(200);
    }
    if (loser === "natural" && loserOutcome.status === "fulfilled") {
      expect((loserOutcome.value as Response).status).toBe(409);
    } else {
      expect(loserOutcome.status).toBe("rejected");
    }
    expect(harness.error(loser)).toBe("V4_SCHEDULE_AUTHORITY_CONFLICT");
    expectCanonicalTerminalEvents(harness.events(winner));
    expectCanonicalTerminalEvents(harness.events(loser));
    expect(harness.terminalWrites()).toBe(1);
    expect(harness.state().mesocycle).toMatchObject({
      state: "COMPLETED",
      isActive: false,
      closedAt: expect.any(Date),
      handoffSummaryJson: null,
      nextSeedDraftJson: null,
    });
    expect(
      harness.state().workouts.find(
        (workout) => workout.id === harness.fixture.finalWorkoutId,
      ),
    ).toMatchObject({
      status: winner === "natural" ? "COMPLETED" : "SKIPPED",
      revision: winner === "natural" ? 2 : 1,
    });
    expect(harness.rolledBackWorkoutWrites(loser)).toBe(0);
    expect(mocks.enterMesocycleHandoffInTransaction).not.toHaveBeenCalled();
  });

  it("runs a final skipped save through the production route under the canonical locks", async () => {
    const harness = lockAwareTerminalHarness("ACTIVE_DELOAD", "natural", 0);
    const started = harness.queue("natural");
    const result = terminalSaveRequest(
      harness.fixture.finalWorkoutId,
      "mark_skipped",
    );
    await started;
    await harness.waitForWinnerLocks();
    harness.releaseWinner();

    const response = await result;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workoutStatus: "SKIPPED",
    });
    expectCanonicalTerminalEvents(harness.events("natural"));
    expect(harness.terminalWrites()).toBe(1);
    expect(harness.state().mesocycle.state).toBe("COMPLETED");
    expect(
      harness.state().workouts.find(
        (workout) => workout.id === harness.fixture.finalWorkoutId,
      ),
    ).toMatchObject({ status: "SKIPPED", revision: 2 });
    expect(mocks.enterMesocycleHandoffInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["PLANNED", "mark_completed", "COMPLETED", 1],
    ["IN_PROGRESS", "mark_completed", "COMPLETED", 1],
    ["PLANNED", "mark_skipped", "SKIPPED", 0],
  ] as const)(
    "promotes a released V4 %s row while applying %s",
    async (initialStatus, action, expectedStatus, expectedCounterUpdates) => {
      const fixture = buildV4RouteFixture({ status: initialStatus });
      mocks.workoutFindUnique.mockResolvedValueOnce(fixture.workout);
      if (action === "mark_completed") {
        mocks.workoutFindUnique.mockResolvedValueOnce({
          exercises: [
            {
              sets: [
                {
                  logs: [
                    {
                      wasSkipped: false,
                      actualReps: 8,
                      actualRpe: 8,
                      actualLoad: 135,
                    },
                  ],
                },
              ],
            },
          ],
        });
      }
      mocks.workoutFindFirst.mockResolvedValue({
        id: fixture.workout.id,
        revision: 2,
        mesocycleId: fixture.mesocycle.id,
      });
      mocks.tx.mesocycle.findUnique.mockResolvedValue(fixture.mesocycle);
      mocks.workoutFindMany.mockImplementation(async () => {
        const update = mocks.workoutUpdateMany.mock.calls[0]?.[0]?.data;
        const persistedUpdate = update
          ? Object.fromEntries(
              Object.entries(update).filter(([, value]) => value !== undefined),
            )
          : null;
        return update
          ? [{ ...fixture.workout, ...persistedUpdate, revision: 2 }]
          : [fixture.workout];
      });

      const response = await POST(
        new Request("http://localhost/api/workouts/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workoutId: fixture.workout.id,
            action,
            expectedRevision: 1,
          }),
        }),
      );

      expect(response.status).toBe(200);
      const update = mocks.workoutUpdateMany.mock.calls[0][0].data;
      expect(update.status).toBe(expectedStatus);
      expect(update.advancesSplit).toBe(true);
      expect(update.sessionIntent).toBe("UPPER");
      expect(update.selectionMetadata.sessionDecisionReceipt.scheduledSlotReceipt).toEqual(
        fixture.scheduledSlotReceipt,
      );
      expect(mocks.tx.mesocycle.update).toHaveBeenCalledTimes(
        expectedCounterUpdates,
      );
    },
  );

  it("rejects a stale terminal retry for a promoted V4 row without another mutation", async () => {
    const fixture = buildV4RouteFixture({
      status: "COMPLETED",
      includeScheduledReceipt: true,
    });
    mocks.workoutFindUnique
      .mockResolvedValueOnce(fixture.workout)
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [
              {
                logs: [
                  { wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 },
                ],
              },
            ],
          },
        ],
      });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: fixture.workout.id,
          action: "mark_completed",
          expectedRevision: 1,
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.tx.mesocycle.updateMany).not.toHaveBeenCalled();
    expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["mesocyclePhaseSnapshot", "DELOAD"],
    ["seedPayloadHash", "conflicting-hash"],
  ] as const)(
    "rejects released V4 promotion when persisted %s conflicts, with zero mutation",
    async (field, value) => {
      const fixture = buildV4RouteFixture();
      mocks.workoutFindUnique.mockResolvedValue({
        ...fixture.workout,
        [field]: value,
      });
      mocks.tx.mesocycle.findUnique.mockResolvedValue(fixture.mesocycle);

      const response = await POST(
        new Request("http://localhost/api/workouts/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workoutId: fixture.workout.id,
            action: "mark_skipped",
            expectedRevision: 1,
          }),
        }),
      );

      expect(response.status).toBe(409);
      expect(mocks.tx.mesocycle.updateMany).toHaveBeenCalledTimes(1);
      expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();
      expect(mocks.workoutCreate).not.toHaveBeenCalled();
    },
  );

  it("rejects client scheduling identity during released-row promotion", async () => {
    const fixture = buildV4RouteFixture();
    mocks.workoutFindUnique.mockResolvedValue(fixture.workout);
    mocks.tx.mesocycle.findUnique.mockResolvedValue(fixture.mesocycle);

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: fixture.workout.id,
          action: "mark_skipped",
          expectedRevision: 1,
          selectionMetadata: fixture.selectionMetadata,
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects later modification of a promoted V4 receipt", async () => {
    const fixture = buildV4RouteFixture({ includeScheduledReceipt: true });
    mocks.workoutFindUnique.mockResolvedValue(fixture.workout);
    mocks.tx.mesocycle.findUnique.mockResolvedValue(fixture.mesocycle);
    const changed = structuredClone(fixture.selectionMetadata);
    changed.sessionDecisionReceipt.scheduledSlotReceipt = {
      ...fixture.scheduledSlotReceipt,
      weekInMeso: 2,
    };

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: fixture.workout.id,
          action: "mark_skipped",
          expectedRevision: 1,
          selectionMetadata: changed,
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects later modification of promoted V4 slot identity", async () => {
    const fixture = buildV4RouteFixture({ includeScheduledReceipt: true });
    mocks.workoutFindUnique.mockResolvedValue(fixture.workout);
    mocks.tx.mesocycle.findUnique.mockResolvedValue(fixture.mesocycle);
    const changed = structuredClone(fixture.selectionMetadata);
    changed.sessionDecisionReceipt.sessionSlot.slotId = "client-replacement";

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: fixture.workout.id,
          action: "mark_skipped",
          expectedRevision: 1,
          selectionMetadata: changed,
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();
  });

  it("keeps accepted V4 standard creation advancing when the client sends false", async () => {
    const fixture = buildV4RouteFixture();
    mocks.tx.mesocycle.findFirst.mockResolvedValue(fixture.mesocycle);
    mocks.tx.mesocycleSeedRevision.findFirst.mockResolvedValue({
      id: "revision-v4",
      revision: 1,
      payloadHash: fixture.scheduledSlotReceipt.acceptedRevisionHash,
    });
    mocks.tx.mesocycleSeedRevision.findUnique.mockResolvedValue({
      seedPayload: fixture.mesocycle.currentSeedRevision.seedPayload,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "created-v4",
          action: "save_plan",
          selectionMode: "AUTO",
          advancesSplit: false,
          selectionMetadata: fixture.selectionMetadata,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const created = mocks.workoutCreate.mock.calls[0][0].data;
    expect(created.advancesSplit).toBe(true);
    expect(created.sessionIntent).toBe("UPPER");
    expect(
      created.selectionMetadata.sessionDecisionReceipt.scheduledSlotReceipt,
    ).toEqual(fixture.scheduledSlotReceipt);
  });

  it("rejects client-authored scheduling metadata on AUTO creation before mutation", async () => {
    const fixture = buildV4RouteFixture({ includeScheduledReceipt: true });
    mocks.tx.mesocycle.findFirst.mockResolvedValue(fixture.mesocycle);
    mocks.tx.mesocycleSeedRevision.findFirst.mockResolvedValue({
      id: "revision-v4",
      revision: 1,
      payloadHash: fixture.scheduledSlotReceipt.acceptedRevisionHash,
    });
    mocks.tx.mesocycleSeedRevision.findUnique.mockResolvedValue({
      seedPayload: fixture.mesocycle.currentSeedRevision.seedPayload,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "client-authored-v4",
          action: "save_plan",
          selectionMode: "AUTO",
          advancesSplit: false,
          selectionMetadata: fixture.selectionMetadata,
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.workoutCreate).not.toHaveBeenCalled();
    expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();
  });

  it("rolls back released-row compatibility fields when later review finalization fails", async () => {
    const fixture = buildV4RouteFixture();
    const committed = structuredClone(fixture.workout);
    mocks.workoutFindUnique.mockResolvedValueOnce({
      ...structuredClone(committed),
      exercises: [
        {
          sets: [
            {
              logs: [
                {
                  wasSkipped: false,
                  actualReps: 8,
                  actualRpe: 8,
                  actualLoad: 135,
                },
              ],
            },
          ],
        },
      ],
    });
    mocks.tx.mesocycle.findUnique.mockResolvedValue(fixture.mesocycle);
    mocks.createPostSessionReviewSnapshotInTransaction.mockRejectedValueOnce(
      new Error("POST_SESSION_REVIEW_FINALIZATION_FAILED:forced"),
    );
    mocks.prisma.$transaction.mockImplementationOnce(async (callback) => {
      const working = structuredClone(committed);
      const transaction = {
        ...mocks.tx,
        workout: {
          ...mocks.tx.workout,
          updateMany: vi.fn(async ({ data }) => {
            Object.assign(
              working,
              Object.fromEntries(
                Object.entries(data).filter(([, value]) => value !== undefined),
              ),
            );
            return { count: 1 };
          }),
          findFirst: vi.fn(async () => ({
            id: working.id,
            revision: working.revision + 1,
            mesocycleId: working.mesocycleId,
          })),
          findMany: vi.fn(async () => [
            { ...working, revision: working.revision + 1 },
          ]),
        },
      };
      await callback(transaction as typeof mocks.tx);
      Object.assign(committed, working);
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: fixture.workout.id,
          action: "mark_completed",
          expectedRevision: 1,
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(committed).toMatchObject({
      status: "PLANNED",
      advancesSplit: false,
      sessionIntent: null,
    });
    expect(
      committed.selectionMetadata.sessionDecisionReceipt,
    ).not.toHaveProperty("scheduledSlotReceipt");
  });

  it("rejects a client-disguised optional V4 standard and duplicate materialization", async () => {
    const fixture = buildV4RouteFixture({ includeScheduledReceipt: true });
    const disguised = structuredClone(fixture.selectionMetadata) as unknown as {
      sessionDecisionReceipt: Record<string, unknown> & {
        exceptions: Array<{ code: string; message: string }>;
      };
    };
    disguised.sessionDecisionReceipt.exceptions = [
      { code: "optional_gap_fill", message: "client disguise" },
    ];
    mocks.tx.mesocycle.findFirst.mockResolvedValue(fixture.mesocycle);

    const disguisedResponse = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "disguised-v4",
          action: "save_plan",
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          advancesSplit: false,
          selectionMetadata: disguised,
        }),
      }),
    );
    expect(disguisedResponse.status).toBe(409);
    expect(mocks.workoutCreate).not.toHaveBeenCalled();

    mocks.workoutFindMany.mockResolvedValue([
      { ...fixture.workout, selectionMetadata: fixture.selectionMetadata },
    ]);
    mocks.tx.mesocycleSeedRevision.findFirst.mockResolvedValue({
      id: "revision-v4",
      revision: 1,
      payloadHash: fixture.scheduledSlotReceipt.acceptedRevisionHash,
    });
    const duplicateResponse = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "duplicate-v4",
          action: "save_plan",
          selectionMode: "INTENT",
          sessionIntent: fixture.slot.intent.toUpperCase(),
          selectionMetadata: fixture.selectionMetadata,
        }),
      }),
    );
    expect(duplicateResponse.status).toBe(409);
    expect(mocks.workoutCreate).not.toHaveBeenCalled();
  });

  it("accepts an exact Short-today creation retry and conflicts on a changed retry", async () => {
    const exercises = [
      {
        section: "MAIN" as const,
        exerciseId: "bench",
        sets: [{ setIndex: 1, targetReps: 8 }],
      },
    ];
    const offeredStructureFingerprint =
      fingerprintShortTodaySaveExercises(exercises)!;
    const capacityOperation = {
      kind: "reduce_session_capacity",
      source: "api_workouts_generate_from_intent",
      appliedAt: "2026-07-25T12:00:00.000Z",
      scope: "current_workout_only",
      facts: {
        workoutId: "workout-1",
        mode: "short_today",
        reason: "user_selected_temporary_capacity",
        transformVersion: "short_today_v1",
        seedRevisionId: "revision-1",
        seedRevisionNumber: 1,
        seedPayloadHash: "a".repeat(64),
        executableRowsHash: "b".repeat(64),
        plannedStructureFingerprint: "c".repeat(64),
        offeredStructureFingerprint,
        omitted: [
          {
            exerciseId: "optional",
            exerciseName: "Optional Top-up",
            plannedSetCount: 3,
            retainedSetCount: 0,
            omittedSetIndexes: [0, 1, 2],
            omissionClass: "optional_top_up",
            yieldOrder: 1,
          },
        ],
        retainedProtectionClaims: [],
      },
    } as const;
    const selectionMetadata = {
      runtimeEditReconciliation: {
        version: 1,
        lastReconciledAt: "2026-07-25T12:00:00.000Z",
        directives: {
          continuityAlias: "none",
          progressionAlias: "none",
          futureSessionGeneration: "ignore",
          futureSeedCarryForward: "ignore",
        },
        ops: [capacityOperation],
      },
    };
    mocks.workoutFindUnique.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      selectionMetadata,
    });

    const exactResponse = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          sessionCapacity: "short_today",
          selectionMetadata,
          exercises,
        }),
      }),
    );
    expect(exactResponse.status).toBe(200);
    await expect(exactResponse.json()).resolves.toMatchObject({
      workoutId: "workout-1",
      revision: 1,
      workoutStatus: "PLANNED",
    });
    expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();

    const changedResponse = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          sessionCapacity: "short_today",
          selectionMetadata,
          exercises: [
            {
              ...exercises[0],
              sets: [
                ...exercises[0].sets,
                { setIndex: 2, targetReps: 8 },
              ],
            },
          ],
        }),
      }),
    );
    expect(changedResponse.status).toBe(409);
    await expect(changedResponse.json()).resolves.toMatchObject({
      error: "Short today must be selected before starting.",
    });
  });

  it.each(["COMPLETED", "PARTIAL", "SKIPPED"] as const)(
    "save_plan with exercise rewrite ignores terminal status %s",
    async (terminalStatus) => {
      const request = new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          status: terminalStatus,
          selectionMetadata: buildCanonicalSelectionMetadata(),
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          status: "saved",
          workoutId: "workout-1",
          revision: expect.any(Number),
          workoutStatus: expect.any(String),
          action: "save_plan",
        })
      );
      expect(body.action).toBe("save_plan");
      expect(body.workoutStatus).toBe("PLANNED");

      const upsert = mocks.workoutUpsert.mock.calls[0][0];
      expect(upsert.create.status).toBe("PLANNED");
      expect(upsert.update.status).toBe("PLANNED");
      const receipt = upsert.create.selectionMetadata.sessionDecisionReceipt;
      expect(receipt).toMatchObject({
        version: 3,
        stimulusAccounting: {
          contractVersion: 1,
          exercises: [
            expect.objectContaining({
              orderIndex: 0,
              sourceExerciseId: "bench",
              contractVersion: 1,
              provenance: "exact",
              snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
          ],
        },
      });
      expect(mocks.workoutExerciseCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            exerciseId: "bench",
            stimulusAccountingSnapshot: expect.objectContaining({
              version: 1,
              sourceExerciseId: "bench",
              provenance: "exact",
              policyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
          }),
        })
      );
    }
  );

  it("mark_completed resolves to COMPLETED when all sets have logs", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [
              { logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] },
              { logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] },
            ],
          },
        ],
      });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        status: "saved",
        workoutId: "workout-1",
        revision: expect.any(Number),
        workoutStatus: "COMPLETED",
        action: "mark_completed",
      })
    );
    expect(body.workoutStatus).toBe("COMPLETED");
    expect(mocks.createPostSessionReviewSnapshotInTransaction).toHaveBeenCalledWith(
      mocks.tx,
      {
        userId: "user-1",
        workoutId: "workout-1",
        provenance: "exact",
      },
    );
  });

  it("rolls back completion when exact review finalization fails", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [
              { logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8 }] },
            ],
          },
        ],
      });
    mocks.createPostSessionReviewSnapshotInTransaction.mockRejectedValueOnce(
      new Error("POST_SESSION_REVIEW_FINALIZATION_FAILED:invalid_contract"),
    );

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("rolled back"),
    });
  });

  it("preserves persisted canonical selectionMetadata for mark_completed when the request omits it", async () => {
    const persistedReceipt = {
      version: 1,
      cycleContext: {
        weekInMeso: 4,
        weekInBlock: 2,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      sessionProvenance: {
        mesocycleId: "meso-1",
        compositionSource: "persisted_slot_plan_seed",
      },
      lifecycleRirTarget: { min: 1, max: 2 },
      lifecycleVolume: {
        targets: { Chest: 16 },
        source: "lifecycle",
      },
      sorenessSuppressedMuscles: ["Chest"],
      deloadDecision: {
        mode: "none",
        reason: [],
        reductionPercent: 0,
        appliedTo: "none",
      },
      readiness: {
        wasAutoregulated: true,
        signalAgeHours: 6,
        fatigueScoreOverall: 0.41,
        intensityScaling: {
          applied: true,
          exerciseIds: ["bench"],
          scaledUpCount: 0,
          scaledDownCount: 1,
        },
        rationale: "Readiness scaled pressing volume.",
      },
      exceptions: [
        {
          code: "readiness_scale",
          message: "Readiness scaled 1 exercise(s): 1 down, 0 up.",
        },
      ],
    };

    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "IN_PROGRESS",
        revision: 3,
        mesocycleId: "meso-1",
        selectionMetadata: {
          rationale: { bench: { selectedStep: "pin", score: 0.9, components: { pinned: 1 }, hardFilterPass: true } },
          selectedExerciseIds: ["bench"],
          sessionDecisionReceipt: persistedReceipt,
        },
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      macroCycleId: "macro-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 3,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);

    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    const selectionMetadata = updateMany.data.selectionMetadata as Record<string, unknown>;
    const receipt = selectionMetadata.sessionDecisionReceipt as Record<string, unknown>;
    const lifecycleVolume = receipt.lifecycleVolume as Record<string, unknown>;
    const readiness = receipt.readiness as Record<string, unknown>;
    const intensityScaling = readiness.intensityScaling as Record<string, unknown>;

    expect(selectionMetadata.rationale).toEqual({
      bench: { selectedStep: "pin", score: 0.9, components: { pinned: 1 }, hardFilterPass: true },
    });
    expect(selectionMetadata.selectedExerciseIds).toEqual(["bench"]);
    expect(receipt.cycleContext).toEqual(
      expect.objectContaining({
        weekInMeso: 4,
        weekInBlock: 2,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      })
    );
    expect(receipt.sessionProvenance).toEqual({
      mesocycleId: "meso-1",
      compositionSource: "persisted_slot_plan_seed",
    });
    expect(receipt.lifecycleRirTarget).toEqual({ min: 1, max: 2 });
    expect((lifecycleVolume.targets as Record<string, unknown>).Chest).toBe(16);
    expect(readiness.wasAutoregulated).toBe(true);
    expect(readiness.signalAgeHours).toBe(6);
    expect(readiness.fatigueScoreOverall).toBe(0.41);
    expect(intensityScaling.exerciseIds).toEqual(["bench"]);
    expect(intensityScaling.scaledDownCount).toBe(1);
  });

  it("calls lifecycle transition for first performed save when workout has mesocycleId", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      macroCycleId: "macro-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 3,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);
    expect(
      mocks.claimSelectedPlanForTransitionInTransaction
    ).toHaveBeenCalledWith(mocks.tx, {
      userId: "user-1",
      macroCycleId: "macro-1",
    });
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");

    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.mesocycleId).toBe("meso-1");
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(2);
    expect(updateMany.data.mesoSessionSnapshot).toBe(1);
    expect(updateMany.data.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
  });

  it("attaches active mesocycle and transitions lifecycle when first performed save has null mesocycleId", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: null,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findFirst.mockResolvedValueOnce({
      id: "meso-active",
      macroCycleId: "macro-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-active");
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-active" },
      data: { completedSessions: { increment: 1 }, accumulationSessionsCompleted: { increment: 1 } },
    });

    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.mesocycleId).toBe("meso-active");
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(2);
    expect(updateMany.data.mesoSessionSnapshot).toBe(2);
    expect(updateMany.data.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
  });

  it("auto-closes week-close target deficits as review evidence at an accumulation week boundary", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 2,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
    mocks.evaluateWeekCloseAtBoundary.mockResolvedValueOnce({
      weekCloseId: "wc-1",
      status: "RESOLVED",
      resolution: "AUTO_DISMISSED",
      weekCloseState: {
        workflowState: "COMPLETED",
        deficitState: "PARTIAL",
        remainingDeficitSets: 4,
      },
      deficitSnapshot: {
        version: 1,
        policy: {
          requiredSessionsPerWeek: 3,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
        summary: {
          totalDeficitSets: 4,
          qualifyingMuscleCount: 1,
          topTargetMuscles: ["Chest"],
        },
        muscles: [{ muscle: "Chest", target: 12, actual: 8, deficit: 4 }],
      },
      advancedLifecycle: false,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      weekClose: {
        weekCloseId: "wc-1",
        resolution: "AUTO_DISMISSED",
        workflowState: "COMPLETED",
        deficitState: "PARTIAL",
        remainingDeficitSets: 4,
      },
    });
    expect(mocks.evaluateWeekCloseAtBoundary).toHaveBeenCalledWith(mocks.tx, {
      userId: "user-1",
      mesocycle: {
        id: "meso-1",
        durationWeeks: 5,
        sessionsPerWeek: 3,
        startWeek: 0,
        macroCycle: {
          startDate: new Date("2026-03-01T00:00:00.000Z"),
        },
      },
      targetWeek: 1,
      targetPhase: "ACCUMULATION",
    });
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("does not re-trigger a stale persisted boundary snapshot when counter progression is mid-week", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        mesocycleWeekSnapshot: 1,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesoSessionSnapshot: 3,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.evaluateWeekCloseAtBoundary).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");
    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(1);
    expect(updateMany.data.mesoSessionSnapshot).toBe(3);
    expect(updateMany.data.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
  });

  it("does not advance lifecycle for first performed mark_partial when advancesSplit=false", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      mesocycleId: "meso-1",
      advancesSplit: undefined,
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_partial",
          advancesSplit: false,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("does not advance lifecycle for first performed mark_completed when persisted advancesSplit=false", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: false,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("cannot bypass non-advancing persistence: mark_completed with payload advancesSplit=true stays non-lifecycle when persisted is false", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: false,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
          advancesSplit: true,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.advancesSplit).toBe(false);
  });

  it("does not enforce gap-fill behavior when marker is present but intent is non-BODY_PART", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: undefined,
        selectionMetadata: buildOptionalGapFillSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [{ sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }] }],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 6,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
          selectionMode: "INTENT",
          sessionIntent: "PULL",
          advancesSplit: true,
          mesocycleWeekSnapshot: 99,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: { completedSessions: { increment: 1 }, accumulationSessionsCompleted: { increment: 1 } },
    });
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");
    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.advancesSplit).toBe(true);
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(3);
  });

  it("does not enforce gap-fill behavior when BODY_PART intent has no optional marker", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: undefined,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [{ sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }] }],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 6,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          advancesSplit: true,
          mesocycleWeekSnapshot: 99,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: { completedSessions: { increment: 1 }, accumulationSessionsCompleted: { increment: 1 } },
    });
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");
    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.advancesSplit).toBe(true);
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(3);
  });

  it("enforces gap-fill behavior only for marker + INTENT + BODY_PART", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: undefined,
        selectionMetadata: buildOptionalGapFillSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [{ sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }] }],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 6,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          advancesSplit: true,
          mesocycleWeekSnapshot: 2,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.advancesSplit).toBe(false);
    expect(upsert.update.mesocycleWeekSnapshot).toBe(2);
  });

  it("ignores client mesocycleWeekSnapshot override for non-gap-fill payloads", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: undefined,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [{ sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }] }],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 6,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          advancesSplit: true,
          mesocycleWeekSnapshot: 1,
        }),
      })
    );

    expect(response.status).toBe(200);
    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(3);
  });

  it("preserves existing planned snapshot week for normal workouts when completed later", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        mesocycleWeekSnapshot: 3,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesoSessionSnapshot: 4,
        advancesSplit: true,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [{ sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }] }],
      });
    // Lifecycle has advanced to week 4 by completion time.
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 9,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
        }),
      })
    );

    expect(response.status).toBe(200);
    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(3);
    expect(updateMany.data.mesoSessionSnapshot).toBe(4);
    expect(updateMany.data.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
  });

  it("preserves existing anchor week for gap-fill completion when active week has advanced", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        mesocycleWeekSnapshot: 3,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesoSessionSnapshot: 4,
        advancesSplit: false,
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
        selectionMetadata: buildOptionalGapFillSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [{ sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }] }],
      });
    // Lifecycle moved to week 4 after planning the anchored week-3 gap-fill.
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 9,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.advancesSplit).toBe(false);
    expect(upsert.update.mesocycleWeekSnapshot).toBe(3);
    expect(upsert.update.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
    expect(upsert.update.mesoSessionSnapshot).toBe(4);
  });

  it("does not advance lifecycle when a workout is only marked partial", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      mesocycleId: "meso-1",
      advancesSplit: undefined,
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_partial",
          advancesSplit: true,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("reconciles a newly skipped legacy authored session without incrementing performed counters", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      mesocycleId: "meso-1",
      mesocycleWeekSnapshot: 5,
      mesocyclePhaseSnapshot: "DELOAD",
      mesoSessionSnapshot: 4,
      advancesSplit: true,
      selectionMode: "INTENT",
      sessionIntent: "LOWER",
      selectionMetadata: buildCanonicalSelectionMetadata(),
      exercises: [],
    });
    mocks.tx.mesocycle.findUnique.mockResolvedValue({
      id: "meso-1",
      macroCycleId: "macro-1",
      state: "ACTIVE_DELOAD",
      durationWeeks: 5,
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 3,
      sessionsPerWeek: 4,
      currentSeedRevisionId: null,
      currentSeedRevision: null,
      macroCycle: { startDate: new Date("2026-07-01T00:00:00.000Z"), primaryGoal: "HYPERTROPHY" },
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_skipped",
          expectedRevision: 1,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ workoutStatus: "SKIPPED" });
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(
      mocks.tx,
      "meso-1",
    );
  });

  it("advances lifecycle when a partial workout is later completed for the first time", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PARTIAL",
        revision: 2,
        mesocycleId: "meso-1",
        advancesSplit: true,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_completed",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: { completedSessions: { increment: 1 }, accumulationSessionsCompleted: { increment: 1 } },
    });
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");
  });

  it("does not call lifecycle transition for non-performed save", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          status: "IN_PROGRESS",
          notes: "still training",
          selectionMetadata: buildCanonicalSelectionMetadata(),
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("rejects a generated plan after the selected mesocycle changes", async () => {
    const selectionMetadata = buildCanonicalSelectionMetadata();
    Object.assign(selectionMetadata.sessionDecisionReceipt, {
      sessionProvenance: {
        mesocycleId: "meso-stale",
        compositionSource: "runtime_selection",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMetadata,
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Active plan selection changed concurrently. Retry the save.",
    });
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
  });

  it("mark_completed resolves to PARTIAL when unresolved sets remain", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }, { logs: [] }],
          },
        ],
      });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        status: "saved",
        workoutId: "workout-1",
        revision: expect.any(Number),
        workoutStatus: "PARTIAL",
        action: "mark_completed",
      })
    );
    expect(body.workoutStatus).toBe("PARTIAL");
    expect(mocks.createPostSessionReviewSnapshotInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["mark_partial", "PARTIAL"],
    ["mark_skipped", "SKIPPED"],
  ] as const)(
    "%s preserves persisted canonical selectionMetadata when the request omits it",
    async (action, expectedStatus) => {
      const persistedReceipt = {
        version: 1,
        cycleContext: {
          weekInMeso: 5,
          weekInBlock: 1,
          phase: "deload",
          blockType: "deload",
          isDeload: true,
          source: "computed",
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
      };

      mocks.workoutFindUnique.mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "IN_PROGRESS",
        revision: 2,
        mesocycleId: null,
        selectionMetadata: {
          sessionDecisionReceipt: persistedReceipt,
          selectedExerciseIds: ["bench"],
        },
      });

      const response = await POST(
        new Request("http://localhost/api/workouts/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workoutId: "workout-1", action }),
        })
      );

      expect(response.status).toBe(200);
      const upsert = mocks.workoutUpsert.mock.calls[0][0];
      expect(upsert.update.status).toBe(expectedStatus);
      expect(upsert.update.selectionMetadata).toEqual(
        expect.objectContaining({
          selectedExerciseIds: ["bench"],
          sessionDecisionReceipt: expect.objectContaining({
            ...persistedReceipt,
            version: 2,
          }),
        })
      );
    }
  );

  it("treats LOGGED_EMPTY rows as unresolved and marks completion as PARTIAL", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [
              { logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] },
              { logs: [{ wasSkipped: false, actualReps: null, actualRpe: null, actualLoad: null }] },
            ],
          },
        ],
      });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        status: "saved",
        workoutId: "workout-1",
        revision: expect.any(Number),
        workoutStatus: "PARTIAL",
        action: "mark_completed",
      })
    );
    expect(body.workoutStatus).toBe("PARTIAL");
  });

  it.each([
    ["mark_partial", "PARTIAL"],
    ["mark_skipped", "SKIPPED"],
  ] as const)("returns required workoutStatus for %s success responses", async (action, expectedStatus) => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "IN_PROGRESS",
      revision: 2,
      mesocycleId: null,
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        status: "saved",
        workoutId: "workout-1",
        revision: expect.any(Number),
        workoutStatus: expectedStatus,
        action,
      })
    );
  });

  it.each([
    ["COMPLETED", "mark_skipped"],
    ["SKIPPED", "mark_completed"],
    ["PARTIAL", "mark_skipped"],
  ] as const)("rejects %s -> %s terminal transitions", async (status, action) => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status,
      revision: 1,
      mesocycleId: null,
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });
    if (action === "mark_completed") {
      mocks.workoutFindUnique.mockResolvedValueOnce({
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
      });
    }

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action }),
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects skipping an uncompleted workout with performed logs", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "IN_PROGRESS",
      revision: 1,
      mesocycleId: null,
      selectionMetadata: buildCanonicalSelectionMetadata(),
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
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_skipped",
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();
  });

  it("mark_completed rejects empty effective completion", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: true }] }, { logs: [] }],
          },
        ],
      });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Cannot mark completed without at least one performed (non-skipped) set log.",
    });
  });

  it("returns 409 for performed saves when no active mesocycle can be resolved", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: null,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findFirst.mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "No active mesocycle found for performed workout save.",
    });
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("returns 409 before lifecycle mutation when a workout belongs to an awaiting-handoff mesocycle", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      mesocycleId: "meso-1",
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "AWAITING_HANDOFF",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          expectedRevision: 1,
          notes: "should fail cleanly",
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Mesocycle handoff is pending; workout saves are closed until the next cycle is accepted.",
    });
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("returns 409 before lifecycle mutation when a workout belongs to a completed mesocycle", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "COMPLETED",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Mesocycle is archived as completed; workout saves are closed.",
    });
    expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("cannot bypass rewrite gating via inferred action", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PARTIAL",
      revision: 2,
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          status: "COMPLETED",
          selectionMetadata: buildCanonicalSelectionMetadata(),
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Only PLANNED workouts can be rewritten with a new exercise list",
    });
  });

  it("enforces revision conflict on rewrites", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PLANNED",
      revision: 3,
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });
    mocks.workoutUpdateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          expectedRevision: 2,
          selectionMetadata: buildCanonicalSelectionMetadata(),
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Workout revision conflict. Refresh and try again.",
    });
    expect(mocks.workoutUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "workout-1",
        userId: "user-1",
        revision: 2,
        status: "PLANNED",
      },
      data: expect.objectContaining({
        revision: { increment: 1 },
      }),
    });
    expect(mocks.tx.workoutSet.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.workoutExercise.deleteMany).not.toHaveBeenCalled();
    expect(mocks.workoutExerciseCreate).not.toHaveBeenCalled();
    expect(mocks.tx.filteredExercise.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
  });

  it("requires expectedRevision for every existing-workout save", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });

    const response = await saveWorkoutPost(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_partial",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "expectedRevision is required for existing workouts.",
    });
    expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();
  });

  it("returns the same not-found response for missing and foreign-owned workouts", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "workout-foreign",
        userId: "user-2",
        status: "PLANNED",
        revision: 1,
        selectionMetadata: buildCanonicalSelectionMetadata(),
      });

    const makeRequest = (workoutId: string) =>
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId,
          action: "mark_partial",
          expectedRevision: 1,
        }),
      });
    const missingResponse = await saveWorkoutPost(makeRequest("workout-missing"));
    const foreignResponse = await saveWorkoutPost(makeRequest("workout-foreign"));

    expect(missingResponse.status).toBe(404);
    expect(foreignResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toEqual({ error: "Workout not found" });
    await expect(foreignResponse.json()).resolves.toEqual({ error: "Workout not found" });
    expect(mocks.workoutUpdateMany).not.toHaveBeenCalled();
  });

  it("increments revision for planned workout rewrites", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      selectionMetadata: buildCanonicalSelectionMetadata(),
    });

    await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          expectedRevision: 1,
          selectionMetadata: buildCanonicalSelectionMetadata(),
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.update.revision).toEqual({ increment: 1 });
  });

  it("persists rewrite_structure runtime edit facts when a save rewrite drifts from the generated workout", async () => {
    const selectionMetadata = buildGeneratedSnapshotSelectionMetadata();

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMetadata,
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
            {
              section: "ACCESSORY",
              exerciseId: "fly",
              sets: [{ setIndex: 1, targetReps: 12 }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.create.selectionMetadata).toEqual(
      expect.objectContaining({
        runtimeEditReconciliation: expect.objectContaining({
          version: 1,
          directives: {
            continuityAlias: "none",
            progressionAlias: "none",
            futureSessionGeneration: "ignore",
            futureSeedCarryForward: "ignore",
          },
          ops: [
            expect.objectContaining({
              kind: "rewrite_structure",
              source: "api_workouts_save",
              scope: "current_workout_only",
              facts: expect.objectContaining({
                changedFields: expect.arrayContaining([
                  "exercise_added",
                  "exercise_set_count_changed",
                  "exercise_prescription_changed",
                ]),
                addedExerciseIds: ["fly"],
              }),
            }),
          ],
        }),
      })
    );
  });

  it("does not append rewrite_structure when save is structurally identical to the generated workout", async () => {
    const selectionMetadata = buildGeneratedSnapshotSelectionMetadata();

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMetadata,
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [
                { setIndex: 1, targetReps: 8, targetRpe: 8 },
                { setIndex: 2, targetReps: 8, targetRpe: 8 },
                { setIndex: 3, targetReps: 8, targetRpe: 8 },
              ],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    const createMetadata = upsert.create.selectionMetadata as Record<string, unknown>;

    expect(createMetadata.workoutStructureState).toEqual(
      expect.objectContaining({
        reconciliation: expect.objectContaining({
          hasDrift: false,
        }),
      })
    );
    expect(createMetadata.runtimeEditReconciliation).toBeUndefined();
  });

  it("rejects save_plan when canonical receipt metadata is missing", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Canonical selectionMetadata.sessionDecisionReceipt is required.",
    });
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
  });

  it("persists canonical receipt cycle context as-is and skips DB cycle-context load", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 6,
                weekInBlock: 2,
                phase: "deload",
                blockType: "deload",
                isDeload: true,
                source: "computed",
              },
              lifecycleVolume: {
                source: "unknown",
              },
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
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );
    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    const createMetadata = upsert.create.selectionMetadata as Record<string, unknown>;
    expect(createMetadata.cycleContext).toBeUndefined();
    expect((createMetadata.sessionDecisionReceipt as Record<string, unknown>).cycleContext).toEqual({
      weekInMeso: 6,
      weekInBlock: 2,
      phase: "deload",
      blockType: "deload",
      isDeload: true,
      source: "computed",
    });
  });


  it("aborts the save when transactional week-close evaluation throws", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 5,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
    mocks.evaluateWeekCloseAtBoundary.mockRejectedValueOnce(new Error("DB timeout"));

    await expect(
      POST(
        new Request("http://localhost/api/workouts/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
        })
      )
    ).rejects.toThrow("DB timeout");

    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: { completedSessions: { increment: 1 }, accumulationSessionsCompleted: { increment: 1 } },
    });
    expect(mocks.evaluateWeekCloseAtBoundary).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        userId: "user-1",
        targetWeek: 2,
        targetPhase: "ACCUMULATION",
      })
    );
  });

  it("rejects performed save when neither request nor persisted workout has canonical receipt metadata", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-1",
      userId: "user-1",
      status: "IN_PROGRESS",
      revision: 1,
      mesocycleId: null,
      selectionMetadata: null,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          action: "mark_partial",
        }),
      })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Canonical selectionMetadata.sessionDecisionReceipt is required.",
    });
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
  });

  it("preserves canonical receipt readiness fields without a compatibility save shim", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 4,
                weekInBlock: 4,
                mesocycleLength: 6,
                phase: "accumulation",
                blockType: "accumulation",
                isDeload: false,
                source: "computed",
              },
              lifecycleRirTarget: { min: 1, max: 2 },
              lifecycleVolume: {
                targets: { Chest: 16 },
                source: "lifecycle",
              },
              sorenessSuppressedMuscles: ["Chest"],
              deloadDecision: {
                mode: "none",
                reason: [],
                reductionPercent: 0,
                appliedTo: "none",
              },
              readiness: {
                wasAutoregulated: true,
                signalAgeHours: 6,
                fatigueScoreOverall: 0.41,
                intensityScaling: {
                  applied: true,
                  exerciseIds: ["bench"],
                  scaledUpCount: 0,
                  scaledDownCount: 1,
                },
                rationale: "Readiness scaled pressing volume.",
              },
              exceptions: [
                {
                  code: "soreness_suppression",
                  message: "Held back weekly volume for Chest due to soreness.",
                },
                {
                  code: "readiness_scale",
                  message: "Readiness scaled 1 exercise(s): 1 down, 0 up.",
                },
              ],
            },
          },
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );
    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    const createMetadata = upsert.create.selectionMetadata as Record<string, unknown>;
    const receipt = createMetadata.sessionDecisionReceipt as Record<string, unknown>;
    const readiness = receipt.readiness as Record<string, unknown>;
    const intensityScaling = readiness.intensityScaling as Record<string, unknown>;
    const lifecycleVolume = receipt.lifecycleVolume as Record<string, unknown>;

    expect((receipt.lifecycleRirTarget as Record<string, unknown>).min).toBe(1);
    expect((lifecycleVolume.targets as Record<string, unknown>).Chest).toBe(16);
    expect(receipt.sorenessSuppressedMuscles).toEqual(["Chest"]);
    expect((receipt.deloadDecision as Record<string, unknown>).mode).toBe("none");
    expect(readiness.wasAutoregulated).toBe(true);
    expect(readiness.signalAgeHours).toBe(6);
    expect(readiness.fatigueScoreOverall).toBe(0.41);
    expect(intensityScaling.applied).toBe(true);
    expect(intensityScaling.exerciseIds).toEqual(["bench"]);
    expect(intensityScaling.scaledDownCount).toBe(1);
  });

  it("stamps initial planned saves with the pre-increment canonical lifecycle snapshot", async () => {
    mocks.tx.mesocycle.findFirst.mockResolvedValueOnce({
      id: "meso-active",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-1",
          selectionMetadata: buildCanonicalSelectionMetadata(),
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 8 }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.create.mesocycleId).toBe("meso-active");
    expect(upsert.create.mesocycleWeekSnapshot).toBe(2);
    expect(upsert.create.mesoSessionSnapshot).toBe(2);
    expect(upsert.create.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("pins strict optional gap-fill planned saves to the anchored accumulation snapshot", async () => {
    mocks.tx.mesocycle.findFirst.mockResolvedValueOnce({
      id: "meso-active",
      state: "ACTIVE_DELOAD",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-gap",
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          advancesSplit: false,
          mesocycleWeekSnapshot: 4,
          selectionMetadata: buildOptionalGapFillSelectionMetadata(),
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 12 }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.create.mesocycleId).toBe("meso-active");
    expect(upsert.create.mesocycleWeekSnapshot).toBe(4);
    expect(upsert.create.mesocyclePhaseSnapshot).toBe("ACCUMULATION");
    expect(upsert.create.mesoSessionSnapshot).toBe(4);
    expect(upsert.create.advancesSplit).toBe(false);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("persists strict supplemental deficit planned saves with advancesSplit=false", async () => {
    mocks.tx.mesocycle.findFirst.mockResolvedValueOnce({
      id: "meso-active",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 9,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-supp",
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          advancesSplit: true,
          selectionMetadata: buildSupplementalDeficitSelectionMetadata(),
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 12 }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    expect(upsert.create.advancesSplit).toBe(false);
    expect(upsert.update.advancesSplit).toBe(false);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("persists closeout planned saves with advancesSplit=false and strips receipt slot identity", async () => {
    mocks.tx.mesocycleWeekClose.findFirst.mockResolvedValueOnce({ id: "week-close-1" });
    mocks.tx.mesocycle.findFirst.mockResolvedValueOnce({
      id: "meso-active",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 9,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-closeout",
          expectedRevision: 1,
          selectionMode: "MANUAL",
          sessionIntent: "PUSH",
          advancesSplit: true,
          selectionMetadata: buildCloseoutSelectionMetadata(),
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 12 }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    const receipt = (upsert.create.selectionMetadata as Record<string, unknown>)
      .sessionDecisionReceipt as Record<string, unknown>;
    expect(upsert.create.advancesSplit).toBe(false);
    expect(upsert.update.advancesSplit).toBe(false);
    expect((upsert.create.selectionMetadata as Record<string, unknown>).weekCloseId).toBe(
      "week-close-1"
    );
    expect(receipt.sessionSlot).toBeUndefined();
    expect(
      (receipt.exceptions as Array<{ code: string }>).map((entry) => entry.code)
    ).toContain("closeout_session");
    expect(
      Object.prototype.hasOwnProperty.call(
        upsert.create.selectionMetadata as Record<string, unknown>,
        "sessionSlot"
      )
    ).toBe(false);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("rejects closeout saves when weekCloseId is missing or invalid for the current week context", async () => {
    mocks.tx.mesocycle.findFirst.mockResolvedValueOnce({
      id: "meso-active",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 7,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-closeout",
          expectedRevision: 1,
          selectionMode: "MANUAL",
          sessionIntent: "PUSH",
          advancesSplit: true,
          selectionMetadata: {
            ...buildCloseoutSelectionMetadata(),
            weekCloseId: "week-close-missing",
          },
          exercises: [
            {
              section: "MAIN",
              exerciseId: "bench",
              sets: [{ setIndex: 1, targetReps: 12 }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Closeout session requires a valid weekCloseId for the current mesocycle week.",
    });
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
  });

  it("keeps closeout metadata idempotent across repeated saves", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-closeout",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      mesocycleId: "meso-1",
      advancesSplit: false,
      selectionMode: "MANUAL",
      sessionIntent: "PUSH",
      selectionMetadata: {
        ...buildCloseoutSelectionMetadata(),
        sessionSlot: {
          slotId: "stale-top-level-slot",
        },
      },
    });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 9,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });
    mocks.tx.mesocycleWeekClose.findFirst.mockResolvedValueOnce({ id: "week-close-1" });
    mocks.workoutUpsert.mockResolvedValueOnce({
      id: "workout-closeout",
      revision: 2,
      mesocycleId: "meso-1",
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-closeout",
          expectedRevision: 1,
          selectionMode: "MANUAL",
          sessionIntent: "PUSH",
          notes: "repeat save",
        }),
      })
    );

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    const selectionMetadata = upsert.update.selectionMetadata as Record<string, unknown>;
    const receipt = selectionMetadata.sessionDecisionReceipt as Record<string, unknown>;
    expect(selectionMetadata.weekCloseId).toBe("week-close-1");
    expect(Object.prototype.hasOwnProperty.call(selectionMetadata, "sessionSlot")).toBe(false);
    expect(receipt.sessionSlot).toBeUndefined();
    expect(
      (receipt.exceptions as Array<{ code: string }>).filter(
        (entry) => entry.code === "closeout_session"
      )
    ).toHaveLength(1);
  });

  it("preserves the supplemental marker on later save/update flows", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-supp",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      mesocycleId: "meso-1",
      advancesSplit: false,
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
      selectionMetadata: buildSupplementalDeficitSelectionMetadata(),
    });
    mocks.workoutUpsert.mockResolvedValueOnce({
      id: "workout-supp",
      revision: 2,
      mesocycleId: "meso-1",
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-supp",
          expectedRevision: 1,
          selectionMode: "INTENT",
          sessionIntent: "BODY_PART",
          notes: "updated note",
        }),
      })
    );

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    const receipt = (upsert.update.selectionMetadata as Record<string, unknown>)
      .sessionDecisionReceipt as Record<string, unknown>;
    expect(upsert.update.advancesSplit).toBe(false);
    expect((receipt.exceptions as Array<{ code: string }>).map((entry) => entry.code)).toContain(
      "supplemental_deficit_session"
    );
  });

  it("completes closeout sessions without lifecycle or exposure/progression updates", async () => {
    mocks.tx.mesocycleWeekClose.findFirst.mockResolvedValueOnce({ id: "week-close-1" });
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-closeout",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: false,
        selectionMode: "MANUAL",
        sessionIntent: "PUSH",
        selectionMetadata: buildCloseoutSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 9,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });
    mocks.workoutUpsert.mockResolvedValueOnce({
      id: "workout-closeout",
      revision: 2,
      mesocycleId: "meso-1",
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutId: "workout-closeout",
          action: "mark_completed",
        }),
      })
    );

    expect(response.status).toBe(200);

    const upsert = mocks.workoutUpsert.mock.calls[0][0];
    const receipt = (upsert.update.selectionMetadata as Record<string, unknown>)
      .sessionDecisionReceipt as Record<string, unknown>;
    expect(upsert.update.advancesSplit).toBe(false);
    expect(receipt.sessionSlot).toBeUndefined();
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("resolves a linked optional gap-fill completion once and advances once transactionally", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-gap",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: false,
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
        selectionMetadata: {
          ...buildOptionalGapFillSelectionMetadata(),
          weekCloseId: "wc-1",
        },
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 12, actualRpe: 8, actualLoad: 70 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_DELOAD",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
    mocks.workoutUpsert.mockResolvedValueOnce({ id: "workout-gap", revision: 2, mesocycleId: "meso-1" });
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-gap",
      revision: 2,
      mesocycleId: "meso-1",
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-gap", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      weekClose: {
        weekCloseId: "wc-1",
        resolution: "GAP_FILL_COMPLETED",
        workflowState: "COMPLETED",
        deficitState: "PARTIAL",
        remainingDeficitSets: 4,
      },
    });
    expect(mocks.linkOptionalWorkoutToWeekClose).toHaveBeenCalledWith(mocks.tx, {
      weekCloseId: "wc-1",
      workoutId: "workout-gap",
    });
    expect(mocks.resolveWeekCloseOnOptionalGapFillCompletion).toHaveBeenCalledWith(mocks.tx, {
      workoutId: "workout-gap",
      weekCloseId: "wc-1",
    });
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("dismisses a linked optional gap-fill week-close when the optional workout is skipped", async () => {
    mocks.workoutFindUnique.mockResolvedValueOnce({
      id: "workout-gap",
      userId: "user-1",
      status: "PLANNED",
      revision: 1,
      mesocycleId: "meso-1",
      advancesSplit: false,
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
      selectionMetadata: {
        ...buildOptionalGapFillSelectionMetadata(),
        weekCloseId: "wc-1",
      },
    });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_DELOAD",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
    mocks.workoutUpsert.mockResolvedValueOnce({
      id: "workout-gap",
      revision: 2,
      mesocycleId: "meso-1",
    });
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-gap",
      revision: 2,
      mesocycleId: "meso-1",
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-gap", action: "mark_skipped" }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workoutStatus: "SKIPPED",
      weekClose: {
        weekCloseId: "wc-1",
        resolution: "GAP_FILL_DISMISSED",
        workflowState: "COMPLETED",
        deficitState: "PARTIAL",
        remainingDeficitSets: 4,
      },
    });
    expect(mocks.linkOptionalWorkoutToWeekClose).toHaveBeenCalledWith(mocks.tx, {
      weekCloseId: "wc-1",
      workoutId: "workout-gap",
    });
    expect(mocks.dismissPendingWeekClose).toHaveBeenCalledWith(mocks.tx, {
      weekCloseId: "wc-1",
    });
    expect(mocks.resolveWeekCloseOnOptionalGapFillCompletion).not.toHaveBeenCalled();
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
  });

  it("rejects linked optional gap-fill completion with 409 when the week-close row is no longer pending", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-gap",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        advancesSplit: false,
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
        selectionMetadata: {
          ...buildOptionalGapFillSelectionMetadata(),
          weekCloseId: "wc-1",
        },
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 12, actualRpe: 8, actualLoad: 70 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_DELOAD",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
    mocks.resolveWeekCloseOnOptionalGapFillCompletion.mockRejectedValueOnce(
      new Error("WEEK_CLOSE_NOT_PENDING")
    );

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-gap", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Linked week-close window is no longer pending.",
    });
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
  });

  it("increments only the deload lifecycle counter for first performed deload saves", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 5, actualRpe: 7, actualLoad: 185 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_DELOAD",
      durationWeeks: 5,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 1,
      sessionsPerWeek: 3,
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: { completedSessions: { increment: 1 }, deloadSessionsCompleted: { increment: 1 } },
    });

    const updateMany = mocks.workoutUpdateMany.mock.calls[0][0];
    expect(updateMany.data.mesocycleWeekSnapshot).toBe(5);
    expect(updateMany.data.mesoSessionSnapshot).toBe(2);
    expect(updateMany.data.mesocyclePhaseSnapshot).toBe("DELOAD");
  });

  it("rejects a same-terminal completion retry without double-advancing lifecycle", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "COMPLETED",
        revision: 1,
        mesocycleId: "meso-1",
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(409);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
    expect(mocks.createPostSessionReviewSnapshotInTransaction).not.toHaveBeenCalled();
  });

  it("completes an off-order planned slot once and rejects a stale terminal retry", async () => {
    const alternativeSelectionMetadata = buildCanonicalSelectionMetadata();
    const alternativeReceipt = alternativeSelectionMetadata.sessionDecisionReceipt as
      typeof alternativeSelectionMetadata.sessionDecisionReceipt & {
        sessionSlot: {
          slotId: string;
          intent: string;
          sequenceIndex: number;
          sequenceLength: number;
          source: string;
        };
      };
    alternativeReceipt.sessionSlot = {
      slotId: "lower_a",
      intent: "lower",
      sequenceIndex: 1,
      sequenceLength: 4,
      source: "mesocycle_slot_sequence",
    };
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        selectionMetadata: alternativeSelectionMetadata,
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "COMPLETED",
        revision: 2,
        mesocycleId: "meso-1",
        selectionMetadata: alternativeSelectionMetadata,
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
    });

    const firstResponse = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );
    const secondResponse = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(409);
    expect(mocks.createPostSessionReviewSnapshotInTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledTimes(1);
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: {
        completedSessions: { increment: 1 },
        accumulationSessionsCompleted: { increment: 1 },
      },
    });
    const persistedMetadata = mocks.workoutUpdateMany.mock.calls[0][0].data
      .selectionMetadata as typeof alternativeSelectionMetadata;
    const persistedReceipt = persistedMetadata.sessionDecisionReceipt as Record<
      string,
      unknown
    >;
    expect(persistedReceipt.sessionSlot).toEqual({
      slotId: "lower_a",
      intent: "lower",
      sequenceIndex: 1,
      sequenceLength: 4,
      source: "mesocycle_slot_sequence",
    });
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.transitionMesocycleStateInTransaction).toHaveBeenCalledWith(mocks.tx, "meso-1");
  });

  it("auto-dismisses a pending week-close window on forward performed progress and does not double-advance on retry", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "COMPLETED",
        revision: 2,
        mesocycleId: "meso-1",
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 3,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });
    mocks.autoDismissPendingWeekCloseOnForwardProgress
      .mockResolvedValueOnce({
        weekCloseId: "wc-1",
        status: "RESOLVED",
        resolution: "AUTO_DISMISSED",
        advancedLifecycle: false,
        outcome: "resolved",
      })
      .mockResolvedValueOnce({
        weekCloseId: null,
        status: null,
        resolution: null,
        advancedLifecycle: false,
        outcome: "not_found",
      });

    const firstResponse = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );
    const secondResponse = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(409);
    expect(mocks.autoDismissPendingWeekCloseOnForwardProgress).toHaveBeenCalledTimes(1);
    expect(mocks.autoDismissPendingWeekCloseOnForwardProgress).toHaveBeenCalledWith(mocks.tx, {
      mesocycleId: "meso-1",
      workoutWeek: 2,
    });
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
    expect(mocks.tx.mesocycle.update).toHaveBeenCalledTimes(1);
  });

  it("returns a revision conflict when another request wins first completion", async () => {
    mocks.workoutFindUnique
      .mockResolvedValueOnce({
        id: "workout-1",
        userId: "user-1",
        status: "PLANNED",
        revision: 1,
        mesocycleId: "meso-1",
        selectionMetadata: buildCanonicalSelectionMetadata(),
      })
      .mockResolvedValueOnce({
        exercises: [
          {
            sets: [{ logs: [{ wasSkipped: false, actualReps: 8, actualRpe: 8, actualLoad: 135 }] }],
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "workout-1",
        revision: 2,
        mesocycleId: "meso-1",
      });
    mocks.workoutUpdateMany.mockResolvedValueOnce({ count: 0 });
    mocks.tx.mesocycle.findUnique.mockResolvedValueOnce({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      durationWeeks: 5,
      accumulationSessionsCompleted: 5,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      startWeek: 0,
      macroCycle: {
        startDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: "workout-1", action: "mark_completed" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Workout revision conflict. Refresh and try again.",
    });
    expect(mocks.workoutUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.mesocycle.update).not.toHaveBeenCalled();
    expect(mocks.evaluateWeekCloseAtBoundary).not.toHaveBeenCalled();
    expect(mocks.transitionMesocycleStateInTransaction).not.toHaveBeenCalled();
    expect(mocks.workoutUpsert).not.toHaveBeenCalled();
  });
});
