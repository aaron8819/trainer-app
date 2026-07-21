/** PostgreSQL-only concurrency coverage. Run through test:db:workout-mutations. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  buildSessionDecisionReceipt,
  readSessionDecisionReceipt,
} from "@/lib/evidence/session-decision-receipt";
import {
  buildExerciseStimulusSnapshot,
  parseExerciseStimulusSnapshot,
  toExerciseStimulusAccountingEvidence,
} from "@/lib/stimulus-accounting/snapshot";
import { closePrismaResourcesForAuditCli } from "@/lib/db/prisma";
import { executeWorkoutMutation } from "./workout-mutation";
import { persistWorkoutRow } from "./save-workout/persistence";
import { normalizeAcceptedSeedPayload } from "./mesocycle-seed-revision";
import {
  activatePreSessionReadinessSnapshot,
  hashPreSessionReadinessSnapshotSource,
  loadCurrentPreSessionReadinessSnapshot,
  loadCurrentPreSessionReadinessSnapshotIdentity,
  type PreSessionReadinessCurrentSnapshotIdentity,
} from "./pre-session-readiness-snapshot";
import type { PreSessionReadinessContract } from "./pre-session-readiness-contract";
import { reconcileRuntimeEditSelectionMetadata } from "./runtime-edit-reconciliation";
import { applyRuntimeExerciseSwap } from "./runtime-exercise-swap-service";
import { loadPersistedIncompleteWorkoutProjections } from "./persisted-incomplete-workout-projection";
import { loadProjectedWeekVolumeReport } from "./projected-week-volume";
import { loadMesocycleWeekMuscleVolume } from "./weekly-volume";
import {
  buildPostSessionReviewEvidenceFingerprint,
  createPostSessionReviewSnapshotInTransaction,
  hashPostSessionReviewValue,
  loadHistoricalPostSessionReview,
} from "./post-session-review-snapshot";
import { loadExerciseHistory } from "./exercise-history";
import { generateWorkoutExplanation } from "./explainability";
import { loadNextWorkoutContext } from "./next-session";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("runtime workout mutation CAS (PostgreSQL)", () => {
  let pool: Pool;
  let db: PrismaClient;
  let ownerId: string;
  let foreignOwnerId: string;
  let exerciseAId: string;
  let exerciseBId: string;
  let exerciseCId: string;
  let exerciseVariantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    const suffix = crypto.randomUUID();
    const [owner, foreignOwner, chestMuscle, cableEquipment] = await Promise.all([
      db.user.create({ data: { email: `mutation-owner-${suffix}@test.local` } }),
      db.user.create({ data: { email: `mutation-foreign-${suffix}@test.local` } }),
      db.muscle.upsert({
        where: { name: "Chest" },
        update: {},
        create: { name: "Chest", mv: 4, mev: 8, mav: 12, mrv: 18 },
      }),
      db.equipment.upsert({
        where: { name: "Cable" },
        update: {},
        create: { name: "Cable", type: "CABLE" },
      }),
    ]);
    const exerciseData = (name: string) => ({
      name,
      jointStress: "LOW" as const,
      movementPatterns: ["HORIZONTAL_PUSH" as const],
      splitTags: ["PUSH" as const],
      isCompound: false,
      fatigueCost: 2,
      repRangeMin: 8,
      repRangeMax: 12,
      exerciseMuscles: {
        create: { muscleId: chestMuscle.id, role: "PRIMARY" as const },
      },
      exerciseEquipment: {
        create: { equipmentId: cableEquipment.id },
      },
    });
    const [exerciseA, exerciseB, exerciseC, exerciseVariant] = await Promise.all([
      db.exercise.create({ data: exerciseData(`Mutation Press ${suffix}`) }),
      db.exercise.create({ data: exerciseData(`Mutation Fly ${suffix}`) }),
      db.exercise.create({ data: exerciseData(`Mutation Fly Alternate ${suffix}`) }),
      db.exercise.create({ data: exerciseData(`Mutation Press Variant ${suffix}`) }),
    ]);
    ownerId = owner.id;
    foreignOwnerId = foreignOwner.id;
    exerciseAId = exerciseA.id;
    exerciseBId = exerciseB.id;
    exerciseCId = exerciseC.id;
    exerciseVariantId = exerciseVariant.id;

    await db.$transaction([
      db.profile.create({ data: { userId: ownerId, trainingAge: "INTERMEDIATE" } }),
      db.goals.create({
        data: {
          userId: ownerId,
          primaryGoal: "HYPERTROPHY",
          secondaryGoal: "STRENGTH",
        },
      }),
      db.constraints.create({
        data: {
          userId: ownerId,
          daysPerWeek: 2,
          splitType: "UPPER_LOWER",
          weeklySchedule: ["UPPER", "UPPER"],
        },
      }),
      db.userPreference.create({ data: { userId: ownerId } }),
    ]);
  });

  afterAll(async () => {
    await db?.$disconnect();
    await pool?.end();
    await closePrismaResourcesForAuditCli();
  });

  function makeReadinessContract(
    identity: PreSessionReadinessCurrentSnapshotIdentity
  ): PreSessionReadinessContract {
    return {
      contractVersion: 1,
      scope: {
        mode: "pre-session-readiness",
        ownerSeam: "api/pre-session-readiness-contract",
        source: {
          producerMode: "persisted_snapshot",
          producer: "pre_session_readiness_snapshot",
          provenance: "app_read_model",
        },
        readOnly: true,
        auditOnly: false,
        affectsScoringOrGeneration: false,
        consumedByProduction: false,
      },
      nextSessionIdentity: {
        userId: identity.userId,
        activeMesocycleId: identity.activeMesocycleId,
        activeState: identity.mesocycleState,
        currentWeek: identity.weekInMeso,
        currentSession: identity.sessionInWeek,
        nextSlotId: identity.slotId,
        nextIntent: identity.slotIntent,
        existingWorkoutId: identity.plannedWorkoutId,
        incompleteWorkoutStatus: identity.plannedWorkoutId ? "PLANNED" : null,
        incompleteWorkoutReadiness: identity.plannedWorkoutId ? "resumable" : "none",
        existingWorkoutAction: identity.plannedWorkoutId ? "resume" : "none",
        generationPath: "standard_generation",
        generator: "generateSessionFromIntent",
      },
      startability: {
        status: "startable",
        safeToTrain: true,
        normalStartCoachingAllowed: true,
        action: "run_seed_as_prescribed",
        reasons: ["ready"],
        blockerSummary: "none",
      },
      seedRuntimeProof: {
        status: "valid",
        compositionSource: "persisted_slot_plan_seed",
        receiptMesocycleId: identity.activeMesocycleId,
        seedSource: "postgres_release_verification",
        seedExecutableShape: "set_aware",
        seedOrderSetCountsRespected: true,
        readOnlyEvidenceOnly: true,
        seedRuntimeChanged: false,
        proofLines: ["production readiness identity"],
      },
      projectedWeekStatus: {
        status: "no_further_action",
        currentWeek: identity.weekInMeso,
        phase: "accumulation",
        belowMev: [],
        overMav: [],
        fatigueRisks: [],
        projectionNotes: [],
        doseGuidanceRows: [],
        noAddOnReason: "No add-ons.",
      },
      doseClosure: {
        heading: "Dose Closure",
        priority: [],
        optional: [],
        monitor: [],
        suppress: [],
        guardrails: [],
        recommendations: [],
      },
      sessionLocalCoaching: {
        defaultInstruction: "Run seed as prescribed.",
        floorBufferOpportunities: [],
        prescriptionConfidenceWatches: [],
        fatigueCautions: [],
        safeOptionalAddOns: [],
        suppressAvoid: [],
        addOnState: { status: "none", reason: "No add-ons." },
      },
      calibrationWatches: {
        prescriptionConfidence: [],
        recoveryCaveats: [],
        fatigue: [],
      },
      consistencyChecks: [
        {
          id: "seed_runtime_proof_read_only",
          status: "pass",
          severity: "info",
          message: "Read-only seed proof.",
          evidence: [],
        },
      ],
      boundaries: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByProduction: false,
        wouldWriteTransaction: false,
        dbMutation: false,
        workoutLogSessionCreated: false,
        seedRuntimeChanged: false,
        plannerMaterializerChanged: false,
        notes: ["disposable PostgreSQL release verification"],
      },
    };
  }

  async function buildExactStimulusSnapshot(exerciseId: string) {
    const exercise = await db.exercise.findUniqueOrThrow({
      where: { id: exerciseId },
      include: {
        aliases: true,
        exerciseMuscles: { include: { muscle: true } },
      },
    });
    return buildExerciseStimulusSnapshot(
      {
        id: exercise.id,
        name: exercise.name,
        aliases: exercise.aliases.map((alias) => alias.alias),
        primaryMuscles: exercise.exerciseMuscles
          .filter((mapping) => mapping.role === "PRIMARY")
          .map((mapping) => mapping.muscle.name),
        secondaryMuscles: exercise.exerciseMuscles
          .filter((mapping) => mapping.role === "SECONDARY")
          .map((mapping) => mapping.muscle.name),
      },
      "exact"
    );
  }

  async function loadPersistedStructure(
    client: Pick<Prisma.TransactionClient, "workoutExercise">,
    workoutId: string
  ) {
    const exercises = await client.workoutExercise.findMany({
      where: { workoutId },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
      select: {
        id: true,
        exerciseId: true,
        orderIndex: true,
        section: true,
        exercise: { select: { name: true } },
        sets: {
          orderBy: { setIndex: "asc" },
          select: {
            id: true,
            setIndex: true,
            targetReps: true,
            targetRepMin: true,
            targetRepMax: true,
            targetRpe: true,
            targetLoad: true,
            restSeconds: true,
          },
        },
      },
    });
    return exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      orderIndex: exercise.orderIndex,
      section: exercise.section ?? "MAIN",
      exercise: exercise.exercise,
      sets: exercise.sets,
    }));
  }

  async function createWorkout() {
    return db.workout.create({
      data: {
        userId: ownerId,
        scheduledDate: new Date("2026-07-14T12:00:00.000Z"),
        exercises: {
          create: {
            exerciseId: exerciseAId,
            orderIndex: 0,
            section: "MAIN",
            isMainLift: true,
            sets: { create: { setIndex: 1, targetReps: 8 } },
          },
        },
      },
      include: { exercises: { include: { sets: true } } },
    });
  }

  it("allows exactly one concurrent structural mutation for one revision", async () => {
    const workout = await createWorkout();
    const original = workout.exercises[0];
    const addExercise = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) => tx.workoutExercise.create({
        data: {
          workoutId: workout.id,
          exerciseId: exerciseBId,
          orderIndex: 1,
          section: "ACCESSORY",
          isMainLift: false,
          sets: { create: { setIndex: 1, targetReps: 12 } },
        },
      }),
    );
    const swapExercise = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) => tx.workoutExercise.update({
        where: { id: original.id },
        data: { exerciseId: exerciseBId },
      }),
    );

    const results = await Promise.allSettled([addExercise, swapExercise]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const stored = await db.workout.findUniqueOrThrow({
      where: { id: workout.id },
      include: { exercises: { orderBy: { orderIndex: "asc" }, include: { sets: true } } },
    });
    expect(stored.revision).toBe(workout.revision + 1);
    expect(stored.exercises.length === 1 || stored.exercises.length === 2).toBe(true);
    if (stored.exercises.length === 2) {
      expect(stored.exercises[0].exerciseId).toBe(exerciseAId);
      expect(stored.exercises[1].sets).toHaveLength(1);
    } else {
      expect(stored.exercises[0].exerciseId).toBe(exerciseBId);
    }
  });

  it("serializes log-versus-structure races without a partial loser", async () => {
    const workout = await createWorkout();
    const workoutExercise = workout.exercises[0];
    const workoutSet = workoutExercise.sets[0];
    const log = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) => tx.setLog.create({
        data: { workoutSetId: workoutSet.id, actualReps: 8, actualRpe: 8 },
      }),
    );
    const addSet = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) => tx.workoutSet.create({
        data: { workoutExerciseId: workoutExercise.id, setIndex: 2, targetReps: 8 },
      }),
    );

    const results = await Promise.allSettled([log, addSet]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [stored, logCount, setCount] = await Promise.all([
      db.workout.findUniqueOrThrow({ where: { id: workout.id } }),
      db.setLog.count({ where: { workoutSetId: workoutSet.id } }),
      db.workoutSet.count({ where: { workoutExerciseId: workoutExercise.id } }),
    ]);
    expect(stored.revision).toBe(workout.revision + 1);
    expect([logCount, setCount]).toEqual(
      logCount === 1 ? [1, 1] : [0, 2],
    );
  });

  it("serializes log-versus-swap races without misattributing performed work", async () => {
    const workout = await createWorkout();
    const workoutExercise = workout.exercises[0];
    const workoutSet = workoutExercise.sets[0];
    const log = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) =>
        tx.setLog.create({
          data: { workoutSetId: workoutSet.id, actualReps: 8, actualRpe: 8 },
        }),
    );
    const swap = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) =>
        tx.workoutExercise.updateMany({
          where: {
            id: workoutExercise.id,
            exerciseId: exerciseAId,
            sets: { none: { logs: { some: {} } } },
          },
          data: { exerciseId: exerciseBId },
        }),
    );

    const results = await Promise.allSettled([log, swap]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [storedExercise, logCount] = await Promise.all([
      db.workoutExercise.findUniqueOrThrow({ where: { id: workoutExercise.id } }),
      db.setLog.count({ where: { workoutSetId: workoutSet.id } }),
    ]);
    expect(
      logCount === 1
        ? storedExercise.exerciseId === exerciseAId
        : storedExercise.exerciseId === exerciseBId,
    ).toBe(true);
  });

  it("serializes remove-versus-log races without deleting performed work", async () => {
    const workout = await createWorkout();
    const workoutExercise = workout.exercises[0];
    const workoutSet = workoutExercise.sets[0];
    const log = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) =>
        tx.setLog.create({
          data: { workoutSetId: workoutSet.id, actualReps: 8, actualRpe: 8 },
        }),
    );
    const remove = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      async (tx) => {
        await tx.workoutSet.deleteMany({
          where: {
            workoutExerciseId: workoutExercise.id,
            logs: { none: {} },
          },
        });
        const removed = await tx.workoutExercise.deleteMany({
          where: {
            id: workoutExercise.id,
            sets: { none: {} },
          },
        });
        if (removed.count !== 1) {
          throw new Error("REMOVE_STATE_CHANGED");
        }
      },
    );

    const results = await Promise.allSettled([log, remove]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [storedExercise, logCount] = await Promise.all([
      db.workoutExercise.findUnique({ where: { id: workoutExercise.id } }),
      db.setLog.count({ where: { workoutSetId: workoutSet.id } }),
    ]);
    expect(logCount === 1 ? storedExercise !== null : storedExercise === null).toBe(true);
  });

  it("serializes completion versus a stale runtime edit", async () => {
    const workout = await createWorkout();
    const workoutExercise = workout.exercises[0];
    const completion = db.$transaction((tx) =>
      persistWorkoutRow(tx, {
        workoutId: workout.id,
        existingWorkout: workout,
        userId: ownerId,
        expectedRevision: workout.revision,
        shouldAdvanceLifecycleTransition: false,
        resolvedMesocycleId: null,
        workoutUpdateData: {
          status: "COMPLETED",
          completedAt: new Date("2026-07-14T13:00:00.000Z"),
        },
        workoutCreateData: {},
      }),
    );
    const staleEdit = executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      (tx) =>
        tx.workoutSet.create({
          data: { workoutExerciseId: workoutExercise.id, setIndex: 2, targetReps: 8 },
        }),
    );

    const results = await Promise.allSettled([completion, staleEdit]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [stored, setCount] = await Promise.all([
      db.workout.findUniqueOrThrow({ where: { id: workout.id } }),
      db.workoutSet.count({ where: { workoutExerciseId: workoutExercise.id } }),
    ]);
    expect(stored.revision).toBe(workout.revision + 1);
    expect(
      stored.status === "COMPLETED"
        ? setCount === 1
        : stored.status === "PLANNED" && setCount === 2,
    ).toBe(true);
  });

  it("runs the integrated workout lifecycle release gate", async () => {
    const releaseOwner = await db.user.create({
      data: {
        email: `mutation-release-${crypto.randomUUID()}@test.local`,
        profile: { create: { trainingAge: "INTERMEDIATE" } },
        goals: {
          create: {
            primaryGoal: "HYPERTROPHY",
            secondaryGoal: "STRENGTH",
          },
        },
        constraints: {
          create: {
            daysPerWeek: 2,
            splitType: "UPPER_LOWER",
            weeklySchedule: ["UPPER", "UPPER"],
          },
        },
        preferences: { create: {} },
      },
    });
    ownerId = releaseOwner.id;
    const scheduledAt = new Date("2026-07-14T12:00:00.000Z");
    const completedAt = new Date("2026-07-14T14:00:00.000Z");
    const snapshotA = await buildExactStimulusSnapshot(exerciseAId);
    const snapshotB = await buildExactStimulusSnapshot(exerciseBId);
    const seed = {
      version: 1,
      source: "postgres_release_verification",
      slots: [
        {
          slotId: "upper_a",
          exercises: [{ exerciseId: exerciseAId, role: "CORE_COMPOUND", setCount: 1 }],
        },
        {
          slotId: "upper_b",
          exercises: [{ exerciseId: exerciseCId, role: "ACCESSORY", setCount: 1 }],
        },
      ],
    };
    const normalizedSeed = normalizeAcceptedSeedPayload(seed);
    const macro = await db.macroCycle.create({
      data: {
        userId: ownerId,
        startDate: new Date("2026-07-13T00:00:00.000Z"),
        endDate: new Date("2026-10-05T00:00:00.000Z"),
        durationWeeks: 12,
        trainingAge: "INTERMEDIATE",
        primaryGoal: "HYPERTROPHY",
      },
    });
    const mesocycle = await db.mesocycle.create({
      data: {
        macroCycleId: macro.id,
        mesoNumber: 1,
        startWeek: 0,
        durationWeeks: 4,
        focus: "Integrated workout lifecycle release gate",
        volumeTarget: "MODERATE",
        intensityBias: "HYPERTROPHY",
        sessionsPerWeek: 2,
        splitType: "UPPER_LOWER",
        daysPerWeek: 2,
        isActive: true,
        slotSequenceJson: {
          version: 1,
          source: "postgres_release_verification",
          sequenceMode: "ordered_flexible",
          slots: [
            { slotId: "upper_a", intent: "UPPER" },
            { slotId: "upper_b", intent: "UPPER" },
          ],
        },
        slotPlanSeedJson: normalizedSeed.canonicalPayload,
        blocks: {
          create: {
            blockNumber: 1,
            blockType: "ACCUMULATION",
            startWeek: 1,
            durationWeeks: 3,
            volumeTarget: "MODERATE",
            intensityBias: "HYPERTROPHY",
            adaptationType: "SARCOPLASMIC_HYPERTROPHY",
          },
        },
      },
    });
    const seedRevision = await db.mesocycleSeedRevision.create({
      data: {
        mesocycleId: mesocycle.id,
        revision: 1,
        seedPayload: normalizedSeed.canonicalPayload,
        payloadHash: normalizedSeed.hash,
        hashAlgorithm: "sha256",
        provenanceStatus: "exact",
        creationReason: "postgres_release_verification",
      },
    });
    await db.mesocycle.update({
      where: { id: mesocycle.id },
      data: { currentSeedRevisionId: seedRevision.id },
    });

    const receipt = buildSessionDecisionReceipt({
      cycleContext: {
        weekInMeso: 1,
        weekInBlock: 1,
        blockDurationWeeks: 3,
        mesocycleLength: 4,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      sessionProvenance: {
        mesocycleId: mesocycle.id,
        compositionSource: "persisted_slot_plan_seed",
        seedProvenance: {
          revisionId: seedRevision.id,
          revision: seedRevision.revision,
          hash: normalizedSeed.hash,
        },
      },
      sessionSlot: {
        slotId: "upper_a",
        intent: "upper",
        sequenceIndex: 0,
        sequenceLength: 2,
        source: "mesocycle_slot_sequence",
      },
      lifecycleVolumeTargets: { Chest: 8 },
    });
    const created = await db.$transaction((tx) =>
      persistWorkoutRow(tx, {
        workoutId: crypto.randomUUID(),
        existingWorkout: null,
        userId: ownerId,
        shouldAdvanceLifecycleTransition: false,
        resolvedMesocycleId: mesocycle.id,
        workoutUpdateData: {},
        workoutCreateData: {
          user: { connect: { id: ownerId } },
          mesocycle: { connect: { id: mesocycle.id } },
          seedRevision: { connect: { id: seedRevision.id } },
          scheduledDate: scheduledAt,
          status: "PLANNED",
          selectionMode: "INTENT",
          sessionIntent: "UPPER",
          advancesSplit: true,
          mesocyclePhaseSnapshot: "ACCUMULATION",
          mesocycleWeekSnapshot: 1,
          mesoSessionSnapshot: 1,
          seedRevisionNumber: seedRevision.revision,
          seedPayloadHash: seedRevision.payloadHash,
          selectionMetadata: {
            sessionDecisionReceipt: receipt,
          },
          exercises: {
            create: {
              exerciseId: exerciseAId,
              orderIndex: 0,
              section: "MAIN",
              isMainLift: true,
              movementPatterns: ["HORIZONTAL_PUSH"],
              stimulusAccountingSnapshot:
                snapshotA as unknown as Prisma.InputJsonValue,
              sets: {
                create: {
                  setIndex: 1,
                  targetReps: 10,
                  targetRepMin: 8,
                  targetRepMax: 12,
                  targetRpe: 8,
                  targetLoad: 100,
                },
              },
            },
          },
        },
      })
    );
    const workout = await db.workout.findUniqueOrThrow({
      where: { id: created.workout.id },
      include: { exercises: { include: { sets: true } } },
    });
    const revisionSequence = [workout.revision];
    expect(workout.revision).toBe(1);

    const originalSeedProvenance = {
      seedRevisionId: workout.seedRevisionId,
      seedRevisionNumber: workout.seedRevisionNumber,
      seedPayloadHash: workout.seedPayloadHash,
    };
    expect(originalSeedProvenance).toEqual({
      seedRevisionId: seedRevision.id,
      seedRevisionNumber: 1,
      seedPayloadHash: normalizedSeed.hash,
    });
    expect(readSessionDecisionReceipt(workout.selectionMetadata)?.sessionProvenance)
      .toMatchObject({
        mesocycleId: mesocycle.id,
        seedProvenance: {
          revisionId: seedRevision.id,
          revision: 1,
          hash: normalizedSeed.hash,
        },
      });

    const nextWorkoutContext = await loadNextWorkoutContext(ownerId);
    expect(nextWorkoutContext).toMatchObject({
      existingWorkoutId: workout.id,
      weekInMeso: 1,
      sessionInWeek: 1,
      slotId: "upper_a",
      intent: "upper",
    });
    const readinessIdentity =
      await loadCurrentPreSessionReadinessSnapshotIdentity(ownerId);
    expect(readinessIdentity).toMatchObject({
      plannedWorkoutId: workout.id,
      plannedWorkoutRevision: 1,
      seedRevisionId: seedRevision.id,
      seedRevisionNumber: 1,
      seedPayloadHash: hashPreSessionReadinessSnapshotSource(
        normalizedSeed.canonicalPayload
      ),
    });
    const readinessActivation = await activatePreSessionReadinessSnapshot({
      preparedIdentity: readinessIdentity!,
      contract: makeReadinessContract(readinessIdentity!),
    });
    expect(readinessActivation.outcome).toBe("created");
    await expect(loadCurrentPreSessionReadinessSnapshot(ownerId)).resolves.toMatchObject({
      status: "available",
      snapshot: {
        id: readinessActivation.snapshot.id,
        plannedWorkoutRevision: 1,
      },
    });

    const addedExerciseMutation = await executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: 1 },
      async (tx) => {
        const addedExercise = await tx.workoutExercise.create({
          data: {
            workoutId: workout.id,
            exerciseId: exerciseBId,
            orderIndex: 1,
            section: "ACCESSORY",
            isMainLift: false,
            movementPatterns: ["HORIZONTAL_PUSH"],
            stimulusAccountingSnapshot:
              snapshotB as unknown as Prisma.InputJsonValue,
            sets: {
              create: {
                setIndex: 1,
                targetReps: 10,
                targetRepMin: 8,
                targetRepMax: 12,
                targetRpe: 8,
                targetLoad: 30,
              },
            },
          },
          include: { sets: true },
        });
        const claimedWorkout = await tx.workout.findUniqueOrThrow({
          where: { id: workout.id },
          select: {
            selectionMetadata: true,
            selectionMode: true,
            sessionIntent: true,
          },
        });
        const reconciled = reconcileRuntimeEditSelectionMetadata({
          selectionMetadata: claimedWorkout.selectionMetadata,
          selectionMode: claimedWorkout.selectionMode,
          sessionIntent: claimedWorkout.sessionIntent,
          persistedExercises: await loadPersistedStructure(tx, workout.id),
          mutation: {
            kind: "add_exercise",
            workoutExerciseId: addedExercise.id,
            exerciseId: exerciseBId,
            orderIndex: 1,
            section: "ACCESSORY",
            setCount: 1,
            prescriptionSource: "session_accessory_defaults",
            stimulusAccounting: toExerciseStimulusAccountingEvidence(snapshotB),
          },
          reconciledAt: new Date("2026-07-14T12:05:00.000Z"),
        });
        await tx.workout.update({
          where: { id: workout.id },
          data: {
            selectionMetadata:
              reconciled.nextSelectionMetadata as Prisma.InputJsonValue,
          },
        });
        return addedExercise;
      }
    );
    const addedExercise = addedExerciseMutation.result;
    revisionSequence.push(addedExerciseMutation.revision);
    expect(addedExerciseMutation.revision).toBe(2);
    const staleReadiness = await loadCurrentPreSessionReadinessSnapshot(ownerId);
    expect(staleReadiness.status).not.toBe("available");
    expect(await db.preSessionReadinessSnapshot.count({
      where: {
        userId: ownerId,
        identityHash: readinessIdentity!.identityHash,
        invalidatedAt: null,
        identityStatus: "EXACT",
      },
    })).toBe(1);

    const addedSetMutation = await executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: 2 },
      async (tx) => {
        const addedSet = await tx.workoutSet.create({
          data: {
            workoutExerciseId: addedExercise.id,
            setIndex: 2,
            targetReps: 10,
            targetRepMin: 8,
            targetRepMax: 12,
            targetRpe: 8,
            targetLoad: 30,
          },
        });
        const claimedWorkout = await tx.workout.findUniqueOrThrow({
          where: { id: workout.id },
          select: {
            selectionMetadata: true,
            selectionMode: true,
            sessionIntent: true,
          },
        });
        const reconciled = reconcileRuntimeEditSelectionMetadata({
          selectionMetadata: claimedWorkout.selectionMetadata,
          selectionMode: claimedWorkout.selectionMode,
          sessionIntent: claimedWorkout.sessionIntent,
          persistedExercises: await loadPersistedStructure(tx, workout.id),
          mutation: {
            kind: "add_set",
            workoutExerciseId: addedExercise.id,
            exerciseId: exerciseBId,
            workoutSetId: addedSet.id,
            setIndex: 2,
            clonedFromSetIndex: 1,
          },
          reconciledAt: new Date("2026-07-14T12:10:00.000Z"),
        });
        await tx.workout.update({
          where: { id: workout.id },
          data: {
            selectionMetadata:
              reconciled.nextSelectionMetadata as Prisma.InputJsonValue,
          },
        });
        return addedSet;
      }
    );
    revisionSequence.push(addedSetMutation.revision);
    expect(addedSetMutation.revision).toBe(3);

    const logMutation = await executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: 3 },
      (tx) =>
        tx.setLog.create({
          data: {
            workoutSetId: workout.exercises[0].sets[0].id,
            setIntent: "WORK",
            actualReps: 10,
            actualRpe: 8,
            actualLoad: 100,
            completedAt: new Date("2026-07-14T12:20:00.000Z"),
          },
        })
    );
    revisionSequence.push(logMutation.revision);
    expect(logMutation.revision).toBe(4);

    const incomplete = await loadPersistedIncompleteWorkoutProjections(db, {
      userId: ownerId,
      mesocycleId: mesocycle.id,
      targetWeek: 1,
      requireSlotIdentity: true,
    });
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0]).toMatchObject({
      workoutId: workout.id,
      status: "reliable",
      performed: { qualifyingSets: 1 },
      remaining: { qualifyingSets: 2 },
      totalProjected: { qualifyingSets: 3 },
    });
    expect(
      incomplete[0].performed.qualifyingSets +
        incomplete[0].remaining.qualifyingSets
    ).toBe(incomplete[0].totalProjected.qualifyingSets);
    const projectedWeek = await loadProjectedWeekVolumeReport({ userId: ownerId });
    expect(projectedWeek.incompleteWorkoutProjections).toEqual(incomplete);
    const projectedWorkout = projectedWeek.projectedSessions.find(
      (session) => session.workoutId === workout.id
    );
    expect(projectedWorkout).toMatchObject({
      projectionCategory: "persisted_incomplete",
      performedContributionByMuscle: { Chest: 1 },
      remainingContributionByMuscle: { Chest: 2 },
      projectedContributionByMuscle: { Chest: 3 },
    });

    const swapMutation = await applyRuntimeExerciseSwap({
      workoutId: workout.id,
      workoutExerciseId: addedExercise.id,
      replacementExerciseId: exerciseCId,
      userId: ownerId,
      expectedRevision: 4,
    });
    revisionSequence.push(swapMutation.revision);
    expect(swapMutation.revision).toBe(5);
    const afterSwap = await db.workout.findUniqueOrThrow({
      where: { id: workout.id },
      include: {
        exercises: {
          orderBy: { orderIndex: "asc" },
          include: { sets: { include: { logs: true }, orderBy: { setIndex: "asc" } } },
        },
      },
    });
    expect(afterSwap.exercises.map((exercise) => exercise.exerciseId)).toEqual([
      exerciseAId,
      exerciseCId,
    ]);
    expect(afterSwap.exercises[0].sets[0].logs).toHaveLength(1);
    expect(afterSwap.exercises[1].sets.flatMap((set) => set.logs)).toHaveLength(0);
    for (const exercise of afterSwap.exercises) {
      expect(parseExerciseStimulusSnapshot(exercise.stimulusAccountingSnapshot))
        .toMatchObject({ sourceExerciseId: exercise.exerciseId, provenance: "exact" });
    }
    const postSwapReceipt = readSessionDecisionReceipt(afterSwap.selectionMetadata);
    expect(postSwapReceipt?.sessionProvenance?.seedProvenance).toEqual({
      revisionId: seedRevision.id,
      revision: 1,
      hash: normalizedSeed.hash,
    });
    expect(afterSwap).toMatchObject(originalSeedProvenance);
    expect(afterSwap.selectionMetadata).toMatchObject({
      runtimeEditReconciliation: {
        ops: expect.arrayContaining([
          expect.objectContaining({
            kind: "replace_exercise",
            facts: expect.objectContaining({
              workoutExerciseId: addedExercise.id,
              fromExerciseId: exerciseBId,
              toExerciseId: exerciseCId,
              fromStimulusAccounting: expect.objectContaining({
                snapshotHash: snapshotB.policyHash,
              }),
              toStimulusAccounting: expect.objectContaining({
                snapshotHash: expect.any(String),
              }),
            }),
          }),
        ]),
      },
    });

    const committedStructure = afterSwap.exercises.map((exercise) => ({
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      orderIndex: exercise.orderIndex,
      sets: exercise.sets.map((set) => ({ id: set.id, setIndex: set.setIndex })),
    }));
    const partialSave = await db.$transaction((tx) =>
      persistWorkoutRow(tx, {
        workoutId: workout.id,
        existingWorkout: { id: workout.id, revision: 5 },
        userId: ownerId,
        expectedRevision: 5,
        shouldAdvanceLifecycleTransition: false,
        resolvedMesocycleId: mesocycle.id,
        workoutUpdateData: { status: "PARTIAL" },
        workoutCreateData: {},
      })
    );
    revisionSequence.push(partialSave.workout.revision);
    expect(partialSave.workout.revision).toBe(6);
    const resumed = await db.workout.findFirstOrThrow({
      where: { id: workout.id, userId: ownerId },
      include: {
        exercises: {
          orderBy: { orderIndex: "asc" },
          include: { sets: { orderBy: { setIndex: "asc" } } },
        },
      },
    });
    expect(resumed.revision).toBe(6);
    expect(resumed.exercises.map((exercise) => ({
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      orderIndex: exercise.orderIndex,
      sets: exercise.sets.map((set) => ({ id: set.id, setIndex: set.setIndex })),
    }))).toEqual(committedStructure);
    expect(resumed).toMatchObject(originalSeedProvenance);
    expect(readSessionDecisionReceipt(resumed.selectionMetadata)?.sessionProvenance)
      .toEqual(postSwapReceipt?.sessionProvenance);
    expect(await db.workout.count({ where: { id: workout.id } })).toBe(1);
    expect(await db.workoutExercise.count({ where: { workoutId: workout.id } })).toBe(2);
    expect(await db.workoutSet.count({
      where: { workoutExercise: { workoutId: workout.id } },
    })).toBe(3);

    const completion = await db.$transaction(async (tx) => {
      const persisted = await persistWorkoutRow(tx, {
        workoutId: workout.id,
        existingWorkout: { id: workout.id, revision: 6 },
        userId: ownerId,
        expectedRevision: 6,
        shouldAdvanceLifecycleTransition: false,
        resolvedMesocycleId: mesocycle.id,
        workoutUpdateData: { status: "COMPLETED", completedAt },
        workoutCreateData: {},
      });
      const review = await createPostSessionReviewSnapshotInTransaction(tx, {
        userId: ownerId,
        workoutId: workout.id,
        provenance: "exact",
        finalizedAt: completedAt,
      });
      return { persisted, review };
    });
    revisionSequence.push(completion.persisted.workout.revision);
    expect(revisionSequence).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(completion.review.created).toBe(true);
    expect(await db.postSessionReviewSnapshot.count({
      where: { workoutId: workout.id },
    })).toBe(1);

    const storedReviewBeforeReopen = await db.postSessionReviewSnapshot.findUniqueOrThrow({
      where: { workoutId: workout.id },
    });
    const historicalReview = await loadHistoricalPostSessionReview(
      ownerId,
      workout.id,
      db
    );
    expect(historicalReview.status).toBe("ready");
    if (historicalReview.status !== "ready") {
      throw new Error(`HISTORICAL_REVIEW_NOT_READY:${historicalReview.status}`);
    }
    expect(hashPostSessionReviewValue(historicalReview.contract)).toBe(
      historicalReview.metadata.payloadHash
    );
    expect(await buildPostSessionReviewEvidenceFingerprint(db, {
      userId: ownerId,
      workoutId: workout.id,
    })).toBe(historicalReview.metadata.evidenceFingerprint);
    await expect(loadHistoricalPostSessionReview(ownerId, workout.id, db))
      .resolves.toMatchObject({
        status: "ready",
        metadata: {
          snapshotId: storedReviewBeforeReopen.id,
          payloadHash: storedReviewBeforeReopen.payloadHash,
          evidenceFingerprint: storedReviewBeforeReopen.evidenceFingerprint,
        },
      });
    const storedReviewAfterReopen = await db.postSessionReviewSnapshot.findUniqueOrThrow({
      where: { workoutId: workout.id },
    });
    expect(storedReviewAfterReopen).toEqual(storedReviewBeforeReopen);

    const completedWeeklyVolume = await loadMesocycleWeekMuscleVolume(db, {
      userId: ownerId,
      mesocycleId: mesocycle.id,
      targetWeek: 1,
      weekStart: new Date("2026-07-13T00:00:00.000Z"),
      includeBreakdowns: true,
    });
    expect(completedWeeklyVolume.Chest).toMatchObject({
      directSets: 1,
      effectiveSets: 1,
      contributions: [
        expect.objectContaining({
          exerciseId: exerciseAId,
          performedSets: 1,
          effectiveSets: 1,
        }),
      ],
    });

    await db.workout.create({
      data: {
        userId: ownerId,
        scheduledDate: new Date("2026-06-01T12:00:00.000Z"),
        completedAt: new Date("2026-06-01T13:00:00.000Z"),
        status: "COMPLETED",
        selectionMode: "INTENT",
        sessionIntent: "UPPER",
        selectionMetadata: { sessionDecisionReceipt: receipt },
        exercises: {
          create: {
            exerciseId: exerciseVariantId,
            orderIndex: 0,
            section: "ACCESSORY",
            isMainLift: false,
            sets: {
              create: {
                setIndex: 1,
                targetReps: 10,
                logs: {
                  create: {
                    actualReps: 10,
                    actualRpe: 8,
                    actualLoad: 50,
                  },
                },
              },
            },
          },
        },
      },
    });
    const legacyRowId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO "ExerciseExposure" ("id", "userId", "exerciseName", "lastUsedAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $4)`,
      [legacyRowId, ownerId, "Legacy Press Name", new Date("2026-06-01T13:00:00.000Z")]
    );
    const legacyBefore = await pool.query(
      `SELECT * FROM "ExerciseExposure" WHERE "userId" = $1 ORDER BY "id"`,
      [ownerId]
    );
    await db.exercise.update({
      where: { id: exerciseAId },
      data: { name: `Renamed Stable Press ${crypto.randomUUID()}` },
    });
    const stableHistory = await loadExerciseHistory(exerciseAId, ownerId, 3);
    const variantHistory = await loadExerciseHistory(exerciseVariantId, ownerId, 3);
    expect(stableHistory.recentExposures).toHaveLength(1);
    expect(stableHistory.recentExposures[0].sets).toEqual([
      expect.objectContaining({ reps: 10, load: 100, rpe: 8 }),
    ]);
    expect(variantHistory.recentExposures).toHaveLength(1);
    expect(variantHistory.recentExposures[0].sets).toEqual([
      expect.objectContaining({ reps: 10, load: 50, rpe: 8 }),
    ]);
    const legacyAfter = await pool.query(
      `SELECT * FROM "ExerciseExposure" WHERE "userId" = $1 ORDER BY "id"`,
      [ownerId]
    );
    expect(legacyAfter.rows).toEqual(legacyBefore.rows);

    const ownerExplanation = await generateWorkoutExplanation(
      { workoutId: workout.id, ownerId },
      db
    );
    expect(ownerExplanation).not.toHaveProperty("error");
    const foreignExplanation = await generateWorkoutExplanation(
      { workoutId: workout.id, ownerId: foreignOwnerId },
      db
    );
    const missingExplanation = await generateWorkoutExplanation(
      { workoutId: crypto.randomUUID(), ownerId },
      db
    );
    expect(foreignExplanation).toEqual({ error: "Workout not found" });
    expect(missingExplanation).toEqual(foreignExplanation);
  });

  it("rolls back the claim and child mutation when post-claim work fails", async () => {
    const workout = await createWorkout();
    await expect(executeWorkoutMutation(
      { workoutId: workout.id, userId: ownerId, expectedRevision: workout.revision },
      async (tx) => {
        await tx.workoutSet.create({
          data: {
            workoutExerciseId: workout.exercises[0].id,
            setIndex: 2,
            targetReps: 20,
          },
        });
        throw new Error("FORCED_POST_CLAIM_FAILURE");
      },
    )).rejects.toThrow("FORCED_POST_CLAIM_FAILURE");
    expect(await db.workout.findUniqueOrThrow({ where: { id: workout.id } })).toMatchObject({
      revision: workout.revision,
    });
    expect(await db.workoutSet.count({
      where: { workoutExerciseId: workout.exercises[0].id },
    })).toBe(1);
  });

  it("preserves owner isolation without leaking a revision conflict", async () => {
    const workout = await createWorkout();
    await expect(executeWorkoutMutation(
      { workoutId: workout.id, userId: foreignOwnerId, expectedRevision: workout.revision },
      async () => undefined,
    )).rejects.toMatchObject({
      code: "WORKOUT_NOT_FOUND",
      status: 404,
    });
  });
});
