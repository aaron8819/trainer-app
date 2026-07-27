import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { closePrismaResourcesForAuditCli } from "@/lib/db/prisma";
import {
  resolveActivePlanContext,
  selectActivePlan,
  selectSoleCreatedPlanInTransaction,
} from "./active-plan-context";
import {
  archivePlan,
  finalizePlan,
  renamePlan,
} from "./plan-management";

export function registerActivePlanContextDatabaseTests(
  databaseUrl: string
): void {
  describe("active plan foundation (PostgreSQL)", () => {
    let pool: Pool;
    let db: PrismaClient;

    beforeAll(() => {
      pool = new Pool({ connectionString: databaseUrl });
      db = new PrismaClient({ adapter: new PrismaPg(pool) });
    });

    afterAll(async () => {
      await db.$disconnect();
      await pool.end();
      await closePrismaResourcesForAuditCli();
    });

    async function createPlan(ownerId: string, suffix: string) {
      return db.macroCycle.create({
        data: {
          id: crypto.randomUUID(),
          userId: ownerId,
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-06-01"),
          durationWeeks: 20,
          trainingAge: "INTERMEDIATE",
          primaryGoal: "HYPERTROPHY",
          mesocycles: {
            create: [
              {
                id: crypto.randomUUID(),
                mesoNumber: 1,
                startWeek: 0,
                durationWeeks: 5,
                focus: `${suffix} one`,
                volumeTarget: "MODERATE",
                intensityBias: "HYPERTROPHY",
              },
              {
                id: crypto.randomUUID(),
                mesoNumber: 2,
                startWeek: 5,
                durationWeeks: 5,
                focus: `${suffix} two`,
                volumeTarget: "MODERATE",
                intensityBias: "HYPERTROPHY",
              },
            ],
          },
        },
        include: { mesocycles: { orderBy: { mesoNumber: "asc" } } },
      });
    }

    it("prevents duplicate active mesocycles in one macrocycle", async () => {
      const owner = await db.user.create({
        data: {
          email: `constraint-${crypto.randomUUID()}@test.local`,
        },
      });
      const plan = await createPlan(owner.id, "constraint");

      const results = await Promise.allSettled(
        plan.mesocycles.map((mesocycle) =>
          db.mesocycle.update({
            where: { id: mesocycle.id },
            data: { isActive: true },
          })
        )
      );

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      await expect(
        db.mesocycle.count({
          where: { macroCycleId: plan.id, isActive: true },
        })
      ).resolves.toBe(1);
    });

    it("auto-selects only a provably sole first plan", async () => {
      const soleOwner = await db.user.create({
        data: { email: `sole-${crypto.randomUUID()}@test.local` },
      });
      const solePlan = await createPlan(soleOwner.id, "sole");
      const selected = await db.$transaction((tx) =>
        selectSoleCreatedPlanInTransaction(tx, {
          userId: soleOwner.id,
          targetMacroCycleId: solePlan.id,
          targetMesocycleId: solePlan.mesocycles[0].id,
        })
      );
      expect(selected?.activeMacroCycleId).toBe(solePlan.id);

      const ambiguousOwner = await db.user.create({
        data: { email: `ambiguous-${crypto.randomUUID()}@test.local` },
      });
      const [, secondPlan] = await Promise.all([
        createPlan(ambiguousOwner.id, "ambiguous-a"),
        createPlan(ambiguousOwner.id, "ambiguous-b"),
      ]);
      const skipped = await db.$transaction((tx) =>
        selectSoleCreatedPlanInTransaction(tx, {
          userId: ambiguousOwner.id,
          targetMacroCycleId: secondPlan.id,
          targetMesocycleId: secondPlan.mesocycles[0].id,
        })
      );
      const unchangedOwner = await db.user.findUniqueOrThrow({
        where: { id: ambiguousOwner.id },
      });
      expect(skipped).toBeNull();
      expect(unchangedOwner.activeMacroCycleId).toBeNull();
      await expect(
        db.mesocycle.count({
          where: {
            macroCycle: { userId: ambiguousOwner.id },
            isActive: true,
          },
        })
      ).resolves.toBe(0);
    });

    it("atomically selects another READY plan without mutating prior plan history", async () => {
      const owner = await db.user.create({
        data: {
          id: crypto.randomUUID(),
          email: `replace-${crypto.randomUUID()}@test.local`,
        },
      });
      const [planA, planB] = await Promise.all([
        createPlan(owner.id, "plan-a"),
        createPlan(owner.id, "plan-b"),
      ]);
      await db.mesocycle.update({
        where: { id: planA.mesocycles[0].id },
        data: { isActive: true },
      });
      await db.mesocycle.update({
        where: { id: planB.mesocycles[0].id },
        data: { isActive: true },
      });
      await db.user.update({
        where: { id: owner.id },
        data: { activeMacroCycleId: planA.id },
      });

      await selectActivePlan({
        userId: owner.id,
        targetMacroCycleId: planB.id,
        targetMesocycleId: planB.mesocycles[0].id,
        expectedActiveMacroCycleId: planA.id,
      });

      const [updatedOwner, planAActive, planBActive] = await Promise.all([
        db.user.findUniqueOrThrow({ where: { id: owner.id } }),
        db.mesocycle.count({
          where: { macroCycleId: planA.id, isActive: true },
        }),
        db.mesocycle.findMany({
          where: { macroCycleId: planB.id, isActive: true },
        }),
      ]);
      expect(updatedOwner.activeMacroCycleId).toBe(planB.id);
      expect(planAActive).toBe(1);
      expect(planBActive.map((mesocycle) => mesocycle.id)).toEqual([
        planB.mesocycles[0].id,
      ]);
      await expect(resolveActivePlanContext(owner.id)).resolves.toMatchObject({
        status: "READY",
        activeMacroCycle: { id: planB.id },
        activeMesocycle: { id: planB.mesocycles[0].id },
      });
    });

    it("allows one concurrent selection winner and leaves a valid context", async () => {
      const owner = await db.user.create({
        data: {
          id: crypto.randomUUID(),
          email: `concurrent-${crypto.randomUUID()}@test.local`,
        },
      });
      const [planA, planB] = await Promise.all([
        createPlan(owner.id, "concurrent-a"),
        createPlan(owner.id, "concurrent-b"),
      ]);
      await Promise.all([
        db.mesocycle.update({
          where: { id: planA.mesocycles[0].id },
          data: { isActive: true },
        }),
        db.mesocycle.update({
          where: { id: planB.mesocycles[0].id },
          data: { isActive: true },
        }),
      ]);

      const attempts = await Promise.allSettled([
        selectActivePlan({
          userId: owner.id,
          targetMacroCycleId: planA.id,
          targetMesocycleId: planA.mesocycles[0].id,
          expectedActiveMacroCycleId: null,
        }),
        selectActivePlan({
          userId: owner.id,
          targetMacroCycleId: planB.id,
          targetMesocycleId: planB.mesocycles[0].id,
          expectedActiveMacroCycleId: null,
        }),
      ]);

      expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
      const updatedOwner = await db.user.findUniqueOrThrow({
        where: { id: owner.id },
      });
      const selectedActive = await db.mesocycle.findMany({
        where: {
          macroCycleId: updatedOwner.activeMacroCycleId!,
          isActive: true,
        },
      });
      expect(selectedActive).toHaveLength(1);
    });

    it("finalizes a generated plan as READY without silently selecting it", async () => {
      const owner = await db.user.create({
        data: {
          id: crypto.randomUUID(),
          email: `finalize-${crypto.randomUUID()}@test.local`,
        },
      });
      const [planA, planB] = await Promise.all([
        createPlan(owner.id, "finalize-a"),
        createPlan(owner.id, "finalize-b"),
      ]);
      await db.mesocycle.update({
        where: { id: planA.mesocycles[0].id },
        data: { isActive: true },
      });
      await db.user.update({
        where: { id: owner.id },
        data: { activeMacroCycleId: planA.id },
      });

      const finalized = await finalizePlan({
        userId: owner.id,
        planId: planB.id,
        expectedUpdatedAt: planB.updatedAt.toISOString(),
      });

      expect(finalized).toMatchObject({
        id: planB.id,
        status: "READY",
        isActive: false,
        activeMesocycleId: planB.mesocycles[0].id,
      });
      await expect(
        db.user.findUniqueOrThrow({ where: { id: owner.id } }),
      ).resolves.toMatchObject({ activeMacroCycleId: planA.id });
    });

    it("blocks switching while a workout is in progress and keeps the prior selection", async () => {
      const owner = await db.user.create({
        data: {
          id: crypto.randomUUID(),
          email: `in-progress-${crypto.randomUUID()}@test.local`,
        },
      });
      const [planA, planB] = await Promise.all([
        createPlan(owner.id, "in-progress-a"),
        createPlan(owner.id, "in-progress-b"),
      ]);
      await Promise.all([
        db.mesocycle.update({
          where: { id: planA.mesocycles[0].id },
          data: { isActive: true },
        }),
        db.mesocycle.update({
          where: { id: planB.mesocycles[0].id },
          data: { isActive: true },
        }),
      ]);
      await db.user.update({
        where: { id: owner.id },
        data: { activeMacroCycleId: planA.id },
      });
      const workout = await db.workout.create({
        data: {
          userId: owner.id,
          scheduledDate: new Date(),
          status: "IN_PROGRESS",
          mesocycleId: planA.mesocycles[0].id,
        },
      });

      await expect(
        selectActivePlan({
          userId: owner.id,
          targetMacroCycleId: planB.id,
          targetMesocycleId: planB.mesocycles[0].id,
          expectedActiveMacroCycleId: planA.id,
        }),
      ).rejects.toMatchObject({
        message: "ACTIVE_WORKOUT_IN_PROGRESS",
        workoutId: workout.id,
      });
      await expect(
        db.user.findUniqueOrThrow({ where: { id: owner.id } }),
      ).resolves.toMatchObject({ activeMacroCycleId: planA.id });
    });

    it("renames and archives only through fresh inactive-plan versions while preserving history", async () => {
      const owner = await db.user.create({
        data: {
          id: crypto.randomUUID(),
          email: `archive-${crypto.randomUUID()}@test.local`,
        },
      });
      const [planA, planB] = await Promise.all([
        createPlan(owner.id, "archive-a"),
        createPlan(owner.id, "archive-b"),
      ]);
      await db.mesocycle.update({
        where: { id: planA.mesocycles[0].id },
        data: { isActive: true },
      });
      await db.user.update({
        where: { id: owner.id },
        data: { activeMacroCycleId: planA.id },
      });
      const historicalWorkout = await db.workout.create({
        data: {
          userId: owner.id,
          scheduledDate: new Date("2026-06-01"),
          status: "COMPLETED",
          completedAt: new Date("2026-06-01T12:00:00Z"),
          mesocycleId: planB.mesocycles[0].id,
        },
      });

      const renamed = await renamePlan({
        userId: owner.id,
        planId: planB.id,
        name: "Archived History",
        expectedUpdatedAt: planB.updatedAt.toISOString(),
      });
      await expect(
        renamePlan({
          userId: owner.id,
          planId: planB.id,
          name: "Stale Rename",
          expectedUpdatedAt: planB.updatedAt.toISOString(),
        }),
      ).rejects.toMatchObject({ code: "PLAN_MUTATION_CONFLICT" });
      await archivePlan({
        userId: owner.id,
        planId: planB.id,
        expectedUpdatedAt: renamed.updatedAt,
      });

      await expect(
        db.macroCycle.findUniqueOrThrow({ where: { id: planB.id } }),
      ).resolves.toMatchObject({
        name: "Archived History",
        archivedAt: expect.any(Date),
      });
      await expect(
        db.workout.findUniqueOrThrow({ where: { id: historicalWorkout.id } }),
      ).resolves.toMatchObject({
        mesocycleId: planB.mesocycles[0].id,
        status: "COMPLETED",
      });
    });

    it("prevents archiving the active plan", async () => {
      const owner = await db.user.create({
        data: {
          id: crypto.randomUUID(),
          email: `archive-active-${crypto.randomUUID()}@test.local`,
        },
      });
      const plan = await createPlan(owner.id, "archive-active");
      await db.mesocycle.update({
        where: { id: plan.mesocycles[0].id },
        data: { isActive: true },
      });
      await db.user.update({
        where: { id: owner.id },
        data: { activeMacroCycleId: plan.id },
      });

      await expect(
        archivePlan({
          userId: owner.id,
          planId: plan.id,
          expectedUpdatedAt: plan.updatedAt.toISOString(),
        }),
      ).rejects.toMatchObject({
        code: "ACTIVE_PLAN_ARCHIVE_FORBIDDEN",
      });
    });
  });
}
