import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  finisherRoutineVersionInclude,
  toFinisherRoutineDto,
  type FinisherRoutineDto,
  type FinisherRoutineVersionRow,
} from "@/lib/api/finisher-routine-dto";
import {
  finisherRoutineDefinitionSchema,
  type FinisherRoutineDefinition,
} from "@/lib/validation";

type FinisherTransaction = Prisma.TransactionClient;

const managementRoutineInclude = (ownerId: string) =>
  ({
    versions: {
      orderBy: { version: "desc" as const },
      take: 1,
      include: finisherRoutineVersionInclude,
    },
    libraryItems: {
      where: { ownerId },
      take: 1,
    },
  }) as const;

type ManagementRoutineRow = Prisma.FinisherRoutineGetPayload<{
  include: ReturnType<typeof managementRoutineInclude>;
}>;

type LogicalLibraryRow = {
  routine: ManagementRoutineRow;
  version: FinisherRoutineVersionRow;
  item: ManagementRoutineRow["libraryItems"][number] | null;
  state: "ACTIVE" | "ARCHIVED" | "DELETED";
  revision: number;
  activePosition: number | null;
};

export type FinisherLibraryItemDto = {
  routineId: string;
  state: "ACTIVE" | "ARCHIVED";
  activePosition: number | null;
  revision: number;
  ownership: "SYSTEM" | "USER";
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
  restoredAt: string | null;
  routine: FinisherRoutineDto;
};

export type FinisherLibraryData = {
  active: FinisherLibraryItemDto[];
  archived: FinisherLibraryItemDto[];
  activeLimitations: string[];
};

export class FinisherLibraryServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

function fail(code: string, status: number): never {
  throw new FinisherLibraryServiceError(code, status);
}

function mapConcurrencyError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  ) {
    fail("FINISHER_LIBRARY_STALE", 409);
  }
  throw error;
}

async function loadActiveLimitations(
  tx: FinisherTransaction,
  ownerId: string,
): Promise<string[]> {
  const injuries = await tx.injury.findMany({
    where: { userId: ownerId, isActive: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { bodyPart: true },
  });
  return injuries.map((injury) => injury.bodyPart);
}

async function loadScopedRoutines(
  tx: FinisherTransaction,
  ownerId: string,
): Promise<ManagementRoutineRow[]> {
  return tx.finisherRoutine.findMany({
    where: {
      publicationState: "ACTIVE",
      OR: [{ ownerId: null }, { ownerId }],
    },
    orderBy: [{ code: "asc" }, { id: "asc" }],
    include: managementRoutineInclude(ownerId),
  });
}

function logicalRows(routines: ManagementRoutineRow[]): {
  active: LogicalLibraryRow[];
  archived: LogicalLibraryRow[];
} {
  const active: LogicalLibraryRow[] = [];
  const archived: LogicalLibraryRow[] = [];
  for (const routine of routines) {
    const version = routine.versions[0];
    if (!version) continue;
    const item = routine.libraryItems[0] ?? null;
    if (!item) {
      if (routine.ownerId == null) {
        active.push({
          routine,
          version,
          item: null,
          state: "ACTIVE",
          revision: 0,
          activePosition: null,
        });
      }
      continue;
    }
    const row: LogicalLibraryRow = {
      routine,
      version,
      item,
      state: item.state,
      revision: item.revision,
      activePosition: item.activePosition,
    };
    if (item.state === "ACTIVE") active.push(row);
    if (item.state === "ARCHIVED") archived.push(row);
  }

  active.sort((left, right) => {
    const leftExplicit = left.activePosition != null;
    const rightExplicit = right.activePosition != null;
    if (leftExplicit !== rightExplicit) return leftExplicit ? -1 : 1;
    return (
      (left.activePosition ?? 0) - (right.activePosition ?? 0) ||
      left.routine.code.localeCompare(right.routine.code) ||
      left.routine.id.localeCompare(right.routine.id)
    );
  });
  archived.sort(
    (left, right) =>
      (right.item?.archivedAt?.getTime() ?? 0) -
        (left.item?.archivedAt?.getTime() ?? 0) ||
      left.version.name.localeCompare(right.version.name) ||
      left.routine.id.localeCompare(right.routine.id),
  );
  return { active, archived };
}

function toLibraryItemDto(
  row: LogicalLibraryRow,
  activeLimitations: string[],
  position: number | null,
): FinisherLibraryItemDto {
  const item = row.item;
  return {
    routineId: row.routine.id,
    state: row.state === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
    activePosition: row.state === "ACTIVE" ? position : null,
    revision: row.revision,
    ownership: row.routine.ownerId == null ? "SYSTEM" : "USER",
    canEdit: row.routine.ownerId != null,
    canDelete: row.routine.ownerId != null,
    createdAt: item?.createdAt.toISOString() ?? null,
    updatedAt: item?.updatedAt.toISOString() ?? null,
    archivedAt: item?.archivedAt?.toISOString() ?? null,
    restoredAt: item?.restoredAt?.toISOString() ?? null,
    routine: toFinisherRoutineDto(row.version, activeLimitations),
  };
}

async function loadLibraryInTransaction(
  tx: FinisherTransaction,
  ownerId: string,
): Promise<FinisherLibraryData> {
  const [routines, activeLimitations] = await Promise.all([
    loadScopedRoutines(tx, ownerId),
    loadActiveLimitations(tx, ownerId),
  ]);
  const rows = logicalRows(routines);
  return {
    active: rows.active.map((row, position) =>
      toLibraryItemDto(row, activeLimitations, position),
    ),
    archived: rows.archived.map((row) =>
      toLibraryItemDto(row, activeLimitations, null),
    ),
    activeLimitations,
  };
}

export async function loadFinisherLibrary(
  ownerId: string,
): Promise<FinisherLibraryData> {
  return prisma.$transaction((tx) => loadLibraryInTransaction(tx, ownerId));
}

export async function loadFinisherLibraryItem(
  ownerId: string,
  routineId: string,
): Promise<{ item: FinisherLibraryItemDto; activeLimitations: string[] } | null> {
  const library = await loadFinisherLibrary(ownerId);
  const item = [...library.active, ...library.archived].find(
    (candidate) => candidate.routineId === routineId,
  );
  return item ? { item, activeLimitations: library.activeLimitations } : null;
}

export async function resolveOwnerScopedActiveFinisherLibrary(
  tx: FinisherTransaction,
  ownerId: string,
): Promise<FinisherRoutineVersionRow[]> {
  const rows = logicalRows(await loadScopedRoutines(tx, ownerId));
  return rows.active.map((row) => row.version);
}

async function materializeLibraryOnFirstMutation(
  tx: FinisherTransaction,
  ownerId: string,
  now: Date,
): Promise<boolean> {
  const itemCount = await tx.finisherLibraryItem.count({ where: { ownerId } });
  if (itemCount > 0) return false;
  const systems = (await loadScopedRoutines(tx, ownerId)).filter(
    (routine) => routine.ownerId == null && routine.versions.length > 0,
  );
  if (systems.length > 0) {
    await tx.finisherLibraryItem.createMany({
      data: systems.map((routine, activePosition) => ({
        ownerId,
        routineId: routine.id,
        state: "ACTIVE" as const,
        activePosition,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })),
    });
  }
  return true;
}

async function loadLogicalTarget(
  tx: FinisherTransaction,
  ownerId: string,
  routineId: string,
): Promise<LogicalLibraryRow> {
  const routine = await tx.finisherRoutine.findFirst({
    where: {
      id: routineId,
      publicationState: "ACTIVE",
      OR: [{ ownerId: null }, { ownerId }],
    },
    include: managementRoutineInclude(ownerId),
  });
  if (!routine || !routine.versions[0]) fail("FINISHER_ROUTINE_NOT_FOUND", 404);
  const rows = logicalRows([routine]);
  const row = rows.active[0] ?? rows.archived[0];
  if (!row) fail("FINISHER_ROUTINE_NOT_FOUND", 404);
  return row;
}

function assertExpectedRevision(
  row: LogicalLibraryRow,
  expectedRevision: number,
): void {
  if (row.revision !== expectedRevision) fail("FINISHER_LIBRARY_STALE", 409);
}

async function explicitActiveRows(
  tx: FinisherTransaction,
  ownerId: string,
) {
  return tx.finisherLibraryItem.findMany({
    where: { ownerId, state: "ACTIVE" },
    orderBy: [{ activePosition: "asc" }, { routineId: "asc" }],
  });
}

async function rewriteExplicitOrder(
  tx: FinisherTransaction,
  ownerId: string,
  desiredRoutineIds: string[],
  createMissingAt?: Date,
): Promise<void> {
  const existing = await explicitActiveRows(tx, ownerId);
  if (existing.length > desiredRoutineIds.length) {
    fail("FINISHER_LIBRARY_ORDER_CONFLICT", 409);
  }
  const byId = new Map(existing.map((item) => [item.routineId, item]));
  if (existing.some((item) => !desiredRoutineIds.includes(item.routineId))) {
    fail("FINISHER_LIBRARY_ORDER_CONFLICT", 409);
  }
  const missing = desiredRoutineIds.filter((routineId) => !byId.has(routineId));
  if (missing.length > 0 && !createMissingAt) {
    fail("FINISHER_LIBRARY_ORDER_CONFLICT", 409);
  }
  if (existing.length > 0) {
    await tx.finisherLibraryItem.updateMany({
      where: { ownerId, state: "ACTIVE" },
      data: { activePosition: { increment: 1_000_000 } },
    });
  }
  for (const [activePosition, routineId] of desiredRoutineIds.entries()) {
    const previous = byId.get(routineId);
    if (!previous) {
      await tx.finisherLibraryItem.create({
        data: {
          ownerId,
          routineId,
          state: "ACTIVE",
          activePosition,
          revision: 1,
          createdAt: createMissingAt!,
          updatedAt: createMissingAt!,
        },
      });
      continue;
    }
    const changed = previous.activePosition !== activePosition;
    const updated = await tx.finisherLibraryItem.updateMany({
      where: {
        ownerId,
        routineId,
        state: "ACTIVE",
        revision: previous.revision,
      },
      data: {
        activePosition,
        ...(changed ? { revision: { increment: 1 } } : {}),
      },
    });
    if (updated.count !== 1) fail("FINISHER_LIBRARY_STALE", 409);
  }
}

function parseDefinition(
  definition: FinisherRoutineDefinition,
): FinisherRoutineDefinition {
  const parsed = finisherRoutineDefinitionSchema.safeParse(definition);
  if (!parsed.success) fail("FINISHER_ROUTINE_INVALID", 400);
  return parsed.data;
}

async function createImmutableVersion(
  tx: FinisherTransaction,
  input: {
    routineId: string;
    version: number;
    definition: FinisherRoutineDefinition;
    equipmentRequirements: string[];
    now: Date;
  },
): Promise<FinisherRoutineVersionRow> {
  const definition = parseDefinition(input.definition);
  const created = await tx.finisherRoutineVersion.create({
    data: {
      routineId: input.routineId,
      version: input.version,
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
      equipmentRequirements: input.equipmentRequirements,
      bodyRegions: definition.bodyRegions,
      limitationTags: definition.limitationTags,
      createdAt: input.now,
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
    data: { sealedAt: input.now },
  });
  return tx.finisherRoutineVersion.findUniqueOrThrow({
    where: { id: created.id },
    include: finisherRoutineVersionInclude,
  });
}

function definitionFromVersion(
  version: FinisherRoutineVersionRow,
  name = version.name,
): FinisherRoutineDefinition {
  return {
    name,
    description: version.description,
    category: version.category,
    difficulty: version.difficulty,
    fatigueCost: version.fatigueCost,
    impactLevel: version.impactLevel,
    bodyRegions: version.bodyRegions as FinisherRoutineDefinition["bodyRegions"],
    limitationTags:
      version.limitationTags as FinisherRoutineDefinition["limitationTags"],
    preparationSeconds: version.preparationSeconds,
    includesFinalRecovery: version.includesFinalRecovery,
    steps: version.steps.map((step) => ({
      movementName: step.movementName,
      workSeconds: step.workSeconds,
      recoverySeconds: step.recoverySeconds,
      techniqueCues: step.techniqueCues,
      alternatives: step.alternatives.map(
        (alternative) => alternative.movementName,
      ),
    })),
  };
}

async function createOwnedRoutine(
  tx: FinisherTransaction,
  input: {
    ownerId: string;
    definition: FinisherRoutineDefinition;
    equipmentRequirements: string[];
    now: Date;
  },
): Promise<string> {
  const routine = await tx.finisherRoutine.create({
    data: {
      code: `custom-${randomUUID()}`,
      ownerId: input.ownerId,
      publicationState: "ACTIVE",
      createdAt: input.now,
    },
  });
  await createImmutableVersion(tx, {
    routineId: routine.id,
    version: 1,
    definition: input.definition,
    equipmentRequirements: input.equipmentRequirements,
    now: input.now,
  });
  const position = await tx.finisherLibraryItem.count({
    where: { ownerId: input.ownerId, state: "ACTIVE" },
  });
  await tx.finisherLibraryItem.create({
    data: {
      ownerId: input.ownerId,
      routineId: routine.id,
      state: "ACTIVE",
      activePosition: position,
      revision: 1,
      createdAt: input.now,
      updatedAt: input.now,
    },
  });
  return routine.id;
}

async function readCreatedItem(ownerId: string, routineId: string) {
  const result = await loadFinisherLibraryItem(ownerId, routineId);
  if (!result) fail("FINISHER_ROUTINE_NOT_FOUND", 404);
  return result.item;
}

export async function createUserFinisherRoutine(input: {
  ownerId: string;
  definition: FinisherRoutineDefinition;
  now?: Date;
}): Promise<FinisherLibraryItemDto> {
  const now = input.now ?? new Date();
  let routineId: string;
  try {
    routineId = await prisma.$transaction(
      async (tx) => {
        await materializeLibraryOnFirstMutation(tx, input.ownerId, now);
        return createOwnedRoutine(tx, {
          ownerId: input.ownerId,
          definition: parseDefinition(input.definition),
          equipmentRequirements: [],
          now,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    mapConcurrencyError(error);
  }
  return readCreatedItem(input.ownerId, routineId!);
}

export async function duplicateFinisherRoutine(input: {
  ownerId: string;
  routineId: string;
  expectedRoutineVersionId: string;
  now?: Date;
}): Promise<FinisherLibraryItemDto> {
  const now = input.now ?? new Date();
  let createdRoutineId: string;
  try {
    createdRoutineId = await prisma.$transaction(
      async (tx) => {
        const source = await loadLogicalTarget(
          tx,
          input.ownerId,
          input.routineId,
        );
        if (source.version.id !== input.expectedRoutineVersionId) {
          fail("FINISHER_LIBRARY_STALE", 409);
        }
        await materializeLibraryOnFirstMutation(tx, input.ownerId, now);
        return createOwnedRoutine(tx, {
          ownerId: input.ownerId,
          definition: definitionFromVersion(
            source.version,
            `${source.version.name} Copy`,
          ),
          equipmentRequirements: source.version.equipmentRequirements,
          now,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    mapConcurrencyError(error);
  }
  return readCreatedItem(input.ownerId, createdRoutineId!);
}

export async function editUserFinisherRoutine(input: {
  ownerId: string;
  routineId: string;
  expectedRevision: number;
  definition: FinisherRoutineDefinition;
  now?: Date;
}): Promise<FinisherLibraryItemDto> {
  const now = input.now ?? new Date();
  try {
    await prisma.$transaction(
      async (tx) => {
        const target = await loadLogicalTarget(
          tx,
          input.ownerId,
          input.routineId,
        );
        if (target.routine.ownerId == null) {
          fail("FINISHER_SYSTEM_ROUTINE_EDIT_FORBIDDEN", 409);
        }
        assertExpectedRevision(target, input.expectedRevision);
        if (!target.item) fail("FINISHER_ROUTINE_NOT_FOUND", 404);
        const claimed = await tx.finisherLibraryItem.updateMany({
          where: {
            ownerId: input.ownerId,
            routineId: input.routineId,
            revision: input.expectedRevision,
            state: { in: ["ACTIVE", "ARCHIVED"] },
          },
          data: { revision: { increment: 1 }, updatedAt: now },
        });
        if (claimed.count !== 1) fail("FINISHER_LIBRARY_STALE", 409);
        await createImmutableVersion(tx, {
          routineId: input.routineId,
          version: target.version.version + 1,
          definition: parseDefinition(input.definition),
          equipmentRequirements: target.version.equipmentRequirements,
          now,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    mapConcurrencyError(error);
  }
  return readCreatedItem(input.ownerId, input.routineId);
}

async function lifecycleMutation(input: {
  ownerId: string;
  routineId: string;
  expectedRevision: number;
  action: "ARCHIVE" | "RESTORE" | "DELETE";
  now: Date;
}): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const targetBeforeMaterialization = await loadLogicalTarget(
        tx,
        input.ownerId,
        input.routineId,
      );
      assertExpectedRevision(targetBeforeMaterialization, input.expectedRevision);
      if (input.action === "DELETE" && targetBeforeMaterialization.routine.ownerId == null) {
        fail("FINISHER_SYSTEM_ROUTINE_DELETE_FORBIDDEN", 409);
      }
      if (input.action === "ARCHIVE" && targetBeforeMaterialization.state !== "ACTIVE") {
        fail("FINISHER_LIBRARY_INVALID_TRANSITION", 409);
      }
      if (input.action === "RESTORE" && targetBeforeMaterialization.state !== "ARCHIVED") {
        fail("FINISHER_LIBRARY_INVALID_TRANSITION", 409);
      }
      if (input.action === "DELETE") {
        const blockingExecution = await tx.finisherExecution.findFirst({
          where: {
            ownerId: input.ownerId,
            state: { in: ["SELECTED", "IN_PROGRESS"] },
            routineVersion: { routineId: input.routineId },
          },
          select: { id: true },
        });
        if (blockingExecution) fail("FINISHER_ROUTINE_DELETE_BLOCKED", 409);
      }

      const firstMaterialization = await materializeLibraryOnFirstMutation(
        tx,
        input.ownerId,
        input.now,
      );
      const current = await tx.finisherLibraryItem.findUnique({
        where: {
          ownerId_routineId: {
            ownerId: input.ownerId,
            routineId: input.routineId,
          },
        },
      });
      const acceptedRevision = firstMaterialization
        ? current?.revision
        : input.expectedRevision;

      if (input.action === "ARCHIVE") {
        if (!current) {
          await tx.finisherLibraryItem.create({
            data: {
              ownerId: input.ownerId,
              routineId: input.routineId,
              state: "ARCHIVED",
              activePosition: null,
              revision: 1,
              createdAt: input.now,
              updatedAt: input.now,
              archivedAt: input.now,
            },
          });
          return;
        }
        const updated = await tx.finisherLibraryItem.updateMany({
          where: {
            ownerId: input.ownerId,
            routineId: input.routineId,
            revision: acceptedRevision,
            state: "ACTIVE",
          },
          data: {
            state: "ARCHIVED",
            activePosition: null,
            revision: { increment: 1 },
            updatedAt: input.now,
            archivedAt: input.now,
            restoredAt: null,
          },
        });
        if (updated.count !== 1) fail("FINISHER_LIBRARY_STALE", 409);
        const remaining = await explicitActiveRows(tx, input.ownerId);
        await rewriteExplicitOrder(
          tx,
          input.ownerId,
          remaining.map((item) => item.routineId),
        );
        return;
      }

      if (!current) fail("FINISHER_ROUTINE_NOT_FOUND", 404);
      if (input.action === "RESTORE") {
        const position = await tx.finisherLibraryItem.count({
          where: { ownerId: input.ownerId, state: "ACTIVE" },
        });
        const updated = await tx.finisherLibraryItem.updateMany({
          where: {
            ownerId: input.ownerId,
            routineId: input.routineId,
            revision: acceptedRevision,
            state: "ARCHIVED",
          },
          data: {
            state: "ACTIVE",
            activePosition: position,
            revision: { increment: 1 },
            updatedAt: input.now,
            archivedAt: null,
            restoredAt: input.now,
          },
        });
        if (updated.count !== 1) fail("FINISHER_LIBRARY_STALE", 409);
        return;
      }

      const updated = await tx.finisherLibraryItem.updateMany({
        where: {
          ownerId: input.ownerId,
          routineId: input.routineId,
          revision: acceptedRevision,
          state: { in: ["ACTIVE", "ARCHIVED"] },
        },
        data: {
          state: "DELETED",
          activePosition: null,
          revision: { increment: 1 },
          updatedAt: input.now,
          deletedAt: input.now,
        },
      });
      if (updated.count !== 1) fail("FINISHER_LIBRARY_STALE", 409);
      if (current.state === "ACTIVE") {
        const remaining = await explicitActiveRows(tx, input.ownerId);
        await rewriteExplicitOrder(
          tx,
          input.ownerId,
          remaining.map((item) => item.routineId),
        );
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function archiveFinisherRoutine(input: {
  ownerId: string;
  routineId: string;
  expectedRevision: number;
  now?: Date;
}): Promise<FinisherLibraryData> {
  try {
    await lifecycleMutation({ ...input, action: "ARCHIVE", now: input.now ?? new Date() });
  } catch (error) {
    mapConcurrencyError(error);
  }
  return loadFinisherLibrary(input.ownerId);
}

export async function restoreFinisherRoutine(input: {
  ownerId: string;
  routineId: string;
  expectedRevision: number;
  now?: Date;
}): Promise<FinisherLibraryData> {
  try {
    await lifecycleMutation({ ...input, action: "RESTORE", now: input.now ?? new Date() });
  } catch (error) {
    mapConcurrencyError(error);
  }
  return loadFinisherLibrary(input.ownerId);
}

export async function deleteFinisherRoutine(input: {
  ownerId: string;
  routineId: string;
  expectedRevision: number;
  now?: Date;
}): Promise<FinisherLibraryData> {
  try {
    await lifecycleMutation({ ...input, action: "DELETE", now: input.now ?? new Date() });
  } catch (error) {
    mapConcurrencyError(error);
  }
  return loadFinisherLibrary(input.ownerId);
}

export async function reorderFinisherLibrary(input: {
  ownerId: string;
  items: Array<{ routineId: string; expectedRevision: number }>;
  now?: Date;
}): Promise<FinisherLibraryData> {
  const now = input.now ?? new Date();
  try {
    await prisma.$transaction(
      async (tx) => {
        const logical = logicalRows(await loadScopedRoutines(tx, input.ownerId));
        const logicalById = new Map(
          logical.active.map((row) => [row.routine.id, row]),
        );
        if (
          logical.active.length !== input.items.length ||
          input.items.some(
            (item) =>
              logicalById.get(item.routineId)?.revision !==
              item.expectedRevision,
          )
        ) {
          fail("FINISHER_LIBRARY_STALE", 409);
        }
        await materializeLibraryOnFirstMutation(tx, input.ownerId, now);
        const existingIds = new Set(
          (await explicitActiveRows(tx, input.ownerId)).map((item) => item.routineId),
        );
        for (const item of input.items) {
          if (existingIds.has(item.routineId)) continue;
          const routine = logicalById.get(item.routineId)?.routine;
          if (!routine || routine.ownerId != null) {
            fail("FINISHER_LIBRARY_ORDER_CONFLICT", 409);
          }
        }
        await rewriteExplicitOrder(
          tx,
          input.ownerId,
          input.items.map((item) => item.routineId),
          now,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    mapConcurrencyError(error);
  }
  return loadFinisherLibrary(input.ownerId);
}
