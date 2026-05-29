import { prisma } from "@/lib/db/prisma";
import {
  prepareMesocycleHandoffAcceptance,
  readNextCycleSeedDraft,
} from "@/lib/api/mesocycle-handoff";
import type { MesocycleSlotPlanSeed } from "@/lib/api/mesocycle-handoff-slot-plan-projection.seed-serialization";
import { parseSlotPlanSeedJson } from "@/lib/api/slot-plan-seed-parser";
import { NEXT_MESOCYCLE_HANDOFF_DRY_RUN_AUDIT_PAYLOAD_VERSION } from "./constants";
import type { NextMesocycleHandoffDryRunPayload } from "./types";

type SourceMesocycleRow = {
  id: string;
  state: string;
  nextSeedDraftJson?: unknown;
};

type ExerciseNameRow = {
  id: string;
  name: string;
};

type HandoffDryRunReader = {
  mesocycle: {
    findFirst(args: unknown): Promise<SourceMesocycleRow | null>;
  };
  exercise: {
    findMany(args: unknown): Promise<ExerciseNameRow[]>;
  };
};

type HandoffDryRunDependencies = {
  reader?: HandoffDryRunReader;
  prepareHandoff?: typeof prepareMesocycleHandoffAcceptance;
};

type PreparedHandoff = Awaited<
  ReturnType<typeof prepareMesocycleHandoffAcceptance>
>;

const EXECUTABLE_SEED_FIELDS = ["exerciseId", "role", "setCount"] as const;

async function loadSourceState(input: {
  userId: string;
  sourceMesocycleId: string;
  reader: HandoffDryRunReader;
}): Promise<SourceMesocycleRow | null> {
  return input.reader.mesocycle.findFirst({
    where: {
      id: input.sourceMesocycleId,
      macroCycle: { userId: input.userId },
    },
    select: {
      id: true,
      state: true,
      nextSeedDraftJson: true,
    },
  });
}

async function loadExerciseNames(input: {
  exerciseIds: string[];
  reader: HandoffDryRunReader;
}): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(input.exerciseIds));
  if (uniqueIds.length === 0) {
    return new Map();
  }
  const rows = await input.reader.exercise.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

function seedExerciseRowsAreMinimal(
  seed: MesocycleSlotPlanSeed | null | undefined,
): boolean {
  return Boolean(
    seed?.slots.every((slot) =>
      slot.exercises.every((exercise) => {
        const keys = Object.keys(exercise).sort();
        return (
          keys.length === EXECUTABLE_SEED_FIELDS.length &&
          EXECUTABLE_SEED_FIELDS.every((field) => keys.includes(field))
        );
      }),
    ),
  );
}

function summarizeSeedShape(seed: MesocycleSlotPlanSeed | null | undefined): {
  seedShape: string;
  slotCount: number;
  exerciseCount: number;
  minimalExecutableRowsOnly: boolean;
  parserCompatible: boolean;
} {
  const slotCount = seed?.slots.length ?? 0;
  const exerciseCount =
    seed?.slots.reduce((count, slot) => count + slot.exercises.length, 0) ?? 0;

  return {
    seedShape: seed
      ? `version=${seed.version} slots=${slotCount} exercises=${exerciseCount}`
      : "not_available",
    slotCount,
    exerciseCount,
    minimalExecutableRowsOnly: seedExerciseRowsAreMinimal(seed),
    parserCompatible: Boolean(seed && parseSlotPlanSeedJson(seed)),
  };
}

async function buildIdentityRows(input: {
  seed: MesocycleSlotPlanSeed | null | undefined;
  reader: HandoffDryRunReader;
  source: NextMesocycleHandoffDryRunPayload["candidateIdentity"]["rows"][number]["source"];
}): Promise<NextMesocycleHandoffDryRunPayload["candidateIdentity"]["rows"]> {
  const exerciseIds =
    input.seed?.slots.flatMap((slot) =>
      slot.exercises.map((exercise) => exercise.exerciseId),
    ) ?? [];
  const exerciseNames = await loadExerciseNames({
    exerciseIds,
    reader: input.reader,
  });

  return (
    input.seed?.slots.flatMap((slot) =>
      slot.exercises.map((exercise) => ({
        slotId: slot.slotId,
        laneOrRole: exercise.role,
        exerciseId: exercise.exerciseId,
        exerciseName: exerciseNames.get(exercise.exerciseId) ?? "unknown",
        setCount: exercise.setCount,
        source: input.source,
      })),
    ) ?? []
  );
}

function buildPersistedDraftTruth(
  source: SourceMesocycleRow | null,
): NextMesocycleHandoffDryRunPayload["persistedDraftTruth"] & {
  seed: MesocycleSlotPlanSeed | null;
} {
  const draft = readNextCycleSeedDraft(source?.nextSeedDraftJson);
  const acceptedSeedDraft = draft?.acceptedSeedDraft;
  const seed = acceptedSeedDraft?.slotPlanSeedJson ?? null;
  const shape = summarizeSeedShape(seed);

  return {
    status: seed ? "available" : "not_available",
    source: acceptedSeedDraft?.source ?? null,
    ...(acceptedSeedDraft?.refreshedAt
      ? { refreshedAt: acceptedSeedDraft.refreshedAt }
      : {}),
    ...shape,
    seed,
  };
}

function buildNoCandidatePayload(input: {
  ownerEmail?: string;
  sourceMesocycleId: string;
  sourceState: string | null;
  blockingReason: string;
}): NextMesocycleHandoffDryRunPayload {
  return {
    version: NEXT_MESOCYCLE_HANDOFF_DRY_RUN_AUDIT_PAYLOAD_VERSION,
    source: "next_mesocycle_handoff_dry_run_audit",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    wouldWriteTransaction: false,
    summary: {
      writes: "no",
      sourceMesocycleId: input.sourceMesocycleId,
      sourceState: input.sourceState,
      candidateAvailable: false,
      handoffReady: false,
      blockingReason: input.blockingReason,
      preparationPath: "not_called_source_not_awaiting_handoff",
      transactionStatus: "not_started",
    },
    wouldPrepareWriteSummary: null,
    persistedDraftTruth: {
      status: "not_available",
      source: null,
      seedShape: "not_available",
      slotCount: 0,
      exerciseCount: 0,
      minimalExecutableRowsOnly: false,
      parserCompatible: false,
    },
    candidateIdentity: {
      status: "not_available_until_handoff",
      rows: [],
    },
    seedShapeSummary: {
      slotPlanSeedJson: "not_available",
      truthBasis: "none",
      wouldBeBuilt: false,
      minimalExecutableRowsOnly: false,
      executableFields: [...EXECUTABLE_SEED_FIELDS],
      serializerPath: "buildMesocycleSlotPlanSeed",
      slotCount: 0,
      exerciseCount: 0,
      seedSource: null,
    },
    weeklyVolumeFloorCapSummary: {
      status: "not_available",
      basis:
        "source is not in AWAITING_HANDOFF, so no prepared candidate seed exists",
      rows: [],
    },
    acceptanceGatePayloadSummary: {
      checks: [
        {
          check: "candidate identity gate",
          enoughData: false,
          basis: "no prepared candidate identity",
        },
        {
          check: "seed/runtime contract gate",
          enoughData: false,
          basis: "no prepared seed",
        },
        {
          check: "volume floors/caps",
          enoughData: false,
          basis: "no prepared seed or candidate volume rows",
        },
        {
          check: "slot/lane balance",
          enoughData: false,
          basis: "no prepared slot sequence",
        },
        {
          check: "Week 1 trainability",
          enoughData: false,
          basis: "no prepared Week 1 seed preview",
        },
      ],
    },
    weekOneRuntimeReplayPreview: {
      status: "not_available",
      runtimeReplayInstantiated: false,
      rows: [],
      limitation:
        "full runtime replay requires a persisted successor active mesocycle; dry-run stops before that write",
    },
    modeComparison: [
      {
        mode: "mesocycle-explain",
        distinction:
          "diagnostic preview only; cannot satisfy candidate identity",
      },
      {
        mode: "v2-accepted-seed-prepare-compare",
        distinction:
          "compares legacy and V2 preparation evidence, but does not summarize would-write transaction effects",
      },
      {
        mode: "next-mesocycle-acceptance-gate",
        distinction:
          "judges candidate readiness; this mode rehearses preparation before that judgment",
      },
    ],
    safety: {
      writes: "no",
      dbMutated: false,
      mesocycleCreated: false,
      workoutLogSessionCreated: false,
      seedRuntimeBehaviorChanged: false,
      plannerMaterializerBehaviorChanged: false,
      transactionExecuted: false,
    },
    ...(input.ownerEmail ? { ownerEmail: input.ownerEmail } : {}),
  };
}

function buildAcceptanceChecks(input: {
  seedAvailable: boolean;
  serializerCompatible: boolean;
  slotCount: number;
  identityRowCount: number;
}): NextMesocycleHandoffDryRunPayload["acceptanceGatePayloadSummary"] {
  return {
    checks: [
      {
        check: "candidate identity gate",
        enoughData: input.identityRowCount > 0,
        basis:
          input.identityRowCount > 0
            ? "candidate seed contains exercise identity rows"
            : "candidate seed contains no exercise identities",
      },
      {
        check: "seed/runtime contract gate",
        enoughData: input.seedAvailable && input.serializerCompatible,
        basis:
          input.seedAvailable && input.serializerCompatible
            ? "buildMesocycleSlotPlanSeed output parses through runtime seed parser"
            : "candidate seed missing or failed parser compatibility",
      },
      {
        check: "volume floors/caps",
        enoughData: false,
        basis:
          "not exposed by the pre-transaction prepared seed; use acceptance gate or post-accept projection checks",
      },
      {
        check: "slot/lane balance",
        enoughData: input.slotCount > 0,
        basis:
          input.slotCount > 0
            ? "prepared ordered slot sequence is available"
            : "prepared slot sequence missing",
      },
      {
        check: "Week 1 trainability",
        enoughData: input.seedAvailable && input.identityRowCount > 0,
        basis:
          input.seedAvailable && input.identityRowCount > 0
            ? "seed-order preview exists, but full runtime replay is not instantiated before successor persistence"
            : "no prepared Week 1 seed preview",
      },
    ],
  };
}

async function buildPreparedPayload(input: {
  ownerEmail?: string;
  sourceMesocycleId: string;
  source: SourceMesocycleRow;
  prepared: PreparedHandoff;
  reader: HandoffDryRunReader;
}): Promise<NextMesocycleHandoffDryRunPayload> {
  const seed = input.prepared.slotPlanSeed;
  const slotSequence = input.prepared.projection.mesocycle.slotSequence.slots;
  const persistedDraft = buildPersistedDraftTruth(input.source);
  const persistedIdentityRows = await buildIdentityRows({
    seed: persistedDraft.seed,
    reader: input.reader,
    source: "persisted_nextSeedDraftJson.acceptedSeedDraft",
  });
  const preparedIdentityRows = await buildIdentityRows({
    seed,
    reader: input.reader,
    source: "prepared_slotPlanSeedJson",
  });
  const identityRows =
    persistedIdentityRows.length > 0
      ? persistedIdentityRows
      : preparedIdentityRows;
  const preparedShape = summarizeSeedShape(seed);
  const truthShape =
    persistedDraft.status === "available" ? persistedDraft : preparedShape;
  const slotOrder = slotSequence.map((slot) => slot.slotId).join(" > ");

  return {
    version: NEXT_MESOCYCLE_HANDOFF_DRY_RUN_AUDIT_PAYLOAD_VERSION,
    source: "next_mesocycle_handoff_dry_run_audit",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    wouldWriteTransaction: false,
    summary: {
      writes: "no",
      sourceMesocycleId: input.sourceMesocycleId,
      sourceState: input.source.state,
      candidateAvailable: identityRows.length > 0,
      handoffReady: true,
      blockingReason: null,
      preparationPath: "prepareMesocycleHandoffAcceptance",
      transactionStatus: "not_started",
    },
    wouldPrepareWriteSummary: {
      successorSource: "prepared_handoff_projection",
      slotSequence: slotOrder || "none",
      seedShape: preparedShape.seedShape,
      slotPlanSeedSource: seed?.source ?? null,
      trainingBlocksCount: input.prepared.projection.trainingBlocks.length,
      carriedRolesCount: input.prepared.projection.carriedForwardRoles.length,
      constraintsAction: "would_upsert_constraints",
      sourceCompletionAction: "would_mark_source_completed",
      transactionBoundary:
        "acceptPreparedMesocycleHandoffInTransaction would perform writes; dry-run stops before it",
      noDbWritesOccur: true,
    },
    persistedDraftTruth: {
      status: persistedDraft.status,
      source: persistedDraft.source,
      ...(persistedDraft.refreshedAt
        ? { refreshedAt: persistedDraft.refreshedAt }
        : {}),
      seedShape: persistedDraft.seedShape,
      slotCount: persistedDraft.slotCount,
      exerciseCount: persistedDraft.exerciseCount,
      minimalExecutableRowsOnly: persistedDraft.minimalExecutableRowsOnly,
      parserCompatible: persistedDraft.parserCompatible,
    },
    candidateIdentity: {
      status:
        identityRows.length > 0 ? "available" : "not_available_until_handoff",
      rows: identityRows,
    },
    seedShapeSummary: {
      slotPlanSeedJson:
        persistedDraft.status === "available"
          ? "persisted_draft_available"
          : seed
            ? "would_be_built"
            : "not_available",
      truthBasis:
        persistedDraft.status === "available"
          ? "persisted_draft"
          : seed
            ? "prepared_acceptance_seed"
            : "none",
      wouldBeBuilt: Boolean(seed),
      minimalExecutableRowsOnly: truthShape.minimalExecutableRowsOnly,
      executableFields: [...EXECUTABLE_SEED_FIELDS],
      serializerPath: "buildMesocycleSlotPlanSeed",
      slotCount: truthShape.slotCount,
      exerciseCount: truthShape.exerciseCount,
      seedSource:
        persistedDraft.status === "available"
          ? persistedDraft.source
          : (seed?.source ?? null),
      parserCompatible: truthShape.parserCompatible,
    },
    weeklyVolumeFloorCapSummary: {
      status: "not_available",
      basis:
        "candidate seed contains executable identity/set rows but not weighted muscle volume, MEV, or MAV rows",
      rows: [],
    },
    acceptanceGatePayloadSummary: buildAcceptanceChecks({
      seedAvailable: Boolean(seed),
      serializerCompatible: preparedShape.parserCompatible,
      slotCount: preparedShape.slotCount || slotSequence.length,
      identityRowCount: identityRows.length,
    }),
    weekOneRuntimeReplayPreview: {
      status:
        identityRows.length > 0 ? "seed_order_preview_only" : "not_available",
      runtimeReplayInstantiated: false,
      rows: identityRows.map((row) => ({
        slotId: row.slotId,
        exerciseName: row.exerciseName,
        role: row.laneOrRole,
        setCount: row.setCount,
      })),
      limitation:
        "full runtime replay uses persisted successor slotPlanSeedJson plus active mesocycle context; dry-run stops before successor persistence, so this is a seed-order expectation preview only",
    },
    modeComparison: [
      {
        mode: "mesocycle-explain",
        distinction:
          "diagnostic preview only; this dry-run uses persisted accepted-draft truth when present",
      },
      {
        mode: "v2-accepted-seed-prepare-compare",
        distinction:
          "compares preparation alternatives; this dry-run separates persisted draft truth from prepared projection evidence",
      },
      {
        mode: "next-mesocycle-acceptance-gate",
        distinction:
          "judges readiness from persisted candidate evidence; this dry-run does not execute acceptance",
      },
    ],
    safety: {
      writes: "no",
      dbMutated: false,
      mesocycleCreated: false,
      workoutLogSessionCreated: false,
      seedRuntimeBehaviorChanged: false,
      plannerMaterializerBehaviorChanged: false,
      transactionExecuted: false,
    },
    ...(input.ownerEmail ? { ownerEmail: input.ownerEmail } : {}),
  };
}

export async function buildNextMesocycleHandoffDryRunAuditPayload(input: {
  userId: string;
  ownerEmail?: string;
  sourceMesocycleId: string;
  dependencies?: HandoffDryRunDependencies;
}): Promise<NextMesocycleHandoffDryRunPayload> {
  const reader = (input.dependencies?.reader ?? prisma) as HandoffDryRunReader;
  const source = await loadSourceState({
    userId: input.userId,
    sourceMesocycleId: input.sourceMesocycleId,
    reader,
  });

  if (!source) {
    return buildNoCandidatePayload({
      ownerEmail: input.ownerEmail,
      sourceMesocycleId: input.sourceMesocycleId,
      sourceState: null,
      blockingReason: "source_not_found",
    });
  }

  if (source.state !== "AWAITING_HANDOFF") {
    return buildNoCandidatePayload({
      ownerEmail: input.ownerEmail,
      sourceMesocycleId: input.sourceMesocycleId,
      sourceState: source.state,
      blockingReason: "source_not_awaiting_handoff",
    });
  }

  try {
    const prepared = await (input.dependencies?.prepareHandoff ??
      prepareMesocycleHandoffAcceptance)({
      userId: input.userId,
      mesocycleId: input.sourceMesocycleId,
    });
    return await buildPreparedPayload({
      ownerEmail: input.ownerEmail,
      sourceMesocycleId: input.sourceMesocycleId,
      prepared,
      reader,
      source,
    });
  } catch (error) {
    return buildNoCandidatePayload({
      ownerEmail: input.ownerEmail,
      sourceMesocycleId: input.sourceMesocycleId,
      sourceState: source.state,
      blockingReason:
        error instanceof Error
          ? `preparation_failed:${error.message}`
          : "preparation_failed",
    });
  }
}
