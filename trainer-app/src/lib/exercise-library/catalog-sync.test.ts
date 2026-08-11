import { describe, expect, it, vi } from "vitest";
import {
  applyCatalogSyncPlan,
  buildCatalogSyncPlan,
  isCatalogSyncPlanClean,
  printCatalogSyncPlan,
  type ExerciseLibrarySnapshot,
} from "../../../scripts/sync-exercise-library";

const machineHipThrust = {
  name: "Machine Hip Thrust",
  movementPatterns: ["hinge"],
  splitTag: "legs",
  isCompound: false,
  isMainLiftEligible: false,
  jointStress: "low",
  equipment: ["Machine"],
  fatigueCost: 2,
  sfrScore: 4,
  lengthPositionScore: 4,
  stimulusBias: ["metabolic"],
  contraindications: null,
  primaryMuscles: ["Glutes"],
  secondaryMuscles: ["Hamstrings"],
  difficulty: "beginner",
  unilateral: false,
  repRangeRecommendation: { min: 8, max: 15 },
};

const baseSnapshot: ExerciseLibrarySnapshot = {
  exercises: [],
  muscles: [
    { id: "muscle-glutes", name: "Glutes" },
    { id: "muscle-hamstrings", name: "Hamstrings" },
  ],
  equipment: [{ id: "equipment-machine", name: "Machine" }],
};

function snapshotExercise(
  name: string,
  aliases: Array<{ alias: string; exerciseId: string }> = [],
): ExerciseLibrarySnapshot["exercises"][number] {
  return {
    id: `exercise-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    movementPatterns: ["HINGE"],
    splitTags: ["LEGS"],
    jointStress: "LOW",
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    stimulusBias: ["METABOLIC"],
    contraindications: null,
    timePerSetSec: 120,
    sfrScore: 4,
    lengthPositionScore: 4,
    difficulty: "BEGINNER",
    isUnilateral: false,
    repRangeMin: 8,
    repRangeMax: 15,
    measurementProfile: null,
    loadConvention: null,
    repBasis: null,
    aliases,
    exerciseMuscles: [
      { role: "PRIMARY", muscle: { id: "muscle-glutes", name: "Glutes" } },
      { role: "SECONDARY", muscle: { id: "muscle-hamstrings", name: "Hamstrings" } },
    ],
    exerciseEquipment: [
      { equipment: { id: "equipment-machine", name: "Machine", type: "MACHINE" } },
    ],
  };
}

function createFakeCatalogDb(snapshot: ExerciseLibrarySnapshot) {
  const calls: string[] = [];
  const exercisesByName = new Map(snapshot.exercises.map((exercise) => [exercise.name, exercise]));
  let nextExerciseId = 1;

  return {
    calls,
    db: {
      exercise: {
        findMany: async () => [...exercisesByName.values()],
        create: async ({ data }: { data: Record<string, unknown> }) => {
          calls.push("exercise.create");
          const created = { id: `exercise-${nextExerciseId++}`, name: data.name as string };
          exercisesByName.set(created.name, {
            ...created,
            movementPatterns: data.movementPatterns as string[],
            splitTags: data.splitTags as string[],
            jointStress: data.jointStress as string,
            isMainLiftEligible: data.isMainLiftEligible as boolean,
            isCompound: data.isCompound as boolean,
            fatigueCost: data.fatigueCost as number,
            stimulusBias: data.stimulusBias as string[],
            contraindications: data.contraindications,
            timePerSetSec: data.timePerSetSec as number,
            sfrScore: data.sfrScore as number,
            lengthPositionScore: data.lengthPositionScore as number,
            difficulty: data.difficulty as string,
            isUnilateral: data.isUnilateral as boolean,
            repRangeMin: data.repRangeMin as number,
            repRangeMax: data.repRangeMax as number,
            aliases: [],
            exerciseMuscles: [],
            exerciseEquipment: [],
          });
          return created;
        },
        update: async () => {
          calls.push("exercise.update");
        },
      },
      muscle: {
        findMany: async () => snapshot.muscles,
      },
      equipment: {
        findMany: async () => snapshot.equipment,
      },
      exerciseMuscle: {
        deleteMany: async () => {
          calls.push("exerciseMuscle.deleteMany");
        },
        createMany: async () => {
          calls.push("exerciseMuscle.createMany");
        },
      },
      exerciseEquipment: {
        deleteMany: async () => {
          calls.push("exerciseEquipment.deleteMany");
        },
        createMany: async () => {
          calls.push("exerciseEquipment.createMany");
        },
      },
      exerciseAlias: {
        upsert: async () => {
          calls.push("exerciseAlias.upsert");
        },
      },
    },
  };
}

describe("catalog-only exercise library sync", () => {
  it("plans missing catalog rows and aliases without deletes", () => {
    const plan = buildCatalogSyncPlan(
      [machineHipThrust],
      [{ exerciseName: "Machine Hip Thrust", alias: "Glute Drive" }],
      baseSnapshot,
    );

    expect(plan).toMatchObject({
      missingInDb: ["Machine Hip Thrust"],
      extraInDb: [],
      fieldMismatches: [],
      plannedExerciseCreates: ["Machine Hip Thrust"],
      plannedExerciseUpdates: [],
      plannedExerciseDeletes: [],
      plannedAliasCreates: [{ exerciseName: "Machine Hip Thrust", alias: "Glute Drive" }],
    });
  });

  it("plans only the decline alias reassignment when the flat-bench relation exists", () => {
    const flat = { ...machineHipThrust, name: "Barbell Bench Press" };
    const decline = { ...machineHipThrust, name: "Decline Barbell Bench Press" };
    const flatDb = snapshotExercise("Barbell Bench Press");
    flatDb.aliases = [
      { alias: "Decline Barbell Bench", exerciseId: flatDb.id },
    ];
    const declineDb = snapshotExercise("Decline Barbell Bench Press");

    const plan = buildCatalogSyncPlan(
      [flat, decline],
      [
        {
          exerciseName: "Decline Barbell Bench Press",
          alias: "Decline Barbell Bench",
        },
      ],
      { ...baseSnapshot, exercises: [flatDb, declineDb] },
    );

    expect(plan.plannedAliasUpdates).toEqual([
      {
        exerciseName: "Decline Barbell Bench Press",
        alias: "Decline Barbell Bench",
        fromExerciseName: "Barbell Bench Press",
      },
    ]);
    expect(plan.plannedAliasCreates).toEqual([]);
    expect(plan.skippedAliases).toEqual([]);
  });

  it("dry-run planning is read-only", () => {
    const { calls } = createFakeCatalogDb(baseSnapshot);

    buildCatalogSyncPlan([machineHipThrust], [], baseSnapshot);

    expect(calls).toEqual([]);
  });

  it("applies only exercise catalog tables", async () => {
    const plan = buildCatalogSyncPlan(
      [machineHipThrust],
      [{ exerciseName: "Machine Hip Thrust", alias: "Glute Drive" }],
      baseSnapshot,
    );
    const { db, calls } = createFakeCatalogDb(baseSnapshot);

    const result = await applyCatalogSyncPlan(
      db,
      [machineHipThrust],
      [{ exerciseName: "Machine Hip Thrust", alias: "Glute Drive" }],
      baseSnapshot,
      plan,
    );

    expect(result).toMatchObject({
      exercisesCreated: 1,
      exercisesUpdated: 0,
      exercisesDeleted: 0,
      aliasesUpserted: 1,
    });
    expect(new Set(calls)).toEqual(
      new Set([
        "exercise.create",
        "exerciseMuscle.deleteMany",
        "exerciseMuscle.createMany",
        "exerciseEquipment.deleteMany",
        "exerciseEquipment.createMany",
        "exerciseAlias.upsert",
      ]),
    );
    expect(calls.some((call) => call.includes("user"))).toBe(false);
    expect(calls.some((call) => call.includes("workoutTemplate"))).toBe(false);
  });

  it("does not rebuild unchanged mappings for a measurement-only update", async () => {
    const snapshot: ExerciseLibrarySnapshot = {
      ...baseSnapshot,
      exercises: [
        {
          id: "exercise-1",
          name: "Machine Hip Thrust",
          movementPatterns: ["HINGE"],
          splitTags: ["LEGS"],
          jointStress: "LOW",
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
          stimulusBias: ["METABOLIC"],
          contraindications: null,
          timePerSetSec: 120,
          sfrScore: 4,
          lengthPositionScore: 4,
          difficulty: "BEGINNER",
          isUnilateral: false,
          repRangeMin: 8,
          repRangeMax: 15,
          measurementProfile: null,
          loadConvention: null,
          repBasis: null,
          aliases: [],
          exerciseMuscles: [
            { role: "PRIMARY", muscle: { id: "muscle-glutes", name: "Glutes" } },
            { role: "SECONDARY", muscle: { id: "muscle-hamstrings", name: "Hamstrings" } },
          ],
          exerciseEquipment: [
            { equipment: { id: "equipment-machine", name: "Machine", type: "MACHINE" } },
          ],
        },
      ],
    };
    const classified = {
      ...machineHipThrust,
      measurementProfile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "TOTAL",
    };
    const plan = buildCatalogSyncPlan([classified], [], snapshot);
    const { db, calls } = createFakeCatalogDb(snapshot);

    const result = await applyCatalogSyncPlan(db, [classified], [], snapshot, plan);

    expect(plan.fieldMismatches).toEqual([
      {
        exerciseName: "Machine Hip Thrust",
        fields: ["measurementProfile", "loadConvention", "repBasis"],
      },
    ]);
    expect(result.exerciseMappingsReplaced).toBe(0);
    expect(calls).toEqual(["exercise.update"]);
  });

  it("prints exact alias moves and blocks apply when aliases cannot be resolved", async () => {
    const snapshot: ExerciseLibrarySnapshot = {
      ...baseSnapshot,
      exercises: [
        {
          id: "exercise-1",
          name: "Machine Hip Thrust",
          movementPatterns: ["HINGE"],
          splitTags: ["LEGS"],
          jointStress: "LOW",
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
          stimulusBias: ["METABOLIC"],
          contraindications: null,
          timePerSetSec: 120,
          sfrScore: 4,
          lengthPositionScore: 4,
          difficulty: "BEGINNER",
          isUnilateral: false,
          repRangeMin: 8,
          repRangeMax: 15,
          aliases: [{ alias: "Glute Drive", exerciseId: "exercise-1" }],
          exerciseMuscles: [],
          exerciseEquipment: [],
        },
      ],
    };
    const plan = buildCatalogSyncPlan(
      [machineHipThrust],
      [
        { exerciseName: "Machine Hip Thrust", alias: "Glute Drive" },
        { exerciseName: "Missing Exercise", alias: "Missing Alias" },
      ],
      {
        ...snapshot,
        exercises: snapshot.exercises.map((exercise) => ({
          ...exercise,
          name: "Legacy Hip Thrust",
        })),
      },
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    printCatalogSyncPlan(plan);

    expect(plan.plannedAliasUpdates).toContainEqual({
      exerciseName: "Machine Hip Thrust",
      alias: "Glute Drive",
      fromExerciseName: "Legacy Hip Thrust",
    });
    expect(plan.skippedAliases).toContainEqual({
      exerciseName: "Missing Exercise",
      alias: "Missing Alias",
      reason: "target exercise is not in catalog JSON",
    });
    expect(isCatalogSyncPlanClean(plan)).toBe(false);
    expect(log).toHaveBeenCalledWith(
      "- Glute Drive: Legacy Hip Thrust -> Machine Hip Thrust",
    );
    expect(log).toHaveBeenCalledWith(
      "- Missing Alias -> Missing Exercise: target exercise is not in catalog JSON",
    );
    log.mockRestore();

    const { db, calls } = createFakeCatalogDb(snapshot);
    await expect(
      applyCatalogSyncPlan(db, [machineHipThrust], [], snapshot, plan),
    ).rejects.toThrow(
      "Catalog sync cannot apply because aliases could not be resolved. Missing Alias -> Missing Exercise: target exercise is not in catalog JSON",
    );
    expect(calls).toEqual([]);
  });

  it("is idempotent once catalog fields, mappings, and aliases match", () => {
    const matchingSnapshot: ExerciseLibrarySnapshot = {
      ...baseSnapshot,
      exercises: [
        {
          id: "exercise-1",
          name: "Machine Hip Thrust",
          movementPatterns: ["HINGE"],
          splitTags: ["LEGS"],
          jointStress: "LOW",
          isMainLiftEligible: false,
          isCompound: false,
          fatigueCost: 2,
          stimulusBias: ["METABOLIC"],
          contraindications: null,
          timePerSetSec: 120,
          sfrScore: 4,
          lengthPositionScore: 4,
          difficulty: "BEGINNER",
          isUnilateral: false,
          repRangeMin: 8,
          repRangeMax: 15,
          aliases: [{ alias: "Glute Drive", exerciseId: "exercise-1" }],
          exerciseMuscles: [
            { role: "PRIMARY", muscle: { id: "muscle-glutes", name: "Glutes" } },
            { role: "SECONDARY", muscle: { id: "muscle-hamstrings", name: "Hamstrings" } },
          ],
          exerciseEquipment: [
            { equipment: { id: "equipment-machine", name: "Machine", type: "MACHINE" } },
          ],
        },
      ],
    };

    const plan = buildCatalogSyncPlan(
      [machineHipThrust],
      [{ exerciseName: "Machine Hip Thrust", alias: "Glute Drive" }],
      matchingSnapshot,
    );

    expect(plan.plannedExerciseCreates).toEqual([]);
    expect(plan.plannedExerciseUpdates).toEqual([]);
    expect(plan.plannedAliasCreates).toEqual([]);
    expect(plan.plannedAliasUpdates).toEqual([]);
  });
});
