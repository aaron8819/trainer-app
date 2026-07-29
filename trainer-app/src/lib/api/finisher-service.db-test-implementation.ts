import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  createFinisherOffer,
  cleanupExpiredFinisherCommandReceipts,
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
    let runtimePool: Pool;
    let client: PrismaClient;
    let ownerId: string;
    let ownerEmail: string;
    let foreignOwnerId: string;
    let routineVersionId: string;
    let alternativeId: string;
    let preparationRoutineVersionId: string;
    let shoulderRoutineVersionId: string;

    const now = new Date("2026-07-28T12:00:00.000Z");

    beforeAll(async () => {
      pool = new Pool({ connectionString: databaseUrl });
      runtimePool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });
      client = new PrismaClient({ adapter: new PrismaPg(pool) });
      const suffix = crypto.randomUUID();
      ownerEmail = `finisher-owner-${suffix}@test.local`;
      const [owner, foreignOwner] = await Promise.all([
        client.user.create({
          data: { email: ownerEmail },
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
      const routine = await client.$transaction(async (tx) => {
        const created = await tx.finisherRoutine.create({
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
        await tx.finisherRoutineVersion.update({
          where: { id: created.versions[0]!.id },
          data: { sealedAt: now },
        });
        return created;
      });
      routineVersionId = routine.versions[0]!.id;
      alternativeId = routine.versions[0]!.steps[0]!.alternatives[0]!.id;
      const preparationRoutine = await client.$transaction(async (tx) => {
        const created = await tx.finisherRoutine.create({
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
        await tx.finisherRoutineVersion.update({
          where: { id: created.versions[0]!.id },
          data: { sealedAt: now },
        });
        return created;
      });
      preparationRoutineVersionId = preparationRoutine.versions[0]!.id;
      const shoulderRoutine = await client.$transaction(async (tx) => {
        const created = await tx.finisherRoutine.create({
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
        await tx.finisherRoutineVersion.update({
          where: { id: created.versions[0]!.id },
          data: { sealedAt: now },
        });
        return created;
      });
      shoulderRoutineVersionId = shoulderRoutine.versions[0]!.id;
    });

    afterAll(async () => {
      await client?.$disconnect();
      await runtimePool?.end();
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
      commandId?: string;
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
        commandId: crypto.randomUUID(),
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
        commandId: input.commandId ?? crypto.randomUUID(),
      });
    }

    async function resumeFinisher(input: LegacyExecutionInput) {
      return resumeSelectedFinisher({
        ...input,
        executionId: await bindExecution(input),
        commandId: input.commandId ?? crypto.randomUUID(),
      });
    }

    async function skipFinisherStep(input: LegacyExecutionInput) {
      return skipSelectedFinisherStep({
        ...input,
        executionId: await bindExecution(input),
        commandId: input.commandId ?? crypto.randomUUID(),
      });
    }

    async function syncFinisher(input: LegacyExecutionInput) {
      return syncSelectedFinisher({
        ...input,
        executionId: await bindExecution(input),
        commandId: input.commandId ?? crypto.randomUUID(),
      });
    }

    async function endFinisher(input: LegacyExecutionInput) {
      return endSelectedFinisher({
        ...input,
        executionId: await bindExecution(input),
        commandId: input.commandId ?? crypto.randomUUID(),
      });
    }

    async function substituteFinisherStep(
      input: LegacyExecutionInput & { alternativeId: string }
    ) {
      return substituteSelectedFinisherStep({
        ...input,
        executionId: await bindExecution(input),
        commandId: input.commandId ?? crypto.randomUUID(),
      });
    }

    async function dismissSelectedFinisher(input: LegacyExecutionInput) {
      return dismissExactFinisher({
        ...input,
        executionId: await bindExecution(input),
        commandId: input.commandId ?? crypto.randomUUID(),
      });
    }

    it("seals complete routine versions atomically and rejects every post-creation child mutation", async () => {
      const before = await client.finisherRoutineVersion.findUniqueOrThrow({
        where: { id: routineVersionId },
        include: {
          steps: {
            orderBy: { orderIndex: "asc" },
            include: {
              alternatives: { orderBy: { orderIndex: "asc" } },
            },
          },
        },
      });
      expect(before.sealedAt).toEqual(expect.any(Date));
      const firstStep = before.steps[0]!;
      const secondStep = before.steps[1]!;
      const firstAlternative = firstStep.alternatives[0]!;
      const blockedMutations = [
        () =>
          client.finisherRoutineStep.create({
            data: {
              routineVersionId,
              orderIndex: 99,
              movementName: "Forbidden append",
              workSeconds: 10,
              recoverySeconds: 0,
            },
          }),
        () =>
          client.finisherRoutineStep.createMany({
            data: [
              {
                routineVersionId,
                orderIndex: 99,
                movementName: "Forbidden bulk append A",
                workSeconds: 10,
                recoverySeconds: 0,
              },
              {
                routineVersionId,
                orderIndex: 100,
                movementName: "Forbidden bulk append B",
                workSeconds: 10,
                recoverySeconds: 0,
              },
            ],
          }),
        () =>
          client.finisherRoutineStep.update({
            where: { id: firstStep.id },
            data: { movementName: "Forbidden rewrite" },
          }),
        () =>
          client.finisherRoutineStep.updateMany({
            where: { routineVersionId },
            data: { recoverySeconds: 0 },
          }),
        () =>
          client.finisherRoutineStep.update({
            where: { id: firstStep.id },
            data: { routineVersionId: preparationRoutineVersionId },
          }),
        () =>
          client.finisherRoutineStep.delete({ where: { id: firstStep.id } }),
        () =>
          client.finisherRoutineStep.deleteMany({
            where: { routineVersionId },
          }),
        () =>
          client.finisherRoutineStepAlternative.create({
            data: {
              routineStepId: firstStep.id,
              orderIndex: 99,
              movementName: "Forbidden alternative",
            },
          }),
        () =>
          client.finisherRoutineStepAlternative.createMany({
            data: [
              {
                routineStepId: firstStep.id,
                orderIndex: 99,
                movementName: "Forbidden bulk alternative A",
              },
              {
                routineStepId: firstStep.id,
                orderIndex: 100,
                movementName: "Forbidden bulk alternative B",
              },
            ],
          }),
        () =>
          client.finisherRoutineStepAlternative.update({
            where: { id: firstAlternative.id },
            data: { movementName: "Forbidden alternative rewrite" },
          }),
        () =>
          client.finisherRoutineStepAlternative.update({
            where: { id: firstAlternative.id },
            data: { routineStepId: secondStep.id },
          }),
        () =>
          client.finisherRoutineStepAlternative.updateMany({
            where: { routineStepId: firstStep.id },
            data: { orderIndex: 7 },
          }),
        () =>
          client.finisherRoutineStepAlternative.delete({
            where: { id: firstAlternative.id },
          }),
        () =>
          client.finisherRoutineStepAlternative.deleteMany({
            where: { routineStepId: firstStep.id },
          }),
      ];
      for (const mutate of blockedMutations) {
        await expect(mutate()).rejects.toThrow();
      }
      expect(
        await client.finisherRoutineVersion.findUniqueOrThrow({
          where: { id: routineVersionId },
          include: {
            steps: {
              orderBy: { orderIndex: "asc" },
              include: {
                alternatives: { orderBy: { orderIndex: "asc" } },
              },
            },
          },
        }),
      ).toEqual(before);

      const suffix = crypto.randomUUID();
      const routine = await client.finisherRoutine.create({
        data: {
          code: `atomic-finisher-${suffix}`,
          publicationState: "RETIRED",
          retiredAt: now,
        },
      });
      await expect(
        client.finisherRoutineVersion.create({
          data: {
            routineId: routine.id,
            version: 1,
            name: "Unsealed definition",
            description: "Must roll back",
            category: "CORE",
            difficulty: "EASY",
            fatigueCost: "LOW",
            impactLevel: "LOW",
          },
        }),
      ).rejects.toThrow();
      expect(
        await client.finisherRoutineVersion.count({
          where: { routineId: routine.id },
        }),
      ).toBe(0);

      const createdVersionId = await client.$transaction(async (tx) => {
        const version = await tx.finisherRoutineVersion.create({
          data: {
            routineId: routine.id,
            version: 1,
            name: "Atomic definition",
            description: "Created and sealed with children",
            category: "CORE",
            difficulty: "EASY",
            fatigueCost: "LOW",
            impactLevel: "LOW",
          },
        });
        const step = await tx.finisherRoutineStep.create({
          data: {
            routineVersionId: version.id,
            orderIndex: 0,
            movementName: "Atomic hold",
            workSeconds: 20,
            recoverySeconds: 0,
          },
        });
        await tx.finisherRoutineStepAlternative.create({
          data: {
            routineStepId: step.id,
            orderIndex: 0,
            movementName: "Atomic alternative",
          },
        });
        await tx.finisherRoutineVersion.update({
          where: { id: version.id },
          data: { sealedAt: now },
        });
        return version.id;
      });
      await expect(
        client.finisherRoutineStep.create({
          data: {
            routineVersionId: createdVersionId,
            orderIndex: 1,
            movementName: "Late append",
            workSeconds: 20,
            recoverySeconds: 0,
          },
        }),
      ).rejects.toThrow();
    });

    it("freezes finalized offer choices and exact execution prescriptions relationally", async () => {
      const offerWorkout = await createWorkout("COMPLETED");
      const secondOfferWorkout = await createWorkout("COMPLETED");
      const offered = await ensureOffer(ownerId, offerWorkout.id, now);
      const secondOffered = await ensureOffer(
        ownerId,
        secondOfferWorkout.id,
        now,
      );
      const offerBefore = await client.finisherOffer.findUniqueOrThrow({
        where: { id: offered.offer!.id },
        include: { items: { orderBy: { position: "asc" } } },
      });
      expect(offerBefore.finalizedAt).toEqual(now);
      const firstItem = offerBefore.items[0]!;

      await expect(
        client.finisherOfferItem.create({
          data: {
            offerId: offerBefore.id,
            routineVersionId: firstItem.routineVersionId,
            position: 999,
          },
        }),
      ).rejects.toThrow();
      await expect(
        client.finisherOfferItem.update({
          where: { id: firstItem.id },
          data: { position: 999 },
        }),
      ).rejects.toThrow();
      await expect(
        client.finisherOfferItem.update({
          where: { id: firstItem.id },
          data: { offerId: secondOffered.offer!.id },
        }),
      ).rejects.toThrow();
      await expect(
        client.finisherOfferItem.delete({ where: { id: firstItem.id } }),
      ).rejects.toThrow();
      expect(
        await client.finisherOffer.findUniqueOrThrow({
          where: { id: offerBefore.id },
          include: { items: { orderBy: { position: "asc" } } },
        }),
      ).toEqual(offerBefore);

      const rollbackWorkout = await createWorkout("COMPLETED");
      const rollbackOffer = await ensureOffer(ownerId, rollbackWorkout.id, now);
      const rollbackOfferItem =
        await client.finisherOfferItem.findFirstOrThrow({
          where: {
            offerId: rollbackOffer.offer!.id,
            routineVersionId,
          },
        });
      const prescribedSteps = await client.finisherRoutineStep.findMany({
        where: { routineVersionId },
        orderBy: { orderIndex: "asc" },
      });
      const foreignStep = await client.finisherRoutineStep.findFirstOrThrow({
        where: { routineVersionId: preparationRoutineVersionId },
        orderBy: { orderIndex: "asc" },
      });
      const invalidExecutionId = crypto.randomUUID();
      await expect(
        client.$transaction(async (tx) => {
          await tx.finisherExecution.create({
            data: {
              id: invalidExecutionId,
              workoutId: rollbackWorkout.id,
              ownerId,
              offerId: rollbackOffer.offer!.id,
              offerItemId: rollbackOfferItem.id,
              offerRevisionAtSelection: rollbackOffer.offer!.revision,
              routineVersionId,
              selectedAt: now,
            },
          });
          await tx.finisherExecutionStep.create({
            data: {
              executionId: invalidExecutionId,
              routineStepId: foreignStep.id,
              routineVersionId,
              orderIndex: foreignStep.orderIndex,
            },
          });
          await tx.finisherExecution.update({
            where: { id: invalidExecutionId },
            data: { finalizedAt: now },
          });
        }),
      ).rejects.toThrow();
      expect(
        await client.finisherExecution.count({
          where: { id: invalidExecutionId },
        }),
      ).toBe(0);

      const selected = await selectFinisher({
        userId: ownerId,
        workoutId: rollbackWorkout.id,
        routineVersionId,
        now,
      });
      const executionBefore =
        await client.finisherExecution.findUniqueOrThrow({
          where: { id: selected.id },
          include: {
            stepExecutions: { orderBy: { orderIndex: "asc" } },
          },
        });
      expect(executionBefore.finalizedAt).toEqual(now);
      expect(
        executionBefore.stepExecutions.map((step) => ({
          routineStepId: step.routineStepId,
          routineVersionId: step.routineVersionId,
          orderIndex: step.orderIndex,
        })),
      ).toEqual(
        prescribedSteps.map((step) => ({
          routineStepId: step.id,
          routineVersionId,
          orderIndex: step.orderIndex,
        })),
      );
      const firstExecutionStep = executionBefore.stepExecutions[0]!;
      const secondExecutionStep = executionBefore.stepExecutions[1]!;
      await expect(
        client.finisherExecutionStep.create({
          data: {
            executionId: selected.id,
            routineStepId: prescribedSteps[0]!.id,
            routineVersionId,
            orderIndex: prescribedSteps[0]!.orderIndex,
          },
        }),
      ).rejects.toThrow();
      await expect(
        client.finisherExecutionStep.update({
          where: { id: firstExecutionStep.id },
          data: { orderIndex: 999 },
        }),
      ).rejects.toThrow();
      await expect(
        client.finisherExecutionStep.update({
          where: { id: firstExecutionStep.id },
          data: { routineStepId: foreignStep.id },
        }),
      ).rejects.toThrow();
      await expect(
        client.finisherExecutionStep.delete({
          where: { id: firstExecutionStep.id },
        }),
      ).rejects.toThrow();
      await expect(
        client.finisherExecutionStep.update({
          where: { id: secondExecutionStep.id },
          data: { performedAlternativeId: alternativeId },
        }),
      ).rejects.toThrow();
      expect(
        await client.finisherExecution.findUniqueOrThrow({
          where: { id: selected.id },
          include: {
            stepExecutions: { orderBy: { orderIndex: "asc" } },
          },
        }),
      ).toEqual(executionBefore);
    });

    it("binds executions to the exact offered workout, item, version, and historical owner", async () => {
      const workoutA = await createWorkout("COMPLETED");
      const workoutB = await createWorkout("COMPLETED");
      const offerA = await ensureOffer(ownerId, workoutA.id, now);
      const offerB = await ensureOffer(ownerId, workoutB.id, now);
      const itemA = await client.finisherOfferItem.findFirstOrThrow({
        where: {
          offerId: offerA.offer!.id,
          routineVersionId,
        },
      });
      const itemB = await client.finisherOfferItem.findFirstOrThrow({
        where: {
          offerId: offerB.offer!.id,
          routineVersionId,
        },
      });
      const invalidIds = Array.from({ length: 5 }, () => crypto.randomUUID());
      const insertExecution = (
        id: string,
        workoutId: string,
        historicalOwnerId: string,
        offerId: string,
        offerItemId: string,
        selectedRoutineVersionId: string,
      ) =>
        client.$executeRaw`
          INSERT INTO "FinisherExecution" (
            "id", "workoutId", "ownerId", "offerId", "offerItemId",
            "offerRevisionAtSelection", "routineVersionId", "selectedAt"
          ) VALUES (
            ${id}, ${workoutId}, ${historicalOwnerId}, ${offerId},
            ${offerItemId}, 1, ${selectedRoutineVersionId}, ${now}
          )
        `;

      await expect(
        insertExecution(
          invalidIds[0]!,
          workoutA.id,
          ownerId,
          offerB.offer!.id,
          itemB.id,
          routineVersionId,
        ),
      ).rejects.toThrow();
      await expect(
        insertExecution(
          invalidIds[1]!,
          workoutA.id,
          ownerId,
          offerA.offer!.id,
          itemA.id,
          preparationRoutineVersionId,
        ),
      ).rejects.toThrow();
      await expect(
        insertExecution(
          invalidIds[2]!,
          workoutA.id,
          ownerId,
          offerA.offer!.id,
          itemB.id,
          routineVersionId,
        ),
      ).rejects.toThrow();
      await expect(
        insertExecution(
          invalidIds[3]!,
          workoutA.id,
          foreignOwnerId,
          offerA.offer!.id,
          itemA.id,
          routineVersionId,
        ),
      ).rejects.toThrow();

      const concurrent = await Promise.allSettled([
        insertExecution(
          invalidIds[4]!,
          workoutB.id,
          ownerId,
          offerA.offer!.id,
          itemA.id,
          routineVersionId,
        ),
        insertExecution(
          crypto.randomUUID(),
          workoutA.id,
          ownerId,
          offerA.offer!.id,
          itemB.id,
          routineVersionId,
        ),
      ]);
      expect(concurrent.every((result) => result.status === "rejected")).toBe(
        true,
      );
      expect(
        await client.finisherExecution.count({
          where: { id: { in: invalidIds } },
        }),
      ).toBe(0);

      const selected = await selectFinisher({
        userId: ownerId,
        workoutId: workoutA.id,
        routineVersionId,
        now,
      });
      const persisted = await client.finisherExecution.findUniqueOrThrow({
        where: { id: selected.id },
      });
      expect(persisted).toMatchObject({
        workoutId: workoutA.id,
        ownerId,
        offerId: offerA.offer!.id,
        offerItemId: itemA.id,
        routineVersionId,
      });

      await expect(
        client.workout.update({
          where: { id: workoutA.id },
          data: { userId: foreignOwnerId },
        }),
      ).rejects.toThrow();
      await expect(
        client.finisherOffer.update({
          where: { id: offerA.offer!.id },
          data: { ownerId: foreignOwnerId },
        }),
      ).rejects.toThrow();
      await expect(
        client.finisherOffer.update({
          where: { id: offerA.offer!.id },
          data: { workoutId: workoutB.id },
        }),
      ).rejects.toThrow();
      await expect(
        client.finisherOffer.delete({
          where: { id: offerA.offer!.id },
        }),
      ).rejects.toThrow();
      await expect(
        client.workout.delete({ where: { id: workoutA.id } }),
      ).rejects.toThrow();
      await expect(
        client.finisherExecution.findUniqueOrThrow({
          where: { id: selected.id },
        }),
      ).resolves.toEqual(persisted);
    });

    it("makes every existing-execution command receipt-safe under concurrent and lost-response retries", async () => {
      type PreparedCommand = {
        executionId: string;
        expectedRevision: number;
        action:
          | "START"
          | "SYNC"
          | "PAUSE"
          | "RESUME"
          | "SKIP"
          | "SUBSTITUTE"
          | "END"
          | "FEEDBACK"
          | "DISMISS";
        invoke: (commandId: string) => Promise<{ revision: number }>;
      };
      const selectExecution = async () => {
        const workout = await createWorkout("COMPLETED");
        const selected = await selectFinisher({
          userId: ownerId,
          workoutId: workout.id,
          routineVersionId,
          now,
        });
        return { workout, selected };
      };
      const preparations: Array<{
        name: string;
        prepare: () => Promise<PreparedCommand>;
      }> = [
        {
          name: "start",
          prepare: async () => {
            const { workout, selected } = await selectExecution();
            return {
              executionId: selected.id,
              expectedRevision: selected.revision,
              action: "START",
              invoke: (commandId) =>
                startSelectedFinisher({
                  userId: ownerId,
                  workoutId: workout.id,
                  executionId: selected.id,
                  expectedRevision: selected.revision,
                  commandId,
                  now,
                }),
            };
          },
        },
        {
          name: "sync",
          prepare: async () => {
            const { workout, selected } = await selectExecution();
            const started = await startSelectedFinisher({
              userId: ownerId,
              workoutId: workout.id,
              executionId: selected.id,
              expectedRevision: selected.revision,
              commandId: crypto.randomUUID(),
              now,
            });
            return {
              executionId: selected.id,
              expectedRevision: started.revision,
              action: "SYNC",
              invoke: (commandId) =>
                syncSelectedFinisher({
                  userId: ownerId,
                  workoutId: workout.id,
                  executionId: selected.id,
                  expectedRevision: started.revision,
                  commandId,
                  now: new Date(now.getTime() + 45_000),
                }),
            };
          },
        },
        {
          name: "pause",
          prepare: async () => {
            const { workout, selected } = await selectExecution();
            const started = await startSelectedFinisher({
              userId: ownerId,
              workoutId: workout.id,
              executionId: selected.id,
              expectedRevision: selected.revision,
              commandId: crypto.randomUUID(),
              now,
            });
            return {
              executionId: selected.id,
              expectedRevision: started.revision,
              action: "PAUSE",
              invoke: (commandId) =>
                pauseSelectedFinisher({
                  userId: ownerId,
                  workoutId: workout.id,
                  executionId: selected.id,
                  expectedRevision: started.revision,
                  commandId,
                  now: new Date(now.getTime() + 5_000),
                }),
            };
          },
        },
        {
          name: "resume",
          prepare: async () => {
            const { workout, selected } = await selectExecution();
            const started = await startSelectedFinisher({
              userId: ownerId,
              workoutId: workout.id,
              executionId: selected.id,
              expectedRevision: selected.revision,
              commandId: crypto.randomUUID(),
              now,
            });
            const paused = await pauseSelectedFinisher({
              userId: ownerId,
              workoutId: workout.id,
              executionId: selected.id,
              expectedRevision: started.revision,
              commandId: crypto.randomUUID(),
              now: new Date(now.getTime() + 5_000),
            });
            return {
              executionId: selected.id,
              expectedRevision: paused.revision,
              action: "RESUME",
              invoke: (commandId) =>
                resumeSelectedFinisher({
                  userId: ownerId,
                  workoutId: workout.id,
                  executionId: selected.id,
                  expectedRevision: paused.revision,
                  commandId,
                  now: new Date(now.getTime() + 10_000),
                }),
            };
          },
        },
        {
          name: "skip",
          prepare: async () => {
            const { workout, selected } = await selectExecution();
            const started = await startSelectedFinisher({
              userId: ownerId,
              workoutId: workout.id,
              executionId: selected.id,
              expectedRevision: selected.revision,
              commandId: crypto.randomUUID(),
              now,
            });
            return {
              executionId: selected.id,
              expectedRevision: started.revision,
              action: "SKIP",
              invoke: (commandId) =>
                skipSelectedFinisherStep({
                  userId: ownerId,
                  workoutId: workout.id,
                  executionId: selected.id,
                  expectedRevision: started.revision,
                  commandId,
                  now: new Date(now.getTime() + 5_000),
                }),
            };
          },
        },
        {
          name: "substitute",
          prepare: async () => {
            const { workout, selected } = await selectExecution();
            return {
              executionId: selected.id,
              expectedRevision: selected.revision,
              action: "SUBSTITUTE",
              invoke: (commandId) =>
                substituteSelectedFinisherStep({
                  userId: ownerId,
                  workoutId: workout.id,
                  executionId: selected.id,
                  expectedRevision: selected.revision,
                  alternativeId,
                  commandId,
                  now,
                }),
            };
          },
        },
        {
          name: "end",
          prepare: async () => {
            const { workout, selected } = await selectExecution();
            const started = await startSelectedFinisher({
              userId: ownerId,
              workoutId: workout.id,
              executionId: selected.id,
              expectedRevision: selected.revision,
              commandId: crypto.randomUUID(),
              now,
            });
            return {
              executionId: selected.id,
              expectedRevision: started.revision,
              action: "END",
              invoke: (commandId) =>
                endSelectedFinisher({
                  userId: ownerId,
                  workoutId: workout.id,
                  executionId: selected.id,
                  expectedRevision: started.revision,
                  commandId,
                  now: new Date(now.getTime() + 5_000),
                }),
            };
          },
        },
        {
          name: "feedback",
          prepare: async () => {
            const { workout, selected } = await selectExecution();
            const started = await startSelectedFinisher({
              userId: ownerId,
              workoutId: workout.id,
              executionId: selected.id,
              expectedRevision: selected.revision,
              commandId: crypto.randomUUID(),
              now,
            });
            const partial = await endSelectedFinisher({
              userId: ownerId,
              workoutId: workout.id,
              executionId: selected.id,
              expectedRevision: started.revision,
              commandId: crypto.randomUUID(),
              now: new Date(now.getTime() + 5_000),
            });
            return {
              executionId: selected.id,
              expectedRevision: partial.revision,
              action: "FEEDBACK",
              invoke: (commandId) =>
                recordExactFinisherFeedback({
                  userId: ownerId,
                  workoutId: workout.id,
                  executionId: selected.id,
                  expectedRevision: partial.revision,
                  difficultyFeedback: 6,
                  commandId,
                  now: new Date(now.getTime() + 6_000),
                }),
            };
          },
        },
        {
          name: "dismiss",
          prepare: async () => {
            const { workout, selected } = await selectExecution();
            return {
              executionId: selected.id,
              expectedRevision: selected.revision,
              action: "DISMISS",
              invoke: (commandId) =>
                dismissExactFinisher({
                  userId: ownerId,
                  workoutId: workout.id,
                  executionId: selected.id,
                  expectedRevision: selected.revision,
                  commandId,
                  now,
                }),
            };
          },
        },
      ];

      for (const scenario of preparations) {
        const prepared = await scenario.prepare();
        const commandId = crypto.randomUUID();
        const concurrent = await Promise.all([
          prepared.invoke(commandId),
          prepared.invoke(commandId),
        ]);
        expect(concurrent[0].revision, scenario.name).toBe(
          concurrent[1].revision,
        );
        const lostResponseRetry = await prepared.invoke(commandId);
        expect(lostResponseRetry.revision, scenario.name).toBe(
          concurrent[0].revision,
        );
        expect(
          await client.finisherExecutionCommand.findUniqueOrThrow({
            where: { id: commandId },
            select: {
              executionId: true,
              action: true,
              expectedRevision: true,
              resultRevision: true,
              expiresAt: true,
            },
          }),
          scenario.name,
        ).toMatchObject({
          executionId: prepared.executionId,
          action: prepared.action,
          expectedRevision: prepared.expectedRevision,
          resultRevision: concurrent[0].revision,
          expiresAt: expect.any(Date),
        });
        await expect(
          prepared.invoke(crypto.randomUUID()),
          scenario.name,
        ).rejects.toMatchObject({
          code: "FINISHER_STALE_TRANSITION",
          status: 409,
        });
      }
    });

    it("returns the original durable result through HTTP after a later command advances current state", async () => {
      const priorOwnerEmail = process.env.OWNER_EMAIL;
      process.env.OWNER_EMAIL = ownerEmail;
      try {
        const { GET, POST } = await import(
          "../../app/api/workouts/[id]/finisher/route"
        );
        const workout = await createWorkout("COMPLETED");
        const selected = await selectFinisher({
          userId: ownerId,
          workoutId: workout.id,
          routineVersionId,
          now,
        });
        const commandId = crypto.randomUUID();
        const context = {
          params: Promise.resolve({ id: workout.id }),
        };
        const commandBody = {
          action: "start",
          executionId: selected.id,
          expectedRevision: selected.revision,
          commandId,
        };
        const originalResponse = await POST(
          new Request("http://local.test", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(commandBody),
          }),
          context,
        );
        expect(originalResponse.status).toBe(200);
        const original = await originalResponse.json();
        const pauseResponse = await POST(
          new Request("http://local.test", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "pause",
              executionId: selected.id,
              expectedRevision: original.revision,
              commandId: crypto.randomUUID(),
            }),
          }),
          context,
        );
        expect(pauseResponse.status).toBe(200);
        const advanced = await pauseResponse.json();
        expect(advanced.revision).toBeGreaterThan(original.revision);

        const retryResponse = await POST(
          new Request("http://local.test", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(commandBody),
          }),
          context,
        );
        expect(retryResponse.status).toBe(200);
        expect(await retryResponse.json()).toEqual(original);
        const currentResponse = await GET(
          new Request("http://local.test"),
          context,
        );
        const current = await currentResponse.json();
        expect(current.execution.revision).toBe(advanced.revision);
        expect(current.execution.revision).toBeGreaterThan(original.revision);
      } finally {
        if (priorOwnerEmail == null) delete process.env.OWNER_EMAIL;
        else process.env.OWNER_EMAIL = priorOwnerEmail;
      }
    });

    it("rejects command-ID reuse with a different payload or execution", async () => {
      const workoutA = await createWorkout("COMPLETED");
      const selectedA = await selectFinisher({
        userId: ownerId,
        workoutId: workoutA.id,
        routineVersionId,
        now,
      });
      const startedA = await startSelectedFinisher({
        userId: ownerId,
        workoutId: workoutA.id,
        executionId: selectedA.id,
        expectedRevision: selectedA.revision,
        commandId: crypto.randomUUID(),
        now,
      });
      const commandId = crypto.randomUUID();
      await recordExactFinisherFeedback({
        userId: ownerId,
        workoutId: workoutA.id,
        executionId: selectedA.id,
        expectedRevision: (
          await endSelectedFinisher({
            userId: ownerId,
            workoutId: workoutA.id,
            executionId: selectedA.id,
            expectedRevision: startedA.revision,
            commandId: crypto.randomUUID(),
            now: new Date(now.getTime() + 5_000),
          })
        ).revision,
        difficultyFeedback: 5,
        commandId,
        now: new Date(now.getTime() + 6_000),
      });
      const command = await client.finisherExecutionCommand.findUniqueOrThrow({
        where: { id: commandId },
      });
      await expect(
        recordExactFinisherFeedback({
          userId: ownerId,
          workoutId: workoutA.id,
          executionId: selectedA.id,
          expectedRevision: command.expectedRevision,
          difficultyFeedback: 7,
          commandId,
          now: new Date(now.getTime() + 7_000),
        }),
      ).rejects.toMatchObject({
        code: "FINISHER_COMMAND_ID_CONFLICT",
        status: 409,
      });

      const workoutB = await createWorkout("COMPLETED");
      const selectedB = await selectFinisher({
        userId: ownerId,
        workoutId: workoutB.id,
        routineVersionId,
        now,
      });
      await expect(
        startSelectedFinisher({
          userId: ownerId,
          workoutId: workoutB.id,
          executionId: selectedB.id,
          expectedRevision: selectedB.revision,
          commandId,
          now,
        }),
      ).rejects.toMatchObject({
        code: "FINISHER_COMMAND_ID_CONFLICT",
        status: 409,
      });
    });

    it("uses the database clock for receipt creation and retry expiration", async () => {
      const workout = await createWorkout("COMPLETED");
      const selected = await selectFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const commandId = crypto.randomUUID();
      const [{ databaseBefore }] = await client.$queryRaw<
        Array<{ databaseBefore: Date }>
      >`SELECT clock_timestamp()::timestamp(3) AS "databaseBefore"`;

      const started = await startSelectedFinisher({
        userId: ownerId,
        workoutId: workout.id,
        executionId: selected.id,
        expectedRevision: selected.revision,
        commandId,
        now: new Date("1900-01-01T00:00:00.000Z"),
      });

      const [{ databaseAfter }] = await client.$queryRaw<
        Array<{ databaseAfter: Date }>
      >`SELECT clock_timestamp()::timestamp(3) AS "databaseAfter"`;
      const receipt =
        await client.finisherExecutionCommand.findUniqueOrThrow({
          where: { id: commandId },
        });
      expect(receipt.ownerId).toBe(ownerId);
      expect(receipt.createdAt.getTime()).toBeGreaterThanOrEqual(
        databaseBefore.getTime(),
      );
      expect(receipt.createdAt.getTime()).toBeLessThanOrEqual(
        databaseAfter.getTime(),
      );
      expect(receipt.expiresAt.getTime() - receipt.createdAt.getTime()).toBe(
        90 * 24 * 60 * 60 * 1_000,
      );

      await expect(
        startSelectedFinisher({
          userId: ownerId,
          workoutId: workout.id,
          executionId: selected.id,
          expectedRevision: selected.revision,
          commandId,
          now: new Date("2100-01-01T00:00:00.000Z"),
        }),
      ).resolves.toEqual(started);
    });

    it("expires receipts at 90 days and cleans payloads in bounded global batches without changing history", async () => {
      const retentionMs = 90 * 24 * 60 * 60 * 1_000;
      const workout = await createWorkout("COMPLETED");
      const selected = await selectFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const startCommandId = crypto.randomUUID();
      const started = await startSelectedFinisher({
        userId: ownerId,
        workoutId: workout.id,
        executionId: selected.id,
        expectedRevision: selected.revision,
        commandId: startCommandId,
        now,
      });
      const pauseCommandId = crypto.randomUUID();
      const paused = await pauseSelectedFinisher({
        userId: ownerId,
        workoutId: workout.id,
        executionId: selected.id,
        expectedRevision: started.revision,
        commandId: pauseCommandId,
        now: new Date(now.getTime() + 1_000),
      });
      const endCommandId = crypto.randomUUID();
      const ended = await endSelectedFinisher({
        userId: ownerId,
        workoutId: workout.id,
        executionId: selected.id,
        expectedRevision: paused.revision,
        commandId: endCommandId,
        now: new Date(now.getTime() + 2_000),
      });
      const beforeExpiry = await startSelectedFinisher({
        userId: ownerId,
        workoutId: workout.id,
        executionId: selected.id,
        expectedRevision: selected.revision,
        commandId: startCommandId,
        now: new Date("2100-01-01T00:00:00.000Z"),
      });
      expect(beforeExpiry).toEqual(started);
      expect(
        await client.finisherExecution.findUniqueOrThrow({
          where: { id: selected.id },
          select: { revision: true, state: true },
        }),
      ).toEqual({ revision: ended.revision, state: ended.state });

      const [boundary] = await client.$queryRaw<
        Array<{ before: boolean; exact: boolean; after: boolean }>
      >`
        WITH database_clock AS MATERIALIZED (
          SELECT clock_timestamp()::timestamp(3) AS "now"
        )
        SELECT
          ("now" + INTERVAL '1 millisecond' <= "now") AS "before",
          ("now" <= "now") AS "exact",
          ("now" - INTERVAL '1 millisecond' <= "now") AS "after"
        FROM database_clock
      `;
      expect(boundary).toEqual({
        before: false,
        exact: true,
        after: true,
      });

      await client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'ALTER TABLE "FinisherExecutionCommand" DISABLE TRIGGER "FinisherExecutionCommand_tombstone"',
        );
        await tx.$executeRaw`
          WITH expiration AS MATERIALIZED (
            SELECT
              clock_timestamp()::timestamp(3) - INTERVAL '1 millisecond'
                AS "expiresAt"
          )
          UPDATE "FinisherExecutionCommand"
          SET
            "createdAt" = expiration."expiresAt" - INTERVAL '90 days',
            "expiresAt" = expiration."expiresAt"
          FROM expiration
          WHERE "id" = ${startCommandId}
        `;
        await tx.$executeRawUnsafe(
          'ALTER TABLE "FinisherExecutionCommand" ENABLE TRIGGER "FinisherExecutionCommand_tombstone"',
        );
      });

      for (const skewedNow of [
        new Date("1900-01-01T00:00:00.000Z"),
        new Date("2100-01-01T00:00:00.000Z"),
      ]) {
        await expect(
          startSelectedFinisher({
            userId: ownerId,
            workoutId: workout.id,
            executionId: selected.id,
            expectedRevision: selected.revision,
            commandId: startCommandId,
            now: skewedNow,
          }),
        ).rejects.toMatchObject({
          code: "FINISHER_COMMAND_EXPIRED",
          status: 409,
        });
      }

      const collisionWorkout = await createWorkout("COMPLETED");
      const collisionSelection = await selectFinisher({
        userId: ownerId,
        workoutId: collisionWorkout.id,
        routineVersionId,
        now,
      });
      await expect(
        startSelectedFinisher({
          userId: ownerId,
          workoutId: collisionWorkout.id,
          executionId: collisionSelection.id,
          expectedRevision: collisionSelection.revision,
          commandId: startCommandId,
          now: new Date("1900-01-01T00:00:00.000Z"),
        }),
      ).rejects.toMatchObject({
        code: "FINISHER_COMMAND_EXPIRED",
        status: 409,
      });

      const permanentHistoryBefore =
        await client.finisherExecution.findUniqueOrThrow({
          where: { id: selected.id },
          include: {
            stepExecutions: { orderBy: { orderIndex: "asc" } },
          },
        });
      const [{ databaseNow }] = await client.$queryRaw<
        Array<{ databaseNow: Date }>
      >`SELECT statement_timestamp() AS "databaseNow"`;
      const cleanupExpiresAt = new Date(databaseNow.getTime() - 60_000);
      const cleanupCreatedAt = new Date(
        cleanupExpiresAt.getTime() - retentionMs,
      );
      const expiredCommandIds = Array.from({ length: 7 }, () =>
        crypto.randomUUID(),
      );
      await client.finisherExecutionCommand.createMany({
        data: expiredCommandIds.map((id, index) => ({
          id,
          workoutId: workout.id,
          ownerId,
          executionId: selected.id,
          action: "SYNC",
          requestHash: `expired-cleanup-${index}`,
          expectedRevision: selected.revision,
          resultRevision: ended.revision,
          response: { marker: index },
          createdAt: cleanupCreatedAt,
          expiresAt: cleanupExpiresAt,
        })),
      });
      await expect(
        client.$executeRaw`
          UPDATE "FinisherExecutionCommand"
          SET
            "response" = NULL,
            "cleanedAt" = statement_timestamp()
          WHERE "id" = ${expiredCommandIds[0]!}
        `,
      ).rejects.toThrow(/tombstone|immutable/i);

      expect(
        await cleanupExpiredFinisherCommandReceipts({ batchSize: 1 }),
      ).toBe(1);

      const concurrent = await Promise.allSettled([
        startSelectedFinisher({
          userId: ownerId,
          workoutId: workout.id,
          executionId: selected.id,
          expectedRevision: selected.revision,
          commandId: expiredCommandIds[1]!,
          now: databaseNow,
        }),
        cleanupExpiredFinisherCommandReceipts({
          batchSize: 2,
        }),
      ]);
      expect(concurrent[0]).toMatchObject({
        status: "rejected",
        reason: { code: "FINISHER_COMMAND_EXPIRED" },
      });
      expect(concurrent[1]).toMatchObject({
        status: "fulfilled",
        value: 2,
      });

      const batchCounts = [1, 2];
      while (
        (await client.finisherExecutionCommand.count({
          where: {
            id: { in: expiredCommandIds },
            cleanedAt: null,
          },
        })) > 0
      ) {
        batchCounts.push(
          await cleanupExpiredFinisherCommandReceipts({
            batchSize: 2,
          }),
        );
      }
      expect(batchCounts.every((count) => count > 0 && count <= 2)).toBe(true);
      expect(batchCounts.reduce((sum, count) => sum + count, 0)).toBe(
        expiredCommandIds.length,
      );
      expect(
        await client.finisherExecutionCommand.findMany({
          where: { id: { in: expiredCommandIds } },
          select: { response: true, cleanedAt: true },
        }),
      ).toEqual(
        expect.arrayContaining(
          expiredCommandIds.map(() => ({
            response: null,
            cleanedAt: expect.any(Date),
          })),
        ),
      );
      await expect(
        startSelectedFinisher({
          userId: ownerId,
          workoutId: workout.id,
          executionId: selected.id,
          expectedRevision: selected.revision,
          commandId: expiredCommandIds[0]!,
          now: databaseNow,
        }),
      ).rejects.toMatchObject({
        code: "FINISHER_COMMAND_EXPIRED",
        status: 409,
      });
      expect(
        await client.finisherExecution.findUniqueOrThrow({
          where: { id: selected.id },
          include: {
            stepExecutions: { orderBy: { orderIndex: "asc" } },
          },
        }),
      ).toEqual(permanentHistoryBefore);
    });

    it("confines cleanup authority to the fixed non-login role and canonical function", async () => {
      const workout = await createWorkout("COMPLETED");
      const selected = await selectFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const commandId = crypto.randomUUID();
      await startSelectedFinisher({
        userId: ownerId,
        workoutId: workout.id,
        executionId: selected.id,
        expectedRevision: selected.revision,
        commandId,
        now,
      });

      const roleFacts = await pool.query<{
        rolname: string;
        rolcanlogin: boolean;
        rolinherit: boolean;
        rolsuper: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolreplication: boolean;
        rolbypassrls: boolean;
      }>(`
        SELECT
          rolname,
          rolcanlogin,
          rolinherit,
          rolsuper,
          rolcreaterole,
          rolcreatedb,
          rolreplication,
          rolbypassrls
        FROM pg_catalog.pg_roles
        WHERE rolname IN (
          'trainer_app_runtime',
          'trainer_finisher_owner',
          'trainer_finisher_cleanup'
        )
        ORDER BY rolname
      `);
      expect(roleFacts.rows).toEqual([
        {
          rolname: "trainer_app_runtime",
          rolcanlogin: true,
          rolinherit: true,
          rolsuper: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolreplication: false,
          rolbypassrls: false,
        },
        {
          rolname: "trainer_finisher_cleanup",
          rolcanlogin: false,
          rolinherit: false,
          rolsuper: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolreplication: false,
          rolbypassrls: false,
        },
        {
          rolname: "trainer_finisher_owner",
          rolcanlogin: false,
          rolinherit: false,
          rolsuper: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolreplication: false,
          rolbypassrls: false,
        },
      ]);

      const membership = await pool.query<{ membershipCount: number }>(`
        SELECT COUNT(*)::integer AS "membershipCount"
        FROM pg_catalog.pg_auth_members memberships
        JOIN pg_catalog.pg_roles granted
          ON granted.oid = memberships.roleid
        JOIN pg_catalog.pg_roles member
          ON member.oid = memberships.member
        WHERE granted.rolname IN (
          'trainer_app_runtime',
          'trainer_finisher_owner',
          'trainer_finisher_cleanup'
        )
          OR member.rolname IN (
            'trainer_app_runtime',
            'trainer_finisher_owner',
            'trainer_finisher_cleanup'
          )
      `);
      expect(membership.rows[0]?.membershipCount).toBe(0);

      const ownership = await pool.query<{
        relationName: string;
        ownerName: string;
      }>(`
        SELECT
          class.relname AS "relationName",
          owner.rolname AS "ownerName"
        FROM pg_catalog.pg_class class
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = class.relnamespace
        JOIN pg_catalog.pg_roles owner ON owner.oid = class.relowner
        WHERE namespace.nspname = 'public'
          AND class.relkind IN ('r', 'p')
          AND class.relname LIKE 'Finisher%'
        ORDER BY class.relname
      `);
      expect(ownership.rows).toHaveLength(9);
      expect(
        ownership.rows.every(
          ({ ownerName }) => ownerName === "trainer_finisher_owner",
        ),
      ).toBe(true);

      const cleanupFunction = await pool.query<{
        ownerName: string;
        runtimeCanExecute: boolean;
        publicCanExecute: boolean;
      }>(`
        SELECT
          owner.rolname AS "ownerName",
          pg_catalog.has_function_privilege(
            'trainer_app_runtime',
            procedure.oid,
            'EXECUTE'
          ) AS "runtimeCanExecute",
          EXISTS (
            SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(
                procedure.proacl,
                pg_catalog.acldefault('f', procedure.proowner)
              )
            ) acl
            WHERE acl.grantee = 0
              AND acl.privilege_type = 'EXECUTE'
          ) AS "publicCanExecute"
        FROM pg_catalog.pg_proc procedure
        JOIN pg_catalog.pg_namespace namespace
          ON namespace.oid = procedure.pronamespace
        JOIN pg_catalog.pg_roles owner ON owner.oid = procedure.proowner
        WHERE namespace.nspname = 'public'
          AND procedure.proname =
            'cleanup_expired_finisher_execution_commands'
          AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
            'p_batch_size integer'
      `);
      expect(cleanupFunction.rows).toEqual([
        {
          ownerName: "trainer_finisher_cleanup",
          runtimeCanExecute: true,
          publicCanExecute: false,
        },
      ]);

      await runtimePool.query(
        `SELECT set_config(
          'trainer.finisher_command_cleanup',
          'enabled',
          false
        )`,
      );
      for (const attack of [
        `UPDATE "FinisherExecutionCommand"
         SET "response" = NULL, "cleanedAt" = clock_timestamp()
         WHERE "id" = '${commandId}'`,
        `DELETE FROM "FinisherExecutionCommand" WHERE "id" = '${commandId}'`,
        `ALTER TABLE "FinisherExecutionCommand"
         DISABLE TRIGGER "FinisherExecutionCommand_tombstone"`,
        `SET ROLE trainer_finisher_cleanup`,
        `CREATE OR REPLACE FUNCTION public.finisher_runtime_attack()
         RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
      ]) {
        await expect(runtimePool.query(attack)).rejects.toThrow(
          /permission denied|must be owner|not permitted|must have/i,
        );
      }

      await expect(
        runtimePool.query<{ cleanedCount: number }>(
          `SELECT cleanup_expired_finisher_execution_commands(100)
            AS "cleanedCount"`,
        ),
      ).resolves.toMatchObject({
        rows: [{ cleanedCount: expect.any(Number) }],
      });
      await expect(
        client.finisherExecutionCommand.findUniqueOrThrow({
          where: { id: commandId },
          select: { response: true, cleanedAt: true },
        }),
      ).resolves.toEqual({
        response: expect.any(Object),
        cleanedAt: null,
      });
    });

    it("enforces permanent command tombstones for Prisma, SQL, bulk, cleanup, and delete paths", async () => {
      const workout = await createWorkout("COMPLETED");
      const selected = await selectFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const commandId = crypto.randomUUID();
      await startSelectedFinisher({
        userId: ownerId,
        workoutId: workout.id,
        executionId: selected.id,
        expectedRevision: selected.revision,
        commandId,
        now,
      });
      const original =
        await client.finisherExecutionCommand.findUniqueOrThrow({
          where: { id: commandId },
        });

      const sqlMutations = [
        `UPDATE "FinisherExecutionCommand" SET "id" = 'tampered-command-id' WHERE "id" = $1`,
        `UPDATE "FinisherExecutionCommand" SET "workoutId" = 'tampered-workout-id' WHERE "id" = $1`,
        `UPDATE "FinisherExecutionCommand" SET "ownerId" = 'tampered-owner-id' WHERE "id" = $1`,
        `UPDATE "FinisherExecutionCommand" SET "executionId" = 'tampered-execution-id' WHERE "id" = $1`,
        `UPDATE "FinisherExecutionCommand" SET "action" = 'PAUSE' WHERE "id" = $1`,
        `UPDATE "FinisherExecutionCommand" SET "requestHash" = "requestHash" || '-tampered' WHERE "id" = $1`,
        `UPDATE "FinisherExecutionCommand" SET "expectedRevision" = "expectedRevision" + 1 WHERE "id" = $1`,
        `UPDATE "FinisherExecutionCommand" SET "resultRevision" = "resultRevision" + 1 WHERE "id" = $1`,
        `UPDATE "FinisherExecutionCommand" SET "response" = '{"tampered":true}'::jsonb WHERE "id" = $1`,
        `UPDATE "FinisherExecutionCommand" SET "createdAt" = "createdAt" - INTERVAL '1 second' WHERE "id" = $1`,
        `UPDATE "FinisherExecutionCommand" SET "expiresAt" = "expiresAt" + INTERVAL '1 second' WHERE "id" = $1`,
        `UPDATE "FinisherExecutionCommand" SET "response" = NULL, "cleanedAt" = "expiresAt" WHERE "id" = $1`,
        `UPDATE "FinisherExecutionCommand" SET "response" = NULL, "cleanedAt" = "expiresAt", "resultRevision" = "resultRevision" + 1 WHERE "id" = $1`,
      ];
      for (const mutation of sqlMutations) {
        await expect(
          client.$executeRawUnsafe(mutation, commandId),
        ).rejects.toThrow(/tombstone|immutable/i);
        await expect(
          client.finisherExecutionCommand.findUniqueOrThrow({
            where: { id: commandId },
          }),
        ).resolves.toEqual(original);
      }

      await expect(
        client.finisherExecutionCommand.updateMany({
          where: { executionId: selected.id },
          data: { resultRevision: { increment: 1 } },
        }),
      ).rejects.toThrow(/tombstone|immutable/i);
      await expect(
        client.finisherExecutionCommand.delete({ where: { id: commandId } }),
      ).rejects.toThrow(/tombstone|delete/i);
      await expect(
        client.finisherExecutionCommand.deleteMany({
          where: { executionId: selected.id },
        }),
      ).rejects.toThrow(/tombstone|delete/i);
      await expect(
        client.finisherExecutionCommand.findUniqueOrThrow({
          where: { id: commandId },
        }),
      ).resolves.toEqual(original);

      await cleanupExpiredFinisherCommandReceipts({ batchSize: 100 });
      await expect(
        client.finisherExecutionCommand.findUniqueOrThrow({
          where: { id: commandId },
        }),
      ).resolves.toEqual(original);

      const cleaned =
        await client.finisherExecutionCommand.findFirstOrThrow({
          where: { cleanedAt: { not: null } },
        });
      await expect(
        client.finisherExecutionCommand.update({
          where: { id: cleaned.id },
          data: { response: { restored: true }, cleanedAt: null },
        }),
      ).rejects.toThrow(/tombstone|immutable/i);
      await expect(
        client.finisherExecutionCommand.delete({ where: { id: cleaned.id } }),
      ).rejects.toThrow(/tombstone|delete/i);
    });

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

    it("projects the same mixed terminal outcome that synchronization persists", async () => {
      const workout = await createWorkout("COMPLETED");
      const started = await startFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const skipped = await skipFinisherStep({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: started.revision,
        now,
      });
      const boundary = new Date(now.getTime() + 61_000);
      const projected = (
        await getFinisherOffer({
          userId: ownerId,
          workoutId: workout.id,
          now: boundary,
        })
      ).execution!;
      expect(projected).toMatchObject({
        state: "PARTIAL",
        completedStepCount: 1,
        skippedStepCount: 1,
        timer: { segment: "FINISHED", syncRequired: true },
      });

      const persisted = await syncFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: skipped.revision,
        now: boundary,
      });
      expect({
        state: persisted.state,
        steps: persisted.steps.map((step) => step.status),
        completedStepCount: persisted.completedStepCount,
        skippedStepCount: persisted.skippedStepCount,
        actualDurationSeconds: persisted.actualDurationSeconds,
      }).toEqual({
        state: projected.state,
        steps: projected.steps.map((step) => step.status),
        completedStepCount: projected.completedStepCount,
        skippedStepCount: projected.skippedStepCount,
        actualDurationSeconds: projected.actualDurationSeconds,
      });
    });

    it("projects and persists a substituted natural completion identically", async () => {
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
        now,
      });
      const boundary = new Date(now.getTime() + 121_000);
      const projected = (
        await getFinisherOffer({
          userId: ownerId,
          workoutId: workout.id,
          now: boundary,
        })
      ).execution!;
      expect(projected).toMatchObject({
        state: "COMPLETED",
        completedStepCount: 2,
        substitutionCount: 1,
        timer: { segment: "FINISHED", syncRequired: true },
      });
      const persisted = await syncFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: substituted.revision,
        now: boundary,
      });
      expect({
        state: persisted.state,
        steps: persisted.steps.map((step) => ({
          status: step.status,
          performedMovement: step.performedMovement,
        })),
        substitutionCount: persisted.substitutionCount,
        actualDurationSeconds: persisted.actualDurationSeconds,
      }).toEqual({
        state: projected.state,
        steps: projected.steps.map((step) => ({
          status: step.status,
          performedMovement: step.performedMovement,
        })),
        substitutionCount: projected.substitutionCount,
        actualDurationSeconds: projected.actualDurationSeconds,
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

    it("freezes substituted terminal step and parent evidence across Prisma, SQL, bulk, insert, and delete paths", async () => {
      const workout = await createWorkout("COMPLETED");
      const selected = await selectFinisher({
        userId: ownerId,
        workoutId: workout.id,
        routineVersionId,
        now,
      });
      const started = await startSelectedFinisher({
        userId: ownerId,
        workoutId: workout.id,
        executionId: selected.id,
        expectedRevision: selected.revision,
        commandId: crypto.randomUUID(),
        now,
      });
      const substituted = await substituteSelectedFinisherStep({
        userId: ownerId,
        workoutId: workout.id,
        executionId: selected.id,
        expectedRevision: started.revision,
        alternativeId,
        commandId: crypto.randomUUID(),
        now: new Date(now.getTime() + 5_000),
      });
      const partial = await endSelectedFinisher({
        userId: ownerId,
        workoutId: workout.id,
        executionId: selected.id,
        expectedRevision: substituted.revision,
        commandId: crypto.randomUUID(),
        now: new Date(now.getTime() + 15_000),
      });
      expect(partial).toMatchObject({
        state: "PARTIAL",
        substitutionCount: 1,
        actualDurationSeconds: 15,
      });

      const original =
        await client.finisherExecution.findUniqueOrThrow({
          where: { id: selected.id },
          include: {
            stepExecutions: { orderBy: { orderIndex: "asc" } },
          },
        });
      const performedStep = original.stepExecutions[0]!;
      expect(performedStep).toMatchObject({
        performedAlternativeId: alternativeId,
        status: "PARTIAL",
        actualWorkMs: 15_000,
        startedAt: now,
        resolvedAt: new Date(now.getTime() + 15_000),
      });

      const assertHistoryUnchanged = async () => {
        await expect(
          client.finisherExecution.findUniqueOrThrow({
            where: { id: selected.id },
            include: {
              stepExecutions: { orderBy: { orderIndex: "asc" } },
            },
          }),
        ).resolves.toEqual(original);
      };
      const stepMutations = [
        { performedAlternativeId: null },
        { performedAlternativeId: "tampered-alternative" },
        { actualWorkMs: 0 },
        { status: "PENDING" as const },
        { startedAt: null },
        { startedAt: new Date(now.getTime() + 1_000) },
        { resolvedAt: null },
        { resolvedAt: new Date(now.getTime() + 16_000) },
        {
          performedAlternativeId: null,
          actualWorkMs: 0,
          status: "PENDING" as const,
          startedAt: null,
          resolvedAt: null,
        },
      ];
      for (const data of stepMutations) {
        await expect(
          client.finisherExecutionStep.update({
            where: { id: performedStep.id },
            data,
          }),
        ).rejects.toThrow(/immutable|regress/i);
        await assertHistoryUnchanged();
      }

      await expect(
        client.$executeRaw`
          UPDATE "FinisherExecutionStep"
          SET "actualWorkMs" = 0, "status" = 'PENDING'
          WHERE "id" = ${performedStep.id}
        `,
      ).rejects.toThrow(/immutable|regress/i);
      await expect(
        client.finisherExecutionStep.updateMany({
          where: { executionId: selected.id },
          data: { actualWorkMs: 0, status: "PENDING" },
        }),
      ).rejects.toThrow(/immutable|regress/i);
      await expect(
        client.finisherExecutionStep.create({
          data: {
            id: crypto.randomUUID(),
            executionId: selected.id,
            routineStepId: performedStep.routineStepId,
            routineVersionId: performedStep.routineVersionId,
            orderIndex: performedStep.orderIndex,
          },
        }),
      ).rejects.toThrow(/immutable/i);
      await expect(
        client.finisherExecutionStep.delete({
          where: { id: performedStep.id },
        }),
      ).rejects.toThrow(/history|delete/i);
      await expect(
        client.finisherExecutionStep.deleteMany({
          where: { executionId: selected.id },
        }),
      ).rejects.toThrow(/history|delete/i);
      await assertHistoryUnchanged();

      for (const data of [
        { state: "IN_PROGRESS" as const },
        { startedAt: null },
        { endedAt: null },
        { preparationActiveMs: { increment: 1 } },
        { recoveryActiveMs: { increment: 1 } },
        { currentStepIndex: 0, revision: { increment: 1 } },
      ]) {
        await expect(
          client.finisherExecution.update({
            where: { id: selected.id },
            data,
          }),
        ).rejects.toThrow(/terminal|immutable/i);
        await assertHistoryUnchanged();
      }
      await expect(
        client.$executeRaw`
          UPDATE "FinisherExecution"
          SET "state" = 'IN_PROGRESS', "endedAt" = NULL
          WHERE "id" = ${selected.id}
        `,
      ).rejects.toThrow(/terminal|immutable/i);
      await assertHistoryUnchanged();
    });

    it("freezes substituted and unsubstituted parent and child rows for every terminal outcome", async () => {
      async function startWithOptionalSubstitution(
        workoutId: string,
        substituted: boolean,
      ) {
        let execution = await startFinisher({
          userId: ownerId,
          workoutId,
          routineVersionId,
          now,
        });
        if (substituted) {
          execution = await substituteFinisherStep({
            userId: ownerId,
            workoutId,
            expectedRevision: execution.revision,
            alternativeId,
            now,
          });
        }
        return execution;
      }

      const setupTerminal = {
        COMPLETED: async (workoutId: string, substituted: boolean) => {
          const started = await startWithOptionalSubstitution(
            workoutId,
            substituted,
          );
          return syncFinisher({
            userId: ownerId,
            workoutId,
            expectedRevision: started.revision,
            now: new Date(now.getTime() + 120_000),
          });
        },
        PARTIAL: async (workoutId: string, substituted: boolean) => {
          const started = await startWithOptionalSubstitution(
            workoutId,
            substituted,
          );
          return endFinisher({
            userId: ownerId,
            workoutId,
            expectedRevision: started.revision,
            now: new Date(now.getTime() + 15_000),
          });
        },
        SKIPPED: async (workoutId: string, substituted: boolean) => {
          const started = await startWithOptionalSubstitution(
            workoutId,
            substituted,
          );
          const first = await skipFinisherStep({
            userId: ownerId,
            workoutId,
            expectedRevision: started.revision,
            now,
          });
          return skipFinisherStep({
            userId: ownerId,
            workoutId,
            expectedRevision: first.timer.revision,
            now,
          });
        },
      } as const;

      for (const [expectedState, setup] of Object.entries(setupTerminal)) {
        for (const substituted of [false, true]) {
          const workout = await createWorkout("COMPLETED");
          const terminal = await setup(workout.id, substituted);
          expect(terminal).toMatchObject({
            state: expectedState,
            substitutionCount: substituted ? 1 : 0,
          });
          const original =
            await client.finisherExecution.findUniqueOrThrow({
              where: { id: terminal.id },
              include: {
                stepExecutions: { orderBy: { orderIndex: "asc" } },
              },
            });
          expect(original.stepExecutions[0]!.performedAlternativeId).toBe(
            substituted ? alternativeId : null,
          );

          await expect(
            client.finisherExecution.update({
              where: { id: terminal.id },
              data: { state: "IN_PROGRESS" },
            }),
          ).rejects.toThrow(/terminal|immutable/i);
          await expect(
            client.finisherExecutionStep.update({
              where: { id: original.stepExecutions.at(-1)!.id },
              data: { note: "tampered" },
            }),
          ).rejects.toThrow(/immutable/i);
          await expect(
            client.finisherExecution.findUniqueOrThrow({
              where: { id: terminal.id },
              include: {
                stepExecutions: { orderBy: { orderIndex: "asc" } },
              },
            }),
          ).resolves.toEqual(original);
        }
      }
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
      const endCommandId = crypto.randomUUID();
      const dismissed = await endFinisher({
        userId: ownerId,
        workoutId: workout.id,
        expectedRevision: started.revision,
        commandId: endCommandId,
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
        expectedRevision: started.revision,
        commandId: endCommandId,
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
      const dismissCommandId = crypto.randomUUID();
      const results = await Promise.allSettled([
        dismissSelectedFinisher({
          userId: ownerId,
          workoutId: workout.id,
          expectedRevision: selected.revision,
          commandId: dismissCommandId,
        }),
        dismissSelectedFinisher({
          userId: ownerId,
          workoutId: workout.id,
          expectedRevision: selected.revision,
          commandId: dismissCommandId,
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
      const dismissalCommandId = crypto.randomUUID();
      await dismissExactFinisher({
        userId: ownerId,
        workoutId: workout.id,
        executionId: executionAId,
        expectedRevision: staleRevision,
        commandId: dismissalCommandId,
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
        startSelectedFinisher({ ...staleBase, commandId: crypto.randomUUID() }),
        syncSelectedFinisher({ ...staleBase, commandId: crypto.randomUUID() }),
        pauseSelectedFinisher({ ...staleBase, commandId: crypto.randomUUID() }),
        resumeSelectedFinisher({ ...staleBase, commandId: crypto.randomUUID() }),
        skipSelectedFinisherStep({ ...staleBase, commandId: crypto.randomUUID() }),
        substituteSelectedFinisherStep({
          ...staleBase,
          alternativeId,
          commandId: crypto.randomUUID(),
        }),
        endSelectedFinisher({ ...staleBase, commandId: crypto.randomUUID() }),
        recordExactFinisherFeedback({
          ...staleBase,
          difficultyFeedback: 5,
          commandId: crypto.randomUUID(),
        }),
        dismissExactFinisher({ ...staleBase, commandId: dismissalCommandId }),
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
