import { beforeEach, describe, expect, it, vi } from "vitest";
import { MesocycleState } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const macroCycleUpdateMany = vi.fn();
  const macroCycleFindFirst = vi.fn();
  const macroCycleCreate = vi.fn();
  const userFindUnique = vi.fn();
  const exerciseFindMany = vi.fn();
  const generateMacroCycle = vi.fn();
  const createInitialAcceptedSeedRevision = vi.fn();
  const tx = {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    macroCycle: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    mesocycle: { updateMany: vi.fn() },
  };
  return {
    macroCycleUpdateMany,
    macroCycleFindFirst,
    macroCycleCreate,
    userFindUnique,
    exerciseFindMany,
    generateMacroCycle,
    createInitialAcceptedSeedRevision,
    tx,
    prisma: {
      user: { findUnique: userFindUnique },
      exercise: { findMany: exerciseFindMany },
      macroCycle: {
        create: macroCycleCreate,
        updateMany: macroCycleUpdateMany,
        findFirst: macroCycleFindFirst,
      },
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/engine", () => ({
  generateMacroCycle: mocks.generateMacroCycle,
}));
vi.mock("./mesocycle-seed-revision", () => ({
  createInitialAcceptedSeedRevisionInTransaction:
    mocks.createInitialAcceptedSeedRevision,
}));

import {
  archivePlan,
  createHypertrophyPlan,
  createStrengthPlan,
  derivePlanLifecycle,
  finalizePlan,
  loadPlanActivationTarget,
  loadPlanManagementData,
  loadPlanReview,
  renamePlan,
} from "./plan-management";

function mesocycle(
  id: string,
  state: MesocycleState,
  isActive = false,
  mesoNumber = 1,
) {
  return { id, state, isActive, mesoNumber };
}

const requiredStrengthRows = [
  ["squat", "Bodyweight Squat", "SQUAT"],
  ["hinge", "Bodyweight Hinge", "HINGE"],
  ["horizontal-push", "Push-Up", "HORIZONTAL_PUSH"],
  ["vertical-push", "Pike Push-Up", "VERTICAL_PUSH"],
  ["horizontal-pull", "Inverted Row", "HORIZONTAL_PULL"],
  ["vertical-pull", "Pull-Up", "VERTICAL_PULL"],
] as const;

function strengthExerciseRows(input?: {
  incompatiblePattern?: string;
  contraindicatedPattern?: string;
}) {
  return requiredStrengthRows.map(([id, name, pattern]) => ({
    id,
    name,
    movementPatterns: [pattern],
    isMainLiftEligible: true,
    isCompound: true,
    fatigueCost: 1,
    contraindications:
      pattern === input?.contraindicatedPattern ? { knee: true } : {},
    exerciseEquipment: [
      {
        equipment: {
          type:
            pattern === input?.incompatiblePattern
              ? "BARBELL"
              : "BODYWEIGHT",
        },
      },
    ],
  }));
}

function infeasibilityInput() {
  return {
    userId: "user-1",
    name: "Strength",
    startDate: new Date("2026-08-03T00:00:00.000Z"),
    configuration: {
      emphasis: "BALANCED" as const,
      daysPerWeek: 2 as const,
      sessionDurationMinutes: 90 as const,
      equipmentProfile: "BODYWEIGHT" as const,
      preferredLifts: {
        squat: "AUTO" as const,
        press: "AUTO" as const,
        hinge: "AUTO" as const,
      },
    },
  };
}

describe("plan lifecycle derivation", () => {
  it("keeps generated plans PREPARING until explicit finalization", () => {
    expect(
      derivePlanLifecycle([
        mesocycle("meso-1", MesocycleState.ACTIVE_ACCUMULATION),
      ]),
    ).toEqual({
      status: "PREPARING",
      activeMesocycleId: null,
      reviewMesocycleId: "meso-1",
    });
  });

  it("marks exactly one valid active mesocycle READY", () => {
    expect(
      derivePlanLifecycle([
        mesocycle("meso-1", MesocycleState.ACTIVE_ACCUMULATION, true),
      ]),
    ).toMatchObject({
      status: "READY",
      activeMesocycleId: "meso-1",
    });
  });

  it("fails closed for ambiguous or handoff-conflicted plan state", () => {
    expect(derivePlanLifecycle([]).status).toBe("INVALID");
    expect(
      derivePlanLifecycle([
        mesocycle("meso-1", MesocycleState.ACTIVE_DELOAD),
      ]).status,
    ).toBe("INVALID");
    expect(
      derivePlanLifecycle([
        mesocycle("meso-1", MesocycleState.ACTIVE_ACCUMULATION, true, 1),
        mesocycle("meso-2", MesocycleState.ACTIVE_DELOAD, true, 2),
      ]).status,
    ).toBe("INVALID");
    expect(
      derivePlanLifecycle([
        mesocycle("meso-1", MesocycleState.AWAITING_HANDOFF),
      ]).status,
    ).toBe("HANDOFF_PENDING");
  });
});

describe("plan management persistence policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only owner-scoped non-archived supported plans", async () => {
    mocks.userFindUnique.mockResolvedValue({
      activeMacroCycleId: "plan-a",
      macroCycles: [],
    });

    await expect(loadPlanManagementData("user-1")).resolves.toEqual({
      activeMacroCycleId: "plan-a",
      plans: [],
    });
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: expect.objectContaining({
        macroCycles: expect.objectContaining({
          where: {
            archivedAt: null,
            primaryGoal: { in: ["HYPERTROPHY", "STRENGTH"] },
          },
        }),
      }),
    });
  });

  it("keeps the legacy plan-summary response unchanged when custom drafts are excluded", async () => {
    const timestamp = new Date("2026-08-04T00:00:00.000Z");
    mocks.userFindUnique.mockResolvedValue({
      activeMacroCycleId: null,
      macroCycles: [
        {
          id: "legacy-plan",
          name: "Legacy plan",
          primaryGoal: "HYPERTROPHY",
          startDate: timestamp,
          endDate: new Date("2026-09-08T00:00:00.000Z"),
          durationWeeks: 5,
          createdAt: timestamp,
          updatedAt: timestamp,
          mesocycles: [
            mesocycle("legacy-meso", MesocycleState.ACTIVE_ACCUMULATION, true),
          ],
        },
      ],
    });

    const result = await loadPlanManagementData("user-1");
    expect(result.plans[0]).not.toHaveProperty("sessionsPerWeek");
    expect(result.plans[0]).not.toHaveProperty("editableCopyAvailable");
    const select = mocks.userFindUnique.mock.calls[0]![0].select.macroCycles.select;
    expect(select).not.toHaveProperty("hypertrophyDraft");
  });

  it("creates a deterministic strength draft without changing the active pointer", async () => {
    const startDate = new Date("2026-08-03T00:00:00.000Z");
    const endDate = new Date("2026-09-07T00:00:00.000Z");
    mocks.userFindUnique.mockResolvedValue({
      activeMacroCycleId: "hypertrophy-plan",
      profile: { trainingAge: "INTERMEDIATE" },
      injuries: [{ bodyPart: "shoulder" }],
    });
    mocks.exerciseFindMany.mockResolvedValue(
      [
        ["squat", "Barbell Back Squat", "SQUAT"],
        ["hinge", "Conventional Deadlift", "HINGE"],
        ["bench", "Barbell Bench Press", "HORIZONTAL_PUSH"],
        ["press", "Barbell Overhead Press", "VERTICAL_PUSH"],
        ["row", "Barbell Row", "HORIZONTAL_PULL"],
        ["pull-up", "Pull-Up", "VERTICAL_PULL"],
      ].map(([id, name, pattern]) => ({
        id,
        name,
        movementPatterns: [pattern],
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 3,
        contraindications: {},
        exerciseEquipment: [
          {
            equipment: {
              type: id === "pull-up" ? "BODYWEIGHT" : "BARBELL",
            },
          },
        ],
      })),
    );
    mocks.generateMacroCycle.mockReturnValue({
      id: "strength-plan",
      startDate,
      endDate,
      durationWeeks: 5,
      mesocycles: [
        {
          id: "strength-meso",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          focus: "Strength",
          volumeTarget: "moderate",
          intensityBias: "strength",
          blocks: [
            {
              id: "strength-block",
              blockNumber: 1,
              blockType: "accumulation",
              startWeek: 0,
              durationWeeks: 2,
              volumeTarget: "moderate",
              intensityBias: "strength",
              adaptationType: "myofibrillar_hypertrophy",
            },
          ],
        },
      ],
    });
    mocks.macroCycleCreate.mockResolvedValue({
      id: "strength-plan",
      name: "Fall Strength",
      primaryGoal: "STRENGTH",
      startDate,
      endDate,
      durationWeeks: 5,
      createdAt: startDate,
      updatedAt: startDate,
      mesocycles: [
        mesocycle(
          "strength-meso",
          MesocycleState.ACTIVE_ACCUMULATION,
        ),
      ],
    });

    await expect(
      createStrengthPlan({
        userId: "user-1",
        name: "Fall Strength",
        startDate,
        configuration: {
          emphasis: "BALANCED",
          daysPerWeek: 4,
          sessionDurationMinutes: 60,
          equipmentProfile: "FULL_GYM",
          preferredLifts: {
            squat: "BACK_SQUAT",
            press: "BARBELL_BENCH",
            hinge: "CONVENTIONAL_DEADLIFT",
          },
        },
      }),
    ).resolves.toMatchObject({
      id: "strength-plan",
      primaryGoal: "STRENGTH",
      status: "PREPARING",
      isActive: false,
    });
    expect(mocks.generateMacroCycle).toHaveBeenCalledWith({
      userId: "user-1",
      startDate,
      durationWeeks: 5,
      trainingAge: "intermediate",
      primaryGoal: "strength",
    });
    expect(mocks.macroCycleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          primaryGoal: "STRENGTH",
          mesocycles: {
            create: expect.objectContaining({
              isActive: false,
              sessionsPerWeek: 4,
              splitType: "UPPER_LOWER",
              slotSequenceJson: expect.objectContaining({
                source: "strength_plan_policy_v1",
              }),
              slotPlanSeedJson: expect.objectContaining({
                source: "strength_plan_policy_v1",
              }),
            }),
          },
        }),
      }),
    );
    const strengthCreateInput = mocks.macroCycleCreate.mock.calls[0]?.[0];
    const serializedExercises =
      strengthCreateInput.data.mesocycles.create.slotPlanSeedJson.slots.flatMap(
        (slot: { exercises: Array<{ setCount: number }> }) => slot.exercises,
      );
    expect(serializedExercises.length).toBeGreaterThan(0);
    expect(
      serializedExercises.every(
        (exercise: { setCount: number }) =>
          Number.isInteger(exercise.setCount) && exercise.setCount > 0,
      ),
    ).toBe(true);
    expect(mocks.prisma.user).not.toHaveProperty("updateMany");
  });

  it.each([
    ["squat", "SQUAT"],
    ["press", "HORIZONTAL_PUSH"],
    ["hinge", "HINGE"],
  ])(
    "returns creation infeasibility before mutation when equipment removes the required %s lane",
    async (_lane, pattern) => {
      mocks.userFindUnique.mockResolvedValue({
        activeMacroCycleId: null,
        profile: { trainingAge: "INTERMEDIATE" },
        injuries: [],
      });
      mocks.exerciseFindMany.mockResolvedValue(
        strengthExerciseRows({ incompatiblePattern: pattern }),
      );

      await expect(
        createStrengthPlan(infeasibilityInput()),
      ).rejects.toMatchObject({
        code: "PLAN_CREATION_INFEASIBLE",
      });
      expect(mocks.generateMacroCycle).not.toHaveBeenCalled();
      expect(mocks.macroCycleCreate).not.toHaveBeenCalled();
    },
  );

  it("returns creation infeasibility before mutation when limitations remove a required lane", async () => {
    mocks.userFindUnique.mockResolvedValue({
      activeMacroCycleId: null,
      profile: { trainingAge: "INTERMEDIATE" },
      injuries: [{ bodyPart: "knee" }],
    });
    mocks.exerciseFindMany.mockResolvedValue(
      strengthExerciseRows({ contraindicatedPattern: "SQUAT" }),
    );

    await expect(
      createStrengthPlan(infeasibilityInput()),
    ).rejects.toMatchObject({
      code: "PLAN_CREATION_INFEASIBLE",
    });
    expect(mocks.generateMacroCycle).not.toHaveBeenCalled();
    expect(mocks.macroCycleCreate).not.toHaveBeenCalled();
  });

  it("does not mislabel an unexpected construction failure as user-correctable infeasibility", async () => {
    mocks.userFindUnique.mockResolvedValue({
      activeMacroCycleId: null,
      profile: { trainingAge: "INTERMEDIATE" },
      injuries: [],
    });
    mocks.exerciseFindMany.mockResolvedValue(
      strengthExerciseRows(),
    );
    const invalidDirectInput = infeasibilityInput();
    invalidDirectInput.configuration.sessionDurationMinutes = 1 as 90;

    await expect(
      createStrengthPlan(invalidDirectInput),
    ).rejects.toThrow(/^STRENGTH_PLAN_DURATION_UNACHIEVABLE:/);
    expect(mocks.generateMacroCycle).not.toHaveBeenCalled();
    expect(mocks.macroCycleCreate).not.toHaveBeenCalled();
  });

  it("finalizes strength as READY with an accepted immutable seed and no selection write", async () => {
    const timestamp = new Date("2026-07-27T01:00:00.000Z");
    const seed = {
      version: 1,
      source: "strength_plan_policy_v1",
      slots: [
        {
          slotId: "strength_lower_a",
          exercises: [
            {
              exerciseId: "squat",
              role: "CORE_COMPOUND",
              setCount: 4,
            },
          ],
        },
      ],
    };
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "strength-plan",
      primaryGoal: "STRENGTH",
      updatedAt: timestamp,
      mesocycles: [
        {
          ...mesocycle(
            "strength-meso",
            MesocycleState.ACTIVE_ACCUMULATION,
          ),
          slotPlanSeedJson: seed,
          currentSeedRevisionId: null,
        },
      ],
    });
    mocks.tx.macroCycle.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.mesocycle.updateMany.mockResolvedValue({ count: 1 });
    mocks.createInitialAcceptedSeedRevision.mockResolvedValue({
      id: "seed-revision-1",
    });
    mocks.tx.macroCycle.findUniqueOrThrow.mockResolvedValue({
      id: "strength-plan",
      name: "Fall Strength",
      primaryGoal: "STRENGTH",
      startDate: timestamp,
      endDate: new Date("2026-08-31T01:00:00.000Z"),
      durationWeeks: 5,
      createdAt: timestamp,
      updatedAt: new Date(timestamp.getTime() + 1),
      mesocycles: [
        mesocycle(
          "strength-meso",
          MesocycleState.ACTIVE_ACCUMULATION,
          true,
        ),
      ],
    });
    mocks.tx.user.findUniqueOrThrow.mockResolvedValue({
      activeMacroCycleId: "hypertrophy-plan",
    });

    await expect(
      finalizePlan({
        userId: "user-1",
        planId: "strength-plan",
        expectedUpdatedAt: timestamp.toISOString(),
      }),
    ).resolves.toMatchObject({
      status: "READY",
      isActive: false,
      activeMesocycleId: "strength-meso",
    });
    expect(mocks.createInitialAcceptedSeedRevision).toHaveBeenCalledWith(
      mocks.tx,
      {
        mesocycleId: "strength-meso",
        seedPayload: seed,
        creationReason: "strength_plan_finalization",
        actorSource: "plan_management",
      },
    );
    expect(mocks.tx.user.findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed Strength seed counts during finalization", async () => {
    const timestamp = new Date("2026-07-27T01:00:00.000Z");
    mocks.tx.macroCycle.findFirst.mockResolvedValue({
      id: "strength-plan",
      primaryGoal: "STRENGTH",
      updatedAt: timestamp,
      mesocycles: [
        {
          ...mesocycle(
            "strength-meso",
            MesocycleState.ACTIVE_ACCUMULATION,
          ),
          slotPlanSeedJson: {
            version: 1,
            source: "strength_plan_policy_v1",
            slots: [
              {
                slotId: "strength_lower_a",
                exercises: [
                  {
                    exerciseId: "squat",
                    role: "CORE_COMPOUND",
                  },
                ],
              },
            ],
          },
          currentSeedRevisionId: null,
        },
      ],
    });
    mocks.tx.macroCycle.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.mesocycle.updateMany.mockResolvedValue({ count: 1 });
    mocks.createInitialAcceptedSeedRevision.mockRejectedValue(
      new Error(
        "ACCEPTED_SEED_SET_COUNT_MISSING:strength_lower_a:squat",
      ),
    );

    await expect(
      finalizePlan({
        userId: "user-1",
        planId: "strength-plan",
        expectedUpdatedAt: timestamp.toISOString(),
      }),
    ).rejects.toMatchObject({ code: "PLAN_INVALID" });
    expect(mocks.tx.macroCycle.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mocks.tx.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("creates a generated plan as inactive PREPARING without changing the active pointer", async () => {
    const startDate = new Date("2026-08-03T00:00:00.000Z");
    const endDate = new Date("2026-11-22T00:00:00.000Z");
    mocks.userFindUnique.mockResolvedValue({
      activeMacroCycleId: "plan-a",
      profile: { trainingAge: "INTERMEDIATE" },
    });
    mocks.generateMacroCycle.mockReturnValue({
      id: "plan-b",
      startDate,
      endDate,
      durationWeeks: 16,
      mesocycles: [
        {
          id: "meso-b1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 4,
          focus: "Accumulation",
          volumeTarget: "moderate",
          intensityBias: "moderate",
          blocks: [
            {
              id: "block-b1",
              blockNumber: 1,
              blockType: "accumulation",
              startWeek: 0,
              durationWeeks: 4,
              volumeTarget: "moderate",
              intensityBias: "moderate",
              adaptationType: "hypertrophy",
            },
          ],
        },
      ],
    });
    mocks.macroCycleCreate.mockResolvedValue({
      id: "plan-b",
      name: "Second Plan",
      primaryGoal: "HYPERTROPHY",
      startDate,
      endDate,
      durationWeeks: 16,
      createdAt: startDate,
      updatedAt: startDate,
      mesocycles: [
        mesocycle("meso-b1", MesocycleState.ACTIVE_ACCUMULATION),
      ],
    });

    await expect(
      createHypertrophyPlan({
        userId: "user-1",
        name: "Second Plan",
        startDate,
        durationWeeks: 16,
      }),
    ).resolves.toMatchObject({
      id: "plan-b",
      status: "PREPARING",
      isActive: false,
    });
    expect(mocks.generateMacroCycle).toHaveBeenCalledWith({
      userId: "user-1",
      startDate,
      durationWeeks: 16,
      trainingAge: "intermediate",
      primaryGoal: "hypertrophy",
    });
    expect(mocks.macroCycleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "plan-b",
          userId: "user-1",
          name: "Second Plan",
          mesocycles: {
            create: [
              expect.objectContaining({
                id: "meso-b1",
                isActive: false,
              }),
            ],
          },
        }),
      }),
    );
  });

  it("resolves explicit review identity with the owner in the database predicate", async () => {
    mocks.userFindUnique.mockResolvedValue({ activeMacroCycleId: "plan-a" });
    mocks.macroCycleFindFirst.mockResolvedValue(null);

    await expect(loadPlanReview("user-1", "foreign-plan")).resolves.toBeNull();
    expect(mocks.macroCycleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "foreign-plan",
          userId: "user-1",
          archivedAt: null,
          primaryGoal: { in: ["HYPERTROPHY", "STRENGTH"] },
        },
      }),
    );
  });

  it("returns strength configuration and weekly structure for review", async () => {
    const timestamp = new Date("2026-08-03T00:00:00.000Z");
    mocks.userFindUnique.mockResolvedValue({
      activeMacroCycleId: "hypertrophy-plan",
    });
    mocks.macroCycleFindFirst.mockResolvedValue({
      id: "strength-plan",
      name: "Fall Strength",
      primaryGoal: "STRENGTH",
      startDate: timestamp,
      endDate: new Date("2026-09-07T00:00:00.000Z"),
      durationWeeks: 5,
      createdAt: timestamp,
      updatedAt: timestamp,
      mesocycles: [
        {
          id: "strength-meso",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          focus: "Balanced Strength",
          volumeTarget: "MODERATE",
          intensityBias: "STRENGTH",
          state: MesocycleState.ACTIVE_ACCUMULATION,
          isActive: false,
          _count: { blocks: 3 },
          slotSequenceJson: {
            version: 1,
            source: "strength_plan_policy_v1",
            sequenceMode: "ordered_flexible",
            strengthConfiguration: {
              version: 1,
              emphasis: "BALANCED",
              daysPerWeek: 4,
              sessionDurationMinutes: 60,
              equipmentProfile: "FULL_GYM",
              preferredLifts: {
                squat: "BACK_SQUAT",
                press: "BARBELL_BENCH",
                hinge: "CONVENTIONAL_DEADLIFT",
              },
            },
            slots: [
              {
                slotId: "strength_lower_a",
                label: "Lower A · Squat",
                intent: "LOWER",
                estimatedMinutes: 55,
              },
            ],
          },
          slotPlanSeedJson: {
            version: 1,
            source: "strength_plan_policy_v1",
            slots: [
              {
                slotId: "strength_lower_a",
                exercises: [
                  {
                    exerciseId: "squat",
                    name: "Barbell Back Squat",
                    role: "CORE_COMPOUND",
                    setCount: 4,
                  },
                  {
                    exerciseId: "rdl",
                    name: "Romanian Deadlift",
                    role: "ACCESSORY",
                    setCount: 2,
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    await expect(
      loadPlanReview("user-1", "strength-plan"),
    ).resolves.toMatchObject({
      primaryGoal: "STRENGTH",
      status: "PREPARING",
      isActive: false,
      strengthConfiguration: {
        emphasis: "BALANCED",
        daysPerWeek: 4,
        sessionDurationMinutes: 60,
      },
      weeklyStructure: [
        {
          slotId: "strength_lower_a",
          label: "Lower A · Squat",
          intent: "LOWER",
          estimatedMinutes: 55,
          primaryLifts: [
            {
              exerciseId: "squat",
              name: "Barbell Back Squat",
              role: "CORE_COMPOUND",
              setCount: 4,
            },
          ],
          assistance: [
            {
              exerciseId: "rdl",
              name: "Romanian Deadlift",
              role: "ACCESSORY",
              setCount: 2,
            },
          ],
        },
      ],
    });
  });

  it("prefers accepted revision roles and set counts in Strength review", async () => {
    const timestamp = new Date("2026-08-03T00:00:00.000Z");
    mocks.userFindUnique.mockResolvedValue({
      activeMacroCycleId: "strength-plan",
    });
    mocks.macroCycleFindFirst.mockResolvedValue({
      id: "strength-plan",
      name: "Fall Strength",
      primaryGoal: "STRENGTH",
      startDate: timestamp,
      endDate: new Date("2026-09-07T00:00:00.000Z"),
      durationWeeks: 5,
      createdAt: timestamp,
      updatedAt: timestamp,
      mesocycles: [
        {
          id: "strength-meso",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          focus: "Balanced Strength",
          volumeTarget: "MODERATE",
          intensityBias: "STRENGTH",
          state: MesocycleState.ACTIVE_ACCUMULATION,
          isActive: true,
          _count: { blocks: 3 },
          slotSequenceJson: {
            version: 1,
            source: "strength_plan_policy_v1",
            strengthConfiguration: {
              version: 1,
              emphasis: "BALANCED",
              daysPerWeek: 2,
              sessionDurationMinutes: 45,
              equipmentProfile: "FULL_GYM",
              preferredLifts: {
                squat: "AUTO",
                press: "AUTO",
                hinge: "AUTO",
              },
            },
            slots: [
              {
                slotId: "strength_full_body_a",
                label: "Full Body A",
                intent: "FULL_BODY",
                estimatedMinutes: 45,
              },
            ],
          },
          slotPlanSeedJson: {
            version: 1,
            source: "strength_plan_policy_v1",
            slots: [
              {
                slotId: "strength_full_body_a",
                exercises: [
                  {
                    exerciseId: "squat",
                    name: "Barbell Back Squat",
                    role: "CORE_COMPOUND",
                    setCount: 4,
                  },
                ],
              },
            ],
          },
          currentSeedRevision: {
            seedPayload: {
              version: 1,
              source: "strength_plan_policy_v1",
              slots: [
                {
                  slotId: "strength_full_body_a",
                  exercises: [
                    {
                      exerciseId: "squat",
                      role: "CORE_COMPOUND",
                      setCount: 3,
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    });

    const review = await loadPlanReview("user-1", "strength-plan");

    expect(review?.weeklyStructure[0]?.primaryLifts).toEqual([
      {
        exerciseId: "squat",
        name: "Barbell Back Squat",
        role: "CORE_COMPOUND",
        setCount: 3,
      },
    ]);
  });

  it("reviews accepted V3 custom plans with their V3 editable envelope", async () => {
    const timestamp = new Date("2026-08-03T00:00:00.000Z");
    const measurement = {
      profile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "TOTAL",
    };
    const seedPayload = {
      version: 3,
      source: "custom_hypertrophy_plan_v1",
      settings: {
        equipmentProfile: "FULL_GYM",
        sessionDurationMinutes: 60,
      },
      slots: [
        {
          slotId: "upper",
          name: "Upper Strength Bias",
          focus: "UPPER",
          exercises: [{
            exerciseId: "bench",
            role: "CORE_COMPOUND",
            setCount: 4,
            intent: {
              userRole: "PRIMARY_LIFT",
              target: {
                kind: "movement_pattern",
                movementPattern: "horizontal_push",
              },
            },
            measurement,
          }],
        },
        {
          slotId: "lower",
          name: "Lower Volume",
          focus: "LOWER",
          exercises: [{
            exerciseId: "curl",
            role: "ACCESSORY",
            setCount: 3,
            intent: {
              userRole: "ACCESSORY",
              target: { kind: "muscle", muscleId: "hamstrings" },
            },
            measurement,
          }],
        },
      ],
    };
    mocks.userFindUnique.mockResolvedValue({ activeMacroCycleId: "custom-plan" });
    mocks.exerciseFindMany.mockResolvedValue([
      { id: "bench", name: "Machine Chest Press" },
      { id: "curl", name: "Leg Curl" },
    ]);
    mocks.macroCycleFindFirst.mockResolvedValue({
      id: "custom-plan",
      name: "Custom Hypertrophy",
      primaryGoal: "HYPERTROPHY",
      startDate: timestamp,
      endDate: new Date("2026-09-07T00:00:00.000Z"),
      durationWeeks: 5,
      createdAt: timestamp,
      updatedAt: timestamp,
      mesocycles: [{
        id: "custom-meso",
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 5,
        focus: "Hypertrophy",
        volumeTarget: "MODERATE",
        intensityBias: "HYPERTROPHY",
        state: MesocycleState.ACTIVE_ACCUMULATION,
        isActive: true,
        _count: { blocks: 3 },
        slotSequenceJson: null,
        slotPlanSeedJson: null,
        currentSeedRevision: { seedPayload },
      }],
    });

    await expect(
      loadPlanReview("user-1", "custom-plan", {
        includeCustomPlanMetadata: true,
      }),
    ).resolves.toMatchObject({
      editableCopyAvailable: true,
      weeklyStructure: [
        {
          slotId: "upper",
          label: "Upper Strength Bias",
          intent: "UPPER",
          primaryLifts: [{
            exerciseId: "bench",
            name: "Machine Chest Press",
            setCount: 4,
          }],
        },
        {
          slotId: "lower",
          label: "Lower Volume",
          intent: "LOWER",
          assistance: [{
            exerciseId: "curl",
            name: "Leg Curl",
            setCount: 3,
          }],
        },
      ],
    });
  });

  it.each([
    {
      label: "missing",
      exercise: {
        exerciseId: "squat",
        name: "Barbell Back Squat",
        role: "CORE_COMPOUND",
      },
    },
    {
      label: "malformed",
      exercise: {
        exerciseId: "squat",
        name: "Barbell Back Squat",
        role: "CORE_COMPOUND",
        setCount: 0,
      },
    },
  ])("fails Strength review closed for $label set counts", async ({ exercise }) => {
    const timestamp = new Date("2026-08-03T00:00:00.000Z");
    mocks.userFindUnique.mockResolvedValue({ activeMacroCycleId: null });
    mocks.macroCycleFindFirst.mockResolvedValue({
      id: "strength-plan",
      name: "Invalid Strength",
      primaryGoal: "STRENGTH",
      startDate: timestamp,
      endDate: timestamp,
      durationWeeks: 5,
      createdAt: timestamp,
      updatedAt: timestamp,
      mesocycles: [
        {
          id: "strength-meso",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          focus: "Strength",
          volumeTarget: "MODERATE",
          intensityBias: "STRENGTH",
          state: MesocycleState.ACTIVE_ACCUMULATION,
          isActive: false,
          _count: { blocks: 1 },
          currentSeedRevision: null,
          slotSequenceJson: {
            version: 1,
            source: "strength_plan_policy_v1",
            slots: [
              {
                slotId: "strength_full_body_a",
                intent: "FULL_BODY",
              },
            ],
          },
          slotPlanSeedJson: {
            version: 1,
            source: "strength_plan_policy_v1",
            slots: [
              {
                slotId: "strength_full_body_a",
                exercises: [exercise],
              },
            ],
          },
        },
      ],
    });

    await expect(
      loadPlanReview("user-1", "strength-plan"),
    ).resolves.toMatchObject({ weeklyStructure: [] });
  });

  it("returns clear validation details for an unrecognized active Strength limitation", async () => {
    mocks.userFindUnique.mockResolvedValue({
      activeMacroCycleId: null,
      profile: { trainingAge: "INTERMEDIATE" },
      injuries: [{ bodyPart: "left ankle" }],
    });
    mocks.exerciseFindMany.mockResolvedValue([]);

    await expect(
      createStrengthPlan({
        userId: "user-1",
        name: "Strength",
        startDate: new Date("2026-08-03T00:00:00.000Z"),
        configuration: {
          emphasis: "BALANCED",
          daysPerWeek: 2,
          sessionDurationMinutes: 45,
          equipmentProfile: "FULL_GYM",
          preferredLifts: {
            squat: "AUTO",
            press: "AUTO",
            hinge: "AUTO",
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "PLAN_LIMITATION_UNRECOGNIZED",
      details: { limitation: "left ankle" },
    });
    expect(mocks.macroCycleCreate).not.toHaveBeenCalled();
  });

  it("preserves unrecognized-limitation precedence for mixed limitation input", async () => {
    mocks.userFindUnique.mockResolvedValue({
      activeMacroCycleId: null,
      profile: { trainingAge: "INTERMEDIATE" },
      injuries: [{ bodyPart: "knee" }, { bodyPart: "left ankle" }],
    });
    mocks.exerciseFindMany.mockResolvedValue(strengthExerciseRows());

    await expect(
      createStrengthPlan(infeasibilityInput()),
    ).rejects.toMatchObject({
      code: "PLAN_LIMITATION_UNRECOGNIZED",
      details: { limitation: "left ankle" },
    });
    expect(mocks.generateMacroCycle).not.toHaveBeenCalled();
    expect(mocks.macroCycleCreate).not.toHaveBeenCalled();
  });

  it("distinguishes an owned archived activation target without exposing foreign plans", async () => {
    mocks.macroCycleFindFirst
      .mockResolvedValueOnce({
        archivedAt: new Date("2026-07-27T03:00:00.000Z"),
        mesocycles: [],
      })
      .mockResolvedValueOnce(null);

    await expect(
      loadPlanActivationTarget("user-1", "archived-plan"),
    ).resolves.toEqual({ status: "ARCHIVED" });
    await expect(
      loadPlanActivationTarget("user-1", "foreign-plan"),
    ).resolves.toEqual({ status: "NOT_FOUND" });
    expect(mocks.macroCycleFindFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: "archived-plan",
          userId: "user-1",
          primaryGoal: { in: ["HYPERTROPHY", "STRENGTH"] },
        },
      }),
    );
  });

  it("normalizes stale rename failures into deterministic conflicts", async () => {
    mocks.macroCycleUpdateMany.mockResolvedValue({ count: 0 });
    mocks.macroCycleFindFirst.mockResolvedValue({
      updatedAt: new Date("2026-07-27T02:00:00.000Z"),
    });

    await expect(
      renamePlan({
        userId: "user-1",
        planId: "plan-a",
        name: "Renamed",
        expectedUpdatedAt: "2026-07-27T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "PLAN_MUTATION_CONFLICT",
      details: { currentUpdatedAt: "2026-07-27T02:00:00.000Z" },
    });
  });

  it("prevents archiving the active plan before any plan write", async () => {
    mocks.tx.user.findUnique.mockResolvedValue({
      activeMacroCycleId: "plan-a",
    });

    await expect(
      archivePlan({
        userId: "user-1",
        planId: "plan-a",
        expectedUpdatedAt: "2026-07-27T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "ACTIVE_PLAN_ARCHIVE_FORBIDDEN",
    });
    expect(mocks.tx.macroCycle.updateMany).not.toHaveBeenCalled();
  });
});
