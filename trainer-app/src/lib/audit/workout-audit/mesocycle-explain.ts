import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { loadActiveMesocycle } from "@/lib/api/mesocycle-lifecycle";
import {
  loadHandoffSourceMesocycle,
  readMesocycleHandoffSummary,
  toHandoffProjectionSource,
} from "@/lib/api/mesocycle-handoff";
import {
  materializeHandoffArtifacts,
  type HandoffArtifactConstraintsRow,
  type HandoffArtifactRoleRow,
  type HandoffArtifactSource,
  type HandoffArtifactWorkoutRow,
  type MaterializedHandoffArtifacts,
} from "@/lib/api/mesocycle-handoff-artifacts";
import { projectSuccessorMesocycle } from "@/lib/api/mesocycle-handoff-projection";
import {
  buildMesocycleSlotPlanSeed,
  projectSuccessorSlotPlansFromSnapshot,
} from "@/lib/api/mesocycle-handoff-slot-plan-projection";
import { resolveMesocycleSlotContract } from "@/lib/api/mesocycle-slot-contract";
import { parseSlotPlanSeedJson } from "@/lib/api/slot-plan-seed-parser";
import {
  appendWorkoutHistoryEntryToMappedContext,
  buildProjectedWorkoutHistoryEntry,
  generateProjectedSession,
  listWorkoutExerciseNames,
  loadPreloadedGenerationSnapshot,
  buildMappedGenerationContextFromSnapshot,
} from "@/lib/api/projected-week-volume-shared";
import { getLatestReadinessSignalForReader } from "@/lib/api/readiness";
import type { SessionIntent } from "@/lib/engine/session-types";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import { readRuntimeEditReconciliation } from "@/lib/ui/selection-metadata";
import {
  buildSessionAuditMutationSummary,
  resolvePersistedOrReconstructedSessionAuditSnapshot,
} from "@/lib/evidence/session-audit-snapshot";
import { resolveSessionSlotPolicy } from "@/lib/planning/session-slot-profile";
import { MESOCYCLE_EXPLAIN_AUDIT_PAYLOAD_VERSION } from "./constants";
import {
  interpretRuntimeEdits,
  type RuntimeEditExerciseContext,
} from "./runtime-edit-interpretation";
import type {
  MesocycleExplainAuditPayload,
  MesocycleExplainComparisonSlotDiff,
  MesocycleExplainExerciseRationale,
  MesocycleExplainExerciseRow,
  MesocycleExplainPreviewProjectedSession,
  MesocycleExplainRealityWorkout,
  MesocycleExplainReasonSource,
  MesocycleExplainSlotRow,
} from "./types";

type ExplainMesocycleRow = Prisma.MesocycleGetPayload<{
  include: {
    blocks: true;
    macroCycle: {
      select: {
        userId: true;
      };
    };
  };
}>;

type ExplainWorkoutRow = Prisma.WorkoutGetPayload<{
  select: {
    id: true;
    scheduledDate: true;
    status: true;
    revision: true;
    advancesSplit: true;
    selectionMode: true;
    sessionIntent: true;
    selectionMetadata: true;
    mesocycleId: true;
    mesocycleWeekSnapshot: true;
    mesoSessionSnapshot: true;
    mesocyclePhaseSnapshot: true;
    exercises: {
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }];
      select: {
        id: true;
        exerciseId: true;
        orderIndex: true;
        section: true;
        isMainLift: true;
        exercise: {
          select: {
            name: true;
            aliases: {
              select: {
                alias: true;
              };
            };
            exerciseMuscles: {
              select: {
                role: true;
                muscle: {
                  select: {
                    name: true;
                  };
                };
              };
            };
          };
        };
        sets: {
          orderBy: {
            setIndex: "asc";
          };
          select: {
            setIndex: true;
            targetReps: true;
            targetRepMin: true;
            targetRepMax: true;
            targetRpe: true;
            targetLoad: true;
            restSeconds: true;
          };
        };
      };
    };
  };
}>;

type NormalizedSeedSlot = {
  slotId: string;
  slotIndex: number;
  intent: string;
  exercises: MesocycleExplainExerciseRow[];
};

type ComparisonSlotShape = {
  slotId: string | null;
  slotIndex: number | null;
  intent: string | null;
  exercises: Array<{
    exerciseId: string;
    role: string | null;
    setCount?: number;
  }>;
};

function countWorkoutExercises(workout: {
  warmup: unknown[];
  mainLifts: unknown[];
  accessories: unknown[];
}): number {
  return workout.warmup.length + workout.mainLifts.length + workout.accessories.length;
}

function countWorkoutSets(workout: {
  warmup: Array<{ sets: unknown[] }>;
  mainLifts: Array<{ sets: unknown[] }>;
  accessories: Array<{ sets: unknown[] }>;
}): number {
  return [...workout.warmup, ...workout.mainLifts, ...workout.accessories].reduce(
    (sum, exercise) => sum + exercise.sets.length,
    0
  );
}

function normalizeIntent(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.toLowerCase() : null;
}

function normalizeReasonCodes(reasonCodes: string[]): string[] {
  return reasonCodes
    .map((code) => code.trim())
    .filter((code) => code.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function buildComparisonKey(slotIndex: number | null, slotId: string | null): string {
  if (slotIndex != null) {
    return `index:${slotIndex}`;
  }
  return `slot:${slotId ?? "unknown"}`;
}

function buildSlotObligationSummary(input: {
  slotId: string;
  intent: string;
  slotSequenceJson: unknown;
  weeklySchedule: string[];
}): string[] {
  const resolved = resolveMesocycleSlotContract({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
  });
  const slot = resolved.slots.find((entry) => entry.slotId === input.slotId);
  const sessionPolicy = resolveSessionSlotPolicy({
    sessionIntent: input.intent as SessionIntent,
    slotId: input.slotId,
    slotSequence: {
      slots: resolved.slots.map((entry, sequenceIndex) => ({
        slotId: entry.slotId,
        intent: entry.intent,
        sequenceIndex,
        authoredSemantics: entry.authoredSemantics,
      })),
    },
  }).currentSession;

  const obligations: string[] = [];
  if (slot?.authoredSemantics?.slotArchetype) {
    obligations.push(`slot_archetype:${slot.authoredSemantics.slotArchetype}`);
  }
  if (slot?.authoredSemantics?.continuityScope) {
    obligations.push(`continuity_scope:${slot.authoredSemantics.continuityScope}`);
  }
  const requiredPatterns = sessionPolicy?.sessionShape?.requiredMovementPatterns ?? [];
  if (requiredPatterns.length > 0) {
    obligations.push(`required_patterns:${requiredPatterns.join(",")}`);
  }
  const supportContract = slot?.authoredSemantics?.supportCoverageContract;
  if (supportContract) {
    obligations.push(`support_coverage:${JSON.stringify(supportContract)}`);
  }
  const primaryLane = slot?.authoredSemantics?.primaryLaneContract;
  if (primaryLane) {
    obligations.push(`primary_lane:${JSON.stringify(primaryLane)}`);
  }

  return obligations;
}

function buildExerciseNameMap(input: {
  slotRows: MesocycleExplainSlotRow[];
  workouts: ExplainWorkoutRow[];
  carryForward: MaterializedHandoffArtifacts["carryForwardRecommendations"];
}): Map<string, string> {
  const byId = new Map<string, string>();

  for (const slot of input.slotRows) {
    for (const exercise of slot.exercises) {
      byId.set(exercise.exerciseId, exercise.exerciseName);
    }
  }

  for (const workout of input.workouts) {
    for (const exercise of workout.exercises) {
      byId.set(exercise.exerciseId, exercise.exercise.name);
    }
  }

  for (const recommendation of input.carryForward) {
    byId.set(recommendation.exerciseId, recommendation.exerciseName);
  }

  return byId;
}

function normalizeSeedSlots(input: {
  slotPlanSeedJson: unknown;
  slotSequenceJson: unknown;
  weeklySchedule: string[];
  exerciseNameById: Map<string, string>;
}): NormalizedSeedSlot[] {
  const parsedSeed = parseSlotPlanSeedJson(input.slotPlanSeedJson);
  if (!parsedSeed) {
    return [];
  }

  const resolvedSlots = resolveMesocycleSlotContract({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
  }).slots;
  const seedBySlotId = new Map(parsedSeed.slots.map((slot) => [slot.slotId, slot.exercises]));

  return resolvedSlots.flatMap((slot, slotIndex) => {
    const exercises = seedBySlotId.get(slot.slotId);
    if (!exercises || exercises.length === 0) {
      return [];
    }

    return [{
      slotId: slot.slotId,
      slotIndex,
      intent: slot.intent,
      exercises: exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        exerciseName: input.exerciseNameById.get(exercise.exerciseId) ?? exercise.exerciseId,
        role: exercise.role,
        ...(exercise.setCount != null ? { setCount: exercise.setCount } : {}),
      })),
    }];
  });
}

async function loadExplainMesocycle(input: {
  userId: string;
  mesocycleId: string;
}): Promise<ExplainMesocycleRow> {
  const mesocycle = await prisma.mesocycle.findFirst({
    where: {
      id: input.mesocycleId,
      macroCycle: { userId: input.userId },
    },
    include: {
      blocks: {
        orderBy: { blockNumber: "asc" },
      },
      macroCycle: {
        select: {
          userId: true,
        },
      },
    },
  });

  if (!mesocycle) {
    throw new Error(`No mesocycle found for mesocycle-explain mesocycleId=${input.mesocycleId}.`);
  }

  return mesocycle;
}

async function resolveSourceMesocycleId(userId: string): Promise<string> {
  const activeMesocycle = await loadActiveMesocycle(userId);
  if (activeMesocycle) {
    return activeMesocycle.id;
  }

  const latestMesocycle = await prisma.mesocycle.findFirst({
    where: {
      macroCycle: { userId },
    },
    orderBy: [{ mesoNumber: "desc" }],
    select: {
      id: true,
    },
  });

  if (!latestMesocycle) {
    throw new Error("No mesocycle found for mesocycle-explain.");
  }

  return latestMesocycle.id;
}

async function loadPreviewArtifacts(input: {
  sourceMesocycle: ExplainMesocycleRow;
}): Promise<{
  rationaleBasis: "persisted_handoff_summary" | "reconstructed_now";
  artifacts: MaterializedHandoffArtifacts;
}> {
  const persistedSummary = readMesocycleHandoffSummary(input.sourceMesocycle.handoffSummaryJson);
  if (persistedSummary?.recommendedDesign && persistedSummary.recommendedNextSeed) {
    return {
      rationaleBasis: "persisted_handoff_summary",
      artifacts: {
        summary: persistedSummary,
        recommendedDesign: persistedSummary.recommendedDesign,
        recommendedNextSeed: persistedSummary.recommendedNextSeed,
        carryForwardRecommendations: persistedSummary.carryForwardRecommendations,
      },
    };
  }

  const handoffSource = await loadHandoffSourceMesocycle(prisma, input.sourceMesocycle.id);
  const roles = await prisma.mesocycleExerciseRole.findMany({
    where: { mesocycleId: input.sourceMesocycle.id },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      exerciseId: true,
      sessionIntent: true,
      role: true,
      exercise: {
        select: {
          name: true,
        },
      },
    },
  }) satisfies HandoffArtifactRoleRow[];
  const candidateExerciseIds = Array.from(new Set(roles.map((role) => role.exerciseId)));
  const [constraints, workouts, latestReadiness] = await Promise.all([
    prisma.constraints.findUnique({
      where: { userId: input.sourceMesocycle.macroCycle.userId },
      select: { weeklySchedule: true, daysPerWeek: true, splitType: true },
    }) as Promise<HandoffArtifactConstraintsRow | null>,
    prisma.workout.findMany({
      where: { mesocycleId: input.sourceMesocycle.id },
      orderBy: [{ scheduledDate: "desc" }],
      select: {
        scheduledDate: true,
        completedAt: true,
        status: true,
        sessionIntent: true,
        selectionMode: true,
        selectionMetadata: true,
        advancesSplit: true,
        mesocyclePhaseSnapshot: true,
        exercises: {
          where:
            candidateExerciseIds.length > 0
              ? { exerciseId: { in: candidateExerciseIds } }
              : undefined,
          select: {
            id: true,
            exerciseId: true,
          },
        },
      },
    }) as Promise<HandoffArtifactWorkoutRow[]>,
    getLatestReadinessSignalForReader(prisma, input.sourceMesocycle.macroCycle.userId),
  ]);

  return {
    rationaleBasis: "reconstructed_now",
    artifacts: materializeHandoffArtifacts({
      source: handoffSource as HandoffArtifactSource,
      constraints,
      roles,
      workouts,
      latestReadiness,
      closedAt: input.sourceMesocycle.closedAt ?? new Date(),
      existingSummary: persistedSummary,
    }),
  };
}

function buildPreviewSlotRows(input: {
  slotPlans: Array<{
    slotId: string;
    intent: string;
    exercises: Array<{
      exerciseId: string;
      role: string;
      setCount?: number;
    }>;
  }>;
  exerciseNameById: Map<string, string>;
}): MesocycleExplainSlotRow[] {
  return input.slotPlans.map((slot, slotIndex) => ({
    slotId: slot.slotId,
    slotIndex,
    intent: slot.intent,
    exercises: slot.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      exerciseName: input.exerciseNameById.get(exercise.exerciseId) ?? exercise.exerciseId,
      role: exercise.role,
      ...(exercise.setCount != null ? { setCount: exercise.setCount } : {}),
    })),
  }));
}

function buildSyntheticProjectedMesocycle(input: {
  sourceMesocycle: ExplainMesocycleRow;
  projection: ReturnType<typeof projectSuccessorMesocycle>;
  slotPlanSeedJson: ReturnType<typeof buildMesocycleSlotPlanSeed>;
}): ExplainMesocycleRow {
  const nextMesocycleId = `preview-${input.sourceMesocycle.id}-${input.projection.mesocycle.mesoNumber}`;

  return {
    ...input.sourceMesocycle,
    id: nextMesocycleId,
    mesoNumber: input.projection.mesocycle.mesoNumber,
    startWeek: input.projection.mesocycle.startWeek,
    durationWeeks: input.projection.mesocycle.durationWeeks,
    focus: input.projection.mesocycle.focus,
    volumeTarget: input.projection.mesocycle.volumeTarget,
    intensityBias: input.projection.mesocycle.intensityBias,
    isActive: true,
    state: "ACTIVE_ACCUMULATION",
    accumulationSessionsCompleted: 0,
    deloadSessionsCompleted: 0,
    sessionsPerWeek: input.projection.mesocycle.sessionsPerWeek,
    daysPerWeek: input.projection.mesocycle.daysPerWeek,
    splitType: input.projection.mesocycle.splitType,
    slotSequenceJson: input.projection.mesocycle.slotSequence as Prisma.JsonValue,
    slotPlanSeedJson: input.slotPlanSeedJson as Prisma.JsonValue,
    closedAt: null,
    handoffSummaryJson: null,
    nextSeedDraftJson: null,
    blocks: input.projection.trainingBlocks.map((block) => ({
      ...(input.sourceMesocycle.blocks[0] ?? {}),
      id: `${nextMesocycleId}-block-${block.blockNumber}`,
      mesocycleId: nextMesocycleId,
      blockNumber: block.blockNumber,
      blockType: block.blockType,
      startWeek: block.startWeek,
      durationWeeks: block.durationWeeks,
      volumeTarget: block.volumeTarget,
      intensityBias: block.intensityBias,
      adaptationType: block.adaptationType,
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as ExplainMesocycleRow["blocks"],
  };
}

async function buildPreviewProjectedSessions(input: {
  userId: string;
  sourceMesocycle: ExplainMesocycleRow;
  projection: ReturnType<typeof projectSuccessorMesocycle>;
  slotPlanSeedJson: ReturnType<typeof buildMesocycleSlotPlanSeed>;
  plannerDiagnosticsMode: "standard" | "debug";
  limitations: string[];
}): Promise<MesocycleExplainPreviewProjectedSession[]> {
  const syntheticMesocycle = buildSyntheticProjectedMesocycle({
    sourceMesocycle: input.sourceMesocycle,
    projection: input.projection,
    slotPlanSeedJson: input.slotPlanSeedJson,
  });
  const snapshot = await loadPreloadedGenerationSnapshot(input.userId, {
    activeMesocycle: syntheticMesocycle,
    forceAccumulation: true,
  });
  const mapped = buildMappedGenerationContextFromSnapshot(input.userId, snapshot, {
    forceAccumulation: true,
  });
  const projectionStartTime = new Date();
  const sessions: MesocycleExplainPreviewProjectedSession[] = [];

  for (const [slotIndex, slot] of input.projection.mesocycle.slotSequence.slots.entries()) {
    const generation = await generateProjectedSession({
      userId: input.userId,
      mapped,
      intent: slot.intent.toLowerCase() as SessionIntent,
      slotId: slot.slotId,
      plannerDiagnosticsMode: input.plannerDiagnosticsMode,
    });
    if ("error" in generation) {
      input.limitations.push(
        `Preview projected session generation stopped at slot ${slot.slotId} because canonical seeded runtime generation failed: ${generation.error}`
      );
      break;
    }

    sessions.push({
      sessionIndex: slotIndex + 1,
      slotId: slot.slotId,
      slotIndex,
      intent: slot.intent,
      exerciseCount: countWorkoutExercises(generation.workout),
      totalSets: countWorkoutSets(generation.workout),
      exerciseIds: [...generation.workout.mainLifts, ...generation.workout.accessories].map(
        (exercise) => exercise.exercise.id
      ),
    });

    const projectedAt = new Date(projectionStartTime.getTime() + slotIndex * 60_000);
    appendWorkoutHistoryEntryToMappedContext({
      mapped,
      historyEntry: buildProjectedWorkoutHistoryEntry({
        mapped,
        workout: generation.workout,
        slotId: slot.slotId,
        intent: slot.intent.toLowerCase() as SessionIntent,
        week: 1,
        sessionNumber: slotIndex + 1,
        occurredAt: projectedAt,
      }),
      occurredAt: projectedAt,
      rotationExerciseNames: listWorkoutExerciseNames(generation.workout),
    });
  }

  return sessions;
}

function buildPreviewExerciseRationale(input: {
  previewSlots: MesocycleExplainSlotRow[];
  design: MaterializedHandoffArtifacts["recommendedDesign"];
  carryForwardReasons: MaterializedHandoffArtifacts["carryForwardRecommendations"];
  rationaleBasis: "persisted_handoff_summary" | "reconstructed_now";
  slotSequenceJson: unknown;
  weeklySchedule: string[];
  repairedSlotIds: Set<string>;
}): MesocycleExplainExerciseRationale[] {
  return input.previewSlots.flatMap((slot) =>
    slot.exercises.map((exercise) => {
      const keepDecision =
        input.design.carryForward.decisions.find((decision) => {
          if (decision.exerciseId !== exercise.exerciseId || decision.role !== exercise.role) {
            return false;
          }
          if (decision.targetSlotId) {
            return decision.targetSlotId === slot.slotId;
          }
          return decision.targetIntent === slot.intent.toUpperCase();
        }) ?? null;
      const carryForwardReason =
        input.carryForwardReasons.find(
          (reason) =>
            reason.exerciseId === exercise.exerciseId &&
            reason.role === exercise.role &&
            reason.recommendation === "keep"
        ) ?? null;
      const constraints = [
        ...(keepDecision ? normalizeReasonCodes(keepDecision.reasonCodes) : []),
        ...(carryForwardReason ? normalizeReasonCodes(carryForwardReason.reasonCodes) : []),
        ...(input.repairedSlotIds.has(slot.slotId) ? ["protected_coverage_repair_applied"] : []),
        ...(keepDecision || carryForwardReason ? [] : ["selected_via_canonical_slot_plan_projection"]),
      ];

      return {
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        slotId: slot.slotId,
        slotIndex: slot.slotIndex,
        intent: slot.intent,
        role: exercise.role,
        reasonSource:
          input.rationaleBasis === "persisted_handoff_summary"
            ? ("persisted" as const)
            : ("reconstructed" as const),
        slotObligation: buildSlotObligationSummary({
          slotId: slot.slotId,
          intent: slot.intent.toLowerCase(),
          slotSequenceJson: input.slotSequenceJson,
          weeklySchedule: input.weeklySchedule,
        }),
        constraints,
        continuity: normalizeReasonCodes(
          [
            ...(keepDecision ? keepDecision.reasonCodes : []),
            ...(carryForwardReason ? carryForwardReason.reasonCodes : []),
          ].filter((code) => code.includes("keep") || code.includes("continu"))
        ),
        ranking: null,
      };
    })
  );
}

function buildSeedExerciseRationale(input: {
  seedSlots: NormalizedSeedSlot[];
  slotSequenceJson: unknown;
  weeklySchedule: string[];
}): MesocycleExplainExerciseRationale[] {
  return input.seedSlots.flatMap((slot) =>
    slot.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      intent: slot.intent,
      role: exercise.role,
      reasonSource: "persisted" as const,
      slotObligation: buildSlotObligationSummary({
        slotId: slot.slotId,
        intent: slot.intent.toLowerCase(),
        slotSequenceJson: input.slotSequenceJson,
        weeklySchedule: input.weeklySchedule,
      }),
      constraints: ["accepted_slot_plan_seed_membership"],
      continuity: [],
      ranking: null,
    }))
  );
}

function resolveSeedSlotForWorkout(input: {
  seedSlots: NormalizedSeedSlot[];
  slotId: string | null;
  slotIndex: number | null;
}): {
  seedSlot: NormalizedSeedSlot | null;
  comparisonBasis: "slot_id" | "slot_sequence_index" | "none";
} {
  if (input.slotId) {
    const bySlotId = input.seedSlots.find((slot) => slot.slotId === input.slotId) ?? null;
    if (bySlotId) {
      return {
        seedSlot: bySlotId,
        comparisonBasis: "slot_id",
      };
    }
  }

  if (input.slotIndex != null) {
    const byIndex = input.seedSlots.find((slot) => slot.slotIndex === input.slotIndex) ?? null;
    if (byIndex) {
      return {
        seedSlot: byIndex,
        comparisonBasis: "slot_sequence_index",
      };
    }
  }

  return {
    seedSlot: null,
    comparisonBasis: "none",
  };
}

function buildRuntimeExerciseContexts(
  workout: ExplainWorkoutRow
): RuntimeEditExerciseContext[] {
  return workout.exercises.map((workoutExercise) => ({
    exerciseId: workoutExercise.exerciseId,
    exerciseName: workoutExercise.exercise.name,
    primaryMuscles: workoutExercise.exercise.exerciseMuscles
      .filter((mapping) => mapping.role === "PRIMARY")
      .map((mapping) => mapping.muscle.name),
    secondaryMuscles: workoutExercise.exercise.exerciseMuscles
      .filter((mapping) => mapping.role === "SECONDARY")
      .map((mapping) => mapping.muscle.name),
    aliases: workoutExercise.exercise.aliases.map((alias) => alias.alias),
  }));
}

function buildRuntimeDriftLabels(
  interpretations: MesocycleExplainRealityWorkout["runtimeInterpretations"]
): string[] {
  return Array.from(
    new Set(
      interpretations.map((interpretation) => {
        if (interpretation.intent === "target_gap_closure") {
          return "runtime_addition_target_gap_closure";
        }
        if (interpretation.intent === "opportunistic_extra") {
          return "runtime_addition_opportunistic_extra";
        }
        if (interpretation.intent === "substitution") {
          return "runtime_substitution";
        }
        if (
          interpretation.intent === "pain_avoidance" ||
          interpretation.intent === "fatigue_adjustment"
        ) {
          return `runtime_${interpretation.intent}`;
        }
        return "runtime_unclassified_drift";
      })
    )
  ).sort((left, right) => left.localeCompare(right));
}

function buildRealityRows(input: {
  workouts: ExplainWorkoutRow[];
  seedSlots: NormalizedSeedSlot[];
}): {
  rows: MesocycleExplainRealityWorkout[];
  latestRealityBySlot: ComparisonSlotShape[];
} {
  const latestRealityByKey = new Map<string, ComparisonSlotShape & { scheduledDate: string }>();
  const rows = input.workouts.map((workout) => {
    const { sessionSnapshot } = resolvePersistedOrReconstructedSessionAuditSnapshot({
      selectionMetadata: workout.selectionMetadata,
      workoutId: workout.id,
      revision: workout.revision,
      status: workout.status,
      advancesSplit: workout.advancesSplit,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
      mesocycleId: workout.mesocycleId,
      mesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
      mesoSessionSnapshot: workout.mesoSessionSnapshot,
      mesocyclePhaseSnapshot: workout.mesocyclePhaseSnapshot,
    });
    const generatedVsSaved = buildSessionAuditMutationSummary({
      snapshot: sessionSnapshot,
      savedSelectionMode: workout.selectionMode,
      savedSessionIntent: workout.sessionIntent,
      persistedExercises: workout.exercises,
    });
    const slotSnapshot = readSessionSlotSnapshot(workout.selectionMetadata);
    const actualExerciseIds = workout.exercises.map((exercise) => exercise.exerciseId);
    const resolvedSeed = resolveSeedSlotForWorkout({
      seedSlots: input.seedSlots,
      slotId: slotSnapshot?.slotId ?? null,
      slotIndex: slotSnapshot?.sequenceIndex ?? null,
    });
    const seedExerciseIds = resolvedSeed.seedSlot?.exercises.map((exercise) => exercise.exerciseId) ?? [];
    const runtimeInterpretations = interpretRuntimeEdits({
      runtimeEditReconciliation: readRuntimeEditReconciliation(workout.selectionMetadata),
      exerciseContexts: buildRuntimeExerciseContexts(workout),
      legacyReconciliation: generatedVsSaved,
    });
    const row: MesocycleExplainRealityWorkout = {
      workoutId: workout.id,
      scheduledDate: workout.scheduledDate.toISOString(),
      status: workout.status,
      selectionMode: workout.selectionMode ?? undefined,
      sessionIntent: workout.sessionIntent ?? undefined,
      slotId: slotSnapshot?.slotId ?? null,
      slotIndex: slotSnapshot?.sequenceIndex ?? null,
      generatedVsSaved,
      seedDrift: {
        comparable: resolvedSeed.seedSlot != null,
        comparisonBasis: resolvedSeed.comparisonBasis,
        addedExerciseIds: actualExerciseIds.filter((exerciseId) => !seedExerciseIds.includes(exerciseId)),
        removedExerciseIds: seedExerciseIds.filter((exerciseId) => !actualExerciseIds.includes(exerciseId)),
        notes:
          resolvedSeed.seedSlot == null
            ? ["no_matching_seed_slot"]
            : [],
      },
      runtimeInterpretations,
      runtimeDriftLabels: buildRuntimeDriftLabels(runtimeInterpretations),
    };

    if (row.slotId || row.slotIndex != null) {
      const comparisonKey = buildComparisonKey(row.slotIndex, row.slotId);
      const existing = latestRealityByKey.get(comparisonKey);
      if (!existing || existing.scheduledDate < row.scheduledDate) {
        latestRealityByKey.set(comparisonKey, {
          slotId: row.slotId,
          slotIndex: row.slotIndex,
          intent: normalizeIntent(workout.sessionIntent),
          exercises: workout.exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            role: exercise.isMainLift ? "CORE_COMPOUND" : "ACCESSORY",
            setCount: exercise.sets.length,
          })),
          scheduledDate: row.scheduledDate,
        });
      }
    }

    return row;
  });

  return {
    rows,
    latestRealityBySlot: Array.from(latestRealityByKey.values()).map((entry) => ({
      slotId: entry.slotId,
      slotIndex: entry.slotIndex,
      intent: entry.intent,
      exercises: entry.exercises,
    })),
  };
}

function buildRealityExerciseRationale(input: {
  workouts: ExplainWorkoutRow[];
  seedSlots: NormalizedSeedSlot[];
  weeklySchedule: string[];
  slotSequenceJson: unknown;
}): MesocycleExplainExerciseRationale[] {
  return input.workouts.flatMap((workout) => {
    const { sessionSnapshot } = resolvePersistedOrReconstructedSessionAuditSnapshot({
      selectionMetadata: workout.selectionMetadata,
      workoutId: workout.id,
      revision: workout.revision,
      status: workout.status,
      advancesSplit: workout.advancesSplit,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
      mesocycleId: workout.mesocycleId,
      mesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
      mesoSessionSnapshot: workout.mesoSessionSnapshot,
      mesocyclePhaseSnapshot: workout.mesocyclePhaseSnapshot,
    });
    const mutation = buildSessionAuditMutationSummary({
      snapshot: sessionSnapshot,
      savedSelectionMode: workout.selectionMode,
      savedSessionIntent: workout.sessionIntent,
      persistedExercises: workout.exercises,
    });
    const runtimeInterpretations = interpretRuntimeEdits({
      runtimeEditReconciliation: readRuntimeEditReconciliation(workout.selectionMetadata),
      exerciseContexts: buildRuntimeExerciseContexts(workout),
      legacyReconciliation: mutation,
    });
    const slotSnapshot = readSessionSlotSnapshot(workout.selectionMetadata);
    const resolvedSeed = resolveSeedSlotForWorkout({
      seedSlots: input.seedSlots,
      slotId: slotSnapshot?.slotId ?? null,
      slotIndex: slotSnapshot?.sequenceIndex ?? null,
    });
    const seedExerciseIds = new Set(
      resolvedSeed.seedSlot?.exercises.map((exercise) => exercise.exerciseId) ?? []
    );

    return workout.exercises.map((exercise) => {
      const fromSeed = seedExerciseIds.has(exercise.exerciseId);
      const runtimeAdded = mutation.addedExerciseIds.includes(exercise.exerciseId);
      const runtimeIntent = runtimeInterpretations.find(
        (interpretation) => interpretation.exerciseId === exercise.exerciseId
      )?.intent;
      const reasonSource: MesocycleExplainReasonSource =
        fromSeed ? "persisted" : runtimeAdded ? "reconstructed" : "unavailable";

      return {
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exercise.name,
        slotId: slotSnapshot?.slotId ?? null,
        slotIndex: slotSnapshot?.sequenceIndex ?? null,
        intent: normalizeIntent(workout.sessionIntent),
        role: exercise.isMainLift ? "CORE_COMPOUND" : "ACCESSORY",
        reasonSource,
        slotObligation:
          slotSnapshot?.slotId && workout.sessionIntent
            ? buildSlotObligationSummary({
                slotId: slotSnapshot.slotId,
                intent: workout.sessionIntent.toLowerCase(),
                slotSequenceJson: input.slotSequenceJson,
                weeklySchedule: input.weeklySchedule,
              })
            : [],
        constraints: [
          ...(runtimeAdded ? ["runtime_edit_added_exercise"] : []),
          ...(runtimeIntent ? [`runtime_intent:${runtimeIntent}`] : []),
        ],
        continuity: fromSeed ? ["present_in_canonical_seed"] : [],
        ranking: null,
      };
    });
  });
}

function buildComparisonSlotDiffs(input: {
  previewSlots: ComparisonSlotShape[];
  retrospectiveSlots: ComparisonSlotShape[];
  slotsComparable?: boolean;
}): MesocycleExplainComparisonSlotDiff[] {
  const previewByKey = new Map(
    input.previewSlots.map((slot) => [buildComparisonKey(slot.slotIndex, slot.slotId), slot])
  );
  const retrospectiveByKey = new Map(
    input.retrospectiveSlots.map((slot) => [buildComparisonKey(slot.slotIndex, slot.slotId), slot])
  );
  const keys = Array.from(new Set([...previewByKey.keys(), ...retrospectiveByKey.keys()])).sort();

  return keys.map((key) => {
    const preview = previewByKey.get(key) ?? null;
    const retrospective = retrospectiveByKey.get(key) ?? null;
    const previewExercises = preview?.exercises ?? [];
    const retrospectiveExercises = retrospective?.exercises ?? [];
    const previewExerciseIds = previewExercises.map((exercise) => exercise.exerciseId);
    const retrospectiveExerciseIds = retrospectiveExercises.map((exercise) => exercise.exerciseId);
    const retrospectiveByExerciseId = new Map(
      retrospectiveExercises.map((exercise) => [exercise.exerciseId, exercise])
    );
    const sharedExerciseIds = previewExerciseIds.filter((exerciseId) =>
      retrospectiveExerciseIds.includes(exerciseId)
    );
    const roleMismatches = sharedExerciseIds.flatMap((exerciseId) => {
      const previewExercise = previewExercises.find((exercise) => exercise.exerciseId === exerciseId);
      const retrospectiveExercise = retrospectiveByExerciseId.get(exerciseId);
      const previewRole = previewExercise?.role ?? null;
      const retrospectiveRole = retrospectiveExercise?.role ?? null;
      return previewRole !== retrospectiveRole
        ? [{ exerciseId, previewRole, retrospectiveRole }]
        : [];
    });
    const setCountMismatches = sharedExerciseIds.flatMap((exerciseId) => {
      const previewExercise = previewExercises.find((exercise) => exercise.exerciseId === exerciseId);
      const retrospectiveExercise = retrospectiveByExerciseId.get(exerciseId);
      const previewSetCount = previewExercise?.setCount ?? null;
      const retrospectiveSetCount = retrospectiveExercise?.setCount ?? null;
      return previewSetCount !== retrospectiveSetCount
        ? [{ exerciseId, previewSetCount, retrospectiveSetCount }]
        : [];
    });
    const orderedExerciseIdsMatch =
      previewExerciseIds.length === retrospectiveExerciseIds.length &&
      previewExerciseIds.every((exerciseId, index) => retrospectiveExerciseIds[index] === exerciseId);
    const exactMatch =
      preview != null &&
      retrospective != null &&
      normalizeIntent(preview.intent) === normalizeIntent(retrospective.intent) &&
      orderedExerciseIdsMatch &&
      roleMismatches.length === 0 &&
      setCountMismatches.length === 0;

    return {
      comparisonKey: key,
      previewSlotId: preview?.slotId ?? null,
      retrospectiveSlotId: retrospective?.slotId ?? null,
      previewIntent: preview?.intent ?? null,
      retrospectiveIntent: retrospective?.intent ?? null,
      previewOnlyExerciseIds: previewExerciseIds.filter(
        (exerciseId) => !retrospectiveExerciseIds.includes(exerciseId)
      ),
      retrospectiveOnlyExerciseIds: retrospectiveExerciseIds.filter(
        (exerciseId) => !previewExerciseIds.includes(exerciseId)
      ),
      sharedExerciseIds,
      orderedExerciseIdsMatch,
      roleMismatches,
      setCountMismatches,
      exactMatch,
      comparable: input.slotsComparable !== false && preview != null && retrospective != null,
    };
  });
}

export async function buildMesocycleExplainAuditPayload(input: {
  userId: string;
  ownerEmail?: string;
  sourceMesocycleId?: string;
  retrospectiveMesocycleId?: string;
  plannerDiagnosticsMode: "standard" | "debug";
}): Promise<MesocycleExplainAuditPayload> {
  const sourceMesocycleId = input.sourceMesocycleId ?? (await resolveSourceMesocycleId(input.userId));
  const retrospectiveMesocycleId = input.retrospectiveMesocycleId ?? sourceMesocycleId;
  const [sourceMesocycle, retrospectiveMesocycle, constraints] = await Promise.all([
    loadExplainMesocycle({ userId: input.userId, mesocycleId: sourceMesocycleId }),
    loadExplainMesocycle({ userId: input.userId, mesocycleId: retrospectiveMesocycleId }),
    prisma.constraints.findUnique({
      where: { userId: input.userId },
      select: { weeklySchedule: true },
    }),
  ]);
  const weeklySchedule = (constraints?.weeklySchedule ?? []).map((intent) => intent.toLowerCase());
  const limitations: string[] = [];

  const previewArtifacts = await loadPreviewArtifacts({
    sourceMesocycle,
  });
  const sourceProjection = toHandoffProjectionSource(
    (await loadHandoffSourceMesocycle(prisma, sourceMesocycle.id)) as HandoffArtifactSource
  );
  const projectedMesocycle = projectSuccessorMesocycle({
    source: sourceProjection,
    design: previewArtifacts.artifacts.recommendedDesign,
  });
  const sourceSnapshot = await loadPreloadedGenerationSnapshot(input.userId, {
    activeMesocycle: sourceMesocycle,
  });
  const slotPlanProjection = projectSuccessorSlotPlansFromSnapshot({
    userId: input.userId,
    source: sourceProjection,
    design: previewArtifacts.artifacts.recommendedDesign,
    snapshot: sourceSnapshot,
  });

  if ("error" in slotPlanProjection) {
    limitations.push(
      `Preview slot-plan projection could not fully materialize through the canonical handoff projection seam: ${slotPlanProjection.error}`
    );
  }

  const previewSlotPlansRaw = "error" in slotPlanProjection ? (slotPlanProjection.slotPlans ?? []) : slotPlanProjection.slotPlans;
  const seedWorkouts = await prisma.workout.findMany({
    where: {
      mesocycleId: retrospectiveMesocycle.id,
    },
    orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      scheduledDate: true,
      status: true,
      revision: true,
      advancesSplit: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
      mesocycleId: true,
      mesocycleWeekSnapshot: true,
      mesoSessionSnapshot: true,
      mesocyclePhaseSnapshot: true,
      exercises: {
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
        select: {
          id: true,
          exerciseId: true,
          orderIndex: true,
          section: true,
          isMainLift: true,
          exercise: {
            select: {
              name: true,
              aliases: {
                select: {
                  alias: true,
                },
              },
              exerciseMuscles: {
                select: {
                  role: true,
                  muscle: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
          sets: {
            orderBy: { setIndex: "asc" },
            select: {
              setIndex: true,
              targetReps: true,
              targetRepMin: true,
              targetRepMax: true,
              targetRpe: true,
              targetLoad: true,
              restSeconds: true,
            },
          },
        },
      },
    },
  });
  const previewSlotRows = buildPreviewSlotRows({
    slotPlans: previewSlotPlansRaw.map((slot) => ({
      slotId: slot.slotId,
      intent: slot.intent,
      exercises: slot.exercises,
    })),
    exerciseNameById: new Map(
      previewArtifacts.artifacts.carryForwardRecommendations.map((row) => [row.exerciseId, row.exerciseName])
    ),
  });
  const exerciseNameById = buildExerciseNameMap({
    slotRows: previewSlotRows,
    workouts: seedWorkouts,
    carryForward: previewArtifacts.artifacts.carryForwardRecommendations,
  });
  const previewSlotPlans = buildPreviewSlotRows({
    slotPlans: previewSlotPlansRaw.map((slot) => ({
      slotId: slot.slotId,
      intent: slot.intent,
      exercises: slot.exercises,
    })),
    exerciseNameById,
  });

  let previewProjectedSessions: MesocycleExplainPreviewProjectedSession[] = [];
  if (previewSlotPlansRaw.length > 0) {
    const previewSeed = buildMesocycleSlotPlanSeed({
      slotSequence: projectedMesocycle.mesocycle.slotSequence,
      slotPlans: previewSlotPlansRaw,
    });
    previewProjectedSessions = await buildPreviewProjectedSessions({
      userId: input.userId,
      sourceMesocycle,
      projection: projectedMesocycle,
      slotPlanSeedJson: previewSeed,
      plannerDiagnosticsMode: input.plannerDiagnosticsMode,
      limitations,
    });
  } else {
    limitations.push(
      "Preview slot plans are unavailable because the canonical handoff slot-plan projection did not return any slot plans."
    );
  }

  const seedSlots =
    retrospectiveMesocycle.slotPlanSeedJson != null
      ? normalizeSeedSlots({
          slotPlanSeedJson: retrospectiveMesocycle.slotPlanSeedJson,
          slotSequenceJson: retrospectiveMesocycle.slotSequenceJson,
          weeklySchedule,
          exerciseNameById,
        })
      : [];
  if (retrospectiveMesocycle.slotPlanSeedJson == null) {
    limitations.push(
      `Retrospective mesocycle ${retrospectiveMesocycle.id} has no persisted slotPlanSeedJson, so accepted-seed comparisons are unavailable.`
    );
  } else if (seedSlots.length === 0) {
    limitations.push(
      `Retrospective mesocycle ${retrospectiveMesocycle.id} has a persisted slotPlanSeedJson that could not be normalized against the canonical slot sequence.`
    );
  }

  const reality = buildRealityRows({
    workouts: seedWorkouts,
    seedSlots,
  });
  const previewVsSeed = buildComparisonSlotDiffs({
    previewSlots: previewSlotPlans.map((slot) => ({
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      intent: slot.intent,
      exercises: slot.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        role: exercise.role,
        setCount: exercise.setCount,
      })),
    })),
    retrospectiveSlots: seedSlots.map((slot) => ({
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      intent: slot.intent,
      exercises: slot.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        role: exercise.role,
        setCount: exercise.setCount,
      })),
    })),
    slotsComparable: false,
  });
  const previewVsReality = buildComparisonSlotDiffs({
    previewSlots: previewSlotPlans.map((slot) => ({
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      intent: slot.intent,
      exercises: slot.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        role: exercise.role,
        setCount: exercise.setCount,
      })),
    })),
    retrospectiveSlots: reality.latestRealityBySlot,
  });

  limitations.push(
    "Historical acceptance-time candidate ranking rationale is not persisted for accepted mesocycle seeds, so ranking remains unavailable in seed and retrospective comparisons."
  );
  limitations.push(
    "Preview exercise rationale is strongest for slot obligation, carry-forward continuity, and protected-coverage reconstruction; per-candidate winner-over-alternative ranking is not claimed unless canonically persisted."
  );
  limitations.push(
    "Preview slot plans are fresh reprojections from the current canonical handoff projection seam, not persisted acceptance-time projection artifacts; preview-vs-seed diffs are diagnostic and are not marked comparable to the accepted seed."
  );
  if (sourceMesocycle.id !== retrospectiveMesocycle.id) {
    limitations.push(
      `Preview is generated from source mesocycle ${sourceMesocycle.id} while seed/reality read from retrospective mesocycle ${retrospectiveMesocycle.id}; cross-mesocycle diffs are structural comparisons, not a one-to-one replay.`
    );
  }
  if (reality.rows.some((row) => row.seedDrift.comparisonBasis === "none")) {
    limitations.push(
      "Some retrospective workouts were missing canonical slot identity, so seed-vs-reality drift falls back to unavailable for those sessions."
    );
  }

  return {
    version: MESOCYCLE_EXPLAIN_AUDIT_PAYLOAD_VERSION,
    ownerEmail: input.ownerEmail,
    sourceMesocycleId: sourceMesocycle.id,
    retrospectiveMesocycleId: retrospectiveMesocycle.id,
    preview: {
      sourceMesocycleId: sourceMesocycle.id,
      rationaleBasis: previewArtifacts.rationaleBasis,
      designBasis: {
        focus: previewArtifacts.artifacts.recommendedDesign.profile.focus,
        splitType: previewArtifacts.artifacts.recommendedDesign.structure.splitType,
        sessionsPerWeek: previewArtifacts.artifacts.recommendedDesign.structure.sessionsPerWeek,
        daysPerWeek: previewArtifacts.artifacts.recommendedDesign.structure.daysPerWeek,
        durationWeeks: previewArtifacts.artifacts.recommendedDesign.profile.durationWeeks,
        volumeTarget: previewArtifacts.artifacts.recommendedDesign.profile.volumeTarget,
        intensityBias: previewArtifacts.artifacts.recommendedDesign.profile.intensityBias,
        profileReasonCodes: previewArtifacts.artifacts.recommendedDesign.explainability.profileReasonCodes,
        structureReasonCodes: previewArtifacts.artifacts.recommendedDesign.explainability.structureReasonCodes,
        startingPointReasonCodes:
          previewArtifacts.artifacts.recommendedDesign.explainability.startingPointReasonCodes,
      },
      carryForwardReasons: previewArtifacts.artifacts.carryForwardRecommendations.map((row) => ({
        exerciseId: row.exerciseId,
        exerciseName: row.exerciseName,
        sessionIntent: row.sessionIntent,
        role: row.role,
        recommendation: row.recommendation,
        signalQuality: row.signalQuality,
        reasonCodes: row.reasonCodes,
      })),
      slotPlans: previewSlotPlans,
      projectedSessions: previewProjectedSessions,
      exerciseRationale: buildPreviewExerciseRationale({
        previewSlots: previewSlotPlans,
        design: previewArtifacts.artifacts.recommendedDesign,
        carryForwardReasons: previewArtifacts.artifacts.carryForwardRecommendations,
        rationaleBasis: previewArtifacts.rationaleBasis,
        slotSequenceJson: projectedMesocycle.mesocycle.slotSequence,
        weeklySchedule,
        repairedSlotIds: new Set(
          ("error" in slotPlanProjection
            ? slotPlanProjection.diagnostics?.protectedCoverage.repairedSlotIds
            : slotPlanProjection.diagnostics?.protectedCoverage.repairedSlotIds) ?? []
        ),
      }),
    },
    seed: {
      mesocycleId: retrospectiveMesocycle.id,
      available: seedSlots.length > 0,
      slotPlans: seedSlots.map((slot) => ({
        slotId: slot.slotId,
        slotIndex: slot.slotIndex,
        intent: slot.intent,
        exercises: slot.exercises,
      })),
      exerciseRationale: buildSeedExerciseRationale({
        seedSlots,
        slotSequenceJson: retrospectiveMesocycle.slotSequenceJson,
        weeklySchedule,
      }),
    },
    reality: {
      mesocycleId: retrospectiveMesocycle.id,
      workoutCount: reality.rows.length,
      generatedVsSaved: reality.rows,
      runtimeDrift: reality.rows.filter(
        (row) =>
          row.seedDrift.addedExerciseIds.length > 0 ||
          row.seedDrift.removedExerciseIds.length > 0 ||
          row.generatedVsSaved.hasDrift
      ),
      exerciseRationale: buildRealityExerciseRationale({
        workouts: seedWorkouts,
        seedSlots,
        weeklySchedule,
        slotSequenceJson: retrospectiveMesocycle.slotSequenceJson,
      }),
    },
    comparison: {
      previewVsSeed: {
        comparable: false,
        comparisonBasis:
          seedSlots.length > 0 && previewSlotPlans.length > 0 ? "fresh_reprojection" : "none",
        slotDiffs: previewVsSeed,
      },
      seedVsReality: {
        comparable: seedSlots.length > 0 && reality.rows.length > 0,
        workoutDrift: reality.rows,
      },
      previewVsReality: {
        comparable: previewSlotPlans.length > 0 && reality.latestRealityBySlot.length > 0,
        comparisonBasis:
          previewSlotPlans.length > 0 && reality.latestRealityBySlot.length > 0
            ? "latest_saved_by_slot"
            : "none",
        slotDiffs: previewVsReality,
      },
    },
    limitations: Array.from(new Set(limitations)),
  };
}
