import { describe, expect, it, vi } from "vitest";
import { deriveNextRuntimeSlotSession } from "@/lib/api/mesocycle-slot-runtime";
import { buildMesocycleSlotSequence } from "@/lib/api/mesocycle-slot-contract";
import { readRuntimeEditReconciliation } from "@/lib/ui/selection-metadata";
import {
  backfillWeek1PerformedSessions,
  TRANSITION_WEEK_BACKFILL_MESOCYCLE_ID,
  TRANSITION_WEEK_BACKFILL_OWNER_EMAIL,
  TRANSITION_WEEK_BACKFILL_SESSIONS,
  type BackfillSessionDefinition,
} from "./backfill-week1-performed-sessions";

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

type ExerciseRow = {
  id: string;
  name: string;
  movementPatterns: string[];
  aliases: Array<{ alias: string }>;
};

type ExistingWorkout = {
  id: string;
  status: string;
  scheduledDate: Date;
  sessionIntent: string | null;
  mesocycleWeekSnapshot: number | null;
  mesoSessionSnapshot: number | null;
  selectionMetadata: unknown;
  exercises: Array<{
    sets: Array<{
      logs: Array<{ id: string; wasSkipped: boolean }>;
    }>;
  }>;
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function exercise(name: string, id = slug(name), aliases: string[] = []): ExerciseRow {
  return {
    id,
    name,
    movementPatterns: [],
    aliases: aliases.map((alias) => ({ alias })),
  };
}

function seedSlotPlanJson() {
  return {
    version: 1,
    source: "handoff_slot_plan_projection",
    slots: [
      {
        slotId: "upper_a",
        exercises: [
          { exerciseId: "incline-machine-press", role: "CORE_COMPOUND", setCount: 4 },
          {
            exerciseId: "close-grip-seated-cable-row",
            role: "CORE_COMPOUND",
            setCount: 3,
          },
          { exerciseId: "close-grip-lat-pulldown", role: "ACCESSORY", setCount: 2 },
          { exerciseId: "cable-rear-delt-fly", role: "ACCESSORY", setCount: 2 },
          { exerciseId: "machine-lateral-raise", role: "ACCESSORY", setCount: 2 },
          { exerciseId: "cable-triceps-pushdown", role: "ACCESSORY", setCount: 3 },
        ],
      },
      {
        slotId: "lower_a",
        exercises: [
          { exerciseId: "belt-squat", role: "CORE_COMPOUND", setCount: 4 },
          { exerciseId: "leg-extension", role: "ACCESSORY", setCount: 2 },
          { exerciseId: "lying-leg-curl", role: "ACCESSORY", setCount: 2 },
          { exerciseId: "seated-calf-raise", role: "ACCESSORY", setCount: 4 },
        ],
      },
      {
        slotId: "upper_b",
        exercises: [
          { exerciseId: "machine-shoulder-press", role: "ACCESSORY", setCount: 2 },
          { exerciseId: "lat-pulldown", role: "CORE_COMPOUND", setCount: 3 },
          { exerciseId: "cable-fly", role: "ACCESSORY", setCount: 3 },
          { exerciseId: "seated-cable-row", role: "ACCESSORY", setCount: 3 },
          { exerciseId: "machine-lateral-raise", role: "ACCESSORY", setCount: 4 },
          { exerciseId: "barbell-curl", role: "ACCESSORY", setCount: 3 },
        ],
      },
      {
        slotId: "lower_b",
        exercises: [
          { exerciseId: "stiff-legged-deadlift", role: "CORE_COMPOUND", setCount: 3 },
          { exerciseId: "seated-leg-curl", role: "ACCESSORY", setCount: 3 },
          { exerciseId: "bulgarian-split-squat", role: "ACCESSORY", setCount: 3 },
          { exerciseId: "seated-calf-raise", role: "ACCESSORY", setCount: 3 },
        ],
      },
    ],
  };
}

function slotSequenceJson() {
  return buildMesocycleSlotSequence([
    { slotId: "upper_a", intent: "UPPER" },
    { slotId: "lower_a", intent: "LOWER" },
    { slotId: "upper_b", intent: "UPPER" },
    { slotId: "lower_b", intent: "LOWER" },
  ]);
}

function exerciseCatalog(): ExerciseRow[] {
  return [
    exercise("Incline Machine Press"),
    exercise("Close-Grip Seated Cable Row"),
    exercise("Close-Grip Lat Pulldown"),
    exercise("Cable Rear Delt Fly"),
    exercise("Machine Lateral Raise"),
    exercise("Cable Triceps Pushdown", undefined, [
      "Triceps Pushdown",
      "Tricep Rope Pushdown",
    ]),
    exercise("Belt Squat"),
    exercise("Leg Extension"),
    exercise("Lying Leg Curl"),
    exercise("Seated Calf Raise"),
    exercise("Machine Shoulder Press"),
    exercise("Lat Pulldown"),
    exercise("Cable Fly"),
    exercise("Seated Cable Row"),
    exercise("Barbell Curl"),
    exercise("Stiff-Legged Deadlift"),
    exercise("Seated Leg Curl"),
    exercise("Bulgarian Split Squat"),
    exercise("Incline Dumbbell Bench Press", undefined, ["Incline DB Press"]),
    exercise("T-Bar Row"),
    exercise("Machine Chest Press"),
    exercise("Standing Calf Raise"),
    exercise("Cable Lateral Raise"),
    exercise("Romanian Deadlift", undefined, ["DB Romanian Deadlift"]),
    exercise("Barbell Back Squat"),
    exercise("Dumbbell Overhead Press", undefined, [
      "DB Shoulder Press",
      "Dumbbell Shoulder Press",
    ]),
    exercise("EZ-Bar Curl"),
    exercise("Torso Rotation"),
  ];
}

function selectionMetadataForSlot(slotId: string, intent: string, sequenceIndex: number) {
  return {
    sessionDecisionReceipt: {
      version: 1,
      cycleContext: {
        weekInMeso: 1,
        weekInBlock: 1,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      sessionProvenance: {
        mesocycleId: TRANSITION_WEEK_BACKFILL_MESOCYCLE_ID,
        compositionSource: "persisted_slot_plan_seed",
      },
      sessionSlot: {
        slotId,
        intent,
        sequenceIndex,
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
  };
}

function existingWorkout(input: {
  id: string;
  slotId: string;
  intent: string;
  sequenceIndex: number;
  mesoSessionSnapshot: number;
  scheduledDate: string;
  status?: string;
  logCount?: number;
}): ExistingWorkout {
  return {
    id: input.id,
    status: input.status ?? "COMPLETED",
    scheduledDate: new Date(`${input.scheduledDate}T12:00:00.000Z`),
    sessionIntent: input.intent.toUpperCase(),
    mesocycleWeekSnapshot: 1,
    mesoSessionSnapshot: input.mesoSessionSnapshot,
    selectionMetadata: selectionMetadataForSlot(input.slotId, input.intent, input.sequenceIndex),
    exercises: [
      {
        sets: [
          {
            logs: Array.from({ length: input.logCount ?? 0 }, (_, index) => ({
              id: `${input.id}-log-${index + 1}`,
              wasSkipped: false,
            })),
          },
        ],
      },
    ],
  };
}

function safeMesocycle(overrides: Record<string, unknown> = {}) {
  return {
    id: TRANSITION_WEEK_BACKFILL_MESOCYCLE_ID,
    state: "ACTIVE_ACCUMULATION",
    isActive: true,
    durationWeeks: 5,
    completedSessions: 0,
    accumulationSessionsCompleted: 0,
    deloadSessionsCompleted: 0,
    sessionsPerWeek: 4,
    slotSequenceJson: slotSequenceJson(),
    slotPlanSeedJson: seedSlotPlanJson(),
    macroCycle: {
      userId: "user-1",
      user: { email: TRANSITION_WEEK_BACKFILL_OWNER_EMAIL },
    },
    ...overrides,
  };
}

function validPerformedSessions(): BackfillSessionDefinition[] {
  return TRANSITION_WEEK_BACKFILL_SESSIONS.map((session) => ({
    ...session,
    performed: session.performed.map((entry) => ({
      ...entry,
      sets: entry.sets.map((set) => ({ ...set })),
    })),
  }));
}

function createFixture(input: {
  mesocycle?: ReturnType<typeof safeMesocycle> | null;
  workouts?: ExistingWorkout[];
  exercises?: ExerciseRow[];
} = {}) {
  const state = {
    mesocycle: input.mesocycle === undefined ? safeMesocycle() : input.mesocycle,
    workouts: [...(input.workouts ?? [])],
    exercises: input.exercises ?? exerciseCatalog(),
    createdWorkouts: [] as Array<Record<string, unknown>>,
    createdWorkoutExercises: [] as Array<Record<string, unknown>>,
    createdWorkoutSets: [] as Array<Record<string, unknown>>,
    createdSetLogs: [] as Array<Record<string, unknown>>,
    mesocycleUpdates: [] as Array<Record<string, unknown>>,
  };
  const tx = {
    mesocycle: {
      findUnique: vi.fn(async (args: { where?: { id?: string } }) =>
        state.mesocycle && args.where?.id === state.mesocycle.id ? state.mesocycle : null,
      ),
      update: vi.fn(async (args: { data?: Record<string, { increment?: number }> }) => {
        state.mesocycleUpdates.push(args as unknown as Record<string, unknown>);
        if (state.mesocycle) {
          const completedIncrement = args.data?.completedSessions?.increment ?? 0;
          const accumulationIncrement =
            args.data?.accumulationSessionsCompleted?.increment ?? 0;
          state.mesocycle = {
            ...state.mesocycle,
            completedSessions:
              ((state.mesocycle as { completedSessions?: number }).completedSessions ?? 0) +
              completedIncrement,
            accumulationSessionsCompleted:
              state.mesocycle.accumulationSessionsCompleted + accumulationIncrement,
          };
        }
        return state.mesocycle;
      }),
    },
    workout: {
      findMany: vi.fn(async () => state.workouts),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        state.createdWorkouts.push(args.data);
        return { id: args.data.id as string };
      }),
    },
    workoutExercise: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        state.createdWorkoutExercises.push(args.data);
        return { id: args.data.id as string };
      }),
    },
    workoutSet: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        state.createdWorkoutSets.push(args.data);
        return { id: args.data.id as string };
      }),
    },
    setLog: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const id = `set-log-${state.createdSetLogs.length + 1}`;
        state.createdSetLogs.push({ id, ...args.data });
        return { id };
      }),
    },
    exercise: {
      findMany: vi.fn(async () => state.exercises),
    },
  };
  const client = {
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  let idCounter = 0;
  return {
    state,
    tx,
    client,
    idFactory: () => {
      idCounter += 1;
      return `generated-id-${idCounter}`;
    },
  };
}

async function runBackfill(
  fixture: ReturnType<typeof createFixture>,
  input: {
    ownerEmail?: string;
    mesocycleId?: string;
    write?: boolean;
    confirmBackfill?: boolean;
    sessions?: readonly BackfillSessionDefinition[];
  } = {},
) {
  return backfillWeek1PerformedSessions({
    ownerEmail: input.ownerEmail ?? TRANSITION_WEEK_BACKFILL_OWNER_EMAIL,
    mesocycleId: input.mesocycleId ?? TRANSITION_WEEK_BACKFILL_MESOCYCLE_ID,
    backfillWeek1PerformedSessions: true,
    write: input.write,
    confirmBackfill: input.confirmBackfill,
    dependencies: {
      prismaClient: fixture.client as never,
      idFactory: fixture.idFactory,
      performedSessions: input.sessions ?? validPerformedSessions(),
    },
  });
}

describe("backfillWeek1PerformedSessions", () => {
  it("blocks if owner does not match the targeted migration owner", async () => {
    const fixture = createFixture();

    const result = await runBackfill(fixture, { ownerEmail: "wrong@example.com" });

    expect(result.safety.eligible).toBe(false);
    expect(result.safety.blockers).toContain("owner_email_mismatch");
    expect(fixture.state.createdWorkouts).toHaveLength(0);
  });

  it("blocks if mesocycle id does not match the targeted migration mesocycle", async () => {
    const fixture = createFixture({
      mesocycle: safeMesocycle({ id: "not-the-target-mesocycle" }),
    });

    const result = await runBackfill(fixture, { mesocycleId: "not-the-target-mesocycle" });

    expect(result.safety.eligible).toBe(false);
    expect(result.safety.blockers).toContain("target_mesocycle_id_mismatch");
    expect(fixture.state.createdWorkouts).toHaveLength(0);
  });

  it("blocks if a target slot is already logged", async () => {
    const fixture = createFixture({
      workouts: [
        existingWorkout({
          id: "already-logged-upper-a",
          slotId: "upper_a",
          intent: "upper",
          sequenceIndex: 0,
          mesoSessionSnapshot: 1,
          scheduledDate: "2026-04-28",
          status: "COMPLETED",
        }),
      ],
    });

    const result = await runBackfill(fixture);

    expect(result.safety.eligible).toBe(false);
    expect(result.safety.blockers).toContain("target_slot_already_logged");
    expect(result.safety.existingSlotWorkoutIds).toEqual(["already-logged-upper-a"]);
  });

  it("blocks if performed logs already exist for the slot/date", async () => {
    const fixture = createFixture({
      workouts: [
        existingWorkout({
          id: "logged-upper-a-same-date",
          slotId: "upper_a",
          intent: "upper",
          sequenceIndex: 0,
          mesoSessionSnapshot: 1,
          scheduledDate: "2026-04-27",
          status: "PARTIAL",
          logCount: 1,
        }),
      ],
    });

    const result = await runBackfill(fixture);

    expect(result.safety.eligible).toBe(false);
    expect(result.safety.blockers).toContain("performed_logs_already_exist_for_slot_date");
    expect(result.safety.existingLoggedWorkoutIds).toEqual(["logged-upper-a-same-date"]);
  });

  it("does not mutate DB state in dry-run mode", async () => {
    const fixture = createFixture();
    const seedBefore = JSON.stringify(fixture.state.mesocycle?.slotPlanSeedJson);
    const sequenceBefore = JSON.stringify(fixture.state.mesocycle?.slotSequenceJson);

    const result = await runBackfill(fixture);

    expect(result.dryRun).toBe(true);
    expect(result.safety.blockers).toEqual([]);
    expect(result.dryRunSummary.totals).toEqual({
      workouts: 3,
      workoutExercises: 19,
      workoutSets: 61,
      performedSetLogs: 54,
      skippedSetLogs: 7,
      runtimeEditOps: 22,
    });
    expect(result.expectedNextSlotAfterWrite.slotId).toBe("lower_b");
    expect(result.write.dbWriteOccurred).toBe(false);
    expect(fixture.state.createdWorkouts).toHaveLength(0);
    expect(fixture.state.createdWorkoutExercises).toHaveLength(0);
    expect(fixture.state.createdWorkoutSets).toHaveLength(0);
    expect(fixture.state.createdSetLogs).toHaveLength(0);
    expect(JSON.stringify(fixture.state.mesocycle?.slotPlanSeedJson)).toBe(seedBefore);
    expect(JSON.stringify(fixture.state.mesocycle?.slotSequenceJson)).toBe(sequenceBefore);
  });

  it("requires explicit confirmation before write mode", async () => {
    const fixture = createFixture();

    await expect(runBackfill(fixture, { write: true })).rejects.toThrow(
      "BACKFILL_WEEK1_CONFIRMATION_REQUIRED",
    );
    expect(fixture.state.createdWorkouts).toHaveLength(0);
  });

  it("omits skipped Torso Rotation rows from the default production payload", async () => {
    const fixture = createFixture();

    const result = await runBackfill(fixture);

    expect(result.safety.eligible).toBe(true);
    expect(result.safety.blockers).toEqual([]);
    expect(
      result.dryRunSummary.slots.flatMap((slot) =>
        slot.mappings.map((mapping) => mapping.performedName),
      ),
    ).not.toContain("Torso Rotation");
  });

  it("blocks if a provided performed row has load-only sets", async () => {
    const fixture = createFixture();
    const sessions = validPerformedSessions();
    sessions[0] = {
      ...sessions[0]!,
      performed: [
        ...sessions[0]!.performed,
        {
          performedName: "Torso Rotation",
          searchTerms: ["Torso Rotation", "Rotary Torso"],
          kind: "added",
          section: "ACCESSORY",
          isMainLift: false,
          sets: [
            { load: 120, note: "Source log supplied load-only value: 120" },
            { load: 120, note: "Source log supplied load-only value: 120" },
          ],
        },
      ],
    };

    const result = await runBackfill(fixture, { sessions });

    expect(result.safety.eligible).toBe(false);
    expect(result.safety.blockers).toContain("performed_set_missing_reps_or_rpe");
    expect(result.safety.allPerformedRowsRepresented).toBe(false);
  });

  it("writes valid performed sessions as deviations without changing seed or slot sequence", async () => {
    const fixture = createFixture();
    const seedBefore = JSON.stringify(fixture.state.mesocycle?.slotPlanSeedJson);
    const sequenceBefore = JSON.stringify(fixture.state.mesocycle?.slotSequenceJson);

    const result = await runBackfill(fixture, {
      write: true,
      confirmBackfill: true,
    });

    expect(result.safety.blockers).toEqual([]);
    expect(result.write.transactionStatus).toBe("success");
    expect(result.write.dbWriteOccurred).toBe(true);
    expect(result.seedSlotSequenceBoundary.slotPlanSeedUnchanged).toBe(true);
    expect(result.seedSlotSequenceBoundary.slotSequenceUnchanged).toBe(true);
    expect(JSON.stringify(fixture.state.mesocycle?.slotPlanSeedJson)).toBe(seedBefore);
    expect(JSON.stringify(fixture.state.mesocycle?.slotSequenceJson)).toBe(sequenceBefore);
    expect(fixture.state.createdWorkouts).toHaveLength(3);
    expect(fixture.state.createdWorkoutExercises).toHaveLength(
      result.dryRunSummary.totals.workoutExercises,
    );
    expect(fixture.state.createdWorkoutSets).toHaveLength(
      result.dryRunSummary.totals.workoutSets,
    );
    expect(fixture.state.createdSetLogs).toHaveLength(
      result.dryRunSummary.totals.performedSetLogs +
        result.dryRunSummary.totals.skippedSetLogs,
    );

    const runtimeOps = fixture.state.createdWorkouts.flatMap((workout) =>
      readRuntimeEditReconciliation(workout.selectionMetadata)?.ops ?? [],
    );
    expect(runtimeOps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "replace_exercise",
          facts: expect.objectContaining({
            fromExerciseId: "incline-machine-press",
            toExerciseId: "incline-dumbbell-bench-press",
            reason: "transition_week_backfill_substitution",
          }),
        }),
        expect.objectContaining({
          kind: "replace_exercise",
          facts: expect.objectContaining({
            fromExerciseId: "cable-fly",
            toExerciseId: "machine-chest-press",
            reason: "transition_week_backfill_substitution",
          }),
        }),
        expect.objectContaining({
          kind: "add_exercise",
          facts: expect.objectContaining({
            exerciseId: "romanian-deadlift",
            prescriptionSource: "generic_accessory_fallback",
          }),
        }),
        expect.objectContaining({
          kind: "add_exercise",
          facts: expect.objectContaining({
            exerciseId: "cable-lateral-raise",
            prescriptionSource: "generic_accessory_fallback",
          }),
        }),
        expect.objectContaining({
          kind: "add_set",
          facts: expect.objectContaining({
            exerciseId: "machine-chest-press",
          }),
        }),
      ]),
    );
    expect(
      fixture.state.createdSetLogs.filter((log) => log.wasSkipped === true),
    ).toHaveLength(result.dryRunSummary.totals.skippedSetLogs);
    expect(
      fixture.state.createdSetLogs.some((log) =>
        String(log.notes ?? "").includes("skipped/unperformed outside app"),
      ),
    ).toBe(true);
    expect(
      fixture.state.createdSetLogs.filter((log) =>
        String(log.notes ?? "").includes("per-hand dumbbell load"),
      ),
    ).toHaveLength(3);
    expect(fixture.state.mesocycle?.accumulationSessionsCompleted).toBe(3);
    expect(result.expectedNextSlotAfterWrite.slotId).toBe("lower_b");

    const replay = deriveNextRuntimeSlotSession({
      mesocycle: {
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: fixture.state.mesocycle?.accumulationSessionsCompleted ?? 0,
        deloadSessionsCompleted: fixture.state.mesocycle?.deloadSessionsCompleted ?? 0,
        sessionsPerWeek: fixture.state.mesocycle?.sessionsPerWeek ?? 4,
        durationWeeks: fixture.state.mesocycle?.durationWeeks ?? 5,
      },
      slotSequenceJson: fixture.state.mesocycle?.slotSequenceJson,
      weeklySchedule: ["upper", "lower", "upper", "lower"],
      performedAdvancingSlotIdsThisWeek: ["upper_a", "lower_a", "upper_b"],
      performedAdvancingIntentsThisWeek: ["upper", "lower", "upper"],
    });
    expect(replay.slotId).toBe("lower_b");
  });
});
