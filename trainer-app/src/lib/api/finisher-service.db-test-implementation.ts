import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  createFinisherOffer,
  declineFinisherOffer,
  endFinisher as endSelectedFinisher,
  getFinisherOffer,
  pauseFinisher as pauseSelectedFinisher,
  recordFinisherFeedback as recordExactFinisherFeedback,
  resumeFinisher as resumeSelectedFinisher,
  selectFinisher as selectOfferedFinisher,
  skipFinisherStep as skipSelectedFinisherStep,
  startFinisher as startSelectedFinisher,
  substituteFinisherStep as substituteSelectedFinisherStep,
  syncFinisher as syncSelectedFinisher,
  dismissSelectedFinisher as dismissExactFinisher,
} from "./finisher-service";
import {
  DeleteWorkoutError,
  deleteOwnedWorkout,
} from "./workout-deletion";
import {
  FINISHER_ROUTINE_SEEDS,
  stableFinisherCatalogId,
} from "../../../prisma/finisher-routine-seed-data";

export function registerFinisherServiceDatabaseTests(databaseUrl: string): void {
  describe("Finisher service (PostgreSQL)", () => {
    let pool: Pool;
    let client: PrismaClient;
    let ownerId: string;
    let foreignOwnerId: string;
    let routineVersionId: string;
    let alternativeId: string;
    let preparationRoutineVersionId: string;
    let shoulderRoutineVersionId: string;

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
      const migratedCatalog = await client.finisherRoutine.findMany({
        where: { publicationState: "ACTIVE" },
        orderBy: { code: "asc" },
        include: {
          versions: {
            orderBy: { version: "asc" },
            include: {
              steps: {
                orderBy: { orderIndex: "asc" },
                include: {
                  alternatives: { orderBy: { orderIndex: "asc" } },
                },
              },
            },
          },
        },
      });
      expect(
        migratedCatalog.map((routine) => ({
          id: routine.id,
          code: routine.code,
          versions: routine.versions.map((version) => ({
            id: version.id,
            version: version.version,
            name: version.name,
            steps: version.steps.map((step) => ({
              id: step.id,
              movementName: step.movementName,
              alternatives: step.alternatives.map((alternative) => ({
                id: alternative.id,
                movementName: alternative.movementName,
              })),
            })),
          })),
        }))
      ).toEqual(
        [...FINISHER_ROUTINE_SEEDS]
          .sort((left, right) => left.code.localeCompare(right.code))
          .map((definition) => ({
            id: stableFinisherCatalogId(`routine:${definition.code}`),
            code: definition.code,
            versions: [
              {
                id: stableFinisherCatalogId(
                  `version:${definition.code}:${definition.version}`
                ),
                version: definition.version,
                name: definition.name,
                steps: definition.steps.map((step, orderIndex) => ({
                  id: stableFinisherCatalogId(
                    `step:${definition.code}:${definition.version}:${orderIndex}`
                  ),
                  movementName: step.movementName,
                  alternatives: (step.alternatives ?? []).map(
                    (movementName, alternativeIndex) => ({
                      id: stableFinisherCatalogId(
                        `alternative:${definition.code}:${definition.version}:${orderIndex}:${alternativeIndex}`
                      ),
                      movementName,
                    })
                  ),
                })),
              },
            ],
          }))
      );
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
      const preparationRoutine = await client.finisherRoutine.create({
        data: {
          code: `finisher-preparation-db-${suffix}`,
          versions: {
            create: {
              version: 1,
              name: `Preparation Finisher DB ${suffix}`,
              description: "Disposable preparation and full-duration fixture",
              category: "CORE",
              difficulty: "EASY",
              fatigueCost: "LOW",
              impactLevel: "LOW",
              preparationSeconds: 10,
              includesFinalRecovery: true,
              equipmentRequirements: ["BODYWEIGHT"],
              bodyRegions: ["core"],
              limitationTags: [],
              steps: {
                create: Array.from({ length: 10 }, (_, orderIndex) => ({
                  orderIndex,
                  movementName: `Timed Hold ${orderIndex + 1}`,
                  workSeconds: 40,
                  recoverySeconds: 20,
                })),
              },
            },
          },
        },
        include: { versions: true },
      });
      preparationRoutineVersionId = preparationRoutine.versions[0]!.id;
      const shoulderRoutine = await client.finisherRoutine.create({
        data: {
          code: `finisher-shoulder-db-${suffix}`,
          versions: {
            create: {
              version: 1,
              name: `Shoulder Conflict Finisher DB ${suffix}`,
              description: "Disposable limitation fixture",
              category: "CORE",
              difficulty: "EASY",
              fatigueCost: "LOW",
              impactLevel: "LOW",
              preparationSeconds: 0,
              includesFinalRecovery: false,
              equipmentRequirements: ["BODYWEIGHT"],
              bodyRegions: ["shoulders"],
              limitationTags: ["shoulder"],
              steps: {
                create: {
                  orderIndex: 0,
                  movementName: "Shoulder Hold",
                  workSeconds: 20,
                  recoverySeconds: 0,
                },
              },
            },
          },
        },
        include: { versions: true },
      });
      shoulderRoutineVersionId = shoulderRoutine.versions[0]!.id;
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

    type LegacyExecutionInput = {
      userId: string;
      workoutId: string;
      expectedRevision: number;
      executionId?: string;
      now?: Date;
    };

    async function currentExecution(workoutId: string) {
      return client.finisherExecution.findFirstOrThrow({
        where: { workoutId },
        orderBy: { selectedAt: "desc" },
      });
    }

    async function ensureOffer(userId: string, workoutId: string, at?: Date) {
      const response = await createFinisherOffer({
        userId,
        workoutId,
        now: at,
      });
      if (!response.offer) throw new Error("Expected persisted Finisher offer");
      return response;
    }

    async function selectFinisher(input: {
      userId: string;
      workoutId: string;
      routineVersionId: string;
      acknowledgeContraindication?: boolean;
      now?: Date;
      executionId?: string;
    }) {
      const offered = await ensureOffer(
        input.userId,
        input.workoutId,
        input.now
      );
      const existing = await client.finisherExecution.findFirst({
        where: {
          workoutId: input.workoutId,
          state: { in: ["SELECTED", "IN_PROGRESS"] },
        },
        orderBy: { selectedAt: "desc" },
      });
      if (
        existing &&
        existing.routineVersionId === input.routineVersionId
      ) {
        return existing;
      }
      return selectOfferedFinisher({
        ...input,
        offerId: offered.offer.id,
        expectedOfferRevision: offered.offer.revision,
        executionId: input.executionId ?? crypto.randomUUID(),
      });
    }

    async function startFinisher(input: {
      userId: string;
      workoutId: string;
      routineVersionId: string;
      acknowledgeContraindication?: boolean;
      now?: Date;
    }) {
      const offered = await ensureOffer(
        input.userId,
        input.workoutId,
        input.now
      );
      let execution = await client.finisherExecution.findFirst({
        where: {
          workoutId: input.workoutId,
          state: { in: ["SELECTED", "IN_PROGRESS"] },
        },
        orderBy: { selectedAt: "desc" },
      });
      if (!execution) {
        execution = await selectOfferedFinisher({
          ...input,
          offerId: offered.offer.id,
          expectedOfferRevision: offered.offer.revision,
          executionId: crypto.randomUUID(),
        });
      }
      if (
        execution.routineVersionId !== input.routineVersionId ||
        execution.timerSegment ||
        execution.startedAt
      ) {
        const current = await getFinisherOffer(input);
        if (!current.execution) throw new Error("Expected active execution");
        return current.execution;
      }
      return startSelectedFinisher({
        userId: input.userId,
        workoutId: input.workoutId,
        executionId: execution.id,
        expectedRevision: execution.revision,
        now: input.now,
      });
    }

    async function bindExecution(input: LegacyExecutionInput) {
      return input.executionId
        ? input.executionId
        : (await currentExecution(input.workoutId)).id;
    }

    async function pauseFinisher(input: LegacyExecutionInput) {
      return pauseSelectedFinisher({
        ...input,
        executionId: await bindExecution(input),
      });
    }

    async function resumeFinisher(input: LegacyExecutionInput) {
      return resumeSelectedFinisher({
        ...input,
        executionId: await bindExecution(input),
      });
    }

    async function skipFinisherStep(input: LegacyExecutionInput) {
      return skipSelectedFinisherStep({
        ...input,
        executionId: await bindExecution(input),
      });
    }

    async function syncFinisher(input: LegacyExecutionInput) {
      return syncSelectedFinisher({
        ...input,
        executionId: await bindExecution(input),
      });
    }

    async function endFinisher(input: LegacyExecutionInput) {
      return endSelectedFinisher({
        ...input,
        executionId: await bindExecution(input),
      });
    }

    async function substituteFinisherStep(
      input: LegacyExecutionInput & { alternativeId: string }
    ) {
      return substituteSelectedFinisherStep({
        ...input,
        executionId: await bindExecution(input),
      });
    }

    async function dismissSelectedFinisher(input: LegacyExecutionInput) {
      return dismissExactFinisher({
        ...input,
        executionId: await bindExecution(input),
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
      const selected = await client.finisherExecution.findFirstOrThrow({
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

    it("uses one canonical limitation interpretation for recommendation and manual selection", async () => {
      const injury = await client.injury.create({
        data: {
          userId: ownerId,
          bodyPart: "left shoulder",
          severity: 2,
          isActive: true,
        },
      });
      try {
        const knownWorkout = await createWorkout("COMPLETED");
        await expect(
          selectFinisher({
            userId: ownerId,
            workoutId: knownWorkout.id,
            routineVersionId: shoulderRoutineVersionId,
            now,
          }),
        ).rejects.toMatchObject({
          code: "FINISHER_CONTRAINDICATION_ACK_REQUIRED",
          status: 409,
        });
        const acknowledged = await selectFinisher({
          userId: ownerId,
          workoutId: knownWorkout.id,
          routineVersionId: shoulderRoutineVersionId,
          acknowledgeContraindication: true,
          now,
        });
        await dismissSelectedFinisher({
          userId: ownerId,
          workoutId: knownWorkout.id,
          expectedRevision: acknowledged.revision,
        });

        await client.injury.update({
          where: { id: injury.id },
          data: { bodyPart: "shoulder, mystery tendon" },
        });
        const unknownWorkout = await createWorkout("COMPLETED");
        const offer = await ensureOffer(ownerId, unknownWorkout.id, now);
        expect(offer.recommendation).toBeNull();
        expect(offer.recommendationUnavailableReason).toContain(
          "mystery tendon",
        );
        expect(
          offer.routines.find((routine) => routine.id === routineVersionId)
            ?.warnings,
        ).toEqual(
          expect.arrayContaining([expect.stringContaining("mystery tendon")]),
        );
        await expect(
          selectFinisher({
            userId: ownerId,
            workoutId: unknownWorkout.id,
            routineVersionId,
            now,
          }),
        ).rejects.toMatchObject({
          code: "FINISHER_CONTRAINDICATION_ACK_REQUIRED",
        });
      } finally {
        await client.injury.delete({ where: { id: injury.id } });
      }
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
      expect(step.status).toBe("PARTIAL");
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
        await client.finisherExecution.findFirstOrThrow({
          where: { workoutId: workout.id },
          select: { workPausedMs: true },
        })
      ).toEqual({ workPausedMs: 30_000 });
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
        expectedRevision: skipped.timer.revision,
        now: new Date(resumedAt.getTime() + 130_000),
      });
      expect(completedOffer).toMatchObject({
        state: "PARTIAL",
        completedStepCount: 1,
        skippedStepCount: 0,
      });
      expect(completedOffer.timer.revision).toBeGreaterThan(
        skipped.timer.revision
      );
    });

    it("records every zero-work skipped step as SKIPPED instead of completed", async () => {
      const workout = await createWorkout("COMPLETED");
      const started = await startFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const first = await skipFinisherStep({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: started.revision,
        now,
      });
      const terminal = await skipFinisherStep({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: first.timer.revision,
        now,
      });
      expect(terminal).toMatchObject({
        state: "SKIPPED",
        actualDurationSeconds: 0,
        completedStepCount: 0,
        skippedStepCount: 2,
      });
      expect(terminal.steps.map((step) => step.status)).toEqual([
        "SKIPPED",
        "SKIPPED",
      ]);
      expect(
        await client.workout.findUniqueOrThrow({
          where: { id: workout.id },
          select: { status: true, completedAt: true },
        })
      ).toMatchObject({ status: "COMPLETED", completedAt: now });
    });

    it("records completed work followed by a zero-work skip as partial", async () => {
      const workout = await createWorkout("COMPLETED");
      const started = await startFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const secondWork = await syncFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: started.revision,
        now: new Date(now.getTime() + 60_000),
      });
      const terminal = await skipFinisherStep({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: secondWork.timer.revision,
        now: new Date(now.getTime() + 60_000),
      });
      expect(terminal).toMatchObject({
        state: "PARTIAL",
        completedStepCount: 1,
        skippedStepCount: 1,
      });
      expect(terminal.steps.map((step) => step.status)).toEqual([
        "COMPLETED",
        "SKIPPED",
      ]);
    });

    it("keeps GET projection read-only across an elapsed boundary", async () => {
      const workout = await createWorkout("COMPLETED");
      const started = await startFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const before = await client.finisherExecution.findFirstOrThrow({
        where: { workoutId: workout.id },
        include: { stepExecutions: true },
      });

      const projected = await getFinisherOffer({
        userId: ownerId,
        workoutId: workout.id,
        now: new Date(now.getTime() + 45_000),
      });
      const after = await client.finisherExecution.findFirstOrThrow({
        where: { workoutId: workout.id },
        include: { stepExecutions: true },
      });

      expect(after).toEqual(before);
      expect(projected.execution).toMatchObject({
        state: "IN_PROGRESS",
        completedStepCount: 1,
        actualDurationSeconds: 45,
        timer: {
          segment: "RECOVERY",
          revision: started.revision,
          syncRequired: true,
        },
      });
    });

    it("does not subtract a preparation pause from 600 seconds of performed time", async () => {
      const workout = await createWorkout("COMPLETED");
      const started = await startFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId: preparationRoutineVersionId,
        now,
      });
      const paused = await pauseFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: started.revision,
        now: new Date(now.getTime() + 5_000),
      });
      const resumed = await resumeFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: paused.timer.revision,
        now: new Date(now.getTime() + 35_000),
      });
      const completed = await syncFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: resumed.timer.revision,
        now: new Date(now.getTime() + 640_000),
      });

      expect(completed).toMatchObject({
        state: "COMPLETED",
        completedStepCount: 10,
        actualDurationSeconds: 600,
        timing: {
          preparationActiveMs: 10_000,
          activeWorkMs: 400_000,
          activeRecoveryMs: 200_000,
          preparationPausedMs: 30_000,
        },
      });
    });

    it("keeps 15 seconds of active work at 15 seconds through a 30-second paused partial ending", async () => {
      const workout = await createWorkout("COMPLETED");
      const started = await startFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const paused = await pauseFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: started.revision,
        now: new Date(now.getTime() + 15_000),
      });
      const partial = await endFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: paused.timer.revision,
        now: new Date(now.getTime() + 45_000),
      });

      expect(partial).toMatchObject({
        state: "PARTIAL",
        actualDurationSeconds: 15,
        resolvedStepCount: 1,
        completedStepCount: 0,
        timing: {
          activeWorkMs: 15_000,
          workPausedMs: 30_000,
        },
      });
      expect(partial.steps[0]).toMatchObject({
        status: "PARTIAL",
        actualWorkMs: 15_000,
      });
      expect(partial.steps[1]).toMatchObject({
        status: "PENDING",
        actualWorkMs: 0,
      });
    });

    it("preserves a predefined substitution as partially performed truth", async () => {
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
      const partial = await endFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: substituted.timer.revision,
        now: new Date(now.getTime() + 15_000),
      });
      expect(partial).toMatchObject({
        state: "PARTIAL",
        resolvedStepCount: 1,
        completedStepCount: 0,
        skippedStepCount: 0,
        substitutionCount: 1,
      });
      expect(partial.steps[0]).toMatchObject({
        prescribedMovement: "Prescribed Hold",
        performedMovement: "Allowed Hold",
        status: "PARTIAL",
        actualWorkMs: 15_000,
      });
      expect(partial.steps[1]).toMatchObject({
        status: "PENDING",
        actualWorkMs: 0,
      });
    });

    it("retains resumed work exactly and skips only active work accumulated across pauses", async () => {
      const workout = await createWorkout("COMPLETED");
      const started = await startFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const paused = await pauseFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: started.revision,
        now: new Date(now.getTime() + 15_000),
      });
      const resumedAt = new Date(now.getTime() + 45_000);
      const resumed = await resumeFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: paused.timer.revision,
        now: resumedAt,
      });
      expect(resumed.timer.segmentEndsAt).toBe(
        new Date(resumedAt.getTime() + 25_000).toISOString(),
      );
      const skipped = await skipFinisherStep({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: resumed.timer.revision,
        now: new Date(resumedAt.getTime() + 5_000),
      });
      expect(skipped.steps[0]).toMatchObject({
        status: "PARTIAL",
        actualWorkMs: 20_000,
      });
      expect(skipped.timing).toMatchObject({
        activeWorkMs: 20_000,
        workPausedMs: 30_000,
      });
    });

    it("accounts paused recovery separately from active recovery", async () => {
      const workout = await createWorkout("COMPLETED");
      const started = await startFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const recovery = await syncFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: started.revision,
        now: new Date(now.getTime() + 40_000),
      });
      const paused = await pauseFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: recovery.timer.revision,
        now: new Date(now.getTime() + 45_000),
      });
      const resumed = await resumeFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: paused.timer.revision,
        now: new Date(now.getTime() + 75_000),
      });
      const nextWork = await syncFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: resumed.timer.revision,
        now: new Date(now.getTime() + 90_000),
      });

      expect(nextWork).toMatchObject({
        actualDurationSeconds: 60,
        timing: {
          activeWorkMs: 40_000,
          activeRecoveryMs: 20_000,
          recoveryPausedMs: 30_000,
        },
        timer: { segment: "WORK", currentStepIndex: 1 },
      });
    });

    it("ends during preparation with zero invented performed work and is repeat-safe", async () => {
      const workout = await createWorkout("COMPLETED");
      const started = await startFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId: preparationRoutineVersionId,
        now,
      });
      const dismissed = await endFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: started.revision,
        now: new Date(now.getTime() + 5_000),
      });
      expect(dismissed).toMatchObject({
        state: "DISMISSED",
        startedAt: null,
        actualDurationSeconds: 0,
        resolvedStepCount: 0,
        timing: {
          preparationActiveMs: 5_000,
          activeWorkMs: 0,
          activeRecoveryMs: 0,
        },
      });
      const repeated = await endFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: dismissed.timer.revision,
        now: new Date(now.getTime() + 50_000),
      });
      expect(repeated.actualDurationSeconds).toBe(0);
      expect(repeated.timer.revision).toBe(dismissed.timer.revision);
      await expect(
        endFinisher({
          userId: ownerId,
          workoutId: workout.id,
          expectedRevision: started.revision,
          now: new Date(now.getTime() + 50_000),
        }),
      ).rejects.toMatchObject({ code: "FINISHER_STALE_TRANSITION", status: 409 });
    });

    it("makes concurrent identical selected dismissals idempotent", async () => {
      const workout = await createWorkout("COMPLETED");
      const selected = await selectFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const results = await Promise.allSettled([
        dismissSelectedFinisher({
          userId: ownerId,
          workoutId: workout.id,
          expectedRevision: selected.revision,
        }),
        dismissSelectedFinisher({
          userId: ownerId,
          workoutId: workout.id,
          expectedRevision: selected.revision,
        }),
      ]);
      expect(results).toEqual([
        expect.objectContaining({ status: "fulfilled" }),
        expect.objectContaining({ status: "fulfilled" }),
      ]);
      expect(
        await client.finisherExecution.count({
          where: { workoutId: workout.id },
        }),
      ).toBe(1);
      expect(
        await client.finisherExecution.findFirstOrThrow({
          where: { workoutId: workout.id },
          select: { state: true, dismissedAt: true },
        })
      ).toMatchObject({ state: "DISMISSED", dismissedAt: expect.any(Date) });
    });

    it("preserves the original offer across catalog changes and persists decline on reload", async () => {
      const workout = await createWorkout("COMPLETED");
      const original = await ensureOffer(ownerId, workout.id, now);
      expect(original.offer).not.toBeNull();
      const beforeRoutineIds = original.routines.map((routine) => routine.id);
      const routine = await client.finisherRoutineVersion.findUniqueOrThrow({
        where: { id: routineVersionId },
        select: { routineId: true },
      });
      await client.finisherRoutine.update({
        where: { id: routine.routineId },
        data: { publicationState: "RETIRED", retiredAt: now },
      });
      try {
        const afterCatalogChange = await getFinisherOffer({
          userId: ownerId,
          workoutId: workout.id,
          now,
        });
        expect(afterCatalogChange.routines.map((item) => item.id)).toEqual(
          beforeRoutineIds
        );
        expect(afterCatalogChange.recommendation).toEqual(
          original.recommendation
        );

        const decisionId = crypto.randomUUID();
        await declineFinisherOffer({
          userId: ownerId,
          workoutId: workout.id,
          offerId: original.offer!.id,
          expectedOfferRevision: original.offer!.revision,
          decisionId,
          now,
        });
        await expect(
          declineFinisherOffer({
            userId: ownerId,
            workoutId: workout.id,
            offerId: original.offer!.id,
            expectedOfferRevision: original.offer!.revision,
            decisionId,
            now,
          })
        ).resolves.toEqual({ declined: true });
        const reloaded = await getFinisherOffer({
          userId: ownerId,
          workoutId: workout.id,
          now,
        });
        expect(reloaded.declined).toBe(true);
        expect(reloaded.offer?.declinedAt).toBe(now.toISOString());
      } finally {
        await client.finisherRoutine.update({
          where: { id: routine.routineId },
          data: { publicationState: "ACTIVE", retiredAt: null },
        });
      }
    });

    it("binds every mutation to execution identity across select A, dismiss A, select B ABA replay", async () => {
      const workout = await createWorkout("COMPLETED");
      const offered = await ensureOffer(ownerId, workout.id, now);
      const executionAId = crypto.randomUUID();
      const executionA = await selectOfferedFinisher({
        userId: ownerId,
        workoutId: workout.id,
        offerId: offered.offer!.id,
        expectedOfferRevision: offered.offer!.revision,
        executionId: executionAId,
        routineVersionId,
        now,
      });
      const staleRevision = executionA.revision;
      await dismissExactFinisher({
        userId: ownerId,
        workoutId: workout.id,
        executionId: executionAId,
        expectedRevision: staleRevision,
        now,
      });
      const afterDismiss = await getFinisherOffer({
        userId: ownerId,
        workoutId: workout.id,
        now,
      });
      expect(afterDismiss.execution).toBeNull();
      expect(afterDismiss.history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: executionAId,
            state: "DISMISSED",
          }),
        ])
      );

      const executionBId = crypto.randomUUID();
      await selectOfferedFinisher({
        userId: ownerId,
        workoutId: workout.id,
        offerId: afterDismiss.offer!.id,
        expectedOfferRevision: afterDismiss.offer!.revision,
        executionId: executionBId,
        routineVersionId: preparationRoutineVersionId,
        now,
      });
      const beforeReplay = await client.finisherExecution.findUniqueOrThrow({
        where: { id: executionBId },
        include: { stepExecutions: { orderBy: { routineStepId: "asc" } } },
      });
      const staleBase = {
        userId: ownerId,
        workoutId: workout.id,
        executionId: executionAId,
        expectedRevision: staleRevision,
        now,
      };
      const staleResults = await Promise.allSettled([
        startSelectedFinisher(staleBase),
        syncSelectedFinisher(staleBase),
        pauseSelectedFinisher(staleBase),
        resumeSelectedFinisher(staleBase),
        skipSelectedFinisherStep(staleBase),
        substituteSelectedFinisherStep({
          ...staleBase,
          alternativeId,
        }),
        endSelectedFinisher(staleBase),
        recordExactFinisherFeedback({
          ...staleBase,
          difficultyFeedback: 5,
        }),
        dismissExactFinisher(staleBase),
      ]);
      expect(
        staleResults.filter((result) => result.status === "rejected")
      ).toHaveLength(8);
      expect(
        staleResults.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      const afterReplay = await client.finisherExecution.findUniqueOrThrow({
        where: { id: executionBId },
        include: { stepExecutions: { orderBy: { routineStepId: "asc" } } },
      });
      expect(afterReplay).toEqual(beforeReplay);
      expect(
        await client.finisherExecution.findUniqueOrThrow({
          where: { id: executionAId },
          select: { state: true, dismissedAt: true },
        })
      ).toEqual({ state: "DISMISSED", dismissedAt: now });
    });

    it("protects every Finisher execution outcome from workout deletion", async () => {
      const setupByState = {
        SELECTED: async (workoutId: string) => {
          await selectFinisher({
            userId: ownerId,
            workoutId,
            routineVersionId,
            now,
          });
        },
        IN_PROGRESS: async (workoutId: string) => {
          await startFinisher({
            userId: ownerId,
            workoutId,
            routineVersionId,
            now,
          });
        },
        PARTIAL: async (workoutId: string) => {
          const started = await startFinisher({
            userId: ownerId,
            workoutId,
            routineVersionId,
            now,
          });
          await endFinisher({
            userId: ownerId,
            workoutId,
            expectedRevision: started.revision,
            now: new Date(now.getTime() + 5_000),
          });
        },
        SKIPPED: async (workoutId: string) => {
          const started = await startFinisher({
            userId: ownerId,
            workoutId,
            routineVersionId,
            now,
          });
          const first = await skipFinisherStep({
            userId: ownerId,
            workoutId,
            expectedRevision: started.revision,
            now,
          });
          await skipFinisherStep({
            userId: ownerId,
            workoutId,
            expectedRevision: first.timer.revision,
            now,
          });
        },
        DISMISSED: async (workoutId: string) => {
          const selected = await selectFinisher({
            userId: ownerId,
            workoutId,
            routineVersionId,
            now,
          });
          await dismissSelectedFinisher({
            userId: ownerId,
            workoutId,
            expectedRevision: selected.revision,
            now,
          });
        },
        COMPLETED: async (workoutId: string) => {
          const started = await startFinisher({
            userId: ownerId,
            workoutId,
            routineVersionId,
            now,
          });
          await syncFinisher({
            userId: ownerId,
            workoutId,
            expectedRevision: started.revision,
            now: new Date(now.getTime() + 120_000),
          });
        },
      } as const;

      for (const [state, setup] of Object.entries(setupByState)) {
        const workout = await createWorkout("COMPLETED");
        await setup(workout.id);

        await expect(
          deleteOwnedWorkout({
            userId: ownerId,
            workoutId: workout.id,
            expectedRevision: workout.revision,
          }),
        ).rejects.toMatchObject({
          code: "WORKOUT_FINISHER_HISTORY_CONFLICT",
          status: 409,
        } satisfies Partial<DeleteWorkoutError>);

        const preserved = await client.workout.findUniqueOrThrow({
          where: { id: workout.id },
          select: {
            revision: true,
            finisherExecutions: { select: { state: true } },
          },
        });
        expect(preserved).toEqual({
          revision: workout.revision,
          finisherExecutions: [{ state }],
        });
      }
    });

    it("protects a declined offer with no execution from workout deletion", async () => {
      const workout = await createWorkout("COMPLETED");
      const offered = await ensureOffer(ownerId, workout.id, now);
      await declineFinisherOffer({
        userId: ownerId,
        workoutId: workout.id,
        offerId: offered.offer!.id,
        expectedOfferRevision: offered.offer!.revision,
        decisionId: crypto.randomUUID(),
        now,
      });
      await expect(
        deleteOwnedWorkout({
          userId: ownerId,
          workoutId: workout.id,
          expectedRevision: workout.revision,
        })
      ).rejects.toMatchObject({
        code: "WORKOUT_FINISHER_HISTORY_CONFLICT",
        status: 409,
      });
    });

    it("deletes a workout without Finisher history and rejects a stale deletion without side effects", async () => {
      const deletable = await createWorkout("COMPLETED");
      await expect(
        deleteOwnedWorkout({
          userId: ownerId,
          workoutId: deletable.id,
          expectedRevision: deletable.revision,
        }),
      ).resolves.toMatchObject({ result: { status: "deleted" } });
      await expect(
        client.workout.findUnique({ where: { id: deletable.id } }),
      ).resolves.toBeNull();

      const stale = await createWorkout("COMPLETED");
      await expect(
        deleteOwnedWorkout({
          userId: ownerId,
          workoutId: stale.id,
          expectedRevision: stale.revision + 1,
        }),
      ).rejects.toMatchObject({
        code: "WORKOUT_REVISION_CONFLICT",
        status: 409,
      });
      await expect(
        client.workout.findUnique({
          where: { id: stale.id },
          select: { revision: true },
        }),
      ).resolves.toEqual({ revision: stale.revision });
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
