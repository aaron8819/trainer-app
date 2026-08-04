import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  archiveFinisherRoutine,
  createUserFinisherRoutine,
  deleteFinisherRoutine,
  duplicateFinisherRoutine,
  editUserFinisherRoutine,
  loadFinisherLibrary,
  loadFinisherLibraryItem,
  reorderFinisherLibrary,
  restoreFinisherRoutine,
} from "./finisher-library-service";
import {
  createFinisherOffer,
  getFinisherOffer,
  selectFinisher,
  startFinisher,
  syncFinisher,
} from "./finisher-service";
import type { FinisherRoutineDefinition } from "@/lib/validation";

const routineDefinition = (
  name: string,
  workSeconds = 1,
): FinisherRoutineDefinition => ({
  name,
  description: `${name} definition`,
  category: "CORE",
  difficulty: "EASY",
  fatigueCost: "LOW",
  impactLevel: "LOW",
  bodyRegions: ["core"],
  limitationTags: [],
  preparationSeconds: 0,
  includesFinalRecovery: false,
  steps: [
    {
      movementName: `${name} hold`,
      workSeconds,
      recoverySeconds: 0,
      techniqueCues: ["Stay controlled"],
      alternatives: [`Supported ${name} hold`],
    },
  ],
});

export function registerFinisherLibraryServiceDatabaseTests(
  databaseUrl: string,
): void {
  describe("Finisher library service (PostgreSQL)", () => {
    let pool: Pool;
    let client: PrismaClient;

    beforeAll(() => {
      pool = new Pool({ connectionString: databaseUrl });
      client = new PrismaClient({ adapter: new PrismaPg(pool) });
    });

    afterAll(async () => {
      await client.$disconnect();
      await pool.end();
    });

    async function owner(label: string): Promise<string> {
      return (
        await client.user.create({
          data: { email: `finisher-library-${label}-${crypto.randomUUID()}@test.local` },
        })
      ).id;
    }

    async function completedWorkout(ownerId: string) {
      return client.workout.create({
        data: {
          userId: ownerId,
          scheduledDate: new Date("2026-08-03T12:00:00.000Z"),
          completedAt: new Date("2026-08-03T13:00:00.000Z"),
          status: "COMPLETED",
          sessionIntent: "PUSH",
        },
      });
    }

    async function appendRoutineVersion(
      routineId: string,
      version: number,
      definition: FinisherRoutineDefinition,
    ): Promise<string> {
      return client.$transaction(async (tx) => {
        const created = await tx.finisherRoutineVersion.create({
          data: {
            routineId,
            version,
            name: definition.name,
            description: definition.description,
            category: definition.category,
            placement: "POST_WORKOUT",
            kind: "FINISHER",
            protocol: "TIMED_INTERVALS",
            difficulty: definition.difficulty,
            fatigueCost: definition.fatigueCost,
            impactLevel: definition.impactLevel,
            preparationSeconds: definition.preparationSeconds,
            includesFinalRecovery: definition.includesFinalRecovery,
            equipmentRequirements: [],
            bodyRegions: definition.bodyRegions,
            limitationTags: definition.limitationTags,
            steps: {
              create: definition.steps.map((step, orderIndex) => ({
                orderIndex,
                movementName: step.movementName,
                workSeconds: step.workSeconds,
                recoverySeconds: step.recoverySeconds,
                techniqueCues: step.techniqueCues,
                alternatives: {
                  create: step.alternatives.map((movementName, alternativeIndex) => ({
                    orderIndex: alternativeIndex,
                    movementName,
                  })),
                },
              })),
            },
          },
          select: { id: true },
        });
        await tx.finisherRoutineVersion.update({
          where: { id: created.id },
          data: { sealedAt: new Date() },
        });
        return created.id;
      });
    }

    async function ownerCreationCounts(ownerId: string) {
      const [routines, versions, overlays] = await Promise.all([
        client.finisherRoutine.count({ where: { ownerId } }),
        client.finisherRoutineVersion.count({
          where: { routine: { ownerId } },
        }),
        client.finisherLibraryItem.count({ where: { ownerId } }),
      ]);
      return { routines, versions, overlays };
    }

    async function overlaySnapshot(ownerId: string) {
      return client.finisherLibraryItem.findMany({
        where: { ownerId },
        orderBy: { routineId: "asc" },
        select: {
          ownerId: true,
          routineId: true,
          state: true,
          activePosition: true,
          revision: true,
          archivedAt: true,
          restoredAt: true,
          deletedAt: true,
        },
      });
    }

    it("applies the additive ownership, overlay, and zero-item offer migration", async () => {
      const facts = await client.$queryRaw<
        Array<{
          ownerColumn: boolean;
          overlayTable: boolean;
          offerConstraint: boolean;
          migrationApplied: boolean;
        }>
      >`
        SELECT
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'FinisherRoutine' AND column_name = 'ownerId'
          ) AS "ownerColumn",
          to_regclass('"FinisherLibraryItem"') IS NOT NULL AS "overlayTable",
          EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'FinisherOffer_item_count_nonnegative'
          ) AS "offerConstraint",
          EXISTS (
            SELECT 1 FROM "_prisma_migrations"
            WHERE migration_name = '20260803120000_add_finisher_management'
              AND finished_at IS NOT NULL
              AND rolled_back_at IS NULL
          ) AS "migrationApplied"
      `;
      expect(facts[0]).toEqual({
        ownerColumn: true,
        overlayTable: true,
        offerConstraint: true,
        migrationApplied: true,
      });
    });

    it("enforces owner-aligned immutable library item identity in PostgreSQL", async () => {
      const connection = await pool.connect();
      const ownerId = crypto.randomUUID();
      const foreignOwnerId = crypto.randomUUID();
      const ownedRoutineId = crypto.randomUUID();
      const systemRoutineId = crypto.randomUUID();
      const replacementRoutineId = crypto.randomUUID();

      try {
        await connection.query("BEGIN");
        await connection.query(
          `INSERT INTO "User" ("id", "email") VALUES ($1, $2), ($3, $4)`,
          [
            ownerId,
            `finisher-library-overlay-owner-${crypto.randomUUID()}@test.local`,
            foreignOwnerId,
            `finisher-library-overlay-foreign-${crypto.randomUUID()}@test.local`,
          ],
        );
        await connection.query(
          `INSERT INTO "FinisherRoutine" ("id", "code", "ownerId")
           VALUES ($1, $2, $3), ($4, $5, NULL), ($6, $7, $3)`,
          [
            ownedRoutineId,
            `owned-overlay-${crypto.randomUUID()}`,
            ownerId,
            systemRoutineId,
            `system-overlay-${crypto.randomUUID()}`,
            replacementRoutineId,
            `replacement-overlay-${crypto.randomUUID()}`,
          ],
        );

        await expect(
          connection.query(
            `INSERT INTO "FinisherLibraryItem"
              ("ownerId", "routineId", "activePosition", "updatedAt")
             VALUES ($1, $2, 0, statement_timestamp())`,
            [ownerId, ownedRoutineId],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
        await expect(
          connection.query(
            `INSERT INTO "FinisherLibraryItem"
              ("ownerId", "routineId", "activePosition", "updatedAt")
             VALUES ($1, $2, 1, statement_timestamp())`,
            [ownerId, systemRoutineId],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });

        await connection.query("SAVEPOINT invalid_owner_insert");
        await expect(
          connection.query(
            `INSERT INTO "FinisherLibraryItem"
              ("ownerId", "routineId", "activePosition", "updatedAt")
             VALUES ($1, $2, 0, statement_timestamp())`,
            [foreignOwnerId, ownedRoutineId],
          ),
        ).rejects.toThrow(/finisher library item owner must match routine owner/);
        await connection.query("ROLLBACK TO SAVEPOINT invalid_owner_insert");

        await connection.query("SAVEPOINT invalid_owner_update");
        await expect(
          connection.query(
            `UPDATE "FinisherLibraryItem" SET "ownerId" = $1
             WHERE "ownerId" = $2 AND "routineId" = $3`,
            [foreignOwnerId, ownerId, systemRoutineId],
          ),
        ).rejects.toThrow(/finisher library item identity is immutable/);
        await connection.query("ROLLBACK TO SAVEPOINT invalid_owner_update");

        await connection.query("SAVEPOINT invalid_routine_update");
        await expect(
          connection.query(
            `UPDATE "FinisherLibraryItem" SET "routineId" = $1
             WHERE "ownerId" = $2 AND "routineId" = $3`,
            [replacementRoutineId, ownerId, systemRoutineId],
          ),
        ).rejects.toThrow(/finisher library item identity is immutable/);
        await connection.query("ROLLBACK TO SAVEPOINT invalid_routine_update");

        await expect(
          connection.query(
            `SELECT "ownerId", "routineId" FROM "FinisherLibraryItem"
             WHERE "ownerId" = $1 ORDER BY "activePosition"`,
            [ownerId],
          ),
        ).resolves.toMatchObject({
          rows: [
            { ownerId, routineId: ownedRoutineId },
            { ownerId, routineId: systemRoutineId },
          ],
        });
      } finally {
        await connection.query("ROLLBACK");
        connection.release();
      }
    });

    it("materializes default-active system routines on the first mutation and enforces CAS", async () => {
      const ownerId = await owner("materialize");
      const initial = await loadFinisherLibrary(ownerId);
      expect(initial.active.length).toBeGreaterThan(0);
      expect(initial.active.every((item) => item.ownership === "SYSTEM")).toBe(true);
      expect(initial.active.every((item) => item.revision === 0)).toBe(true);
      expect(
        await client.finisherLibraryItem.count({ where: { ownerId } }),
      ).toBe(0);

      const target = initial.active[0]!;
      const archived = await archiveFinisherRoutine({
        ownerId,
        routineId: target.routineId,
        expectedRevision: 0,
      });
      expect(archived.archived.map((item) => item.routineId)).toContain(
        target.routineId,
      );
      expect(
        await client.finisherLibraryItem.count({ where: { ownerId } }),
      ).toBe(initial.active.length);
      const beforeStaleRestore = await overlaySnapshot(ownerId);
      await expect(
        restoreFinisherRoutine({
          ownerId,
          routineId: target.routineId,
          expectedRevision: 0,
        }),
      ).rejects.toMatchObject({ code: "FINISHER_LIBRARY_STALE", status: 409 });
      expect(await overlaySnapshot(ownerId)).toEqual(beforeStaleRestore);

      const archivedTarget = archived.archived.find(
        (item) => item.routineId === target.routineId,
      )!;
      const restored = await restoreFinisherRoutine({
        ownerId,
        routineId: target.routineId,
        expectedRevision: archivedTarget.revision,
      });
      expect(restored.active.at(-1)?.routineId).toBe(target.routineId);
    });

    it("validates and persists personal order atomically into new offers", async () => {
      const ownerId = await owner("order");
      const initial = await loadFinisherLibrary(ownerId);
      const desired = [...initial.active].reverse();
      const reordered = await reorderFinisherLibrary({
        ownerId,
        items: desired.map((item) => ({
          routineId: item.routineId,
          expectedRevision: item.revision,
        })),
      });
      expect(reordered.active.map((item) => item.routineId)).toEqual(
        desired.map((item) => item.routineId),
      );
      await expect(
        reorderFinisherLibrary({
          ownerId,
          items: desired.map((item) => ({
            routineId: item.routineId,
            expectedRevision: item.revision,
          })),
        }),
      ).rejects.toMatchObject({ code: "FINISHER_LIBRARY_STALE", status: 409 });

      const workout = await completedWorkout(ownerId);
      const offer = await createFinisherOffer({
        userId: ownerId,
        workoutId: workout.id,
      });
      expect(offer.routines.map((routine) => routine.routineId)).toEqual(
        reordered.active.map((item) => item.routineId),
      );

      const foreignOwnerId = await owner("order-foreign");
      const foreign = await createUserFinisherRoutine({
        ownerId: foreignOwnerId,
        definition: routineDefinition("Foreign order item"),
      });
      const validItems = reordered.active.map((item) => ({
        routineId: item.routineId,
        expectedRevision: item.revision,
      }));
      expect(validItems.length).toBeGreaterThan(1);
      const rejectedOrders = [
        validItems.slice(0, -1),
        validItems.map((item, index) =>
          index === validItems.length - 1 ? validItems[0]! : item,
        ),
        validItems.map((item, index) =>
          index === validItems.length - 1
            ? {
                routineId: foreign.routineId,
                expectedRevision: foreign.revision,
              }
            : item,
        ),
      ];
      for (const items of rejectedOrders) {
        const before = await overlaySnapshot(ownerId);
        await expect(
          reorderFinisherLibrary({ ownerId, items }),
        ).rejects.toMatchObject({ status: 409 });
        expect(await overlaySnapshot(ownerId)).toEqual(before);
      }
    });

    it("creates, duplicates, and edits through immutable N+1 while frozen history retains N", async () => {
      const ownerId = await owner("versions");
      const created = await createUserFinisherRoutine({
        ownerId,
        definition: routineDefinition("Versioned Core"),
      });
      expect(created.ownership).toBe("USER");
      expect(created.routine.version).toBe(1);
      expect(created.routine.equipmentRequirements).toEqual([]);

      const workout = await completedWorkout(ownerId);
      const frozenOffer = await createFinisherOffer({
        userId: ownerId,
        workoutId: workout.id,
        now: new Date("2026-08-03T14:00:00.000Z"),
      });
      const frozenVersionId = frozenOffer.routines.find(
        (routine) => routine.routineId === created.routineId,
      )!.id;

      const edited = await editUserFinisherRoutine({
        ownerId,
        routineId: created.routineId,
        expectedRevision: created.revision,
        definition: routineDefinition("Versioned Core Updated"),
      });
      expect(edited.routine.version).toBe(2);
      const versions = await client.finisherRoutineVersion.findMany({
        where: { routineId: created.routineId },
        orderBy: { version: "asc" },
      });
      expect(versions.map((version) => [version.version, version.name])).toEqual([
        [1, "Versioned Core"],
        [2, "Versioned Core Updated"],
      ]);
      expect(
        await client.finisherOfferItem.findFirstOrThrow({
          where: { offerId: frozenOffer.offer!.id, routineVersionId: frozenVersionId },
        }),
      ).toBeTruthy();
      await expect(
        editUserFinisherRoutine({
          ownerId,
          routineId: created.routineId,
          expectedRevision: created.revision,
          definition: routineDefinition("Stale edit"),
        }),
      ).rejects.toMatchObject({ code: "FINISHER_LIBRARY_STALE", status: 409 });

      const duplicated = await duplicateFinisherRoutine({
        ownerId,
        routineId: created.routineId,
        expectedRoutineVersionId: edited.routine.id,
      });
      expect(duplicated.routineId).not.toBe(created.routineId);
      expect(duplicated.routine.name).toBe("Versioned Core Updated Copy");
      expect(
        await client.finisherRoutine.findUniqueOrThrow({
          where: { id: duplicated.routineId },
          select: { ownerId: true },
        }),
      ).toEqual({ ownerId });
    });

    it("rejects duplication when a user or system definition advances after review", async () => {
      const ownerId = await owner("stale-duplicate");
      const created = await createUserFinisherRoutine({
        ownerId,
        definition: routineDefinition("Reviewed user routine"),
      });
      await editUserFinisherRoutine({
        ownerId,
        routineId: created.routineId,
        expectedRevision: created.revision,
        definition: routineDefinition("Advanced user routine"),
      });
      const beforeUserRejection = await ownerCreationCounts(ownerId);
      await expect(
        duplicateFinisherRoutine({
          ownerId,
          routineId: created.routineId,
          expectedRoutineVersionId: created.routine.id,
        }),
      ).rejects.toMatchObject({ code: "FINISHER_LIBRARY_STALE", status: 409 });
      expect(await ownerCreationCounts(ownerId)).toEqual(beforeUserRejection);

      const systemRoutine = await client.finisherRoutine.create({
        data: {
          code: `stale-system-${crypto.randomUUID()}`,
          publicationState: "RETIRED",
          retiredAt: new Date(),
        },
      });
      const reviewedSystemVersionId = await appendRoutineVersion(
        systemRoutine.id,
        1,
        routineDefinition("Reviewed system routine"),
      );
      await appendRoutineVersion(
        systemRoutine.id,
        2,
        routineDefinition("Advanced system routine"),
      );
      await client.finisherRoutine.update({
        where: { id: systemRoutine.id },
        data: { publicationState: "ACTIVE", retiredAt: null },
      });
      try {
        const beforeSystemRejection = await ownerCreationCounts(ownerId);
        await expect(
          duplicateFinisherRoutine({
            ownerId,
            routineId: systemRoutine.id,
            expectedRoutineVersionId: reviewedSystemVersionId,
          }),
        ).rejects.toMatchObject({
          code: "FINISHER_LIBRARY_STALE",
          status: 409,
        });
        expect(await ownerCreationCounts(ownerId)).toEqual(beforeSystemRejection);
      } finally {
        await client.finisherRoutine.update({
          where: { id: systemRoutine.id },
          data: { publicationState: "RETIRED", retiredAt: new Date() },
        });
      }
    });

    it("returns 404 for foreign IDs and blocks system product deletion", async () => {
      const [ownerId, foreignOwnerId] = await Promise.all([
        owner("isolation-owner"),
        owner("isolation-foreign"),
      ]);
      const created = await createUserFinisherRoutine({
        ownerId,
        definition: routineDefinition("Private Core"),
      });
      expect(
        await loadFinisherLibraryItem(foreignOwnerId, created.routineId),
      ).toBeNull();
      const beforeForeignArchive = await overlaySnapshot(ownerId);
      await expect(
        archiveFinisherRoutine({
          ownerId: foreignOwnerId,
          routineId: created.routineId,
          expectedRevision: created.revision,
        }),
      ).rejects.toMatchObject({ code: "FINISHER_ROUTINE_NOT_FOUND", status: 404 });
      expect(await overlaySnapshot(ownerId)).toEqual(beforeForeignArchive);
      await expect(
        deleteFinisherRoutine({
          ownerId: foreignOwnerId,
          routineId: created.routineId,
          expectedRevision: created.revision,
        }),
      ).rejects.toMatchObject({ code: "FINISHER_ROUTINE_NOT_FOUND", status: 404 });

      const system = (await loadFinisherLibrary(ownerId)).active.find(
        (item) => item.ownership === "SYSTEM",
      )!;
      await expect(
        deleteFinisherRoutine({
          ownerId,
          routineId: system.routineId,
          expectedRevision: system.revision,
        }),
      ).rejects.toMatchObject({
        code: "FINISHER_SYSTEM_ROUTINE_DELETE_FORBIDDEN",
        status: 409,
      });
    });

    it("blocks deletion for selected execution and preserves completed version history after deletion", async () => {
      const ownerId = await owner("delete-history");
      const blocked = await createUserFinisherRoutine({
        ownerId,
        definition: routineDefinition("Selected Core"),
      });
      const selectedWorkout = await completedWorkout(ownerId);
      const selectedOffer = await createFinisherOffer({
        userId: ownerId,
        workoutId: selectedWorkout.id,
      });
      await selectFinisher({
        userId: ownerId,
        workoutId: selectedWorkout.id,
        offerId: selectedOffer.offer!.id,
        expectedOfferRevision: selectedOffer.offer!.revision,
        executionId: crypto.randomUUID(),
        routineVersionId: blocked.routine.id,
      });
      await expect(
        deleteFinisherRoutine({
          ownerId,
          routineId: blocked.routineId,
          expectedRevision: blocked.revision,
        }),
      ).rejects.toMatchObject({ code: "FINISHER_ROUTINE_DELETE_BLOCKED", status: 409 });

      const completed = await createUserFinisherRoutine({
        ownerId,
        definition: routineDefinition("Completed Core"),
      });
      const completedWorkoutRow = await completedWorkout(ownerId);
      const completedOffer = await createFinisherOffer({
        userId: ownerId,
        workoutId: completedWorkoutRow.id,
        now: new Date("2026-08-03T15:00:00.000Z"),
      });
      const executionId = crypto.randomUUID();
      await selectFinisher({
        userId: ownerId,
        workoutId: completedWorkoutRow.id,
        offerId: completedOffer.offer!.id,
        expectedOfferRevision: completedOffer.offer!.revision,
        executionId,
        routineVersionId: completed.routine.id,
        now: new Date("2026-08-03T15:00:01.000Z"),
      });
      const started = await startFinisher({
        userId: ownerId,
        workoutId: completedWorkoutRow.id,
        executionId,
        expectedRevision: 1,
        commandId: crypto.randomUUID(),
        now: new Date("2026-08-03T15:00:02.000Z"),
      });
      const finished = await syncFinisher({
        userId: ownerId,
        workoutId: completedWorkoutRow.id,
        executionId,
        expectedRevision: started.revision,
        commandId: crypto.randomUUID(),
        now: new Date("2026-08-03T15:00:04.000Z"),
      });
      expect(finished.state).toBe("COMPLETED");

      await deleteFinisherRoutine({
        ownerId,
        routineId: completed.routineId,
        expectedRevision: completed.revision,
      });
      expect(await loadFinisherLibraryItem(ownerId, completed.routineId)).toBeNull();
      const history = await getFinisherOffer({
        userId: ownerId,
        workoutId: completedWorkoutRow.id,
      });
      expect(history.history.find((entry) => entry.id === executionId)?.routine).toMatchObject({
        routineId: completed.routineId,
        version: 1,
        name: "Completed Core",
      });
    });

    it("finalizes a zero-item offer when the entire logical library is archived", async () => {
      const ownerId = await owner("empty");
      let library = await loadFinisherLibrary(ownerId);
      while (library.active.length > 0) {
        const target = library.active[0]!;
        library = await archiveFinisherRoutine({
          ownerId,
          routineId: target.routineId,
          expectedRevision: target.revision,
        });
      }
      const workout = await completedWorkout(ownerId);
      const offer = await createFinisherOffer({
        userId: ownerId,
        workoutId: workout.id,
      });
      expect(offer.offer).not.toBeNull();
      expect(offer.routines).toEqual([]);
      expect(offer.recommendation).toBeNull();
      expect(
        await client.finisherOffer.findUniqueOrThrow({
          where: { workoutId: workout.id },
          select: { itemCount: true, finalizedAt: true },
        }),
      ).toMatchObject({ itemCount: 0, finalizedAt: expect.any(Date) });
    });
  });
}
