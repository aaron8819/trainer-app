import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { evaluateAcceptedMesocycleSeedProvenance } from "@/lib/api/accepted-mesocycle-seed-provenance";
import { deriveCurrentMesocycleSession } from "@/lib/api/mesocycle-lifecycle";
import { buildProgramCurrentWeekPlan } from "@/lib/api/program-page";
import { loadProjectedWeekVolumeReport } from "@/lib/api/projected-week-volume";
import { readRuntimeSlotSequence } from "@/lib/api/mesocycle-slot-runtime";
import { loadNextWorkoutContext } from "@/lib/api/next-session";
import { parseSlotPlanSeedJson } from "@/lib/api/slot-plan-seed-parser";
import { generateSessionFromIntent } from "@/lib/api/template-session";
import type {
  PrescriptionConfidenceReadout,
  SessionGenerationResult,
} from "@/lib/api/template-session/types";
import { listWorkoutPlanExercisesInOrder } from "@/lib/engine/workout-plan-order";
import { parseSessionIntent } from "@/lib/planning/session-opportunities";
import type { SessionSlotSnapshot } from "@/lib/evidence/types";
import type { MesocycleState } from "@prisma/client";
import { NEXT_MESOCYCLE_POST_ACCEPT_VERIFICATION_AUDIT_PAYLOAD_VERSION } from "./constants";
import type {
  NextMesocyclePostAcceptVerificationPayload,
  PrescriptionConfidenceSourceClassification,
  ProjectedWeekVolumeAuditPayload,
  WorkoutAuditGenerationPath,
} from "./types";

const EXECUTABLE_SEED_FIELDS = ["exerciseId", "role", "setCount"] as const;

type SourceMesocycleRow = {
  id: string;
  state: MesocycleState;
  isActive: boolean;
  macroCycleId: string;
  mesoNumber: number;
  nextSeedDraftJson?: unknown;
};

type SuccessorMesocycleRow = SourceMesocycleRow & {
  durationWeeks: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  sessionsPerWeek: number;
  slotSequenceJson: unknown;
  slotPlanSeedJson: unknown;
  currentSeedRevision?: {
    id: string;
    revision: number;
    seedPayload?: unknown;
    payloadHash: string | null;
    provenanceStatus: string;
  } | null;
  seedRevisions?: Array<{
    id: string;
    revision: number;
    payloadHash: string | null;
    provenanceStatus: string;
    creationReason: string;
    actorSource: string | null;
    sourceRevisionId: string | null;
    activatedAt: Date;
  }>;
};

type PostAcceptEvidence = {
  ownerEmail?: string;
  sourceMesocycleId: string;
  requestedSuccessorMesocycleId?: string;
  sourceMesocycle: SourceMesocycleRow | null;
  successorMesocycle: SuccessorMesocycleRow | null;
  activeMesocycleId: string | null;
  weeklySchedule: string[];
  seedExerciseNameById: Record<string, string>;
  nextSession: Awaited<ReturnType<typeof loadNextWorkoutContext>> | null;
  generationResult: SessionGenerationResult | { error: string } | null;
  generationPath: WorkoutAuditGenerationPath | null;
  projectedWeekVolume: ProjectedWeekVolumeAuditPayload | null;
  projectedWeekError?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function summarizeSeed(seedJson: unknown): NextMesocyclePostAcceptVerificationPayload["seedContract"] {
  const parsed = parseSlotPlanSeedJson(seedJson);
  const rawSeed = isRecord(seedJson) ? seedJson : null;
  const rawSlots = Array.isArray(rawSeed?.slots) ? rawSeed.slots : [];
  let extraExecutableRowFieldCount = 0;

  for (const rawSlot of rawSlots) {
    const exercises = isRecord(rawSlot) && Array.isArray(rawSlot.exercises)
      ? rawSlot.exercises
      : [];
    for (const rawExercise of exercises) {
      if (!isRecord(rawExercise)) {
        continue;
      }
      const keys = Object.keys(rawExercise);
      extraExecutableRowFieldCount += keys.filter(
        (key) => !EXECUTABLE_SEED_FIELDS.includes(key as typeof EXECUTABLE_SEED_FIELDS[number]),
      ).length;
    }
  }

  const exercises = parsed?.slots.flatMap((slot) => slot.exercises) ?? [];
  const missingSetCount = exercises.filter(
    (exercise) => !exercise.hasExplicitSetCount,
  ).length;

  return {
    slotPlanSeedJson: parsed
      ? exercises.length > 0
        ? "available"
        : "missing"
      : seedJson
        ? "invalid"
        : "missing",
    source: parsed?.source ?? null,
    slotCount: parsed?.slots.length ?? 0,
    exerciseCount: exercises.length,
    minimalExecutableRowsOnly:
      parsed != null &&
      exercises.length > 0 &&
      missingSetCount === 0 &&
      extraExecutableRowFieldCount === 0,
    executableFields: [...EXECUTABLE_SEED_FIELDS],
    missingSetCount,
    extraExecutableRowFieldCount,
  };
}

function resolveAdvancingSlotSnapshot(
  nextSession: PostAcceptEvidence["nextSession"],
): SessionSlotSnapshot | undefined {
  if (
    !nextSession ||
    nextSession.source !== "rotation" ||
    !nextSession.slotId ||
    nextSession.slotSequenceIndex == null ||
    !nextSession.slotSource ||
    !nextSession.intent
  ) {
    return undefined;
  }

  return {
    slotId: nextSession.slotId,
    intent: nextSession.intent,
    sequenceIndex: nextSession.slotSequenceIndex,
    sequenceLength: nextSession.slotSequenceLength ?? undefined,
    source: nextSession.slotSource,
  };
}

function generatedExerciseRows(
  generationResult: PostAcceptEvidence["generationResult"],
): Array<{ exerciseId: string; setCount: number }> {
  if (!generationResult || "error" in generationResult) {
    return [];
  }
  return listWorkoutPlanExercisesInOrder(generationResult.workout)
    .filter(({ section }) => section !== "warmup")
    .map(({ exercise }) => ({
      exerciseId: exercise.exercise.id,
      setCount: exercise.sets.length,
    }));
}

function classifyPrescriptionReadout(
  readout: PrescriptionConfidenceReadout,
): PrescriptionConfidenceSourceClassification {
  if (readout.cautionReason?.includes("target_effort_load_mismatch")) {
    return "load_calibration_drift";
  }

  if (readout.cautionReason === "estimate_load_no_exact_history") {
    return "exercise_new_to_user";
  }

  if (readout.loadSource === "estimate") {
    return "estimated";
  }

  if (readout.loadSource === "none" || readout.loadSource === "unknown") {
    return "missing";
  }

  if (
    readout.loadSource === "baseline" ||
    readout.loadSource === "existing_target_load"
  ) {
    return "estimated";
  }

  if (readout.loadSource === "history") {
    if (readout.confidence === "high") {
      return "exact_history";
    }
    if (readout.confidence === "medium") {
      return "recent_history";
    }
    return "stale_history";
  }

  if (readout.loadSource === "runtime_added_same_exercise_calibration_anchor") {
    return "recent_history";
  }

  if (readout.loadSource === "bodyweight") {
    return readout.confidence === "low" ? "missing" : "exact_history";
  }

  return "missing";
}

function ownerSeamForPrescriptionClassification(
  classification: PrescriptionConfidenceSourceClassification,
): string {
  if (classification === "runtime_only") {
    return "template-session seeded runtime replay";
  }
  if (classification === "load_calibration_drift") {
    return "progression/load calibration readout";
  }
  return "future-week prescription readout";
}

function buildPrescriptionConfidenceSourceMap(
  generationResult: PostAcceptEvidence["generationResult"],
): NextMesocyclePostAcceptVerificationPayload["prescriptionConfidence"] {
  if (!generationResult) {
    return {
      status: "runtime_only",
      summary: {
        rowCount: 0,
        lowConfidenceCount: 0,
        cautionCount: 0,
        runtimeOnlyCount: 1,
        classificationCounts: { runtime_only: 1 },
      },
      rows: [],
    };
  }

  if ("error" in generationResult) {
    return {
      status: "generation_error",
      summary: {
        rowCount: 0,
        lowConfidenceCount: 0,
        cautionCount: 0,
        runtimeOnlyCount: 0,
        classificationCounts: {},
      },
      rows: [],
    };
  }

  const rows = (generationResult.prescriptionReadouts ?? []).map((readout) => {
    const classification = classifyPrescriptionReadout(readout);
    return {
      exerciseId: readout.exerciseId,
      exerciseName: readout.exerciseName,
      classification,
      confidence: readout.confidence,
      loadSource: readout.loadSource,
      cautionLevel: readout.cautionLevel,
      cautionReason: readout.cautionReason,
      targetLoad: readout.targetLoad,
      ownerSeam: ownerSeamForPrescriptionClassification(classification),
      evidence: [
        `loadSource=${readout.loadSource}`,
        `confidence=${readout.confidence}`,
        `caution=${readout.cautionLevel}`,
        readout.cautionReason ? `reason=${readout.cautionReason}` : "",
      ].filter(Boolean).join(" "),
    };
  });
  const classificationCounts = rows.reduce<
    Partial<Record<PrescriptionConfidenceSourceClassification, number>>
  >((counts, row) => {
    counts[row.classification] = (counts[row.classification] ?? 0) + 1;
    return counts;
  }, {});

  return {
    status: "available",
    summary: {
      rowCount: rows.length,
      lowConfidenceCount: rows.filter((row) => row.confidence === "low").length,
      cautionCount: rows.filter((row) => row.cautionLevel !== "none").length,
      runtimeOnlyCount: 0,
      classificationCounts,
    },
    rows,
  };
}

function seedExerciseRowsForSlot(input: {
  seedJson: unknown;
  slotId: string | null;
}): Array<{ exerciseId: string; setCount: number | null }> {
  const parsed = parseSlotPlanSeedJson(input.seedJson);
  const slot = parsed?.slots.find((entry) => entry.slotId === input.slotId);
  return (
    slot?.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      setCount: exercise.setCount ?? null,
    })) ?? []
  );
}

function acceptedSeedDraftSlotPlanSeedJson(nextSeedDraftJson: unknown): unknown {
  const draft = isRecord(nextSeedDraftJson) ? nextSeedDraftJson : null;
  const acceptedSeedDraft = isRecord(draft?.acceptedSeedDraft)
    ? draft.acceptedSeedDraft
    : null;
  return acceptedSeedDraft?.slotPlanSeedJson;
}

function summarizeSeedIdentity(input: {
  seedJson: unknown;
  seedExerciseNameById: Record<string, string>;
}): {
  hash: string | null;
  source: string | null;
  rowCount: number;
  slotOrder: string[];
  anchorRows: Array<{
    slotId: string;
    exerciseId: string;
    exerciseName: string;
    setCount: number | null;
  }>;
} {
  const parsed = parseSlotPlanSeedJson(input.seedJson);
  if (!parsed) {
    return {
      hash: null,
      source: null,
      rowCount: 0,
      slotOrder: [],
      anchorRows: [],
    };
  }

  return {
    hash: stableHash(input.seedJson),
    source: parsed.source ?? null,
    rowCount: parsed.slots.reduce((sum, slot) => sum + slot.exercises.length, 0),
    slotOrder: parsed.slots.map((slot) => slot.slotId),
    anchorRows: parsed.slots.flatMap((slot) => {
      const anchor = slot.exercises[0];
      return anchor
        ? [
            {
              slotId: slot.slotId,
              exerciseId: anchor.exerciseId,
              exerciseName:
                input.seedExerciseNameById[anchor.exerciseId] ?? anchor.exerciseId,
              setCount: anchor.setCount ?? null,
            },
          ]
        : [];
    }),
  };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => right[index] === value);
}

function anchorRowsEqual(
  left: ReturnType<typeof summarizeSeedIdentity>["anchorRows"],
  right: ReturnType<typeof summarizeSeedIdentity>["anchorRows"],
): boolean {
  return (
    left.length === right.length &&
    left.every((row, index) => {
      const other = right[index];
      return (
        other?.slotId === row.slotId &&
        other.exerciseId === row.exerciseId &&
        other.setCount === row.setCount
      );
    })
  );
}

function rowsMatchSeed(input: {
  seedRows: Array<{ exerciseId: string; setCount: number | null }>;
  generatedRows: Array<{ exerciseId: string; setCount: number }>;
}): boolean {
  if (input.seedRows.length === 0 || input.seedRows.length !== input.generatedRows.length) {
    return false;
  }
  return input.seedRows.every((seedRow, index) => {
    const generatedRow = input.generatedRows[index];
    return (
      generatedRow?.exerciseId === seedRow.exerciseId &&
      generatedRow.setCount === seedRow.setCount
    );
  });
}

function projectedSessionsMatchSeed(input: {
  seedJson: unknown;
  projectedWeekVolume: ProjectedWeekVolumeAuditPayload | null;
}): { allSeedBacked: boolean; mismatchedSlots: string[] } {
  const sessions = input.projectedWeekVolume?.projectedSessions ?? [];
  if (sessions.length === 0) {
    return { allSeedBacked: false, mismatchedSlots: [] };
  }

  const mismatchedSlots = sessions.flatMap((session) => {
    const seedRows = seedExerciseRowsForSlot({
      seedJson: input.seedJson,
      slotId: session.slotId,
    });
    const generatedRows =
      session.exercises?.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        setCount: exercise.setCount,
      })) ?? [];
    return rowsMatchSeed({ seedRows, generatedRows })
      ? []
      : [session.slotId ?? session.intent];
  });

  return {
    allSeedBacked: mismatchedSlots.length === 0,
    mismatchedSlots,
  };
}

function check(
  input: NextMesocyclePostAcceptVerificationPayload["checks"][number],
): NextMesocyclePostAcceptVerificationPayload["checks"][number] {
  return input;
}

function deriveVerificationResult(
  checks: NextMesocyclePostAcceptVerificationPayload["checks"],
): NextMesocyclePostAcceptVerificationPayload["verificationResult"] {
  if (checks.some((row) => row.status === "fail" && row.mustFixBeforeWeek1)) {
    return "blocked";
  }
  if (checks.some((row) => row.status === "fail")) {
    return "not_runnable";
  }
  if (checks.some((row) => row.status === "warning" || row.status === "unknown")) {
    return "watch_items";
  }
  return "safe_to_train";
}

export function buildNextMesocyclePostAcceptVerificationFromEvidence(
  evidence: PostAcceptEvidence,
): NextMesocyclePostAcceptVerificationPayload {
  const source = evidence.sourceMesocycle;
  const successor = evidence.successorMesocycle;
  const preAcceptSeedJson = acceptedSeedDraftSlotPlanSeedJson(
    source?.nextSeedDraftJson,
  );
  const preAcceptSeedIdentity = summarizeSeedIdentity({
    seedJson: preAcceptSeedJson,
    seedExerciseNameById: evidence.seedExerciseNameById,
  });
  const successorSeedIdentity = summarizeSeedIdentity({
    seedJson: successor?.slotPlanSeedJson,
    seedExerciseNameById: evidence.seedExerciseNameById,
  });
  const preAcceptDraftSeedAvailable = preAcceptSeedIdentity.hash != null;
  const seedIdentityComparison = {
    preAcceptPersistedDraftSeedHash: preAcceptSeedIdentity.hash,
    successorSlotPlanSeedHash: successorSeedIdentity.hash,
    hashesMatch:
      preAcceptSeedIdentity.hash != null &&
      preAcceptSeedIdentity.hash === successorSeedIdentity.hash,
    source: {
      preAccept: preAcceptSeedIdentity.source,
      successor: successorSeedIdentity.source,
      matches:
        preAcceptSeedIdentity.source != null &&
        preAcceptSeedIdentity.source === successorSeedIdentity.source,
    },
    anchorRows: {
      preAccept: preAcceptSeedIdentity.anchorRows,
      successor: successorSeedIdentity.anchorRows,
      matches: anchorRowsEqual(
        preAcceptSeedIdentity.anchorRows,
        successorSeedIdentity.anchorRows,
      ),
    },
    rowCount: {
      preAccept: preAcceptSeedIdentity.rowCount,
      successor: successorSeedIdentity.rowCount,
      matches: preAcceptSeedIdentity.rowCount === successorSeedIdentity.rowCount,
    },
    slotOrder: {
      preAccept: preAcceptSeedIdentity.slotOrder,
      successor: successorSeedIdentity.slotOrder,
      matches: arraysEqual(
        preAcceptSeedIdentity.slotOrder,
        successorSeedIdentity.slotOrder,
      ),
    },
  };
  const parsedSeed = parseSlotPlanSeedJson(successor?.slotPlanSeedJson);
  const seedSummary = summarizeSeed(successor?.slotPlanSeedJson);
  const slotSequence = readRuntimeSlotSequence({
    slotSequenceJson: successor?.slotSequenceJson,
    weeklySchedule: evidence.weeklySchedule,
  });
  const seedSlotOrder = parsedSeed?.slots.map((slot) => slot.slotId) ?? [];
  const slotOrder = slotSequence.slots.map((slot) => slot.slotId);
  const orderStable =
    slotOrder.length > 0 &&
    slotOrder.length === seedSlotOrder.length &&
    slotOrder.every((slotId, index) => seedSlotOrder[index] === slotId);
  const generationRows = generatedExerciseRows(evidence.generationResult);
  const nextSlotId = evidence.nextSession?.slotId ?? null;
  const seedRows = seedExerciseRowsForSlot({
    seedJson: successor?.slotPlanSeedJson,
    slotId: nextSlotId,
  });
  const exerciseOrderMatchesSeed = rowsMatchSeed({
    seedRows,
    generatedRows: generationRows,
  });
  const generationError =
    evidence.generationResult && "error" in evidence.generationResult
      ? evidence.generationResult.error
      : null;
  const receiptCompositionSource =
    evidence.generationResult && !("error" in evidence.generationResult)
      ? evidence.generationResult.selection.sessionDecisionReceipt?.sessionProvenance
          ?.compositionSource ?? null
      : null;
  const receiptSeedProvenance =
    evidence.generationResult && !("error" in evidence.generationResult)
      ? evidence.generationResult.selection.sessionDecisionReceipt?.sessionProvenance
          ?.seedProvenance ?? null
      : null;
  const provenance =
    successor?.slotPlanSeedJson != null
      ? evaluateAcceptedMesocycleSeedProvenance({
          mesocycleId: successor.id,
          mesocycleState: successor.state,
          slotPlanSeedJson: successor.slotPlanSeedJson,
          receiptCompositionSource,
          receiptSeedProvenance,
          currentRevision: successor.currentSeedRevision,
          revisionHistory: successor.seedRevisions,
          readModelExerciseSource: "persisted_slot_plan_seed",
        })
      : null;
  const projectedMatch = projectedSessionsMatchSeed({
    seedJson: successor?.slotPlanSeedJson,
    projectedWeekVolume: evidence.projectedWeekVolume,
  });
  const currentWeek =
    evidence.projectedWeekVolume?.currentWeek.week ??
    (successor ? deriveCurrentMesocycleSession(successor).week : null);
  const programPlan =
    successor && evidence.nextSession
      ? buildProgramCurrentWeekPlan({
          week: currentWeek ?? 1,
          slotSequenceJson: successor.slotSequenceJson,
          slotPlanSeedJson: successor.slotPlanSeedJson,
          seedExerciseNameById: evidence.seedExerciseNameById,
          weeklySchedule: evidence.weeklySchedule,
          currentWeekWorkouts: [],
          nextWorkoutContext: evidence.nextSession,
        })
      : null;
  const programExerciseSources = Array.from(
    new Set(programPlan?.slots.map((slot) => slot.exerciseSource) ?? []),
  ).sort();
  const allProgramRowsSeedBacked =
    (programPlan?.slots.length ?? 0) > 0 &&
    programPlan!.slots.every(
      (slot) =>
        slot.exerciseSource === "persisted_slot_plan_seed" &&
        (slot.exercises?.length ?? 0) > 0,
    );
  const futureWeekStatus =
    evidence.generationResult == null
      ? "not_available"
      : generationError
        ? "generation_error"
        : "available";
  const projectedWeekStatus =
    evidence.projectedWeekVolume
      ? "available"
      : evidence.projectedWeekError
        ? "generation_error"
        : "not_available";
  const progressionTraceCount =
    evidence.generationResult && !("error" in evidence.generationResult)
      ? Object.keys(evidence.generationResult.audit?.progressionTraces ?? {}).length
      : 0;
  const cautionCount =
    evidence.generationResult && !("error" in evidence.generationResult)
      ? [
          ...(evidence.generationResult.sraWarnings ?? []),
          ...(evidence.generationResult.substitutions ?? []),
        ].length
      : 0;
  const prescriptionConfidence = buildPrescriptionConfidenceSourceMap(
    evidence.generationResult,
  );
  const prescriptionReadoutWarning =
    prescriptionConfidence.summary.lowConfidenceCount > 0 ||
    prescriptionConfidence.summary.cautionCount > 0 ||
    (prescriptionConfidence.summary.classificationCounts.estimated ?? 0) > 0 ||
    (prescriptionConfidence.summary.classificationCounts.missing ?? 0) > 0 ||
    (prescriptionConfidence.summary.classificationCounts.exercise_new_to_user ??
      0) > 0 ||
    (prescriptionConfidence.summary.classificationCounts.stale_history ?? 0) > 0 ||
    (prescriptionConfidence.summary.classificationCounts.load_calibration_drift ??
      0) > 0;

  const checks: NextMesocyclePostAcceptVerificationPayload["checks"] = [
    check({
      check: "source mesocycle completed/inactive",
      status: source?.state === "COMPLETED" && source.isActive === false ? "pass" : "fail",
      evidence: `state=${source?.state ?? "missing"} isActive=${source?.isActive ?? "missing"}`,
      ownerSeam: "mesocycle-handoff",
      mustFixBeforeWeek1: true,
    }),
    check({
      check: "successor mesocycle active",
      status:
        successor?.state === "ACTIVE_ACCUMULATION" &&
        successor.isActive === true &&
        evidence.activeMesocycleId === successor.id
          ? "pass"
          : "fail",
      evidence: `state=${successor?.state ?? "missing"} isActive=${successor?.isActive ?? "missing"} activeMesocycleId=${evidence.activeMesocycleId ?? "missing"}`,
      ownerSeam: "mesocycle-handoff",
      mustFixBeforeWeek1: true,
    }),
    check({
      check: "successor owner/source linkage",
      status:
        Boolean(
          source &&
            successor &&
            source.macroCycleId === successor.macroCycleId &&
            successor.mesoNumber === source.mesoNumber + 1 &&
            (!evidence.requestedSuccessorMesocycleId ||
              evidence.requestedSuccessorMesocycleId === successor.id),
        )
          ? "pass"
          : "fail",
      evidence: `source=${source?.id ?? "missing"} successor=${successor?.id ?? "missing"} requested=${evidence.requestedSuccessorMesocycleId ?? "none"}`,
      ownerSeam: "mesocycle-handoff",
      mustFixBeforeWeek1: true,
    }),
    check({
      check: "successor seed matches pre-accept persisted draft seed when present",
      status:
        !preAcceptDraftSeedAvailable ||
        (seedIdentityComparison.hashesMatch &&
          seedIdentityComparison.source.matches &&
          seedIdentityComparison.anchorRows.matches &&
          seedIdentityComparison.rowCount.matches &&
          seedIdentityComparison.slotOrder.matches)
          ? "pass"
          : "fail",
      evidence: preAcceptDraftSeedAvailable
        ? `preAcceptPersistedDraftSeedHash=${seedIdentityComparison.preAcceptPersistedDraftSeedHash ?? "missing"} successorSlotPlanSeedHash=${seedIdentityComparison.successorSlotPlanSeedHash ?? "missing"} source=${seedIdentityComparison.source.preAccept ?? "missing"}->${seedIdentityComparison.source.successor ?? "missing"} rowCount=${seedIdentityComparison.rowCount.preAccept}->${seedIdentityComparison.rowCount.successor} slotOrderMatches=${seedIdentityComparison.slotOrder.matches} anchorRowsMatch=${seedIdentityComparison.anchorRows.matches}`
        : "preAcceptPersistedDraftSeedHash=not_available",
      ownerSeam: "mesocycle-handoff accepted seed persistence",
      mustFixBeforeWeek1: true,
    }),
    check({
      check: "slotPlanSeedJson exists with minimal executable rows",
      status:
        seedSummary.slotPlanSeedJson === "available" &&
        seedSummary.minimalExecutableRowsOnly
          ? "pass"
          : "fail",
      evidence: `seed=${seedSummary.slotPlanSeedJson} source=${seedSummary.source ?? "missing"} slots=${seedSummary.slotCount} exercises=${seedSummary.exerciseCount} missingSetCount=${seedSummary.missingSetCount} extraExecutableRowFieldCount=${seedSummary.extraExecutableRowFieldCount}`,
      ownerSeam: "accepted seed contract",
      mustFixBeforeWeek1: true,
    }),
    check({
      check: "slot sequence exists and order is stable",
      status: slotSequence.hasPersistedSequence && orderStable ? "pass" : "fail",
      evidence: `slotOrder=${slotOrder.join(">") || "missing"} seedSlotOrder=${seedSlotOrder.join(">") || "missing"}`,
      ownerSeam: "mesocycle-slot-runtime",
      mustFixBeforeWeek1: true,
    }),
    check({
      check: "Week 1 future-week replays persisted seed",
      status:
        futureWeekStatus === "available" &&
        receiptCompositionSource === "persisted_slot_plan_seed" &&
        evidence.generationPath?.executionMode === "standard_generation" &&
        exerciseOrderMatchesSeed
          ? "pass"
          : "fail",
      evidence: generationError
        ? `generation_error=${generationError}`
        : `compositionSource=${receiptCompositionSource ?? "missing"} generationPath=${evidence.generationPath?.executionMode ?? "not_run"} nextSlot=${nextSlotId ?? "missing"} orderMatchesSeed=${exerciseOrderMatchesSeed}`,
      ownerSeam: "template-session seeded runtime replay",
      mustFixBeforeWeek1: true,
    }),
    check({
      check: "projected-week-volume uses accepted seed",
      status:
        projectedWeekStatus === "available" &&
        evidence.projectedWeekVolume?.currentWeek.mesocycleId === successor?.id &&
        projectedMatch.allSeedBacked
          ? "pass"
          : "fail",
      evidence: evidence.projectedWeekError
        ? `projected_week_error=${evidence.projectedWeekError}`
        : `mesocycleId=${evidence.projectedWeekVolume?.currentWeek.mesocycleId ?? "missing"} projectedSessions=${evidence.projectedWeekVolume?.projectedSessions.length ?? 0} mismatchedSlots=${projectedMatch.mismatchedSlots.join(",") || "none"}`,
      ownerSeam: "projected-week-volume",
      mustFixBeforeWeek1: true,
    }),
    check({
      check: "Program/Home read models are seed-backed",
      status:
        evidence.nextSession?.slotSource === "mesocycle_slot_sequence" &&
        allProgramRowsSeedBacked
          ? "pass"
          : "warning",
      evidence: `homeSlotSource=${evidence.nextSession?.slotSource ?? "missing"} programExerciseSources=${programExerciseSources.join(",") || "missing"}`,
      ownerSeam: "program/home read models",
      mustFixBeforeWeek1: false,
    }),
    check({
      check: "no legacy fallback/reselection/order drift",
      status:
        receiptCompositionSource === "persisted_slot_plan_seed" &&
        exerciseOrderMatchesSeed &&
        projectedMatch.allSeedBacked
          ? "pass"
          : "fail",
      evidence: `runtimeSeedReplay=${receiptCompositionSource ?? "missing"} futureOrderMatchesSeed=${exerciseOrderMatchesSeed} projectedSeedBacked=${projectedMatch.allSeedBacked}`,
      ownerSeam: "seed/runtime replay",
      mustFixBeforeWeek1: true,
    }),
    check({
      check: "deload does not contaminate Week 1 anchors",
      status:
        evidence.generationPath?.executionMode === "standard_generation" &&
        successor?.state === "ACTIVE_ACCUMULATION" &&
        currentWeek === 1
          ? "pass"
          : "warning",
      evidence: `generationPath=${evidence.generationPath?.executionMode ?? "not_run"} successorState=${successor?.state ?? "missing"} week=${currentWeek ?? "unknown"}`,
      ownerSeam: "progression/deload semantics",
      mustFixBeforeWeek1: false,
    }),
    check({
      check: "receipts/provenance/composition source coherent",
      status:
        provenance?.status === "valid" &&
        receiptCompositionSource === "persisted_slot_plan_seed"
          ? "pass"
          : provenance?.status === "suspicious"
            ? "warning"
            : "fail",
      evidence: `provenance=${provenance?.status ?? "not_available"} warningCodes=${provenance?.warnings.map((warning) => warning.code).join(",") || "none"} receiptCompositionSource=${receiptCompositionSource ?? "missing"}`,
      ownerSeam: "accepted seed provenance",
      mustFixBeforeWeek1: provenance?.status === "invalid",
    }),
    check({
      check: "Week 1 prescriptions expose usable confidence/caution readouts",
      status:
        futureWeekStatus === "available" &&
        generationRows.length > 0 &&
        prescriptionConfidence.summary.rowCount > 0
          ? prescriptionReadoutWarning
            ? "warning"
            : "pass"
          : "fail",
      evidence: `generatedExercises=${generationRows.length} prescriptionRows=${prescriptionConfidence.summary.rowCount} lowConfidence=${prescriptionConfidence.summary.lowConfidenceCount} caution=${prescriptionConfidence.summary.cautionCount} classifications=${Object.entries(prescriptionConfidence.summary.classificationCounts).map(([key, value]) => `${key}:${value}`).join(",") || "none"}`,
      ownerSeam: "future-week prescription readout",
      mustFixBeforeWeek1: futureWeekStatus !== "available",
    }),
  ];
  const verificationResult = deriveVerificationResult(checks);

  return {
    version: NEXT_MESOCYCLE_POST_ACCEPT_VERIFICATION_AUDIT_PAYLOAD_VERSION,
    source: "next_mesocycle_post_accept_verification_audit",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    wouldWriteTransaction: false,
    verificationResult,
    recommendation:
      verificationResult === "safe_to_train"
        ? "persisted successor is safe to train from for Week 1"
        : verificationResult === "watch_items"
          ? "persisted successor is trainable only with listed watch items"
          : verificationResult === "blocked"
            ? "fix must-fix findings before Week 1; do not reseed or repair from this audit"
            : "rerun after accept-next-cycle creates an active persisted successor",
    sourceMesocycle: {
      id: evidence.sourceMesocycleId,
      state: source?.state ?? null,
      isActive: source?.isActive ?? null,
      macroCycleId: source?.macroCycleId ?? null,
      mesoNumber: source?.mesoNumber ?? null,
    },
    successorMesocycle: {
      id: successor?.id ?? null,
      ...(evidence.requestedSuccessorMesocycleId
        ? { requestedId: evidence.requestedSuccessorMesocycleId }
        : {}),
      state: successor?.state ?? null,
      isActive: successor?.isActive ?? null,
      macroCycleId: successor?.macroCycleId ?? null,
      mesoNumber: successor?.mesoNumber ?? null,
      activeMesocycleId: evidence.activeMesocycleId,
    },
    acceptedSeedIdentity: seedIdentityComparison,
    seedContract: seedSummary,
    slotSequence: {
      available: slotSequence.slots.length > 0,
      hasPersistedSequence: slotSequence.hasPersistedSequence,
      orderStable,
      slotOrder,
      seedSlotOrder,
    },
    futureWeekReplay: {
      status: futureWeekStatus,
      compositionSource: receiptCompositionSource,
      generationPath: evidence.generationPath?.executionMode ?? "not_run",
      nextSlotId,
      generatedExerciseOrder: generationRows.map((row) => row.exerciseId),
      seedExerciseOrder: seedRows.map((row) => row.exerciseId),
      exerciseOrderMatchesSeed,
      generatedExerciseCount: generationRows.length,
      progressionTraceCount,
      cautionCount,
    },
    prescriptionConfidence,
    projectedWeekVolume: {
      status: projectedWeekStatus,
      currentWeek: evidence.projectedWeekVolume?.currentWeek.week ?? null,
      mesocycleId: evidence.projectedWeekVolume?.currentWeek.mesocycleId ?? null,
      projectedSessionCount: evidence.projectedWeekVolume?.projectedSessions.length ?? 0,
      allProjectedSessionsSeedBacked: projectedMatch.allSeedBacked,
      mismatchedSlots: projectedMatch.mismatchedSlots,
    },
    readModels: {
      homeNextSessionSlotSource: evidence.nextSession?.slotSource ?? null,
      programExerciseSources,
      allProgramRowsSeedBacked,
    },
    provenance: {
      status: provenance?.status ?? "not_available",
      warningCodes: provenance?.warnings.map((warning) => warning.code) ?? [],
      receiptCompositionSource,
    },
    checks,
    safety: {
      writes: "no",
      dbMutated: false,
      mesocycleCreated: false,
      workoutLogSessionCreated: false,
      seedRuntimeBehaviorChanged: false,
      plannerMaterializerBehaviorChanged: false,
      transactionExecuted: false,
    },
  };
}

async function loadExerciseNames(seedJson: unknown): Promise<Record<string, string>> {
  const parsed = parseSlotPlanSeedJson(seedJson);
  const exerciseIds = Array.from(
    new Set(parsed?.slots.flatMap((slot) => slot.exercises.map((exercise) => exercise.exerciseId)) ?? []),
  );
  if (exerciseIds.length === 0) {
    return {};
  }
  const rows = await prisma.exercise.findMany({
    where: { id: { in: exerciseIds } },
    select: { id: true, name: true },
  });
  return Object.fromEntries(rows.map((row) => [row.id, row.name]));
}

function buildGenerationPath(
  generationResult: SessionGenerationResult | { error: string } | null,
): WorkoutAuditGenerationPath | null {
  if (!generationResult) {
    return null;
  }
  return {
    requestedMode: "next-mesocycle-post-accept-verification",
    executionMode: "standard_generation",
    generator: "generateSessionFromIntent",
    reason: "standard_future_week_or_preview",
  };
}

async function buildFutureWeekGeneration(input: {
  userId: string;
  nextSession: Awaited<ReturnType<typeof loadNextWorkoutContext>> | null;
  plannerDiagnosticsMode: "standard" | "debug";
}): Promise<SessionGenerationResult | { error: string } | null> {
  if (!input.nextSession?.intent) {
    return { error: "next-session intent is unavailable" };
  }
  const intent = parseSessionIntent(input.nextSession.intent);
  if (!intent) {
    return { error: `unsupported next-session intent: ${input.nextSession.intent}` };
  }
  try {
    return await generateSessionFromIntent(input.userId, {
      intent,
      advancingSlot: resolveAdvancingSlotSnapshot(input.nextSession),
      plannerDiagnosticsMode: input.plannerDiagnosticsMode,
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "future-week generation failed",
    };
  }
}

export async function buildNextMesocyclePostAcceptVerificationAuditPayload(input: {
  userId: string;
  ownerEmail?: string;
  sourceMesocycleId: string;
  successorMesocycleId?: string;
  plannerDiagnosticsMode: "standard" | "debug";
}): Promise<NextMesocyclePostAcceptVerificationPayload> {
  const sourceMesocycle = await prisma.mesocycle.findFirst({
    where: {
      id: input.sourceMesocycleId,
      macroCycle: { userId: input.userId },
    },
    select: {
      id: true,
      state: true,
      isActive: true,
      macroCycleId: true,
      mesoNumber: true,
      nextSeedDraftJson: true,
    },
  });
  const successorMesocycle = sourceMesocycle
    ? await prisma.mesocycle.findFirst({
        where: {
          macroCycleId: sourceMesocycle.macroCycleId,
          mesoNumber: sourceMesocycle.mesoNumber + 1,
        },
        select: {
          id: true,
          state: true,
          isActive: true,
          macroCycleId: true,
          mesoNumber: true,
          durationWeeks: true,
          accumulationSessionsCompleted: true,
          deloadSessionsCompleted: true,
          sessionsPerWeek: true,
          slotSequenceJson: true,
          slotPlanSeedJson: true,
          currentSeedRevision: {
            select: {
              id: true,
              revision: true,
              seedPayload: true,
              payloadHash: true,
              provenanceStatus: true,
            },
          },
          seedRevisions: {
            select: {
              id: true,
              revision: true,
              payloadHash: true,
              provenanceStatus: true,
              creationReason: true,
              actorSource: true,
              sourceRevisionId: true,
              activatedAt: true,
            },
            orderBy: { revision: "asc" },
          },
        },
      })
    : null;
  const [activeMesocycle, constraints, nextSession] = await Promise.all([
    prisma.mesocycle.findFirst({
      where: { macroCycle: { userId: input.userId }, isActive: true },
      select: { id: true },
    }),
    prisma.constraints.findUnique({
      where: { userId: input.userId },
      select: { weeklySchedule: true },
    }),
    loadNextWorkoutContext(input.userId).catch(() => null),
  ]);
  if (successorMesocycle?.currentSeedRevision?.seedPayload) {
    successorMesocycle.slotPlanSeedJson = successorMesocycle.currentSeedRevision.seedPayload;
  }
  const [seedExerciseNameById, generationResult, projectedWeekResult] =
    await Promise.all([
      loadExerciseNames(successorMesocycle?.slotPlanSeedJson),
      buildFutureWeekGeneration({
        userId: input.userId,
        nextSession,
        plannerDiagnosticsMode: input.plannerDiagnosticsMode,
      }),
      loadProjectedWeekVolumeReport({
        userId: input.userId,
        plannerDiagnosticsMode: input.plannerDiagnosticsMode,
      })
        .then((report) => ({
          report: {
            version: 1 as const,
            ...report,
          },
          error: undefined,
        }))
        .catch((error) => ({
          report: null,
          error: error instanceof Error ? error.message : "projected-week-volume failed",
        })),
    ]);

  return buildNextMesocyclePostAcceptVerificationFromEvidence({
    ownerEmail: input.ownerEmail,
    sourceMesocycleId: input.sourceMesocycleId,
    requestedSuccessorMesocycleId: input.successorMesocycleId,
    sourceMesocycle,
    successorMesocycle,
    activeMesocycleId: activeMesocycle?.id ?? null,
    weeklySchedule: (constraints?.weeklySchedule ?? []).map((intent) => intent.toLowerCase()),
    seedExerciseNameById,
    nextSession,
    generationResult,
    generationPath: buildGenerationPath(generationResult),
    projectedWeekVolume: projectedWeekResult.report,
    projectedWeekError: projectedWeekResult.error,
  });
}
