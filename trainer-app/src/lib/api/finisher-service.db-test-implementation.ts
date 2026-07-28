import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  endFinisher,
  pauseFinisher,
  resumeFinisher,
  selectFinisher,
  skipFinisherStep,
  startFinisher,
  substituteFinisherStep,
  syncFinisher,
} from "./finisher-service";

export function registerFinisherServiceDatabaseTests(databaseUrl: string): void {
  describe("Finisher service (PostgreSQL)", () => {
    let pool: Pool;
    let client: PrismaClient;
    let ownerId: string;
    let foreignOwnerId: string;
    let routineVersionId: string;
    let alternativeId: string;

    const now = new Date("2026-07-28T12:00:00.000Z");

    beforeAll(async () => {
      pool = new Pool({ connectionString: databaseUrl });
      client = new PrismaClient({ adapter: new PrismaPg(pool) });
      const suffix = crypto.randomUUID();
      const [owner, foreignOwner] = await Promise.all([
        client.user.create({
          data: { email: `finisher-owner-${suffix}@test.local` },
        }),
        client.user.create({
          data: { email: `finisher-foreign-${suffix}@test.local` },
        }),
      ]);
      ownerId = owner.id;
      foreignOwnerId = foreignOwner.id;
      const routine = await client.finisherRoutine.create({
        data: {
          code: `finisher-db-${suffix}`,
          versions: {
            create: {
              version: 1,
              name: `Finisher DB ${suffix}`,
              description: "Disposable database fixture",
              category: "CORE",
              difficulty: "EASY",
              fatigueCost: "LOW",
              impactLevel: "LOW",
              preparationSeconds: 0,
              includesFinalRecovery: true,
              equipmentRequirements: ["BODYWEIGHT"],
              bodyRegions: ["core"],
              limitationTags: [],
              steps: {
                create: [
                  {
                    orderIndex: 0,
                    movementName: "Prescribed Hold",
                    workSeconds: 40,
                    recoverySeconds: 20,
                    alternatives: {
                      create: {
                        orderIndex: 0,
                        movementName: "Allowed Hold",
                      },
                    },
                  },
                  {
                    orderIndex: 1,
                    movementName: "Second Hold",
                    workSeconds: 40,
                    recoverySeconds: 20,
                  },
                ],
              },
            },
          },
        },
        include: {
          versions: {
            include: {
              steps: {
                include: { alternatives: true },
                orderBy: { orderIndex: "asc" },
              },
            },
          },
        },
      });
      routineVersionId = routine.versions[0]!.id;
      alternativeId = routine.versions[0]!.steps[0]!.alternatives[0]!.id;
    });

    afterAll(async () => {
      await client?.$disconnect();
      await pool?.end();
    });

    function createWorkout(
      status: "PLANNED" | "COMPLETED",
      sessionIntent: "PUSH" | "LEGS" = "PUSH"
    ) {
      return client.workout.create({
        data: {
          userId: ownerId,
          scheduledDate: now,
          completedAt: status === "COMPLETED" ? now : null,
          status,
          sessionIntent,
          selectionMode: sessionIntent === "LEGS" ? "MANUAL" : "AUTO",
        },
      });
    }

    it("rejects pre-completion and cross-user starts with owner-scoped errors", async () => {
      const planned = await createWorkout("PLANNED");
      await expect(
        startFinisher({
          userId: ownerId,
          workoutId: planned.id,
          routineVersionId,
          now,
        })
      ).rejects.toMatchObject({
        code: "WORKOUT_NOT_COMPLETED",
        status: 409,
      });

      const completed = await createWorkout("COMPLETED");
      await expect(
        startFinisher({
          userId: foreignOwnerId,
          workoutId: completed.id,
          routineVersionId,
          now,
        })
      ).rejects.toMatchObject({
        code: "WORKOUT_NOT_FOUND",
        status: 404,
      });
    });

    it("enforces one execution under concurrency and makes exact duplicate starts deterministic", async () => {
      const workout = await createWorkout("COMPLETED", "LEGS");
      const results = await Promise.allSettled([
        startFinisher({
          userId: ownerId,
          workoutId: workout.id,
          routineVersionId,
          now,
        }),
        startFinisher({
          userId: ownerId,
          workoutId: workout.id,
          routineVersionId,
          now,
        }),
      ]);
      expect(results.some((result) => result.status === "fulfilled")).toBe(true);
      expect(
        await client.finisherExecution.count({
          where: { workoutId: workout.id },
        })
      ).toBe(1);

      const retry = await startFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      expect(retry.workoutId).toBe(workout.id);
      expect(retry.routineVersionId).toBe(routineVersionId);
    });

    it("keeps selected-only routines out of performed history", async () => {
      const workout = await createWorkout("COMPLETED");
      await selectFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const selected = await client.finisherExecution.findUniqueOrThrow({
        where: { workoutId: workout.id },
      });
      expect(selected.state).toBe("SELECTED");
      expect(selected.startedAt).toBeNull();
      expect(
        await client.finisherExecution.count({
          where: { workoutId: workout.id, startedAt: { not: null } },
        })
      ).toBe(0);
    });

    it("retains prescribed and performed truth and never changes workout completion", async () => {
      const workout = await createWorkout("COMPLETED");
      const started = await startFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const substituted = await substituteFinisherStep({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: started.revision,
        alternativeId,
        now: new Date(now.getTime() + 5_000),
      });
      const skipped = await skipFinisherStep({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: substituted.timer.revision,
        now: new Date(now.getTime() + 10_000),
      });
      const partial = await endFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: skipped.timer.revision,
        now: new Date(now.getTime() + 15_000),
      });
      expect(partial.state).toBe("PARTIAL");
      expect(partial.completedAt).toBeNull();

      const step = await client.finisherExecutionStep.findFirstOrThrow({
        where: {
          execution: { workoutId: workout.id },
          routineStep: { orderIndex: 0 },
        },
        include: {
          routineStep: true,
          performedAlternative: true,
        },
      });
      expect(step.routineStep.movementName).toBe("Prescribed Hold");
      expect(step.performedAlternative?.movementName).toBe("Allowed Hold");
      expect(step.status).toBe("SKIPPED");
      expect(
        await client.workout.findUniqueOrThrow({
          where: { id: workout.id },
          select: { status: true, completedAt: true },
        })
      ).toMatchObject({ status: "COMPLETED", completedAt: now });
    });

    it("persists paused time and completes with skipped steps resolved", async () => {
      const workout = await createWorkout("COMPLETED");
      const started = await startFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const pausedAt = new Date(now.getTime() + 10_000);
      const paused = await pauseFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: started.revision,
        now: pausedAt,
      });
      expect(paused.timer.pausedRemainingMs).toBe(30_000);

      const resumedAt = new Date(now.getTime() + 40_000);
      const resumed = await resumeFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: paused.timer.revision,
        now: resumedAt,
      });
      expect(
        await client.finisherExecution.findUniqueOrThrow({
          where: { workoutId: workout.id },
          select: { totalPausedMs: true },
        })
      ).toEqual({ totalPausedMs: 30_000 });
      expect(resumed.timer.segmentEndsAt).toBe(
        new Date(resumedAt.getTime() + 30_000).toISOString()
      );

      const skipped = await skipFinisherStep({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: resumed.timer.revision,
        now: new Date(resumedAt.getTime() + 5_000),
      });
      const completedOffer = await syncFinisher({
        userId: ownerId,
        workoutId: workout.id,
        now: new Date(resumedAt.getTime() + 130_000),
      });
      expect(completedOffer.execution).toMatchObject({
        state: "COMPLETED",
        completedStepCount: 1,
        skippedStepCount: 1,
      });
      expect(completedOffer.execution?.timer.revision).toBeGreaterThan(
        skipped.timer.revision
      );
    });

    it("rejects later edits to an immutable referenced routine version", async () => {
      await expect(
        client.finisherRoutineVersion.update({
          where: { id: routineVersionId },
          data: { name: "Mutated historical definition" },
        })
      ).rejects.toThrow(/immutable/i);
    });
  });
}
