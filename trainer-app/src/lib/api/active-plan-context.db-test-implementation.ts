import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { closePrismaResourcesForAuditCli } from "@/lib/db/prisma";
import {
  selectActivePlan,
  selectSoleCreatedPlanInTransaction,
} from "./active-plan-context";

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

    it("atomically replaces the selected plan without mutating prior plan history", async () => {
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
  });
}
