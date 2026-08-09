import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type {
  HypertrophyPlanDraftV1,
  HypertrophyPlanDraftV2,
} from "@/lib/engine/hypertrophy-plan-authoring";

const originalMeasurementRollout = process.env.TRAINER_EXERCISE_MEASUREMENT_ROLLOUT;

afterEach(() => {
  if (originalMeasurementRollout === undefined) {
    delete process.env.TRAINER_EXERCISE_MEASUREMENT_ROLLOUT;
  } else {
    process.env.TRAINER_EXERCISE_MEASUREMENT_ROLLOUT = originalMeasurementRollout;
  }
});

const mocks = vi.hoisted(() => {
  const state = {
    draft: null as null | { payload: unknown; revision: number },
    mesocycles: [] as unknown[],
    revisions: [] as unknown[],
    planUpdates: [] as unknown[],
  };
  const tx = {
    macroCycle: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(async (input: unknown) => {
        state.planUpdates.push(input);
        return input;
      }),
    },
    exercise: { findMany: vi.fn() },
    injury: { findMany: vi.fn() },
    userPreference: { findUnique: vi.fn() },
    hypertrophyPlanDraft: {
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      deleteMany: vi.fn(),
    },
    mesocycle: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        state.mesocycles.push(data);
        return data;
      }),
    },
  };
  const prisma = {
    ...tx,
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => {
        const snapshot = structuredClone(state);
        try {
          return await callback(tx);
        } catch (error) {
          state.draft = snapshot.draft;
          state.mesocycles.splice(0, state.mesocycles.length, ...snapshot.mesocycles);
          state.revisions.splice(0, state.revisions.length, ...snapshot.revisions);
          state.planUpdates.splice(
            0,
            state.planUpdates.length,
            ...snapshot.planUpdates,
          );
          throw error;
        }
      },
    ),
  };
  const createRevision = vi.fn();
  return { state, tx, prisma, createRevision };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("./mesocycle-seed-revision", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mesocycle-seed-revision")>()),
  createInitialAcceptedSeedRevisionInTransaction: mocks.createRevision,
}));

import {
  createCustomHypertrophyPlan,
  createEditableHypertrophyPlanCopy,
  deriveHypertrophyPlanV4Preview,
  loadHypertrophyPlanEditorData,
  makeHypertrophyPlanReady,
  saveHypertrophyPlanDraft,
} from "./hypertrophy-plan-drafts";

function draft(): HypertrophyPlanDraftV1 {
  return {
    version: 1 as const,
    settings: {
      equipmentProfile: "FULL_GYM" as const,
      sessionDurationMinutes: 60 as const,
    },
    sessions: [
      {
        slotId: "upper",
        name: "Upper",
        focus: "UPPER" as const,
        exercises: [
          {
            exerciseId: "bench",
            workingSets: 4,
            intent: {
              userRole: "PRIMARY_LIFT" as const,
              target: {
                kind: "movement_pattern" as const,
                movementPattern: "horizontal_push" as const,
              },
            },
          },
        ],
      },
      {
        slotId: "lower",
        name: "Lower",
        focus: "LOWER" as const,
        exercises: [
          {
            exerciseId: "curl",
            workingSets: 3,
            intent: {
              userRole: "MUSCLE_ISOLATION" as const,
              target: { kind: "muscle" as const, muscleId: "hamstrings" as const },
            },
          },
        ],
      },
    ],
  };
}

function lowAxialDraft() {
  const value = structuredClone(draft());
  value.sessions[1]!.exercises[0] = {
    exerciseId: "hip-thrust",
    workingSets: 3,
    intent: {
      userRole: "PRIMARY_LIFT",
      target: { kind: "movement_pattern", movementPattern: "hinge" },
      requiredExerciseClass: "low_axial_hip_extension_anchor",
    },
  };
  return value;
}

function weeklyDraft({ emptyUpper = false } = {}): HypertrophyPlanDraftV2 {
  return {
    version: 2,
    settings: draft().settings,
    weeks: [
      { week: 1, phase: "ACCUMULATION" },
      { week: 2, phase: "DELOAD" },
    ],
    sessions: [
      {
        slotId: "upper",
        name: "Upper",
        focus: "UPPER",
        exercises: emptyUpper
          ? []
          : [
              {
                placementId: "placement-bench",
                exerciseId: "bench",
                intent: draft().sessions[0]!.exercises[0]!.intent,
                prescriptions: [
                  {
                    week: 1,
                    status: "PRESCRIBE",
                    setCount: 4,
                    reps: { kind: "RANGE", min: 6, max: 8 },
                    rir: { kind: "TARGET_RANGE", min: 2, max: 3 },
                  },
                  {
                    week: 2,
                    status: "PRESCRIBE",
                    setCount: 4,
                    reps: { kind: "EXACT", reps: 6 },
                    rir: { kind: "TARGET_RANGE", min: 4, max: 5 },
                  },
                ],
              },
            ],
      },
      {
        slotId: "lower",
        name: "Lower",
        focus: "LOWER",
        exercises: [
          {
            placementId: "placement-curl",
            exerciseId: "curl",
            intent: draft().sessions[1]!.exercises[0]!.intent,
            prescriptions: [
              {
                week: 1,
                status: "PRESCRIBE",
                setCount: 3,
                reps: { kind: "EXACT", reps: 10 },
                rir: { kind: "NOT_APPLICABLE" },
              },
              { week: 2, status: "OMIT" },
            ],
          },
        ],
      },
    ],
  };
}

const exerciseRows = [
  {
    id: "bench",
    name: "Bench Press",
    movementPatterns: ["HORIZONTAL_PUSH"],
    contraindications: {},
    isCompound: true,
    isMainLiftEligible: true,
    fatigueCost: 3,
    timePerSetSec: 180,
    measurementProfile: "REPS_EXTERNAL_LOAD",
    loadConvention: "BARBELL_TOTAL",
    repBasis: "TOTAL",
    aliases: [],
    exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
    exerciseMuscles: [
      { role: "PRIMARY", muscle: { id: "chest", name: "Chest" } },
    ],
  },
  {
    id: "curl",
    name: "Leg Curl",
    movementPatterns: ["FLEXION"],
    contraindications: {},
    isCompound: false,
    isMainLiftEligible: false,
    fatigueCost: 1,
    timePerSetSec: 90,
    measurementProfile: "REPS_EXTERNAL_LOAD",
    loadConvention: "MACHINE_DISPLAYED",
    repBasis: "TOTAL",
    aliases: [],
    exerciseEquipment: [{ equipment: { type: "MACHINE" } }],
    exerciseMuscles: [
      {
        role: "PRIMARY",
        muscle: { id: "hamstrings", name: "Hamstrings" },
      },
    ],
  },
  {
    id: "hip-thrust",
    name: "Machine Hip Thrust",
    movementPatterns: ["HINGE"],
    contraindications: {},
    isCompound: true,
    isMainLiftEligible: true,
    fatigueCost: 2,
    timePerSetSec: 120,
    measurementProfile: "REPS_EXTERNAL_LOAD",
    loadConvention: "MACHINE_DISPLAYED",
    repBasis: "TOTAL",
    aliases: [],
    exerciseEquipment: [{ equipment: { type: "MACHINE" } }],
    exerciseMuscles: [
      { role: "PRIMARY", muscle: { id: "glutes", name: "Glutes" } },
      {
        role: "SECONDARY",
        muscle: { id: "hamstrings", name: "Hamstrings" },
      },
    ],
  },
];

describe("custom hypertrophy draft persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRAINER_EXERCISE_MEASUREMENT_ROLLOUT;
    mocks.state.draft = { payload: draft(), revision: 3 };
    mocks.state.mesocycles.length = 0;
    mocks.state.revisions.length = 0;
    mocks.state.planUpdates.length = 0;
    mocks.tx.exercise.findMany.mockResolvedValue(exerciseRows);
    mocks.tx.injury.findMany.mockResolvedValue([]);
    mocks.tx.userPreference.findUnique.mockResolvedValue(null);
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });
    mocks.tx.hypertrophyPlanDraft.deleteMany.mockImplementation(async () => {
      mocks.state.draft = null;
      return { count: 1 };
    });
    mocks.createRevision.mockImplementation(async (_tx, input) => {
      const revision = { id: "revision-1", seedPayload: input.seedPayload };
      mocks.state.revisions.push(revision);
      return revision;
    });
  });

  it("rejects stale autosave writes without changing the plan name", async () => {
    mocks.tx.hypertrophyPlanDraft.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      saveHypertrophyPlanDraft({
        userId: "user-1",
        planId: "plan-1",
        expectedRevision: 2,
        name: "Stale name",
        draft: draft(),
      }),
    ).rejects.toMatchObject({ code: "PLAN_MUTATION_CONFLICT" });
    expect(mocks.tx.macroCycle.update).not.toHaveBeenCalled();
  });

  it("creates a generic V4 weekly draft in the existing JSON draft row", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      profile: { trainingAge: "INTERMEDIATE" },
    });
    mocks.prisma.macroCycle.create.mockResolvedValue({});

    await createCustomHypertrophyPlan({
      userId: "user-1",
      name: "Weekly plan",
      sessionsPerWeek: 4,
      equipmentProfile: "FULL_GYM",
      sessionDurationMinutes: 60,
      authorMethod: "WEEKLY",
      preset: "UPPER_LOWER_4",
    });

    const createInput = mocks.prisma.macroCycle.create.mock.calls[0]![0];
    expect(createInput.data.hypertrophyDraft.create.payload).toMatchObject({
      version: 2,
      weeks: [
        { week: 1, phase: "ACCUMULATION" },
        { week: 2, phase: "ACCUMULATION" },
        { week: 3, phase: "ACCUMULATION" },
        { week: 4, phase: "ACCUMULATION" },
        { week: 5, phase: "DELOAD" },
      ],
    });
    expect(createInput.data.hypertrophyDraft.create.payload.sessions).toHaveLength(4);
    expect(createInput.data.hypertrophyDraft.create.payload.sessions[0].exercises).toEqual([]);
    expect(createInput.data).not.toHaveProperty("mesocycles");
  });

  it("replays concurrent identical custom-plan creates by server-enforced creation identity", async () => {
    const creationId = "00000000-0000-4000-8000-000000000123";
    let persisted: {
      name: string;
      hypertrophyDraft: { payload: unknown; revision: number };
    } | null = null;
    mocks.prisma.user.findUnique.mockResolvedValue({
      profile: { trainingAge: "INTERMEDIATE" },
    });
    mocks.prisma.macroCycle.create
      .mockImplementationOnce(async ({ data }) => {
        persisted = {
          name: data.name,
          hypertrophyDraft: {
            payload: data.hypertrophyDraft.create.payload,
            revision: 1,
          },
        };
        return {};
      })
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "test",
        }),
      );
    mocks.prisma.macroCycle.findFirst.mockImplementation(async ({ where }) =>
      where.id === creationId ? persisted : null,
    );
    const input = {
      userId: "user-1",
      name: "Weekly plan",
      sessionsPerWeek: 4,
      equipmentProfile: "FULL_GYM" as const,
      sessionDurationMinutes: 60 as const,
      authorMethod: "WEEKLY" as const,
      preset: "UPPER_LOWER_4" as const,
      creationId,
    };

    await expect(
      Promise.all([
        createCustomHypertrophyPlan(input),
        createCustomHypertrophyPlan(input),
      ]),
    ).resolves.toEqual([
      { planId: creationId, draftRevision: 1 },
      { planId: creationId, draftRevision: 1 },
    ]);
  });

  it("keeps separate intentional create identities separate", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      profile: { trainingAge: "INTERMEDIATE" },
    });
    mocks.prisma.macroCycle.create.mockResolvedValue({});
    const base = {
      userId: "user-1",
      name: "Weekly plan",
      sessionsPerWeek: 4,
      equipmentProfile: "FULL_GYM" as const,
      sessionDurationMinutes: 60 as const,
      authorMethod: "WEEKLY" as const,
      preset: "UPPER_LOWER_4" as const,
    };

    const created = await Promise.all([
      createCustomHypertrophyPlan({
        ...base,
        creationId: "00000000-0000-4000-8000-000000000123",
      }),
      createCustomHypertrophyPlan({
        ...base,
        creationId: "00000000-0000-4000-8000-000000000124",
      }),
    ]);

    expect(created.map((result) => result.planId)).toEqual([
      "00000000-0000-4000-8000-000000000123",
      "00000000-0000-4000-8000-000000000124",
    ]);
  });

  it("autosaves a structurally valid but preview-incomplete V4 draft", async () => {
    const incomplete = weeklyDraft({ emptyUpper: true });
    mocks.tx.hypertrophyPlanDraft.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.hypertrophyPlanDraft.findUniqueOrThrow.mockResolvedValue({
      revision: 4,
      updatedAt: new Date("2026-08-06T12:00:00.000Z"),
    });

    await expect(
      saveHypertrophyPlanDraft({
        userId: "user-1",
        planId: "plan-1",
        expectedRevision: 3,
        name: "Weekly draft",
        draft: incomplete,
      }),
    ).resolves.toMatchObject({
      revision: 4,
      preview: {
        status: "INELIGIBLE",
        reasons: [expect.objectContaining({ code: "EMPTY_SESSION", slotId: "upper" })],
      },
    });
    expect(mocks.tx.hypertrophyPlanDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payload: incomplete }),
      }),
    );
    expect(mocks.tx.mesocycle.create).not.toHaveBeenCalled();
    expect(mocks.createRevision).not.toHaveBeenCalled();
  });

  it("rejects a malformed V4 placement before persistence", async () => {
    const malformed = weeklyDraft();
    const prescription = malformed.sessions[0]!.exercises[0]!.prescriptions[0];
    if (prescription?.status !== "PRESCRIBE") throw new Error("fixture");
    prescription.setCount = 0;

    await expect(
      saveHypertrophyPlanDraft({
        userId: "user-1",
        planId: "plan-1",
        expectedRevision: 3,
        name: "Malformed weekly draft",
        draft: malformed,
      }),
    ).rejects.toThrow();
    expect(mocks.tx.hypertrophyPlanDraft.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.macroCycle.update).not.toHaveBeenCalled();
  });

  it("restores the exact saved V4 draft and derives preview without downstream writes", async () => {
    const saved = weeklyDraft();
    mocks.prisma.macroCycle.findFirst.mockResolvedValueOnce({
      id: "plan-1",
      name: "Weekly draft",
      hypertrophyDraft: {
        payload: structuredClone(saved),
        revision: 7,
        updatedAt: new Date("2026-08-06T12:00:00.000Z"),
      },
    });

    const restored = await loadHypertrophyPlanEditorData("user-1", "plan-1");

    expect(restored).toMatchObject({
      draft: saved,
      revision: 7,
      preview: { status: "ELIGIBLE", hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(mocks.tx.mesocycle.create).not.toHaveBeenCalled();
    expect(mocks.createRevision).not.toHaveBeenCalled();
    expect(mocks.tx.hypertrophyPlanDraft.updateMany).not.toHaveBeenCalled();
  });

  it("returns clear deterministic preview reasons for unresolved measurement identity", () => {
    const candidate = weeklyDraft();
    const measurement = {
      profile: "REPS_EXTERNAL_LOAD" as const,
      loadConvention: "BARBELL_TOTAL" as const,
      repBasis: "TOTAL" as const,
    };
    const input = {
      draft: candidate,
      knownExerciseIds: new Set(["bench", "curl"]),
      measurementByExerciseId: new Map([["bench", measurement]]),
    };

    expect(deriveHypertrophyPlanV4Preview(input)).toEqual(
      deriveHypertrophyPlanV4Preview(input),
    );
    expect(deriveHypertrophyPlanV4Preview(input)).toEqual({
      status: "INELIGIBLE",
      reasons: [
        {
          code: "MEASUREMENT_UNRESOLVED",
          message:
            "Lower has an exercise without a supported measurement identity.",
          slotId: "lower",
          placementId: "placement-curl",
        },
      ],
    });
  });

  it("rejects V4 finalization before accepted-plan or materialization writes", async () => {
    mocks.state.draft = { payload: weeklyDraft(), revision: 3 };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });

    await expect(
      makeHypertrophyPlanReady({
        userId: "user-1",
        planId: "plan-1",
        expectedDraftRevision: 3,
        warningsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "PLAN_VERSION_NOT_EXECUTABLE" });
    expect(mocks.tx.exercise.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.mesocycle.create).not.toHaveBeenCalled();
    expect(mocks.createRevision).not.toHaveBeenCalled();
    expect(mocks.tx.hypertrophyPlanDraft.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.macroCycle.update).not.toHaveBeenCalled();
  });

  it("preserves the low-axial semantic through draft validation and autosave", async () => {
    const constrainedDraft = lowAxialDraft();
    mocks.tx.hypertrophyPlanDraft.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.hypertrophyPlanDraft.findUniqueOrThrow.mockResolvedValue({
      revision: 4,
      updatedAt: new Date("2026-08-05T12:00:00.000Z"),
    });

    await expect(
      saveHypertrophyPlanDraft({
        userId: "user-1",
        planId: "plan-1",
        expectedRevision: 3,
        name: "Low axial plan",
        draft: constrainedDraft,
      }),
    ).resolves.toEqual({
      revision: 4,
      updatedAt: "2026-08-05T12:00:00.000Z",
    });
    expect(mocks.tx.hypertrophyPlanDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payload: constrainedDraft }),
      }),
    );
  });

  it("atomically creates one accepted five-week plan and consumes its draft", async () => {
    const result = await makeHypertrophyPlanReady({
      userId: "user-1",
      planId: "plan-1",
      expectedDraftRevision: 3,
      warningsConfirmed: true,
    });
    expect(result).toEqual({
      planId: "plan-1",
      mesocycleId: expect.any(String),
      revisionId: "revision-1",
    });
    expect(mocks.state.draft).toBeNull();
    expect(mocks.state.mesocycles).toHaveLength(1);
    expect(mocks.state.revisions).toHaveLength(1);
    expect(mocks.state.mesocycles[0]).toMatchObject({
      durationWeeks: 5,
      sessionsPerWeek: 2,
      blocks: {
        create: [
          { durationWeeks: 4 },
          { durationWeeks: 1 },
        ],
      },
    });
    expect(mocks.state.revisions[0]).toMatchObject({
      seedPayload: {
        version: 2,
        slots: [
          {
            exercises: [
              {
                role: "CORE_COMPOUND",
                intent: draft().sessions[0]!.exercises[0]!.intent,
              },
            ],
          },
          {
            exercises: [
              {
                role: "ACCESSORY",
                intent: draft().sessions[1]!.exercises[0]!.intent,
              },
            ],
          },
        ],
      },
    });
  });

  it("emits V3 only when the gate is enabled and every selected exercise is classified", async () => {
    process.env.TRAINER_EXERCISE_MEASUREMENT_ROLLOUT = "enabled";
    mocks.tx.exercise.findMany.mockResolvedValue(
      exerciseRows.map((row) => ({
        ...row,
        measurementProfile: "REPS_EXTERNAL_LOAD",
        loadConvention: row.id === "bench" ? "BARBELL_TOTAL" : "MACHINE_DISPLAYED",
        repBasis: "TOTAL",
      })),
    );

    await makeHypertrophyPlanReady({
      userId: "user-1",
      planId: "plan-1",
      expectedDraftRevision: 3,
      warningsConfirmed: true,
    });

    expect(mocks.state.revisions[0]).toMatchObject({
      seedPayload: {
        version: 3,
        settings: draft().settings,
        slots: [
          {
            name: "Upper",
            focus: "UPPER",
            exercises: [
              {
                measurement: {
                  profile: "REPS_EXTERNAL_LOAD",
                  loadConvention: "BARBELL_TOTAL",
                  repBasis: "TOTAL",
                },
              },
            ],
          },
          {
            name: "Lower",
            focus: "LOWER",
            exercises: [
              {
                measurement: {
                  profile: "REPS_EXTERNAL_LOAD",
                  loadConvention: "MACHINE_DISPLAYED",
                  repBasis: "TOTAL",
                },
              },
            ],
          },
        ],
      },
    });
  });

  it("keeps a mixed classified plan on accepted V2 even when the gate is enabled", async () => {
    process.env.TRAINER_EXERCISE_MEASUREMENT_ROLLOUT = "enabled";
    mocks.tx.exercise.findMany.mockResolvedValue(
      exerciseRows.map((row) =>
        row.id === "bench"
          ? {
              ...row,
              measurementProfile: "REPS_EXTERNAL_LOAD",
              loadConvention: "BARBELL_TOTAL",
              repBasis: "TOTAL",
            }
          : {
              ...row,
              measurementProfile: null,
              loadConvention: null,
              repBasis: null,
            },
      ),
    );

    await makeHypertrophyPlanReady({
      userId: "user-1",
      planId: "plan-1",
      expectedDraftRevision: 3,
      warningsConfirmed: true,
    });

    expect(mocks.state.revisions[0]).toMatchObject({
      seedPayload: { version: 2 },
    });
  });

  it("preserves the low-axial semantic through make-ready acceptance", async () => {
    const constrainedDraft = lowAxialDraft();
    mocks.state.draft = { payload: constrainedDraft, revision: 3 };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "plan-1",
      trainingAge: "INTERMEDIATE",
      hypertrophyDraft: mocks.state.draft,
      mesocycles: [],
    });

    await makeHypertrophyPlanReady({
      userId: "user-1",
      planId: "plan-1",
      expectedDraftRevision: 3,
      warningsConfirmed: true,
    });

    expect(mocks.state.revisions[0]).toMatchObject({
      seedPayload: {
        slots: [
          expect.anything(),
          {
            exercises: [
              {
                intent: {
                  requiredExerciseClass: "low_axial_hip_extension_anchor",
                },
              },
            ],
          },
        ],
      },
    });
  });

  it("rolls back accepted writes and preserves the exact draft after a delete CAS miss", async () => {
    const before = structuredClone(mocks.state.draft);
    mocks.tx.hypertrophyPlanDraft.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      makeHypertrophyPlanReady({
        userId: "user-1",
        planId: "plan-1",
        expectedDraftRevision: 3,
        warningsConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "PLAN_MUTATION_CONFLICT" });
    expect(mocks.state.draft).toEqual(before);
    expect(mocks.state.mesocycles).toEqual([]);
    expect(mocks.state.revisions).toEqual([]);
    expect(mocks.state.planUpdates).toEqual([]);
  });

  it("reconstructs editable-copy intent only from the accepted revision", async () => {
    const copiedDraft = lowAxialDraft();
    const accepted = {
      version: 2,
      source: "custom_hypertrophy_plan_v1",
      settings: copiedDraft.settings,
      slots: copiedDraft.sessions.map((session) => ({
        slotId: session.slotId,
        name: session.name,
        focus: session.focus,
        exercises: session.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          role:
            exercise.intent.userRole === "PRIMARY_LIFT"
              ? "CORE_COMPOUND"
              : "ACCESSORY",
          setCount: exercise.workingSets,
          intent: exercise.intent,
        })),
      })),
    };
    mocks.prisma.macroCycle.findFirst.mockResolvedValueOnce({
      trainingAge: "INTERMEDIATE",
      mesocycles: [{ currentSeedRevision: { seedPayload: accepted } }],
    });
    mocks.prisma.macroCycle.create.mockResolvedValue({});
    await createEditableHypertrophyPlanCopy({
      userId: "user-1",
      sourcePlanId: "source-plan",
      name: "Editable copy",
    });
    const createInput = mocks.prisma.macroCycle.create.mock.calls[0]![0];
    expect(createInput.data.hypertrophyDraft.create.payload).toEqual(copiedDraft);
    expect(createInput.data.hypertrophyDraft.create.payload.sessions[0].exercises[0].intent)
      .toEqual(copiedDraft.sessions[0]!.exercises[0]!.intent);
    expect(
      createInput.data.hypertrophyDraft.create.payload.sessions[1].exercises[0]
        .intent.requiredExerciseClass,
    ).toBe("low_axial_hip_extension_anchor");
    expect(createInput.data).not.toHaveProperty("mesocycles");
  });

  it("preserves the complete editable envelope when copying accepted V3", async () => {
    const copiedDraft = lowAxialDraft();
    const accepted = {
      version: 3,
      source: "custom_hypertrophy_plan_v1",
      settings: copiedDraft.settings,
      slots: copiedDraft.sessions.map((session) => ({
        slotId: session.slotId,
        name: session.name,
        focus: session.focus,
        exercises: session.exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          role:
            exercise.intent.userRole === "PRIMARY_LIFT"
              ? "CORE_COMPOUND"
              : "ACCESSORY",
          setCount: exercise.workingSets,
          intent: exercise.intent,
          measurement: {
            profile: "REPS_EXTERNAL_LOAD",
            loadConvention: "BARBELL_TOTAL",
            repBasis: "TOTAL",
          },
        })),
      })),
    };
    mocks.prisma.macroCycle.findFirst.mockResolvedValueOnce({
      trainingAge: "INTERMEDIATE",
      mesocycles: [{ currentSeedRevision: { seedPayload: accepted } }],
    });
    mocks.prisma.macroCycle.create.mockResolvedValue({});

    await createEditableHypertrophyPlanCopy({
      userId: "user-1",
      sourcePlanId: "source-plan",
      name: "Editable V3 copy",
    });

    const createInput = mocks.prisma.macroCycle.create.mock.calls[0]![0];
    expect(createInput.data.hypertrophyDraft.create.payload).toEqual(copiedDraft);
    expect(createInput.data.hypertrophyDraft.create.payload.settings).toEqual(
      copiedDraft.settings,
    );
    expect(
      createInput.data.hypertrophyDraft.create.payload.sessions.map(
        (session: { slotId: string; name: string; focus: string }) => ({
          slotId: session.slotId,
          name: session.name,
          focus: session.focus,
        }),
      ),
    ).toEqual(
      copiedDraft.sessions.map((session) => ({
        slotId: session.slotId,
        name: session.name,
        focus: session.focus,
      })),
    );
    expect(
      createInput.data.hypertrophyDraft.create.payload.sessions[1].exercises[0]
        .intent.requiredExerciseClass,
    ).toBe("low_axial_hip_extension_anchor");
  });

  it.each([
    { version: 3, source: "custom_hypertrophy_plan_v1", slots: [] },
    { version: 4, source: "custom_hypertrophy_plan_v1", slots: [] },
  ])("rejects an invalid accepted copy source before creating a draft", async (seedPayload) => {
    mocks.prisma.macroCycle.findFirst.mockResolvedValueOnce({
      trainingAge: "INTERMEDIATE",
      mesocycles: [{ currentSeedRevision: { seedPayload } }],
    });

    await expect(
      createEditableHypertrophyPlanCopy({
        userId: "user-1",
        sourcePlanId: "source-plan",
        name: "Invalid copy",
      }),
    ).rejects.toMatchObject({ code: "PLAN_COPY_UNAVAILABLE" });
    expect(mocks.prisma.macroCycle.create).not.toHaveBeenCalled();
  });
});
