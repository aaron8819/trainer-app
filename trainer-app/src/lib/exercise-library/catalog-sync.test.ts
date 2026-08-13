import { describe, expect, it, vi } from "vitest";
import {
  applyCatalogSyncPlan,
  buildCatalogSyncReport,
  buildCatalogSyncPlan,
  buildSelectedCatalogStateFingerprint,
  executeCatalogSync,
  isCatalogSyncPlanClean,
  parseCatalogSyncCliArgs,
  printCatalogSyncPlan,
  printCatalogSyncReport,
  resolveCatalogSyncScope,
  runExerciseLibrarySyncCli,
  type ExerciseLibrarySnapshot,
} from "../../../scripts/sync-exercise-library";

const machineHipThrust = {
  catalogKey: "machine-hip-thrust",
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
        findMany: async () => [],
        upsert: async () => {
          calls.push("exerciseAlias.upsert");
        },
      },
    },
  };
}

type SyncDb = Parameters<typeof executeCatalogSync>[0]["db"];
type SyncTransactionDb = Parameters<Parameters<SyncDb["$transaction"]>[0]>[0];

function matchingSnapshotExercise(
  exercise: typeof machineHipThrust & {
    measurementProfile?: string;
    loadConvention?: string;
    repBasis?: string;
  },
  aliases: Array<{ alias: string; exerciseId: string }> = [],
) {
  return {
    ...snapshotExercise(exercise.name, aliases),
    measurementProfile: exercise.measurementProfile ?? null,
    loadConvention: exercise.loadConvention ?? null,
    repBasis: exercise.repBasis ?? null,
  };
}

function createSequencedTransactionalDb(
  snapshots: ExerciseLibrarySnapshot[],
  options: { failOn?: string; failureCode?: string } = {},
) {
  let exerciseReadIndex = 0;
  let activeSnapshot = snapshots[0]!;
  let transactionCalls: string[] | undefined;
  const committedCalls: string[] = [];
  const writeArguments: Array<{ call: string; args: unknown }> = [];
  let commits = 0;
  let rollbacks = 0;
  let transactionAttempts = 0;
  const transactionOptions: unknown[] = [];
  const exerciseReadArguments: unknown[] = [];

  const record = (call: string, args: unknown) => {
    if (!transactionCalls) throw new Error(`Write outside transaction: ${call}`);
    transactionCalls.push(call);
    writeArguments.push({ call, args });
    if (options.failOn === call) {
      const error = new Error(`Injected transaction failure: ${call}`) as Error & { code?: string };
      error.code = options.failureCode;
      throw error;
    }
  };

  const requestedNames = (args: unknown): Set<string> | undefined => {
    const names = (args as { where?: { name?: { in?: string[] } } } | undefined)
      ?.where?.name?.in;
    return names ? new Set(names) : undefined;
  };

  const db: SyncDb = {
    exercise: {
      findMany: async (args?: unknown) => {
        exerciseReadArguments.push(args);
        activeSnapshot = snapshots[Math.min(exerciseReadIndex, snapshots.length - 1)]!;
        exerciseReadIndex++;
        const names = requestedNames(args);
        return names
          ? activeSnapshot.exercises.filter((exercise) => names.has(exercise.name))
          : activeSnapshot.exercises;
      },
      create: async (args) => {
        record("exercise.create", args);
        return { id: "database-default-uuid", name: args.data.name as string };
      },
      update: async (args) => {
        record("exercise.update", args);
      },
    },
    muscle: {
      findMany: async (args?: unknown) => {
        const names = requestedNames(args);
        return names
          ? activeSnapshot.muscles.filter((muscle) => names.has(muscle.name))
          : activeSnapshot.muscles;
      },
    },
    equipment: {
      findMany: async (args?: unknown) => {
        const names = requestedNames(args);
        return names
          ? activeSnapshot.equipment.filter((equipment) => names.has(equipment.name))
          : activeSnapshot.equipment;
      },
    },
    exerciseMuscle: {
      deleteMany: async (args) => {
        record("exerciseMuscle.deleteMany", args);
      },
      createMany: async (args) => {
        record("exerciseMuscle.createMany", args);
      },
    },
    exerciseEquipment: {
      deleteMany: async (args) => {
        record("exerciseEquipment.deleteMany", args);
      },
      createMany: async (args) => {
        record("exerciseEquipment.createMany", args);
      },
    },
    exerciseAlias: {
      findMany: async (args?: unknown) => {
        const aliases = new Set(
          (args as { where?: { alias?: { in?: string[] } } } | undefined)
            ?.where?.alias?.in ?? [],
        );
        return activeSnapshot.exercises.flatMap((exercise) =>
          exercise.aliases
            .filter((alias) => aliases.has(alias.alias))
            .map((alias) => ({
              alias: alias.alias,
              exerciseId: alias.exerciseId,
              exercise: { id: exercise.id, name: exercise.name },
            })),
        );
      },
      upsert: async (args) => {
        record("exerciseAlias.upsert", args);
      },
    },
    async $transaction<T>(
      operation: (tx: SyncTransactionDb) => Promise<T>,
      transactionOption?: unknown,
    ): Promise<T> {
      transactionAttempts++;
      transactionOptions.push(transactionOption);
      transactionCalls = [];
      try {
        const result = await operation(db);
        committedCalls.push(...transactionCalls);
        commits++;
        return result;
      } catch (error) {
        rollbacks++;
        throw error;
      } finally {
        transactionCalls = undefined;
      }
    },
  };

  return {
    db,
    committedCalls,
    writeArguments,
    get commits() {
      return commits;
    },
    get rollbacks() {
      return rollbacks;
    },
    get transactionAttempts() {
      return transactionAttempts;
    },
    transactionOptions,
    exerciseReadArguments,
  };
}

function buildCablePallofScenario() {
  const cablePallofPress = {
    ...machineHipThrust,
    name: "Cable Pallof Press",
    catalogKey: "cable-pallof-press",
  };
  const legacyPallofPress = {
    ...machineHipThrust,
    name: "Pallof Press",
    catalogKey: "pallof-press",
  };
  const unrelated = Array.from({ length: 39 }, (_, index) => ({
    ...machineHipThrust,
    name: `Unrelated Measurement Exercise ${index + 1}`,
    catalogKey: `unrelated-measurement-exercise-${index + 1}`,
    measurementProfile: "REPS_EXTERNAL_LOAD",
    loadConvention: "MACHINE_DISPLAYED",
    repBasis: "TOTAL",
  }));
  const catalog = [cablePallofPress, legacyPallofPress, ...unrelated];
  const aliases = [
    {
      exerciseName: unrelated[0]!.name,
      alias: "Repository Managed Unrelated Alias",
    },
  ];
  const legacyDb = matchingSnapshotExercise(legacyPallofPress, [
    {
      alias: "Database Only Pallof Alias",
      exerciseId: "exercise-pallof-press",
    },
  ]);
  const unrelatedDb = unrelated.map((exercise, index) => ({
    ...matchingSnapshotExercise(exercise, index === 0
      ? [{ alias: aliases[0]!.alias, exerciseId: `exercise-unrelated-measurement-exercise-1` }]
      : []),
    measurementProfile: null,
    loadConvention: null,
    repBasis: null,
  }));
  const before: ExerciseLibrarySnapshot = {
    ...baseSnapshot,
    exercises: [legacyDb, ...unrelatedDb],
  };
  const after: ExerciseLibrarySnapshot = {
    ...baseSnapshot,
    exercises: [matchingSnapshotExercise(cablePallofPress), legacyDb, ...unrelatedDb],
  };
  return { cablePallofPress, legacyPallofPress, unrelated, catalog, aliases, before, after };
}

describe("catalog-only exercise library sync", () => {
  it("accepts only the complete documented CLI grammar and exact repeatable catalog keys", () => {
    const catalog = [
      machineHipThrust,
      { ...machineHipThrust, name: "Cable Pallof Press", catalogKey: "cable-pallof-press" },
    ];
    const aliases = [{ exerciseName: machineHipThrust.name, alias: "Glute Drive" }];

    expect(parseCatalogSyncCliArgs([], catalog, aliases)).toEqual({
      apply: false,
      catalogKeys: undefined,
    });
    expect(
      parseCatalogSyncCliArgs(
        [
          "--apply",
          "--confirm-remote-write",
          "--env-file",
          ".env.staging",
          "--catalog-key",
          "machine-hip-thrust",
          "--catalog-key=cable-pallof-press",
        ],
        catalog,
        aliases,
      ),
    ).toEqual({
      apply: true,
      catalogKeys: ["machine-hip-thrust", "cable-pallof-press"],
    });
    expect(
      parseCatalogSyncCliArgs(["--env-file=.env.local"], catalog, aliases),
    ).toEqual({ apply: false, catalogKeys: undefined });

    const rejected = [
      ["--aply"],
      ["--catalog-keys", "cable-pallof-press"],
      ["--catalog-keyy", "cable-pallof-press"],
      ["--unexpected"],
      ["trailing-positional"],
      ["--catalog-key", "cable-pallof-press", "unexpected"],
      ["--"],
      ["--write"],
      ["--catalog-key"],
      ["--catalog-key="],
      ["--catalog-key", ""],
      ["--catalog-key", "   "],
      ["--catalog-key", "--apply"],
      ["--catalog-key", "Machine Hip Thrust"],
      ["--catalog-key", "Glute Drive"],
      ["--catalog-key", "Machine-Hip-Thrust"],
      ["--catalog-key", "unknown-exercise"],
      ["--catalog-key", "machine-hip-thrust", "--catalog-key=machine-hip-thrust"],
      ["--apply", "--apply"],
      ["--confirm-remote-write", "--confirm-remote-write", "--apply"],
      ["--confirm-remote-write"],
      ["--env-file"],
      ["--env-file="],
      ["--env-file", "--apply"],
      ["--env-file=.env", "--env-file", ".env.other"],
    ];
    for (const argv of rejected) {
      expect(() => parseCatalogSyncCliArgs(argv, catalog, aliases)).toThrow();
    }

    expect(() =>
      parseCatalogSyncCliArgs(
        ["--catalog-key", "machine-hip-thrust"],
        catalog,
        aliases,
        { allowCatalogKeySelectors: false },
      ),
    ).toThrow("Catalog key selectors are supported only by sync:exercise-library");
  });

  it("rejects invalid CLI arguments before environment or database initialization", async () => {
    const runWithEnvironment = vi.fn(async () => undefined);
    const runSync = vi.fn(async () => undefined);

    await expect(
      runExerciseLibrarySyncCli(["--apply", "--catalog-keey=machine-hip-thrust"], {}, {
        runWithEnvironment,
        runSync,
      }),
    ).rejects.toThrow("Unsupported catalog sync argument");

    expect(runWithEnvironment).not.toHaveBeenCalled();
    expect(runSync).not.toHaveBeenCalled();
  });

  it("routes valid CLI execution through the canonical environment and sync path", async () => {
    const runSync = vi.fn(async () => ({ status: "complete" }));
    const runWithEnvironment = vi.fn(async (
      options: { argv: string[]; allowWrite: boolean; requiredVariables: string[] },
      operation: (environment: { targetClass: string }) => Promise<unknown>,
    ) => operation({ targetClass: "local" }));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runExerciseLibrarySyncCli(["--apply", "--catalog-key=machine-hip-thrust"], {}, {
      runWithEnvironment,
      runSync,
    });

    expect(runWithEnvironment).toHaveBeenCalledWith(
      {
        argv: ["--apply", "--catalog-key=machine-hip-thrust", "--write"],
        allowWrite: true,
        requiredVariables: ["DATABASE_URL"],
      },
      expect.any(Function),
    );
    expect(runSync).toHaveBeenCalledWith({
      apply: true,
      catalogKeys: ["machine-hip-thrust"],
    });
    log.mockRestore();
  });

  it("fingerprints representative selected scalar, relation, lookup, and alias-owner changes", () => {
    const alias = { exerciseName: machineHipThrust.name, alias: "Glute Drive" };
    const selected = matchingSnapshotExercise(machineHipThrust, [
      { alias: alias.alias, exerciseId: "exercise-machine-hip-thrust" },
    ]);
    const baseline = {
      ...baseSnapshot,
      exercises: [selected],
    };
    const fingerprint = buildSelectedCatalogStateFingerprint(
      [machineHipThrust],
      [alias],
      baseline,
    );
    const variants: ExerciseLibrarySnapshot[] = [
      {
        ...baseline,
        exercises: [{ ...selected, measurementProfile: "TIME_DURATION" }],
      },
      {
        ...baseline,
        exercises: [{
          ...selected,
          exerciseMuscles: selected.exerciseMuscles.map((relation, index) =>
            index === 0 ? { ...relation, role: "SECONDARY" } : relation,
          ),
        }],
      },
      {
        ...baseline,
        exercises: [{
          ...selected,
          exerciseEquipment: [{
            equipment: { ...selected.exerciseEquipment[0]!.equipment, id: "equipment-replaced" },
          }],
        }],
      },
      {
        ...baseline,
        muscles: baseline.muscles.map((muscle) =>
          muscle.name === "Glutes" ? { ...muscle, id: "muscle-replaced" } : muscle,
        ),
      },
      {
        ...baseline,
        exercises: [
          { ...selected, aliases: [] },
          {
            ...snapshotExercise("Legacy Alias Owner", [
              { alias: alias.alias, exerciseId: "exercise-legacy-alias-owner" },
            ]),
            id: "exercise-legacy-alias-owner",
          },
        ],
      },
    ];

    for (const variant of variants) {
      expect(
        buildSelectedCatalogStateFingerprint([machineHipThrust], [alias], variant),
      ).not.toEqual(fingerprint);
    }
  });

  it("fingerprints selected alias canonical-name conflicts as explicit absence or exact presence", () => {
    const alias = { exerciseName: machineHipThrust.name, alias: "Glute Drive" };
    const selected = matchingSnapshotExercise(machineHipThrust);
    const absent = buildSelectedCatalogStateFingerprint(
      [machineHipThrust],
      [alias],
      { ...baseSnapshot, exercises: [selected] },
    );
    const conflict = {
      ...snapshotExercise(alias.alias),
      id: "exercise-alias-name-conflict",
    };
    const presentSnapshot = { ...baseSnapshot, exercises: [selected, conflict] };
    const present = buildSelectedCatalogStateFingerprint(
      [machineHipThrust],
      [alias],
      presentSnapshot,
    );

    expect(absent.aliases).toEqual([{
      alias: alias.alias,
      canonicalExerciseName: machineHipThrust.name,
      databaseOwner: null,
      canonicalNameConflict: { state: "absent" },
    }]);
    expect(present.aliases[0]?.canonicalNameConflict).toEqual({
      state: "present",
      exerciseId: conflict.id,
      exerciseName: alias.alias,
    });
    expect(
      buildCatalogSyncPlan([machineHipThrust], [alias], presentSnapshot).skippedAliases,
    ).toContainEqual({
      ...alias,
      reason: "alias matches a canonical exercise name",
    });
  });

  it("keeps unselected alias-name collisions outside the selected fingerprint", async () => {
    const selectedAlias = { exerciseName: machineHipThrust.name, alias: "Glute Drive" };
    const deferred = {
      ...machineHipThrust,
      name: "Deferred Exercise",
      catalogKey: "deferred-exercise",
    };
    const deferredAlias = { exerciseName: deferred.name, alias: "Deferred Alias" };
    const snapshot = {
      ...baseSnapshot,
      exercises: [
        matchingSnapshotExercise(machineHipThrust),
        matchingSnapshotExercise(deferred),
        snapshotExercise(deferredAlias.alias),
      ],
    };
    const execution = await executeCatalogSync({
      db: createSequencedTransactionalDb([snapshot]).db,
      catalog: [machineHipThrust, deferred],
      aliases: [selectedAlias, deferredAlias],
      scope: resolveCatalogSyncScope(
        [machineHipThrust, deferred],
        [machineHipThrust.catalogKey],
      ),
      apply: false,
    });

    expect(execution.authorizedFingerprint.aliases).toEqual([{
      alias: selectedAlias.alias,
      canonicalExerciseName: machineHipThrust.name,
      databaseOwner: null,
      canonicalNameConflict: { state: "absent" },
    }]);
  });

  it("reports one Cable Pallof Press create and defers 39 unrelated measurement updates", () => {
    const scenario = buildCablePallofScenario();
    const scope = resolveCatalogSyncScope(scenario.catalog, ["cable-pallof-press"]);
    const report = buildCatalogSyncReport(
      scenario.catalog,
      scenario.aliases,
      scenario.before,
      scope,
    );

    expect(report.inScopePlan.plannedExerciseCreates).toEqual(["Cable Pallof Press"]);
    expect(report.inScopePlan.plannedExerciseUpdates).toEqual([]);
    expect(report.summary.totalCatalogDrift.operationCount).toBe(40);
    expect(report.summary.selectedInScopeOperations.operationCount).toBe(1);
    expect(report.summary.deferredOutOfScopeOperations.operationCount).toBe(39);
    expect(report.summary.deferredOutOfScopeOperations.exerciseUpdates).toHaveLength(39);
    expect(report.inScopePlan.plannedAliasCreates).toEqual([]);
    expect(report.inScopePlan.plannedAliasUpdates).toEqual([]);
    expect(report.inScopePlan.plannedExerciseUpdates).not.toContain("Pallof Press");
  });

  it("uses the same selected plan for dry run and apply and mutates only Cable Pallof Press", async () => {
    const scenario = buildCablePallofScenario();
    const scope = resolveCatalogSyncScope(scenario.catalog, ["cable-pallof-press"]);
    const dryRunDb = createSequencedTransactionalDb([scenario.before]);
    const applyDb = createSequencedTransactionalDb([
      scenario.before,
      scenario.before,
      scenario.before,
      scenario.after,
    ]);

    const dryRun = await executeCatalogSync({
      db: dryRunDb.db,
      catalog: scenario.catalog,
      aliases: scenario.aliases,
      scope,
      apply: false,
    });
    const applied = await executeCatalogSync({
      db: applyDb.db,
      catalog: scenario.catalog,
      aliases: scenario.aliases,
      scope,
      apply: true,
    });

    expect(applied.beforeReport.inScopePlan).toEqual(dryRun.beforeReport.inScopePlan);
    expect(applied.mutationResult?.mutatedIdentities).toEqual({
      exerciseCreates: ["Cable Pallof Press"],
      exerciseUpdates: [],
      aliasCreates: [],
      aliasUpdates: [],
    });
    expect(applyDb.committedCalls).toEqual([
      "exercise.create",
      "exerciseMuscle.deleteMany",
      "exerciseMuscle.createMany",
      "exerciseEquipment.deleteMany",
      "exerciseEquipment.createMany",
    ]);
    const create = applyDb.writeArguments.find((entry) => entry.call === "exercise.create")!;
    expect(create.args).toMatchObject({ data: { name: "Cable Pallof Press" } });
    expect((create.args as { data: Record<string, unknown> }).data).not.toHaveProperty("id");
    expect(JSON.stringify(applyDb.writeArguments)).not.toContain('"name":"Pallof Press"');
    expect(JSON.stringify(applyDb.writeArguments)).not.toContain("Database Only Pallof Alias");
    expect(JSON.stringify(applyDb.writeArguments)).not.toContain("Repository Managed Unrelated Alias");
    expect(applied.afterReport?.summary.deferredOutOfScopeOperations.operationCount).toBe(39);
    expect(isCatalogSyncPlanClean(applied.afterReport!.inScopePlan)).toBe(true);
    expect(applyDb.commits).toBe(1);
    expect(applyDb.rollbacks).toBe(0);
    expect(applyDb.transactionAttempts).toBe(1);
    expect(applyDb.transactionOptions).toEqual([{ isolationLevel: "Serializable" }]);
  });

  it("limits existing-identity updates and multiple selections to the exact selected keys", async () => {
    const first = {
      ...machineHipThrust,
      name: "Selected One",
      catalogKey: "selected-one",
      measurementProfile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "TOTAL",
    };
    const second = { ...first, name: "Selected Two", catalogKey: "selected-two" };
    const deferred = { ...first, name: "Deferred Three", catalogKey: "deferred-three" };
    const catalog = [first, second, deferred];
    const beforeExercises = catalog.map((exercise) => ({
      ...matchingSnapshotExercise(exercise),
      measurementProfile: null,
      loadConvention: null,
      repBasis: null,
    }));
    const afterExercises = beforeExercises.map((exercise) =>
      exercise.name === deferred.name
        ? exercise
        : matchingSnapshotExercise(catalog.find((entry) => entry.name === exercise.name)!),
    );
    const before = { ...baseSnapshot, exercises: beforeExercises };
    const after = { ...baseSnapshot, exercises: afterExercises };
    const scope = resolveCatalogSyncScope(catalog, ["selected-one", "selected-two"]);
    const transactionalDb = createSequencedTransactionalDb([before, before, before, after]);

    const execution = await executeCatalogSync({
      db: transactionalDb.db,
      catalog,
      aliases: [],
      scope,
      apply: true,
    });

    expect(execution.beforeReport.inScopePlan.plannedExerciseUpdates).toEqual([
      "Selected One",
      "Selected Two",
    ]);
    expect(execution.beforeReport.summary.deferredOutOfScopeOperations.exerciseUpdates).toEqual([
      "Deferred Three",
    ]);
    const updatedIds = transactionalDb.writeArguments
      .filter((entry) => entry.call === "exercise.update")
      .map((entry) => (entry.args as { where: { id: string } }).where.id);
    expect(updatedIds).toEqual(["exercise-selected-one", "exercise-selected-two"]);
    expect(transactionalDb.committedCalls).toEqual(["exercise.update", "exercise.update"]);
  });

  it("defers repository-managed aliases outside scope and preserves database-only aliases", async () => {
    const selected = machineHipThrust;
    const deferred = { ...machineHipThrust, name: "Deferred Exercise", catalogKey: "deferred-exercise" };
    const databaseOnlyAlias = {
      alias: "Database Only Alias",
      exerciseId: "exercise-machine-hip-thrust",
    };
    const snapshot = {
      ...baseSnapshot,
      exercises: [matchingSnapshotExercise(selected, [databaseOnlyAlias]), matchingSnapshotExercise(deferred)],
    };
    const aliases = [{ exerciseName: deferred.name, alias: "Managed Deferred Alias" }];
    const scope = resolveCatalogSyncScope([selected, deferred], [selected.catalogKey]);
    const report = buildCatalogSyncReport([selected, deferred], aliases, snapshot, scope);
    const transactionalDb = createSequencedTransactionalDb([
      snapshot,
      snapshot,
      snapshot,
      snapshot,
    ]);
    const execution = await executeCatalogSync({
      db: transactionalDb.db,
      catalog: [selected, deferred],
      aliases,
      scope,
      apply: true,
    });

    expect(report.totalPlan.plannedAliasCreates).toEqual(aliases);
    expect(report.inScopePlan.plannedAliasCreates).toEqual([]);
    expect(report.summary.deferredOutOfScopeOperations.aliasCreates).toEqual(aliases);
    expect(report.totalPlan.plannedAliasUpdates).toEqual([]);
    expect(execution.mutationResult?.aliasesUpserted).toBe(0);
    expect(transactionalDb.committedCalls).toEqual([]);
    expect(transactionalDb.writeArguments).toEqual([]);
  });

  it("keeps catalog-wide planning behavior when no selector is present", () => {
    const scenario = buildCablePallofScenario();
    const scope = resolveCatalogSyncScope(scenario.catalog, undefined);
    const report = buildCatalogSyncReport(
      scenario.catalog,
      scenario.aliases,
      scenario.before,
      scope,
    );

    expect(scope.mode).toBe("catalog-wide");
    expect(report.inScopePlan).toBe(report.totalPlan);
    expect(report.summary.totalCatalogDrift).toMatchObject(
      report.summary.selectedInScopeOperations,
    );
    expect(report.summary.deferredOutOfScopeOperations.operationCount).toBe(0);
  });

  it("rejects a selected identity that appears after authorization", async () => {
    const scenario = buildCablePallofScenario();
    const changedTransactionSnapshot = {
      ...scenario.before,
      exercises: [matchingSnapshotExercise(scenario.cablePallofPress), ...scenario.before.exercises],
    };
    const transactionalDb = createSequencedTransactionalDb([
      scenario.before,
      scenario.before,
      changedTransactionSnapshot,
    ]);

    await expect(
      executeCatalogSync({
        db: transactionalDb.db,
        catalog: scenario.catalog,
        aliases: scenario.aliases,
        scope: resolveCatalogSyncScope(scenario.catalog, ["cable-pallof-press"]),
        apply: true,
      }),
    ).rejects.toThrow("Selected catalog database state changed before apply");
    expect(transactionalDb.committedCalls).toEqual([]);
    expect(transactionalDb.writeArguments).toEqual([]);
    expect(transactionalDb.commits).toBe(0);
    expect(transactionalDb.rollbacks).toBe(1);
  });

  it("rejects selected scalar changes even when the lossy mutation plan is unchanged", async () => {
    const classified = {
      ...machineHipThrust,
      measurementProfile: "REPS_EXTERNAL_LOAD",
      loadConvention: "MACHINE_DISPLAYED",
      repBasis: "TOTAL",
    };
    const beforeExercise = matchingSnapshotExercise(machineHipThrust);
    const changedExercise = { ...beforeExercise, measurementProfile: "TIME_DURATION" };
    const before = { ...baseSnapshot, exercises: [beforeExercise] };
    const changed = { ...baseSnapshot, exercises: [changedExercise] };
    const transactionalDb = createSequencedTransactionalDb([before, before, changed]);

    await expect(
      executeCatalogSync({
        db: transactionalDb.db,
        catalog: [classified],
        aliases: [],
        scope: resolveCatalogSyncScope([classified], [classified.catalogKey]),
        apply: true,
      }),
    ).rejects.toThrow("Selected catalog database state changed before apply");
    expect(transactionalDb.writeArguments).toEqual([]);
    expect(transactionalDb.commits).toBe(0);
    expect(transactionalDb.rollbacks).toBe(1);
  });

  it("rejects selected relation-id changes before writing", async () => {
    const beforeExercise = matchingSnapshotExercise(machineHipThrust);
    const relationVariants = [
      {
        ...beforeExercise,
        exerciseMuscles: beforeExercise.exerciseMuscles.map((relation, index) =>
          index === 0
            ? { ...relation, muscle: { ...relation.muscle, id: "muscle-replaced" } }
            : relation,
        ),
      },
      {
        ...beforeExercise,
        exerciseEquipment: [{
          equipment: {
            ...beforeExercise.exerciseEquipment[0]!.equipment,
            id: "equipment-replaced",
          },
        }],
      },
    ];

    for (const changedExercise of relationVariants) {
      const transactionalDb = createSequencedTransactionalDb([
        { ...baseSnapshot, exercises: [beforeExercise] },
        { ...baseSnapshot, exercises: [beforeExercise] },
        { ...baseSnapshot, exercises: [changedExercise] },
      ]);

      await expect(
        executeCatalogSync({
          db: transactionalDb.db,
          catalog: [machineHipThrust],
          aliases: [],
          scope: resolveCatalogSyncScope([machineHipThrust], [machineHipThrust.catalogKey]),
          apply: true,
        }),
      ).rejects.toThrow("Selected catalog database state changed before apply");
      expect(transactionalDb.writeArguments).toEqual([]);
    }
  });

  it("rejects selected alias-owner ID changes even when the mutation plan is unchanged", async () => {
    const alias = { exerciseName: machineHipThrust.name, alias: "Glute Drive" };
    const selected = matchingSnapshotExercise(machineHipThrust);
    const legacyOwner = (id: string) => ({
      ...snapshotExercise("Legacy Alias Owner", [{ alias: alias.alias, exerciseId: id }]),
      id,
    });
    const before = {
      ...baseSnapshot,
      exercises: [selected, legacyOwner("legacy-owner-a")],
    };
    const changed = {
      ...baseSnapshot,
      exercises: [selected, legacyOwner("legacy-owner-b")],
    };
    const transactionalDb = createSequencedTransactionalDb([before, before, changed]);

    await expect(
      executeCatalogSync({
        db: transactionalDb.db,
        catalog: [machineHipThrust],
        aliases: [alias],
        scope: resolveCatalogSyncScope([machineHipThrust], [machineHipThrust.catalogKey]),
        apply: true,
      }),
    ).rejects.toThrow("Selected catalog database state changed before apply");
    expect(transactionalDb.writeArguments).toEqual([]);
  });

  it("aborts every selected write when an alias-name conflict appears after authorization", async () => {
    const alias = { exerciseName: machineHipThrust.name, alias: "Glute Drive" };
    const before = {
      ...baseSnapshot,
      exercises: [matchingSnapshotExercise(machineHipThrust)],
    };
    const changed = {
      ...baseSnapshot,
      exercises: [
        matchingSnapshotExercise(machineHipThrust),
        { ...snapshotExercise(alias.alias), id: "exercise-alias-name-conflict" },
      ],
    };
    const transactionalDb = createSequencedTransactionalDb([before, before, changed]);

    await expect(
      executeCatalogSync({
        db: transactionalDb.db,
        catalog: [machineHipThrust],
        aliases: [alias],
        scope: resolveCatalogSyncScope([machineHipThrust], [machineHipThrust.catalogKey]),
        apply: true,
      }),
    ).rejects.toThrow("Selected catalog database state changed before apply");

    expect(transactionalDb.writeArguments).toEqual([]);
    for (const writePrefix of [
      "exercise.",
      "exerciseMuscle.",
      "exerciseEquipment.",
      "exerciseAlias.",
    ]) {
      expect(
        transactionalDb.writeArguments.some((entry) => entry.call.startsWith(writePrefix)),
      ).toBe(false);
    }
    expect(transactionalDb.commits).toBe(0);
    expect(transactionalDb.rollbacks).toBe(1);
  });

  it("aborts when an authorized alias-name conflict disappears or changes identity", async () => {
    const alias = { exerciseName: machineHipThrust.name, alias: "Glute Drive" };
    const selected = matchingSnapshotExercise(machineHipThrust);
    const conflict = { ...snapshotExercise(alias.alias), id: "conflict-before" };
    const before = { ...baseSnapshot, exercises: [selected, conflict] };
    const changedStates = [
      { ...baseSnapshot, exercises: [selected] },
      {
        ...baseSnapshot,
        exercises: [selected, { ...conflict, id: "conflict-replaced" }],
      },
    ];

    for (const changed of changedStates) {
      const transactionalDb = createSequencedTransactionalDb([before, before, changed]);
      await expect(
        executeCatalogSync({
          db: transactionalDb.db,
          catalog: [machineHipThrust],
          aliases: [alias],
          scope: resolveCatalogSyncScope([machineHipThrust], [machineHipThrust.catalogKey]),
          apply: true,
        }),
      ).rejects.toThrow("Selected catalog database state changed before apply");
      expect(transactionalDb.writeArguments).toEqual([]);
      expect(transactionalDb.commits).toBe(0);
      expect(transactionalDb.rollbacks).toBe(1);
    }
  });

  it("preserves selected alias creation and reassignment through the canonical mutation seam", async () => {
    const alias = { exerciseName: machineHipThrust.name, alias: "Glute Drive" };
    const selected = matchingSnapshotExercise(machineHipThrust);
    const legacyOwner = {
      ...snapshotExercise("Legacy Alias Owner", [
        { alias: alias.alias, exerciseId: "exercise-legacy-alias-owner" },
      ]),
      id: "exercise-legacy-alias-owner",
    };
    const cases = [
      {
        before: { ...baseSnapshot, exercises: [selected] },
        expected: { aliasCreates: [alias], aliasUpdates: [] },
      },
      {
        before: { ...baseSnapshot, exercises: [selected, legacyOwner] },
        expected: {
          aliasCreates: [],
          aliasUpdates: [{ ...alias, fromExerciseName: legacyOwner.name }],
        },
      },
    ];

    for (const scenario of cases) {
      const after = {
        ...baseSnapshot,
        exercises: [
          matchingSnapshotExercise(machineHipThrust, [
            { alias: alias.alias, exerciseId: selected.id },
          ]),
          ...(scenario.before.exercises.length > 1
            ? [{ ...legacyOwner, aliases: [] }]
            : []),
        ],
      };
      const transactionalDb = createSequencedTransactionalDb([
        scenario.before,
        scenario.before,
        scenario.before,
        after,
      ]);
      const execution = await executeCatalogSync({
        db: transactionalDb.db,
        catalog: [machineHipThrust],
        aliases: [alias],
        scope: resolveCatalogSyncScope([machineHipThrust], [machineHipThrust.catalogKey]),
        apply: true,
      });

      expect(execution.mutationResult?.mutatedIdentities).toMatchObject(scenario.expected);
      expect(transactionalDb.committedCalls).toEqual(["exerciseAlias.upsert"]);
      expect(transactionalDb.exerciseReadArguments[1]).toEqual(
        transactionalDb.exerciseReadArguments[2],
      );
      expect(transactionalDb.exerciseReadArguments[1]).toMatchObject({
        where: { name: { in: [alias.alias, machineHipThrust.name] } },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
    }
  });

  it("does not include unrelated exercise-name changes in the selected transaction read set", async () => {
    const scenario = buildCablePallofScenario();
    const changedUnselected = {
      ...scenario.before,
      exercises: scenario.before.exercises.map((exercise) =>
        exercise.name === scenario.unrelated[0]!.name
          ? { ...exercise, name: "Renamed Unselected Exercise" }
          : exercise,
      ),
    };
    const transactionalDb = createSequencedTransactionalDb([
      scenario.before,
      scenario.before,
      changedUnselected,
      scenario.after,
    ]);

    const execution = await executeCatalogSync({
      db: transactionalDb.db,
      catalog: scenario.catalog,
      aliases: scenario.aliases,
      scope: resolveCatalogSyncScope(scenario.catalog, [scenario.cablePallofPress.catalogKey]),
      apply: true,
    });

    expect(execution.mutationResult?.mutatedIdentities.exerciseCreates).toEqual([
      "Cable Pallof Press",
    ]);
    expect(transactionalDb.commits).toBe(1);
  });

  it("propagates a serializable conflict without retrying a changed authorization", async () => {
    const scenario = buildCablePallofScenario();
    const transactionalDb = createSequencedTransactionalDb(
      [scenario.before, scenario.before, scenario.before],
      { failOn: "exercise.create", failureCode: "P2034" },
    );

    await expect(
      executeCatalogSync({
        db: transactionalDb.db,
        catalog: scenario.catalog,
        aliases: scenario.aliases,
        scope: resolveCatalogSyncScope(scenario.catalog, ["cable-pallof-press"]),
        apply: true,
      }),
    ).rejects.toMatchObject({ code: "P2034" });
    expect(transactionalDb.transactionAttempts).toBe(1);
    expect(transactionalDb.committedCalls).toEqual([]);
    expect(transactionalDb.commits).toBe(0);
    expect(transactionalDb.rollbacks).toBe(1);
  });

  it("leaves transaction failure atomic", async () => {
    const scenario = buildCablePallofScenario();
    const transactionalDb = createSequencedTransactionalDb(
      [scenario.before, scenario.before, scenario.before],
      { failOn: "exerciseEquipment.createMany" },
    );

    await expect(
      executeCatalogSync({
        db: transactionalDb.db,
        catalog: scenario.catalog,
        aliases: scenario.aliases,
        scope: resolveCatalogSyncScope(scenario.catalog, ["cable-pallof-press"]),
        apply: true,
      }),
    ).rejects.toThrow("Injected transaction failure");
    expect(transactionalDb.committedCalls).toEqual([]);
    expect(transactionalDb.commits).toBe(0);
    expect(transactionalDb.rollbacks).toBe(1);
  });

  it("prints active scope and structured total, selected, and deferred summaries", () => {
    const scenario = buildCablePallofScenario();
    const report = buildCatalogSyncReport(
      scenario.catalog,
      scenario.aliases,
      scenario.before,
      resolveCatalogSyncScope(scenario.catalog, ["cable-pallof-press"]),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    printCatalogSyncReport(report);

    expect(log).toHaveBeenCalledWith("Active scope: identity-scoped");
    expect(log).toHaveBeenCalledWith("Selected in-scope operations: 1");
    expect(log).toHaveBeenCalledWith("Deferred out-of-scope operations: 39");
    const structuredLine = log.mock.calls
      .map(([message]) => message)
      .find((message) => typeof message === "string" && message.startsWith("Catalog sync structured summary:"));
    expect(structuredLine).toContain('"totalCatalogDrift"');
    expect(structuredLine).toContain('"selectedInScopeOperations"');
    expect(structuredLine).toContain('"deferredOutOfScopeOperations"');
    log.mockRestore();
  });

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
