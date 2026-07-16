import { Pool } from "pg";
import {
  runWithRolloutEnvironment,
  sanitizedRolloutEnvironment,
} from "@/lib/operations/rollout-environment";
import {
  assertSeedInventoryWritable,
  buildSeedInventory,
  type SeedInventorySourceRow,
} from "@/lib/operations/seed-revision-rollout";

async function hasRevisionSchema(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ present: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'MesocycleSeedRevision'
    ) AS present
  `);
  return result.rows[0]?.present === true;
}

async function loadRows(pool: Pool): Promise<SeedInventorySourceRow[]> {
  const revisionSchemaPresent = await hasRevisionSchema(pool);
  const result = revisionSchemaPresent
    ? await pool.query<{
        mesocycleId: string;
        state: string;
        isActive: boolean;
        seedPayload: unknown;
        currentRevisionId: string | null;
        currentRevision: number | null;
        provenanceStatus: string | null;
        payloadHash: string | null;
        hashAlgorithm: string | null;
        workoutCount: string;
        completedWorkoutCount: string;
      }>(`
        SELECT m."id" AS "mesocycleId", m."state"::text AS "state", m."isActive",
          COALESCE(r."seedPayload", m."slotPlanSeedJson") AS "seedPayload",
          m."currentSeedRevisionId" AS "currentRevisionId", r."revision" AS "currentRevision",
          r."provenanceStatus", r."payloadHash", r."hashAlgorithm",
          COUNT(w."id")::text AS "workoutCount",
          COUNT(w."id") FILTER (WHERE w."status" = 'COMPLETED')::text AS "completedWorkoutCount"
        FROM "Mesocycle" m
        LEFT JOIN "MesocycleSeedRevision" r ON r."id" = m."currentSeedRevisionId"
        LEFT JOIN "Workout" w ON w."mesocycleId" = m."id"
        GROUP BY m."id", r."id"
        ORDER BY m."id"
      `)
    : await pool.query<{
        mesocycleId: string;
        state: string;
        isActive: boolean;
        seedPayload: unknown;
        workoutCount: string;
        completedWorkoutCount: string;
      }>(`
        SELECT m."id" AS "mesocycleId", m."state"::text AS "state", m."isActive",
          m."slotPlanSeedJson" AS "seedPayload",
          COUNT(w."id")::text AS "workoutCount",
          COUNT(w."id") FILTER (WHERE w."status" = 'COMPLETED')::text AS "completedWorkoutCount"
        FROM "Mesocycle" m
        LEFT JOIN "Workout" w ON w."mesocycleId" = m."id"
        GROUP BY m."id"
        ORDER BY m."id"
      `);

  if (!revisionSchemaPresent) {
    return result.rows.map((row) => ({
      mesocycleId: row.mesocycleId,
      state: row.state,
      isActive: row.isActive,
      seedPayload: row.seedPayload,
      revisionSchemaPresent: false,
      currentRevisionId: null,
      currentRevision: null,
      provenanceStatus: null,
      payloadHash: null,
      hashAlgorithm: null,
      workoutCount: Number(row.workoutCount),
      completedWorkoutCount: Number(row.completedWorkoutCount),
    }));
  }

  return (result.rows as Array<{
    mesocycleId: string;
    state: string;
    isActive: boolean;
    seedPayload: unknown;
    currentRevisionId: string | null;
    currentRevision: number | null;
    provenanceStatus: string | null;
    payloadHash: string | null;
    hashAlgorithm: string | null;
    workoutCount: string;
    completedWorkoutCount: string;
  }>).map((row) => ({
    ...row,
    revisionSchemaPresent: true,
    workoutCount: Number(row.workoutCount),
    completedWorkoutCount: Number(row.completedWorkoutCount),
  }));
}

async function main(): Promise<void> {
  await runWithRolloutEnvironment(
    { argv: process.argv.slice(2), allowWrite: true },
    async (rolloutEnvironment) => {
      console.log(JSON.stringify({ environment: sanitizedRolloutEnvironment(rolloutEnvironment) }));
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        const inventory = buildSeedInventory(await loadRows(pool));
        console.log(JSON.stringify(inventory, null, 2));

        if (!rolloutEnvironment.writeEnabled) return;
        assertSeedInventoryWritable(inventory);

        const [{ prisma }, revisionModule] = await Promise.all([
          import("@/lib/db/prisma"),
          import("@/lib/api/mesocycle-seed-revision"),
        ]);
        try {
          const candidates = inventory.rows.filter(
            (row) => row.classification === "normalizable",
          );
          await prisma.$transaction(async (tx) => {
            for (const candidate of candidates) {
              await revisionModule.promoteLegacySeedRevisionToExactInTransaction(tx, {
                mesocycleId: candidate.mesocycleId,
                actorSource: "backfill_immutable_seed_revisions",
              });
            }
          });
        } catch (error) {
          revisionModule.mapSeedRevisionWriteError(error);
        } finally {
          await prisma.$disconnect();
        }
      } finally {
        await pool.end();
      }
    },
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
