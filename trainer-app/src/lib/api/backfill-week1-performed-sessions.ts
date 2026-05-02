import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deriveNextRuntimeSlotSession } from "@/lib/api/mesocycle-slot-runtime";
import { parseSlotPlanSeedJson } from "@/lib/api/slot-plan-seed-parser";
import {
  attachSavedSessionAuditSnapshot,
  reconcileRuntimeEditSelectionMetadata,
} from "@/lib/api/save-workout/receipt";
import { buildSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import { attachSessionAuditSnapshotToSelectionMetadata } from "@/lib/evidence/session-audit-snapshot";
import type { SessionAuditSnapshot } from "@/lib/evidence/session-audit-types";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import type { RuntimeExerciseReplaceReason } from "@/lib/ui/selection-metadata";
import { getSetValidity } from "@/lib/logging/setValidity";
import { quantizeLoad } from "@/lib/units/load-quantization";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";

const BACKFILL_SOURCE = "v2_transition_week1_performed_sessions_backfill";
export const TRANSITION_WEEK_BACKFILL_OWNER_EMAIL = "aaron8819@gmail.com";
export const TRANSITION_WEEK_BACKFILL_MESOCYCLE_ID =
  "ceb2cff3-9d4d-4b3e-b309-c63ab28e62d4";
const BACKFILL_WEEK = 1;
const REPLACEMENT_REASON: RuntimeExerciseReplaceReason =
  "transition_week_backfill_substitution";

type BackfillIntent = "UPPER" | "LOWER";
type WorkoutSection = "MAIN" | "ACCESSORY";

export type PerformedSetDefinition = {
  reps?: number;
  load?: number;
  rpe?: number;
  note?: string;
};

type BackfillMappingKind =
  | "planned"
  | "substitution"
  | "added"
  | "added_optional_core";

export type PerformedExerciseDefinition = {
  performedName: string;
  searchTerms: string[];
  kind: BackfillMappingKind;
  seedExerciseName?: string;
  section: WorkoutSection;
  isMainLift: boolean;
  sets: PerformedSetDefinition[];
};

export type BackfillSessionDefinition = {
  slotId: "upper_a" | "lower_a" | "upper_b";
  intent: BackfillIntent;
  performedDate: string;
  mesoSessionSnapshot: number;
  performed: PerformedExerciseDefinition[];
};

export const TRANSITION_WEEK_BACKFILL_SESSIONS: readonly BackfillSessionDefinition[] = [
  {
    slotId: "upper_a",
    intent: "UPPER",
    performedDate: "2026-04-27",
    mesoSessionSnapshot: 1,
    performed: [
      {
        performedName: "Incline DB Bench Press",
        searchTerms: ["Incline DB Bench Press", "Incline Dumbbell Bench Press"],
        kind: "substitution",
        seedExerciseName: "Machine Chest Press",
        section: "MAIN",
        isMainLift: true,
        sets: [
          { reps: 8, load: 50 },
          { reps: 8, load: 50 },
          { reps: 8, load: 50 },
        ],
      },
      {
        performedName: "T-Bar Row",
        searchTerms: ["T-Bar Row", "T Bar Row"],
        kind: "substitution",
        seedExerciseName: "Chest Supported Row",
        section: "MAIN",
        isMainLift: true,
        sets: [
          { reps: 8, load: 115 },
          { reps: 8, load: 115 },
          { reps: 8, load: 115 },
        ],
      },
      {
        performedName: "Lat Pulldown",
        searchTerms: ["Lat Pulldown", "Lat Pull-Down"],
        kind: "substitution",
        seedExerciseName: "Neutral Grip Pulldown",
        section: "MAIN",
        isMainLift: true,
        sets: [
          { reps: 8, load: 120 },
          { reps: 8, load: 120 },
          { reps: 8, load: 120 },
        ],
      },
      {
        performedName: "Cable Fly",
        searchTerms: ["Cable Fly", "Cable Crossover"],
        kind: "added",
        section: "ACCESSORY",
        isMainLift: false,
        sets: [
          { reps: 12, load: 17.5 },
          { reps: 12, load: 17.5 },
          { reps: 12, load: 17.5 },
        ],
      },
      {
        performedName: "Cable Rear Delt Fly",
        searchTerms: ["Cable Rear Delt Fly", "Rear Delt Cable Fly", "Rear Delt Reverse Fly"],
        kind: "substitution",
        seedExerciseName: "Rear Delt Reverse Fly",
        section: "ACCESSORY",
        isMainLift: false,
        sets: [
          { reps: 15, load: 7.5 },
          { reps: 15, load: 7.5 },
          { reps: 15, load: 7.5 },
        ],
      },
      {
        performedName: "Cable Triceps Pressdown",
        searchTerms: ["Cable Triceps Pressdown", "Cable Tricep Pressdown", "Rope Pressdown"],
        kind: "substitution",
        seedExerciseName: "Rope Pressdown",
        section: "ACCESSORY",
        isMainLift: false,
        sets: [
          { reps: 15, load: 27.5 },
          { reps: 15, load: 32.5 },
          { reps: 15, load: 32.5 },
        ],
      },
      {
        performedName: "Torso Rotation",
        searchTerms: ["Torso Rotation", "Rotary Torso"],
        kind: "added_optional_core",
        section: "ACCESSORY",
        isMainLift: false,
        sets: [
          { load: 120, note: "Source log supplied load-only value: 120" },
          { load: 120, note: "Source log supplied load-only value: 120" },
        ],
      },
    ],
  },
  {
    slotId: "lower_a",
    intent: "LOWER",
    performedDate: "2026-04-29",
    mesoSessionSnapshot: 2,
    performed: [
      {
        performedName: "Barbell Back Squat",
        searchTerms: ["Barbell Back Squat", "Back Squat"],
        kind: "substitution",
        seedExerciseName: "Hack Squat",
        section: "MAIN",
        isMainLift: true,
        sets: [
          { reps: 8, load: 95 },
          { reps: 8, load: 115 },
          { reps: 5, load: 135 },
        ],
      },
      {
        performedName: "Leg Extension",
        searchTerms: ["Leg Extension"],
        kind: "planned",
        seedExerciseName: "Leg Extension",
        section: "ACCESSORY",
        isMainLift: false,
        sets: [
          { reps: 12, load: 70 },
          { reps: 12, load: 70 },
          { reps: 12, load: 70 },
          { reps: 12, load: 70 },
        ],
      },
      {
        performedName: "Seated Leg Curl",
        searchTerms: ["Seated Leg Curl"],
        kind: "planned",
        seedExerciseName: "Seated Leg Curl",
        section: "ACCESSORY",
        isMainLift: false,
        sets: [
          { reps: 12, load: 70 },
          { reps: 12, load: 70 },
          { reps: 12, load: 70 },
        ],
      },
      {
        performedName: "DB RDL",
        searchTerms: ["DB RDL", "Dumbbell Romanian Deadlift", "Dumbbell RDL"],
        kind: "added",
        section: "ACCESSORY",
        isMainLift: false,
        sets: [
          { reps: 12, load: 25 },
          { reps: 8, load: 30 },
          { reps: 8, load: 30 },
        ],
      },
      {
        performedName: "Standing Calf Raise",
        searchTerms: ["Standing Calf Raise"],
        kind: "planned",
        seedExerciseName: "Standing Calf Raise",
        section: "ACCESSORY",
        isMainLift: false,
        sets: [
          { reps: 12, load: 90 },
          { reps: 12, load: 90 },
          { reps: 12, load: 90 },
          { reps: 12, load: 90 },
        ],
      },
      {
        performedName: "Torso Rotation",
        searchTerms: ["Torso Rotation", "Rotary Torso"],
        kind: "added_optional_core",
        section: "ACCESSORY",
        isMainLift: false,
        sets: [{ reps: 12, load: 130 }],
      },
    ],
  },
  {
    slotId: "upper_b",
    intent: "UPPER",
    performedDate: "2026-04-30",
    mesoSessionSnapshot: 3,
    performed: [
      {
        performedName: "DB Overhead Press",
        searchTerms: ["DB Overhead Press", "Dumbbell Overhead Press", "Dumbbell Shoulder Press"],
        kind: "added",
        section: "MAIN",
        isMainLift: true,
        sets: [
          { reps: 8, load: 40 },
          { reps: 8, load: 40 },
        ],
      },
      {
        performedName: "Close-Grip Pulldown Variant",
        searchTerms: ["Close-Grip Pulldown", "Close Grip Pulldown", "Lat Pulldown"],
        kind: "substitution",
        seedExerciseName: "Assisted Pull Up",
        section: "MAIN",
        isMainLift: true,
        sets: [
          { reps: 8, load: 115 },
          { reps: 8, load: 115 },
          { reps: 8, load: 115 },
        ],
      },
      {
        performedName: "Machine Chest Press / Press",
        searchTerms: ["Machine Chest Press", "Chest Press"],
        kind: "substitution",
        seedExerciseName: "Cable Fly",
        section: "MAIN",
        isMainLift: true,
        sets: [
          { reps: 10, load: 90 },
          { reps: 10, load: 90 },
          { reps: 10, load: 90 },
          { reps: 8, load: 90 },
        ],
      },
      {
        performedName: "Seated Cable Row",
        searchTerms: ["Seated Cable Row", "Cable Row"],
        kind: "substitution",
        seedExerciseName: "Cable Row",
        section: "MAIN",
        isMainLift: true,
        sets: [{ reps: 8, load: 42.5 }],
      },
      {
        performedName: "Machine Lateral Raise",
        searchTerms: ["Machine Lateral Raise", "Lateral Raise Machine"],
        kind: "added",
        section: "ACCESSORY",
        isMainLift: false,
        sets: [
          { reps: 12, load: 40 },
          { reps: 12, load: 35 },
          { reps: 12, load: 35 },
        ],
      },
      {
        performedName: "Cable Lateral Raise",
        searchTerms: ["Cable Lateral Raise"],
        kind: "planned",
        seedExerciseName: "Cable Lateral Raise",
        section: "ACCESSORY",
        isMainLift: false,
        sets: [
          { reps: 12, load: 7.5 },
          { reps: 12, load: 7.5 },
          { reps: 12, load: 7.5 },
        ],
      },
      {
        performedName: "EZ Bar Curl",
        searchTerms: ["EZ Bar Curl", "EZ-Bar Curl"],
        kind: "substitution",
        seedExerciseName: "Cable Curl",
        section: "ACCESSORY",
        isMainLift: false,
        sets: [
          { reps: 8, load: 50 },
          { reps: 10, load: 50 },
          { reps: 10, load: 50 },
        ],
      },
    ],
  },
];

type ExerciseRow = {
  id: string;
  name: string;
  movementPatterns?: string[] | null;
  aliases?: Array<{ alias: string }>;
};

type BackfillMesocycleRow = {
  id: string;
  state: string;
  isActive: boolean;
  durationWeeks: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  sessionsPerWeek: number;
  slotSequenceJson: unknown;
  slotPlanSeedJson: unknown;
  macroCycle: {
    userId: string;
    user: {
      email: string | null;
    };
  };
};

type ExistingWorkoutRow = {
  id: string;
  status: string;
  scheduledDate: Date;
  sessionIntent: string | null;
  mesocycleWeekSnapshot: number | null;
  mesoSessionSnapshot: number | null;
  selectionMetadata: unknown;
  exercises: Array<{
    sets: Array<{
      logs: Array<{ id: string; wasSkipped: boolean }>;
    }>;
  }>;
};

type BackfillTx = {
  mesocycle: {
    findUnique(args: unknown): Promise<BackfillMesocycleRow | null>;
    update(args: unknown): Promise<unknown>;
  };
  workout: {
    findMany(args: unknown): Promise<ExistingWorkoutRow[]>;
    create(args: unknown): Promise<{ id: string }>;
  };
  workoutExercise: {
    create(args: unknown): Promise<{ id: string }>;
  };
  workoutSet: {
    create(args: unknown): Promise<{ id: string }>;
  };
  setLog: {
    create(args: unknown): Promise<{ id: string }>;
  };
  exercise: {
    findMany(args: unknown): Promise<ExerciseRow[]>;
  };
};

export type BackfillWeek1Blocker =
  | "explicit_owner_email_required"
  | "explicit_mesocycle_id_required"
  | "explicit_backfill_flag_required"
  | "explicit_write_confirmation_required"
  | "target_mesocycle_not_found"
  | "owner_email_mismatch"
  | "target_mesocycle_id_mismatch"
  | "target_not_active"
  | "target_not_active_accumulation"
  | "target_counter_not_zero"
  | "slot_sequence_missing"
  | "slot_plan_seed_missing"
  | "target_slot_missing_from_sequence"
  | "target_slot_missing_from_seed"
  | "seed_exercise_missing"
  | "target_slot_already_logged"
  | "duplicate_workout_for_slot_date"
  | "performed_logs_already_exist_for_slot_date"
  | "exercise_resolution_missing"
  | "exercise_resolution_ambiguous"
  | "performed_set_missing_reps_or_rpe"
  | "slot_sequence_changed_before_write"
  | "slot_plan_seed_changed_before_write";

export type BackfillExerciseMappingRow = {
  performedName: string;
  performedExerciseId: string | null;
  resolvedExerciseName: string | null;
  seedExerciseName: string | null;
  seedExerciseId: string | null;
  kind: BackfillMappingKind;
  plannedSetCount: number;
  performedSetCount: number;
  skippedSetCount: number;
  extraSetCount: number;
  writeSetCount: number;
  issues: BackfillWeek1Blocker[];
};

export type BackfillSlotDryRun = {
  slotId: string;
  intent: BackfillIntent;
  performedDate: string;
  seedExercises: Array<{
    exerciseId: string;
    exerciseName: string;
    setCount: number;
  }>;
  mappings: BackfillExerciseMappingRow[];
  substitutions: BackfillExerciseMappingRow[];
  additions: BackfillExerciseMappingRow[];
  skippedUnperformedSets: BackfillExerciseMappingRow[];
  extraSets: BackfillExerciseMappingRow[];
  expectedRows: {
    workouts: 1;
    workoutExercises: number;
    workoutSets: number;
    performedSetLogs: number;
    skippedSetLogs: number;
    runtimeEditOps: number;
  };
};

export type BackfillWeek1PerformedSessionsResult = {
  version: 1;
  source: typeof BACKFILL_SOURCE;
  dryRun: boolean;
  writeRequested: boolean;
  owner: {
    requestedEmail: string;
    matchedEmail: string | null;
    userId: string | null;
  };
  targetMesocycle: {
    requestedId: string;
    matchedId: string | null;
    state: string | null;
    isActive: boolean | null;
    accumulationSessionsCompleted: number | null;
    deloadSessionsCompleted: number | null;
  };
  slotsToBackfill: Array<"upper_a" | "lower_a" | "upper_b">;
  dryRunSummary: {
    slots: BackfillSlotDryRun[];
    totals: {
      workouts: number;
      workoutExercises: number;
      workoutSets: number;
      performedSetLogs: number;
      skippedSetLogs: number;
      runtimeEditOps: number;
    };
  };
  safety: {
    checked: true;
    eligible: boolean;
    blockers: BackfillWeek1Blocker[];
    duplicateWorkoutIds: string[];
    existingSlotWorkoutIds: string[];
    existingLoggedWorkoutIds: string[];
    backfillOperationExplicit: boolean;
    allPerformedRowsRepresented: boolean;
  };
  seedSlotSequenceBoundary: {
    willMutateSlotPlanSeedJson: false;
    willMutateSlotSequenceJson: false;
    slotPlanSeedUnchanged: boolean | null;
    slotSequenceUnchanged: boolean | null;
  };
  expectedNextSlotAfterWrite: {
    slotId: string | null;
    intent: string | null;
    weekInMeso: number | null;
    sessionInWeek: number | null;
  };
  write: {
    requested: boolean;
    confirmationProvided: boolean;
    eligible: boolean;
    dbWriteOccurred: boolean;
    transactionStatus: "not_requested" | "no_write" | "success";
    createdWorkoutIds: string[];
  };
};

type BackfillDependencies = {
  prismaClient?: typeof prisma;
  idFactory?: () => string;
  performedSessions?: readonly BackfillSessionDefinition[];
};

export type BackfillWeek1PerformedSessionsInput = {
  ownerEmail: string;
  mesocycleId: string;
  backfillWeek1PerformedSessions?: boolean;
  write?: boolean;
  confirmBackfill?: boolean;
  dependencies?: BackfillDependencies;
};

type ResolvedSeedExercise = {
  exerciseId: string;
  exerciseName: string;
  role: "CORE_COMPOUND" | "ACCESSORY";
  setCount: number;
};

type ResolvedSessionPlan = {
  definition: BackfillSessionDefinition;
  seedExercises: ResolvedSeedExercise[];
  mappings: BackfillExerciseMappingRow[];
};

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function performedAtDate(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

function sameUtcDate(left: Date, right: Date): boolean {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

function uniqueBlockers(blockers: BackfillWeek1Blocker[]): BackfillWeek1Blocker[] {
  return Array.from(new Set(blockers));
}

function resolveExerciseByTerms(
  exercises: ExerciseRow[],
  terms: readonly string[],
): { status: "missing" | "ambiguous" | "resolved"; exercise?: ExerciseRow } {
  const normalizedTerms = terms.map(normalizeName).filter(Boolean);
  const rows = exercises.map((exercise) => ({
    exercise,
    names: [exercise.name, ...(exercise.aliases ?? []).map((alias) => alias.alias)].map(
      normalizeName,
    ),
  }));

  for (const term of normalizedTerms) {
    const exact = rows.filter((row) => row.names.some((name) => name === term));
    if (exact.length === 1) {
      return { status: "resolved", exercise: exact[0]!.exercise };
    }
    if (exact.length > 1) {
      return { status: "ambiguous" };
    }
  }

  for (const term of normalizedTerms) {
    const contains = rows.filter((row) =>
      row.names.some((name) => name.includes(term) || term.includes(name)),
    );
    if (contains.length === 1) {
      return { status: "resolved", exercise: contains[0]!.exercise };
    }
    if (contains.length > 1) {
      return { status: "ambiguous" };
    }
  }
  return { status: "missing" };
}

function buildSeedExerciseIndex(
  seedExercises: ResolvedSeedExercise[],
): Map<string, ResolvedSeedExercise> {
  return new Map(
    seedExercises.map((exercise) => [normalizeName(exercise.exerciseName), exercise]),
  );
}

function countRuntimeOps(mappings: BackfillExerciseMappingRow[]): number {
  const substitutionCount = mappings.filter(
    (mapping) =>
      mapping.seedExerciseId &&
      mapping.performedExerciseId &&
      mapping.seedExerciseId !== mapping.performedExerciseId,
  ).length;
  const additionCount = mappings.filter((mapping) => !mapping.seedExerciseId).length;
  const extraSetCount = mappings.reduce((sum, mapping) => sum + mapping.extraSetCount, 0);
  const rewriteStructureCount =
    substitutionCount > 0 || additionCount > 0 || extraSetCount > 0 ? 1 : 0;
  return substitutionCount + additionCount + extraSetCount + rewriteStructureCount;
}

function inspectExistingWorkoutCollisions(input: {
  existingWorkouts: ExistingWorkoutRow[];
  session: BackfillSessionDefinition;
}): {
  duplicateWorkoutIds: string[];
  existingSlotWorkoutIds: string[];
  existingLoggedWorkoutIds: string[];
} {
  const targetDate = performedAtDate(input.session.performedDate);
  const duplicateWorkoutIds: string[] = [];
  const existingSlotWorkoutIds: string[] = [];
  const existingLoggedWorkoutIds: string[] = [];

  for (const workout of input.existingWorkouts) {
    const slot = readSessionSlotSnapshot(workout.selectionMetadata);
    const sameSlot =
      slot?.slotId === input.session.slotId ||
      workout.mesoSessionSnapshot === input.session.mesoSessionSnapshot;
    if (!sameSlot) {
      continue;
    }

    const loggedSetCount = workout.exercises.reduce(
      (sum, exercise) =>
        sum + exercise.sets.reduce((setSum, set) => setSum + set.logs.length, 0),
      0,
    );
    if (workout.status === "COMPLETED" || workout.status === "PARTIAL" || loggedSetCount > 0) {
      existingSlotWorkoutIds.push(workout.id);
    }
    if (sameUtcDate(workout.scheduledDate, targetDate)) {
      duplicateWorkoutIds.push(workout.id);
      if (loggedSetCount > 0) {
        existingLoggedWorkoutIds.push(workout.id);
      }
    }
  }

  return {
    duplicateWorkoutIds,
    existingSlotWorkoutIds,
    existingLoggedWorkoutIds,
  };
}

function buildCycleContext(input: {
  mesocycle: BackfillMesocycleRow;
}): ReturnType<typeof buildSessionDecisionReceipt>["cycleContext"] {
  return {
    weekInMeso: BACKFILL_WEEK,
    weekInBlock: BACKFILL_WEEK,
    blockDurationWeeks: Math.max(1, input.mesocycle.durationWeeks - 1),
    mesocycleLength: input.mesocycle.durationWeeks,
    phase: "accumulation",
    blockType: "accumulation",
    isDeload: false,
    source: "computed",
  };
}

function buildGeneratedSnapshot(input: {
  session: BackfillSessionDefinition;
  seedExercises: ResolvedSeedExercise[];
  cycleContext: ReturnType<typeof buildSessionDecisionReceipt>["cycleContext"];
}): SessionAuditSnapshot {
  const receipt = buildSessionDecisionReceipt({
    cycleContext: input.cycleContext,
  });
  const selectionMetadata = { sessionDecisionReceipt: receipt };
  const semantics = deriveSessionSemantics({
    advancesSplit: true,
    selectionMode: "INTENT",
    sessionIntent: input.session.intent,
    selectionMetadata,
    mesocyclePhase: "ACCUMULATION",
  });

  return {
    version: 1,
    generated: {
      selectionMode: "INTENT",
      sessionIntent: input.session.intent.toLowerCase(),
      cycleContext: receipt.cycleContext,
      deloadDecision: receipt.deloadDecision,
      semantics,
      exerciseCount: input.seedExercises.length,
      hardSetCount: input.seedExercises.reduce((sum, exercise) => sum + exercise.setCount, 0),
      exercises: input.seedExercises.map((exercise, index) => ({
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseName,
        orderIndex: index,
        section: exercise.role === "CORE_COMPOUND" ? "main" : "accessory",
        isMainLift: exercise.role === "CORE_COMPOUND",
        role: exercise.role,
        prescribedSetCount: exercise.setCount,
        prescribedSets: Array.from({ length: exercise.setCount }, (_, setIndex) => ({
          setIndex: setIndex + 1,
          targetReps: 8,
          role: exercise.role,
        })),
      })),
      traces: {
        progression: {},
      },
    },
  };
}

function buildResolvedSessionPlans(input: {
  mesocycle: BackfillMesocycleRow;
  exercises: ExerciseRow[];
  sessions: readonly BackfillSessionDefinition[];
}): {
  plans: ResolvedSessionPlan[];
  blockers: BackfillWeek1Blocker[];
} {
  const seed = parseSlotPlanSeedJson(input.mesocycle.slotPlanSeedJson);
  const exerciseById = new Map(input.exercises.map((exercise) => [exercise.id, exercise]));
  const blockers: BackfillWeek1Blocker[] = [];

  if (!seed) {
    return { plans: [], blockers: ["slot_plan_seed_missing"] };
  }

  const plans = input.sessions.map((definition): ResolvedSessionPlan => {
    const seedSlot = seed.slots.find((slot) => slot.slotId === definition.slotId);
    if (!seedSlot) {
      blockers.push("target_slot_missing_from_seed");
    }
    const seedExercises: ResolvedSeedExercise[] = (seedSlot?.exercises ?? []).map((exercise) => ({
      exerciseId: exercise.exerciseId,
      exerciseName:
        exercise.name ?? exerciseById.get(exercise.exerciseId)?.name ?? exercise.exerciseId,
      role: exercise.role,
      setCount: exercise.setCount ?? 0,
    }));
    const seedByName = buildSeedExerciseIndex(seedExercises);

    const mappings = definition.performed.map((performed): BackfillExerciseMappingRow => {
      const issues: BackfillWeek1Blocker[] = [];
      const exerciseResolution = resolveExerciseByTerms(input.exercises, performed.searchTerms);
      if (exerciseResolution.status === "missing") {
        issues.push("exercise_resolution_missing");
      }
      if (exerciseResolution.status === "ambiguous") {
        issues.push("exercise_resolution_ambiguous");
      }

      const seedExercise = performed.seedExerciseName
        ? seedByName.get(normalizeName(performed.seedExerciseName)) ?? null
        : null;
      if (performed.seedExerciseName && !seedExercise) {
        issues.push("seed_exercise_missing");
      }

      const performedSetIssues = performed.sets.flatMap((set) => {
        const validity = getSetValidity({
          actualReps: set.reps,
          actualRpe: set.rpe,
          actualLoad: set.load,
          wasSkipped: false,
        });
        return validity.valid ? [] : (["performed_set_missing_reps_or_rpe"] as const);
      });
      issues.push(...performedSetIssues);

      const plannedSetCount = seedExercise?.setCount ?? 0;
      const performedSetCount = performed.sets.length;
      const skippedSetCount = Math.max(0, plannedSetCount - performedSetCount);
      const extraSetCount = seedExercise ? Math.max(0, performedSetCount - plannedSetCount) : 0;

      return {
        performedName: performed.performedName,
        performedExerciseId: exerciseResolution.exercise?.id ?? null,
        resolvedExerciseName: exerciseResolution.exercise?.name ?? null,
        seedExerciseName: seedExercise?.exerciseName ?? performed.seedExerciseName ?? null,
        seedExerciseId: seedExercise?.exerciseId ?? null,
        kind: performed.kind,
        plannedSetCount,
        performedSetCount,
        skippedSetCount,
        extraSetCount,
        writeSetCount: seedExercise ? Math.max(plannedSetCount, performedSetCount) : performedSetCount,
        issues: uniqueBlockers(issues),
      };
    });

    return {
      definition,
      seedExercises,
      mappings,
    };
  });

  return {
    plans,
    blockers: uniqueBlockers([
      ...blockers,
      ...plans.flatMap((plan) => plan.mappings.flatMap((mapping) => mapping.issues)),
    ]),
  };
}

function buildSlotDryRun(plan: ResolvedSessionPlan): BackfillSlotDryRun {
  const expectedRows = {
    workouts: 1 as const,
    workoutExercises: plan.mappings.length,
    workoutSets: plan.mappings.reduce((sum, mapping) => sum + mapping.writeSetCount, 0),
    performedSetLogs: plan.mappings.reduce((sum, mapping) => sum + mapping.performedSetCount, 0),
    skippedSetLogs: plan.mappings.reduce((sum, mapping) => sum + mapping.skippedSetCount, 0),
    runtimeEditOps: countRuntimeOps(plan.mappings),
  };

  return {
    slotId: plan.definition.slotId,
    intent: plan.definition.intent,
    performedDate: plan.definition.performedDate,
    seedExercises: plan.seedExercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      setCount: exercise.setCount,
    })),
    mappings: plan.mappings,
    substitutions: plan.mappings.filter(
      (mapping) =>
        mapping.seedExerciseId &&
        mapping.performedExerciseId &&
        mapping.seedExerciseId !== mapping.performedExerciseId,
    ),
    additions: plan.mappings.filter((mapping) => !mapping.seedExerciseId),
    skippedUnperformedSets: plan.mappings.filter((mapping) => mapping.skippedSetCount > 0),
    extraSets: plan.mappings.filter((mapping) => mapping.extraSetCount > 0),
    expectedRows,
  };
}

function buildExpectedNextSlot(
  mesocycle: BackfillMesocycleRow,
  sessions: readonly BackfillSessionDefinition[],
) {
  const next = deriveNextRuntimeSlotSession({
    mesocycle: {
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted:
        mesocycle.accumulationSessionsCompleted + sessions.length,
      deloadSessionsCompleted: mesocycle.deloadSessionsCompleted,
      sessionsPerWeek: mesocycle.sessionsPerWeek,
      durationWeeks: mesocycle.durationWeeks,
    },
    slotSequenceJson: mesocycle.slotSequenceJson,
    weeklySchedule: ["upper", "lower", "upper", "lower"],
    performedAdvancingSlotIdsThisWeek: sessions.map((session) => session.slotId),
    performedAdvancingIntentsThisWeek: sessions.map((session) =>
      session.intent.toLowerCase(),
    ),
  });

  return {
    slotId: next.slotId,
    intent: next.intent,
    weekInMeso: next.week,
    sessionInWeek: next.session,
  };
}

async function inspectBackfillSafety(
  tx: BackfillTx,
  input: {
    ownerEmail: string;
    mesocycleId: string;
    explicitFlag: boolean;
    sessions: readonly BackfillSessionDefinition[];
  },
): Promise<{
  mesocycle: BackfillMesocycleRow | null;
  plans: ResolvedSessionPlan[];
  result: Omit<BackfillWeek1PerformedSessionsResult, "write">;
}> {
  const blockers: BackfillWeek1Blocker[] = [];
  if (!input.ownerEmail.trim()) blockers.push("explicit_owner_email_required");
  if (!input.mesocycleId.trim()) blockers.push("explicit_mesocycle_id_required");
  if (!input.explicitFlag) blockers.push("explicit_backfill_flag_required");

  const mesocycle = await tx.mesocycle.findUnique({
    where: { id: input.mesocycleId },
    select: {
      id: true,
      state: true,
      isActive: true,
      durationWeeks: true,
      accumulationSessionsCompleted: true,
      deloadSessionsCompleted: true,
      sessionsPerWeek: true,
      slotSequenceJson: true,
      slotPlanSeedJson: true,
      macroCycle: {
        select: {
          userId: true,
          user: { select: { email: true } },
        },
      },
    },
  });

  if (!mesocycle) {
    blockers.push("target_mesocycle_not_found");
  }

  if (mesocycle) {
    if (
      mesocycle.id !== TRANSITION_WEEK_BACKFILL_MESOCYCLE_ID ||
      input.mesocycleId !== TRANSITION_WEEK_BACKFILL_MESOCYCLE_ID
    ) {
      blockers.push("target_mesocycle_id_mismatch");
    }
    if (
      normalizeEmail(mesocycle.macroCycle.user.email ?? "") !==
        normalizeEmail(input.ownerEmail) ||
      normalizeEmail(input.ownerEmail) !== TRANSITION_WEEK_BACKFILL_OWNER_EMAIL
    ) {
      blockers.push("owner_email_mismatch");
    }
    if (!mesocycle.isActive) blockers.push("target_not_active");
    if (mesocycle.state !== "ACTIVE_ACCUMULATION") {
      blockers.push("target_not_active_accumulation");
    }
    if (
      mesocycle.accumulationSessionsCompleted !== 0 ||
      mesocycle.deloadSessionsCompleted !== 0
    ) {
      blockers.push("target_counter_not_zero");
    }
    if (!mesocycle.slotSequenceJson) blockers.push("slot_sequence_missing");
    if (!mesocycle.slotPlanSeedJson) blockers.push("slot_plan_seed_missing");
  }

  const [existingWorkouts, exercises] = mesocycle
    ? await Promise.all([
        tx.workout.findMany({
          where: { mesocycleId: mesocycle.id },
          select: {
            id: true,
            status: true,
            scheduledDate: true,
            sessionIntent: true,
            mesocycleWeekSnapshot: true,
            mesoSessionSnapshot: true,
            selectionMetadata: true,
            exercises: {
              select: {
                sets: {
                  select: {
                    logs: { select: { id: true, wasSkipped: true } },
                  },
                },
              },
            },
          },
        }),
        tx.exercise.findMany({
          select: {
            id: true,
            name: true,
            movementPatterns: true,
            aliases: { select: { alias: true } },
          },
        }),
      ])
    : [[], [] as ExerciseRow[]];

  const plansAndBlockers = mesocycle
    ? buildResolvedSessionPlans({ mesocycle, exercises, sessions: input.sessions })
    : { plans: [] as ResolvedSessionPlan[], blockers: [] as BackfillWeek1Blocker[] };
  blockers.push(...plansAndBlockers.blockers);

  if (mesocycle) {
    const parsedSeed = parseSlotPlanSeedJson(mesocycle.slotPlanSeedJson);
    const sequenceSlots =
      mesocycle.slotSequenceJson &&
      typeof mesocycle.slotSequenceJson === "object" &&
      !Array.isArray(mesocycle.slotSequenceJson) &&
      Array.isArray((mesocycle.slotSequenceJson as { slots?: unknown[] }).slots)
        ? ((mesocycle.slotSequenceJson as { slots: Array<{ slotId?: unknown }> }).slots)
        : [];
    for (const session of input.sessions) {
      if (!sequenceSlots.some((slot) => slot.slotId === session.slotId)) {
        blockers.push("target_slot_missing_from_sequence");
      }
      if (!parsedSeed?.slots.some((slot) => slot.slotId === session.slotId)) {
        blockers.push("target_slot_missing_from_seed");
      }
      const collisions = inspectExistingWorkoutCollisions({
        existingWorkouts,
        session,
      });
      if (collisions.existingSlotWorkoutIds.length > 0) {
        blockers.push("target_slot_already_logged");
      }
      if (collisions.duplicateWorkoutIds.length > 0) {
        blockers.push("duplicate_workout_for_slot_date");
      }
      if (collisions.existingLoggedWorkoutIds.length > 0) {
        blockers.push("performed_logs_already_exist_for_slot_date");
      }
    }
  }

  const slots = plansAndBlockers.plans.map(buildSlotDryRun);
  const totals = slots.reduce(
    (sum, slot) => ({
      workouts: sum.workouts + slot.expectedRows.workouts,
      workoutExercises: sum.workoutExercises + slot.expectedRows.workoutExercises,
      workoutSets: sum.workoutSets + slot.expectedRows.workoutSets,
      performedSetLogs: sum.performedSetLogs + slot.expectedRows.performedSetLogs,
      skippedSetLogs: sum.skippedSetLogs + slot.expectedRows.skippedSetLogs,
      runtimeEditOps: sum.runtimeEditOps + slot.expectedRows.runtimeEditOps,
    }),
    {
      workouts: 0,
      workoutExercises: 0,
      workoutSets: 0,
      performedSetLogs: 0,
      skippedSetLogs: 0,
      runtimeEditOps: 0,
    },
  );

  const allBlockers = uniqueBlockers(blockers);
  const collisions = mesocycle
    ? input.sessions.map((session) =>
        inspectExistingWorkoutCollisions({ existingWorkouts, session }),
      )
    : [];
  const duplicateWorkoutIds = collisions.flatMap((entry) => entry.duplicateWorkoutIds);
  const existingSlotWorkoutIds = collisions.flatMap((entry) => entry.existingSlotWorkoutIds);
  const existingLoggedWorkoutIds = collisions.flatMap((entry) => entry.existingLoggedWorkoutIds);

  return {
    mesocycle,
    plans: plansAndBlockers.plans,
    result: {
      version: 1,
      source: BACKFILL_SOURCE,
      dryRun: true,
      writeRequested: false,
      owner: {
        requestedEmail: input.ownerEmail,
        matchedEmail: mesocycle?.macroCycle.user.email ?? null,
        userId: mesocycle?.macroCycle.userId ?? null,
      },
      targetMesocycle: {
        requestedId: input.mesocycleId,
        matchedId: mesocycle?.id ?? null,
        state: mesocycle?.state ?? null,
        isActive: mesocycle?.isActive ?? null,
        accumulationSessionsCompleted:
          mesocycle?.accumulationSessionsCompleted ?? null,
        deloadSessionsCompleted: mesocycle?.deloadSessionsCompleted ?? null,
      },
      slotsToBackfill: input.sessions.map((session) => session.slotId),
      dryRunSummary: {
        slots,
        totals,
      },
      safety: {
        checked: true,
        eligible: allBlockers.length === 0,
        blockers: allBlockers,
        duplicateWorkoutIds,
        existingSlotWorkoutIds,
        existingLoggedWorkoutIds,
        backfillOperationExplicit: input.explicitFlag,
        allPerformedRowsRepresented: !allBlockers.some(
          (blocker) =>
            blocker === "performed_set_missing_reps_or_rpe" ||
            blocker === "exercise_resolution_missing" ||
            blocker === "exercise_resolution_ambiguous" ||
            blocker === "seed_exercise_missing",
        ),
      },
      seedSlotSequenceBoundary: {
        willMutateSlotPlanSeedJson: false,
        willMutateSlotSequenceJson: false,
        slotPlanSeedUnchanged: null,
        slotSequenceUnchanged: null,
      },
      expectedNextSlotAfterWrite: mesocycle
        ? buildExpectedNextSlot(mesocycle, input.sessions)
        : {
            slotId: null,
            intent: null,
            weekInMeso: null,
            sessionInWeek: null,
          },
    },
  };
}

function buildInitialSelectionMetadata(input: {
  mesocycle: BackfillMesocycleRow;
  session: BackfillSessionDefinition;
  seedExercises: ResolvedSeedExercise[];
  workoutId: string;
}) {
  const cycleContext = buildCycleContext({ mesocycle: input.mesocycle });
  const receipt = buildSessionDecisionReceipt({
    cycleContext,
    sessionProvenance: {
      mesocycleId: input.mesocycle.id,
      compositionSource: "persisted_slot_plan_seed",
    },
    sessionSlot: {
      slotId: input.session.slotId,
      intent: input.session.intent.toLowerCase(),
      sequenceIndex: input.session.mesoSessionSnapshot - 1,
      sequenceLength: input.mesocycle.sessionsPerWeek,
      source: "mesocycle_slot_sequence",
    },
  });
  const generatedSnapshot = buildGeneratedSnapshot({
    session: input.session,
    seedExercises: input.seedExercises,
    cycleContext,
  });
  const withGeneratedSnapshot = attachSessionAuditSnapshotToSelectionMetadata(
    { sessionDecisionReceipt: receipt },
    generatedSnapshot,
  );

  return attachSavedSessionAuditSnapshot({
    selectionMetadata: withGeneratedSnapshot,
    workoutId: input.workoutId,
    revision: 1,
    status: "COMPLETED",
    advancesSplit: true,
    selectionMode: "INTENT",
    sessionIntent: input.session.intent,
    mesocycleId: input.mesocycle.id,
    mesocycleWeekSnapshot: BACKFILL_WEEK,
    mesoSessionSnapshot: input.session.mesoSessionSnapshot,
    mesocyclePhaseSnapshot: "ACCUMULATION",
  });
}

type PersistedExerciseForBackfill = {
  workoutExerciseId: string;
  exerciseId: string;
  orderIndex: number;
  section: WorkoutSection;
  isMainLift: boolean;
  exercise: { name: string };
  sets: Array<{
    workoutSetId: string;
    setIndex: number;
    targetReps: number;
    targetRpe: number | null;
    targetLoad: number | null;
    restSeconds: null;
    actual?: PerformedSetDefinition;
    wasSkipped: boolean;
    notes?: string;
  }>;
  mapping: BackfillExerciseMappingRow;
  definition: PerformedExerciseDefinition;
};

function buildPersistedExercisesForBackfill(input: {
  plan: ResolvedSessionPlan;
  idFactory: () => string;
}): PersistedExerciseForBackfill[] {
  return input.plan.mappings.map((mapping, exerciseIndex) => {
    const definition = input.plan.definition.performed[exerciseIndex]!;
    const workoutExerciseId = input.idFactory();
    const lastPerformed = definition.sets[definition.sets.length - 1];
    return {
      workoutExerciseId,
      exerciseId: mapping.performedExerciseId!,
      orderIndex: exerciseIndex,
      section: definition.section,
      isMainLift: definition.isMainLift,
      exercise: { name: mapping.resolvedExerciseName ?? definition.performedName },
      mapping,
      definition,
      sets: Array.from({ length: mapping.writeSetCount }, (_, setIndex) => {
        const actual = definition.sets[setIndex];
        const wasSkipped = !actual;
        const fallbackReps = lastPerformed?.reps ?? 0;
        const fallbackLoad = lastPerformed?.load ?? null;
        return {
          workoutSetId: input.idFactory(),
          setIndex: setIndex + 1,
          targetReps: actual?.reps ?? fallbackReps,
          targetRpe: actual?.rpe ?? null,
          targetLoad: actual?.load ?? fallbackLoad,
          restSeconds: null,
          actual,
          wasSkipped,
          notes: wasSkipped
            ? "Transition-week backfill: seed-planned set skipped/unperformed outside app."
            : actual.note,
        };
      }),
    };
  });
}

function applyRuntimeEditMetadata(input: {
  selectionMetadata: unknown;
  persistedExercises: PersistedExerciseForBackfill[];
  session: BackfillSessionDefinition;
  reconciledAt: string;
}) {
  let selectionMetadata = input.selectionMetadata;
  const persistedExercises = input.persistedExercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    orderIndex: exercise.orderIndex,
    section: exercise.section,
    exercise: exercise.exercise,
    sets: exercise.sets.map((set) => ({
      setIndex: set.setIndex,
      targetReps: set.targetReps,
      targetRpe: set.targetRpe,
      targetLoad: set.targetLoad,
      restSeconds: set.restSeconds,
    })),
  }));

  for (const exercise of input.persistedExercises) {
    const mapping = exercise.mapping;
    if (
      mapping.seedExerciseId &&
      mapping.performedExerciseId &&
      mapping.seedExerciseId !== mapping.performedExerciseId
    ) {
      selectionMetadata = reconcileRuntimeEditSelectionMetadata({
        selectionMetadata,
        selectionMode: "INTENT",
        sessionIntent: input.session.intent,
        persistedExercises,
        reconciledAt: input.reconciledAt,
        mutation: {
          kind: "replace_exercise",
          workoutExerciseId: exercise.workoutExerciseId,
          fromExerciseId: mapping.seedExerciseId,
          fromExerciseName: mapping.seedExerciseName ?? mapping.seedExerciseId,
          toExerciseId: mapping.performedExerciseId,
          toExerciseName: mapping.resolvedExerciseName ?? mapping.performedName,
          reason: REPLACEMENT_REASON,
          setCount: mapping.writeSetCount,
        },
      }).nextSelectionMetadata;
    }

    if (!mapping.seedExerciseId && mapping.performedExerciseId) {
      selectionMetadata = reconcileRuntimeEditSelectionMetadata({
        selectionMetadata,
        selectionMode: "INTENT",
        sessionIntent: input.session.intent,
        persistedExercises,
        reconciledAt: input.reconciledAt,
        mutation: {
          kind: "add_exercise",
          workoutExerciseId: exercise.workoutExerciseId,
          exerciseId: mapping.performedExerciseId,
          orderIndex: exercise.orderIndex,
          section: exercise.section,
          setCount: mapping.writeSetCount,
          prescriptionSource: "generic_accessory_fallback",
        },
      }).nextSelectionMetadata;
    }

    if (mapping.seedExerciseId && mapping.extraSetCount > 0) {
      for (const set of exercise.sets.slice(mapping.plannedSetCount)) {
        selectionMetadata = reconcileRuntimeEditSelectionMetadata({
          selectionMetadata,
          selectionMode: "INTENT",
          sessionIntent: input.session.intent,
          persistedExercises,
          reconciledAt: input.reconciledAt,
          mutation: {
            kind: "add_set",
            workoutExerciseId: exercise.workoutExerciseId,
            exerciseId: exercise.exerciseId,
            workoutSetId: set.workoutSetId,
            setIndex: set.setIndex,
            clonedFromSetIndex: Math.max(1, mapping.plannedSetCount),
          },
        }).nextSelectionMetadata;
      }
    }
  }

  return reconcileRuntimeEditSelectionMetadata({
    selectionMetadata,
    selectionMode: "INTENT",
    sessionIntent: input.session.intent,
    persistedExercises,
    reconciledAt: input.reconciledAt,
    mutation: { kind: "rewrite_structure" },
  }).nextSelectionMetadata;
}

async function writeBackfillSessions(input: {
  tx: BackfillTx;
  mesocycle: BackfillMesocycleRow;
  plans: ResolvedSessionPlan[];
  idFactory: () => string;
}): Promise<string[]> {
  const createdWorkoutIds: string[] = [];

  for (const plan of input.plans) {
    const workoutId = input.idFactory();
    const performedAt = performedAtDate(plan.definition.performedDate);
    const persistedExercises = buildPersistedExercisesForBackfill({
      plan,
      idFactory: input.idFactory,
    });
    const initialSelectionMetadata = buildInitialSelectionMetadata({
      mesocycle: input.mesocycle,
      session: plan.definition,
      seedExercises: plan.seedExercises,
      workoutId,
    });
    const selectionMetadata = applyRuntimeEditMetadata({
      selectionMetadata: initialSelectionMetadata,
      persistedExercises,
      session: plan.definition,
      reconciledAt: performedAt.toISOString(),
    });

    await input.tx.workout.create({
      data: {
        id: workoutId,
        userId: input.mesocycle.macroCycle.userId,
        scheduledDate: performedAt,
        completedAt: performedAt,
        status: "COMPLETED",
        selectionMode: "INTENT",
        sessionIntent: plan.definition.intent,
        selectionMetadata: selectionMetadata as Prisma.InputJsonValue,
        mesocycleId: input.mesocycle.id,
        mesocycleWeekSnapshot: BACKFILL_WEEK,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesoSessionSnapshot: plan.definition.mesoSessionSnapshot,
        advancesSplit: true,
        notes: `Transition-week backfill: performed outside app on ${plan.definition.performedDate}. Seed preserved; deviations recorded in selectionMetadata.runtimeEditReconciliation.`,
      },
      select: { id: true },
    });

    for (const exercise of persistedExercises) {
      await input.tx.workoutExercise.create({
        data: {
          id: exercise.workoutExerciseId,
          workoutId,
          exerciseId: exercise.exerciseId,
          orderIndex: exercise.orderIndex,
          section: exercise.section,
          isMainLift: exercise.isMainLift,
          movementPatterns: [],
        },
        select: { id: true },
      });

      for (const set of exercise.sets) {
        await input.tx.workoutSet.create({
          data: {
            id: set.workoutSetId,
            workoutExerciseId: exercise.workoutExerciseId,
            setIndex: set.setIndex,
            targetReps: set.targetReps,
            targetRpe: set.targetRpe,
            targetLoad: set.targetLoad,
            restSeconds: set.restSeconds,
          },
          select: { id: true },
        });

        await input.tx.setLog.create({
          data: {
            workoutSetId: set.workoutSetId,
            actualReps: set.wasSkipped ? undefined : set.actual?.reps,
            actualRpe: set.wasSkipped ? undefined : set.actual?.rpe,
            actualLoad:
              set.wasSkipped || set.actual?.load == null
                ? undefined
                : quantizeLoad(set.actual.load),
            wasSkipped: set.wasSkipped,
            completedAt: performedAt,
            notes: set.notes,
          },
          select: { id: true },
        });
      }
    }

    createdWorkoutIds.push(workoutId);
  }

  await input.tx.mesocycle.update({
    where: { id: input.mesocycle.id },
    data: {
      completedSessions: { increment: input.plans.length },
      accumulationSessionsCompleted: { increment: input.plans.length },
    },
  });

  return createdWorkoutIds;
}

function assertRequiredInput(input: BackfillWeek1PerformedSessionsInput): void {
  if (!input.ownerEmail || input.ownerEmail.trim().length === 0) {
    throw new Error("BACKFILL_WEEK1_OWNER_EMAIL_REQUIRED");
  }
  if (!input.mesocycleId || input.mesocycleId.trim().length === 0) {
    throw new Error("BACKFILL_WEEK1_MESOCYCLE_ID_REQUIRED");
  }
  if (input.backfillWeek1PerformedSessions !== true) {
    throw new Error("BACKFILL_WEEK1_EXPLICIT_FLAG_REQUIRED");
  }
  if (input.write && input.confirmBackfill !== true) {
    throw new Error("BACKFILL_WEEK1_CONFIRMATION_REQUIRED");
  }
}

function finalizeResult(input: {
  base: Omit<BackfillWeek1PerformedSessionsResult, "write">;
  writeRequested: boolean;
  confirmationProvided: boolean;
  dbWriteOccurred: boolean;
  transactionStatus: BackfillWeek1PerformedSessionsResult["write"]["transactionStatus"];
  createdWorkoutIds?: string[];
  slotPlanSeedUnchanged?: boolean;
  slotSequenceUnchanged?: boolean;
}): BackfillWeek1PerformedSessionsResult {
  return {
    ...input.base,
    dryRun: !input.writeRequested,
    writeRequested: input.writeRequested,
    seedSlotSequenceBoundary: {
      ...input.base.seedSlotSequenceBoundary,
      slotPlanSeedUnchanged:
        input.slotPlanSeedUnchanged ??
        input.base.seedSlotSequenceBoundary.slotPlanSeedUnchanged,
      slotSequenceUnchanged:
        input.slotSequenceUnchanged ??
        input.base.seedSlotSequenceBoundary.slotSequenceUnchanged,
    },
    write: {
      requested: input.writeRequested,
      confirmationProvided: input.confirmationProvided,
      eligible: input.base.safety.eligible,
      dbWriteOccurred: input.dbWriteOccurred,
      transactionStatus: input.transactionStatus,
      createdWorkoutIds: input.createdWorkoutIds ?? [],
    },
  };
}

export async function backfillWeek1PerformedSessions(
  input: BackfillWeek1PerformedSessionsInput,
): Promise<BackfillWeek1PerformedSessionsResult> {
  assertRequiredInput(input);

  const client = input.dependencies?.prismaClient ?? prisma;
  const writeRequested = input.write === true;
  const confirmationProvided = input.confirmBackfill === true;
  const idFactory = input.dependencies?.idFactory ?? randomUUID;
  const sessions =
    input.dependencies?.performedSessions ?? TRANSITION_WEEK_BACKFILL_SESSIONS;

  const initial = await client.$transaction((tx) =>
    inspectBackfillSafety(tx as unknown as BackfillTx, {
      ownerEmail: input.ownerEmail,
      mesocycleId: input.mesocycleId,
      explicitFlag: input.backfillWeek1PerformedSessions === true,
      sessions,
    }),
  );

  if (!writeRequested) {
    return finalizeResult({
      base: initial.result,
      writeRequested,
      confirmationProvided,
      dbWriteOccurred: false,
      transactionStatus: "not_requested",
    });
  }

  if (!initial.result.safety.eligible || !initial.mesocycle) {
    return finalizeResult({
      base: initial.result,
      writeRequested,
      confirmationProvided,
      dbWriteOccurred: false,
      transactionStatus: "no_write",
    });
  }

  const initialSeedJson = stableJson(initial.mesocycle.slotPlanSeedJson);
  const initialSlotSequenceJson = stableJson(initial.mesocycle.slotSequenceJson);

  const writeResult = await client.$transaction(async (tx) => {
    const current = await inspectBackfillSafety(tx as unknown as BackfillTx, {
      ownerEmail: input.ownerEmail,
      mesocycleId: input.mesocycleId,
      explicitFlag: input.backfillWeek1PerformedSessions === true,
      sessions,
    });
    if (!current.result.safety.eligible || !current.mesocycle) {
      return {
        base: current.result,
        createdWorkoutIds: [] as string[],
        dbWriteOccurred: false,
        transactionStatus: "no_write" as const,
        slotPlanSeedUnchanged:
          current.mesocycle?.slotPlanSeedJson == null
            ? false
            : stableJson(current.mesocycle.slotPlanSeedJson) === initialSeedJson,
        slotSequenceUnchanged:
          current.mesocycle?.slotSequenceJson == null
            ? false
            : stableJson(current.mesocycle.slotSequenceJson) === initialSlotSequenceJson,
      };
    }
    if (stableJson(current.mesocycle.slotSequenceJson) !== initialSlotSequenceJson) {
      return {
        base: {
          ...current.result,
          safety: {
            ...current.result.safety,
            eligible: false,
            blockers: uniqueBlockers([
              ...current.result.safety.blockers,
              "slot_sequence_changed_before_write",
            ]),
          },
        },
        createdWorkoutIds: [] as string[],
        dbWriteOccurred: false,
        transactionStatus: "no_write" as const,
        slotPlanSeedUnchanged:
          stableJson(current.mesocycle.slotPlanSeedJson) === initialSeedJson,
        slotSequenceUnchanged: false,
      };
    }
    if (stableJson(current.mesocycle.slotPlanSeedJson) !== initialSeedJson) {
      return {
        base: {
          ...current.result,
          safety: {
            ...current.result.safety,
            eligible: false,
            blockers: uniqueBlockers([
              ...current.result.safety.blockers,
              "slot_plan_seed_changed_before_write",
            ]),
          },
        },
        createdWorkoutIds: [] as string[],
        dbWriteOccurred: false,
        transactionStatus: "no_write" as const,
        slotPlanSeedUnchanged: false,
        slotSequenceUnchanged: true,
      };
    }

    const createdWorkoutIds = await writeBackfillSessions({
      tx: tx as unknown as BackfillTx,
      mesocycle: current.mesocycle,
      plans: current.plans,
      idFactory,
    });

    return {
      base: current.result,
      createdWorkoutIds,
      dbWriteOccurred: createdWorkoutIds.length > 0,
      transactionStatus: "success" as const,
      slotPlanSeedUnchanged: true,
      slotSequenceUnchanged: true,
    };
  });

  return finalizeResult({
    base: writeResult.base,
    writeRequested,
    confirmationProvided,
    dbWriteOccurred: writeResult.dbWriteOccurred,
    transactionStatus: writeResult.transactionStatus,
    createdWorkoutIds: writeResult.createdWorkoutIds,
    slotPlanSeedUnchanged: writeResult.slotPlanSeedUnchanged,
    slotSequenceUnchanged: writeResult.slotSequenceUnchanged,
  });
}
