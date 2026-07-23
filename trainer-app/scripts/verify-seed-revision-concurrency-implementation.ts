import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import {
  createCorrectiveSeedRevisionInTransaction,
  createInitialAcceptedSeedRevisionInTransaction,
  exactSeedRevisionProvenance,
} from "@/lib/api/mesocycle-seed-revision";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function seed(setCount: number) {
  return {
    version: 1,
    source: "postgres_concurrency_verification",
    slots: [{
      slotId: "upper_a",
      exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount }],
    }],
  };
}

export async function runSeedRevisionConcurrencyVerification() {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { email: `seed-revision-${suffix}@test.local` },
  });
  const macrocycle = await prisma.macroCycle.create({
    data: {
      userId: user.id,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-03-31T00:00:00.000Z"),
      durationWeeks: 12,
      trainingAge: "INTERMEDIATE",
      primaryGoal: "HYPERTROPHY",
    },
  });
  const mesocycle = await prisma.mesocycle.create({
    data: {
      macroCycleId: macrocycle.id,
      mesoNumber: 1,
      startWeek: 0,
      durationWeeks: 4,
      focus: "Concurrency verification",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      isActive: true,
      slotPlanSeedJson: seed(3),
    },
  });

  const initial = await prisma.$transaction((tx) =>
    createInitialAcceptedSeedRevisionInTransaction(tx, {
      mesocycleId: mesocycle.id,
      seedPayload: seed(3),
      creationReason: "postgres_verification_initial",
      actorSource: "verify_seed_revision_concurrency",
    }),
  );
  const initialProvenance = exactSeedRevisionProvenance(initial);
  assert(initialProvenance, "INITIAL_EXACT_PROVENANCE_MISSING");

  const rollbackMesocycle = await prisma.mesocycle.create({
    data: {
      macroCycleId: macrocycle.id,
      mesoNumber: 2,
      startWeek: 4,
      durationWeeks: 4,
      focus: "Acceptance rollback verification",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      slotPlanSeedJson: seed(3),
    },
  });
  await prisma.$transaction(async (tx) => {
    await createInitialAcceptedSeedRevisionInTransaction(tx, {
      mesocycleId: rollbackMesocycle.id,
      seedPayload: seed(3),
      creationReason: "postgres_verification_acceptance_rollback",
      actorSource: "verify_seed_revision_concurrency",
    });
    throw new Error("EXPECTED_ACCEPTANCE_ROLLBACK");
  }).catch((error: unknown) => {
    assert(
      error instanceof Error && error.message === "EXPECTED_ACCEPTANCE_ROLLBACK",
      "UNEXPECTED_ACCEPTANCE_ROLLBACK_ERROR",
    );
  });
  const rolledBackAcceptance = await prisma.mesocycle.findUniqueOrThrow({
    where: { id: rollbackMesocycle.id },
    select: { currentSeedRevisionId: true, seedRevisions: { select: { id: true } } },
  });
  assert(rolledBackAcceptance.currentSeedRevisionId === null, "ACCEPTANCE_ROLLBACK_LEFT_ACTIVE_POINTER");
  assert(rolledBackAcceptance.seedRevisions.length === 0, "ACCEPTANCE_ROLLBACK_LEFT_REVISION");

  let releaseGeneration!: () => void;
  let announceGenerationRead!: () => void;
  const generationMayContinue = new Promise<void>((resolve) => {
    releaseGeneration = resolve;
  });
  const generationRead = new Promise<void>((resolve) => {
    announceGenerationRead = resolve;
  });

  const generation = prisma.$transaction(async (tx) => {
    const active = await tx.mesocycle.findUniqueOrThrow({
      where: { id: mesocycle.id },
      select: { currentSeedRevision: true },
    });
    const revision = active.currentSeedRevision;
    assert(revision, "GENERATION_CURRENT_REVISION_MISSING");
    const provenance = exactSeedRevisionProvenance(revision);
    assert(provenance, "GENERATION_EXACT_PROVENANCE_MISSING");
    announceGenerationRead();
    await generationMayContinue;
    return tx.workout.create({
      data: {
        userId: user.id,
        mesocycleId: mesocycle.id,
        scheduledDate: new Date("2026-01-02T00:00:00.000Z"),
        seedRevisionId: provenance.revisionId,
        seedRevisionNumber: provenance.revision,
        seedPayloadHash: provenance.hash,
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 2,
            sessionProvenance: {
              mesocycleId: mesocycle.id,
              compositionSource: "persisted_slot_plan_seed",
              seedProvenance: provenance,
            },
          },
        },
      },
      select: {
        id: true,
        seedRevisionId: true,
        seedRevisionNumber: true,
        seedPayloadHash: true,
      },
    });
  });

  await generationRead;
  const correction = await prisma.$transaction((tx) =>
    createCorrectiveSeedRevisionInTransaction(tx, {
      mesocycleId: mesocycle.id,
      expectedCurrentRevisionId: initial.id,
      seedPayload: seed(4),
      creationReason: "postgres_verification_generation_race",
      actorSource: "verify_seed_revision_concurrency",
    }),
  );
  releaseGeneration();
  const workout = await generation;
  assert(correction.created && correction.revision.revision === 2, "CORRECTION_REVISION_2_MISSING");
  assert(workout.seedRevisionId === initial.id, "GENERATION_REVISION_DRIFTED_DURING_RACE");
  assert(workout.seedPayloadHash === initialProvenance.hash, "GENERATION_HASH_DRIFTED_DURING_RACE");

  const raceInput = {
    mesocycleId: mesocycle.id,
    expectedCurrentRevisionId: correction.revision.id,
    seedPayload: seed(5),
    creationReason: "postgres_verification_concurrent_correction",
    actorSource: "verify_seed_revision_concurrency",
  };
  const competing = await Promise.allSettled([
    prisma.$transaction((tx) => createCorrectiveSeedRevisionInTransaction(tx, raceInput)),
    prisma.$transaction((tx) => createCorrectiveSeedRevisionInTransaction(tx, raceInput)),
  ]);
  assert(competing.filter((result) => result.status === "fulfilled").length === 1, "CONCURRENT_CORRECTION_DID_NOT_HAVE_ONE_WINNER");
  assert(competing.filter((result) => result.status === "rejected").length === 1, "CONCURRENT_CORRECTION_DID_NOT_HAVE_ONE_CONFLICT");

  const beforeRollback = await prisma.mesocycle.findUniqueOrThrow({
    where: { id: mesocycle.id },
    select: { currentSeedRevisionId: true, seedRevisions: { select: { id: true } } },
  });
  await prisma.$transaction(async (tx) => {
    await createCorrectiveSeedRevisionInTransaction(tx, {
      mesocycleId: mesocycle.id,
      expectedCurrentRevisionId: beforeRollback.currentSeedRevisionId ?? undefined,
      seedPayload: seed(6),
      creationReason: "postgres_verification_rollback",
      actorSource: "verify_seed_revision_concurrency",
    });
    throw new Error("EXPECTED_ROLLBACK");
  }).catch((error: unknown) => {
    assert(error instanceof Error && error.message === "EXPECTED_ROLLBACK", "UNEXPECTED_ROLLBACK_ERROR");
  });
  const afterRollback = await prisma.mesocycle.findUniqueOrThrow({
    where: { id: mesocycle.id },
    select: { currentSeedRevisionId: true, seedRevisions: { select: { id: true } } },
  });
  assert(afterRollback.currentSeedRevisionId === beforeRollback.currentSeedRevisionId, "ROLLBACK_CHANGED_ACTIVE_REVISION");
  assert(afterRollback.seedRevisions.length === beforeRollback.seedRevisions.length, "ROLLBACK_LEFT_ORPHAN_REVISION");

  console.log(JSON.stringify({
    status: "pass",
    generationCorrectionRace: "old_revision_preserved",
    concurrentCorrections: "one_winner_one_conflict",
    failedCorrection: "fully_rolled_back",
    failedAcceptance: "fully_rolled_back",
    finalRevisionCount: afterRollback.seedRevisions.length,
  }, null, 2));
}

export async function closeSeedRevisionConcurrencyVerification(): Promise<void> {
  await prisma.$disconnect();
}
