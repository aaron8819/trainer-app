import "dotenv/config";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MesocycleState, WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import type { SessionIntent } from "@/lib/engine/session-types";
import type { SessionGenerationResult } from "@/lib/api/template-session/types";
import type { CheckInRow } from "@/lib/api/checkin-staleness";
import { resolveNextWorkoutContext, type NextWorkoutContext } from "@/lib/api/next-session";
import { findPendingWeekCloseForUser } from "@/lib/api/mesocycle-week-close";
import { deriveCurrentMesocycleSession, getWeeklyVolumeTarget } from "@/lib/api/mesocycle-lifecycle";
import { loadWorkoutContext } from "@/lib/api/workout-context";
import { loadExerciseExposure } from "@/lib/api/exercise-exposure";
import { generateSessionFromMappedContext } from "@/lib/api/template-session";
import {
  buildMappedGenerationContextFromSnapshot,
  type PreloadedGenerationSnapshot,
} from "@/lib/api/template-session/context-loader";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";

type Args = Record<string, string | boolean>;

type ArtifactComparableIdentity = {
  userId?: string;
  ownerEmail?: string;
};

type AuditFailure = {
  section: string;
  message: string;
  stack?: string;
};

type AuditWarningSeverity = "info" | "warn" | "error";

type AuditWarningSource = "audit-runner" | "template-session" | "stimulus-profile" | "exercise-exposure" | "helper";

type AuditWarning = {
  code:
    | "AUDIT_SECTION_FAILURE"
    | "AUDIT_MESOCYCLE_DURATION_SHORT"
    | "AUDIT_WEEK_CONTEXT_MISMATCH"
    | "AUDIT_PPL_PREVIEWS_SKIPPED"
    | "AUDIT_NO_ACTIVE_MESOCYCLE"
    | "PREVIEW_GENERATION_ERROR"
    | "PREVIEW_SRA_WARNINGS_PRESENT"
    | "PENDING_WEEK_CLOSE_MISSING_TARGET_MUSCLES"
    | "HELPER_STIMULUS_PROFILE_COVERAGE_MISSING"
    | "HELPER_SECTION_ROLE_MISMATCH"
    | "HELPER_TEMPLATE_SESSION_WARNING"
    | "HELPER_UNCLASSIFIED_WARNING";
  severity: AuditWarningSeverity;
  source: AuditWarningSource;
  message: string;
  rawMessage: string;
  details?: Record<string, unknown>;
};

type AuditWarnings = {
  schemaWarnings: AuditWarning[];
  connectionRuntimeWarnings: AuditWarning[];
  stimulusFallbackWarnings: AuditWarning[];
  generationWarnings: AuditWarning[];
};

type WeekStimulusRow = {
  muscle: string;
  target: number;
  effectiveSets: number;
  directSets: number;
  indirectSets: number;
  deficit: number;
};

type WeekStimulusSummary = {
  week: number;
  totalTarget: number;
  totalEffectiveSets: number;
  totalDeficit: number;
  rows: WeekStimulusRow[];
};

type PreviewSummary = {
  label: string;
  mode: "next-session" | "intent-preview" | "optional-gap-fill";
  intent: SessionIntent | null;
  targetMuscles: string[];
  status: "ok" | "error";
  existingWorkoutId: string | null;
  source: string | null;
  error?: string;
    summary?: {
      selectionMode: string;
      selectedExerciseCount: number;
      mainLiftCount: number;
      accessoryCount: number;
      totalPlannedSets: number;
      filteredExerciseCount: number;
      estimatedMinutes: number;
    };
  cycleContext?: {
    weekInMeso: number;
    phase: string;
    isDeload: boolean;
  };
  exercises?: {
    mainLifts: string[];
    accessories: string[];
  };
  topDeficits?: Array<{
    muscle: string;
    target: number;
    actual: number;
    deficit: number;
  }>;
    sraWarnings?: Array<{
      muscle: string;
      lastTrainedHoursAgo: number;
      sraWindowHours: number;
      recoveryPercent: number;
    }>;
  };

type AuditArtifactSummary = {
  currentWeek?: number;
  currentSession?: number;
  phase?: string;
  nextSessionIntent?: string;
  topDeficits?: Array<{
    muscle: string;
    deficit: number;
    target: number;
    actual: number;
  }>;
  topUnderRecoveredMuscles?: Array<{
    muscle: string;
    recoveryPercent: number;
    lastTrainedHoursAgo: number;
    sraWindowHours: number;
    previews: string[];
  }>;
  previewSessionDurations?: Array<{
    preview: string;
    estimatedMinutes: number;
  }>;
  unresolvedDeficitsByPreview?: Array<{
    preview: string;
    unresolvedDeficitTotal: number;
    topDeficitMuscle?: string;
    topDeficitValue?: number;
  }>;
  warningCounts: {
    byCategory: Array<{
      category: "connectionRuntimeWarnings" | "generationWarnings" | "schemaWarnings" | "stimulusFallbackWarnings";
      count: number;
    }>;
    byCode: Array<{
      code: AuditWarning["code"];
      count: number;
    }>;
  };
  optionalGapFillActive: boolean;
  pendingWeekClosePresent: boolean;
  failuresPresent: boolean;
};

type AuditArtifact = {
  version: 1;
  generatedAt: string;
  auditWeek: number;
  identity: {
    userId: string;
    ownerEmail?: string;
  };
  mesocycleState: {
    mesocycleId: string | null;
    mesoNumber: number | null;
    state: MesocycleState | null;
    focus: string | null;
    durationWeeks: number | null;
    sessionsPerWeek: number | null;
    splitType: string | null;
    currentWeek: number | null;
    currentSession: number | null;
    currentPhase: string | null;
    nextSessionIntent: string | null;
    nextSessionSource: string | null;
    nextExistingWorkoutId: string | null;
    pendingWeekCloseId: string | null;
  };
  historicalWeeklyStimulusSummary: WeekStimulusSummary[];
  week4Targets: {
    week: number;
    rows: Array<{ muscle: string; target: number }>;
  };
  week4Actuals: {
    week: number;
    rows: Array<{
      muscle: string;
      effectiveSets: number;
      directSets: number;
      indirectSets: number;
    }>;
  };
  week4Deficits: {
    week: number;
    rows: Array<{
      muscle: string;
      target: number;
      actual: number;
      deficit: number;
    }>;
    totalDeficit: number;
  };
  generationPreviews: {
    nextSession: PreviewSummary | null;
    splitPreviews: PreviewSummary[];
  };
  optionalGapFillState: {
    eligible: boolean;
    reason: string | null;
    weekCloseId: string | null;
    targetWeek: number | null;
    targetPhase: string | null;
    targetMuscles: string[];
    deficitSummary: Array<{
      muscle: string;
      target: number;
      actual: number;
      deficit: number;
    }>;
    linkedWorkout: {
      id: string;
      status: string;
      } | null;
      policy: {
        requiredSessionsPerWeek: number;
        maxOptionalGapFillSessionsPerWeek: number;
        maxGeneratedHardSets: number;
        maxGeneratedExercises: number;
      } | null;
      preview: PreviewSummary | null;
    };
  summary: AuditArtifactSummary;
  warnings: AuditWarnings;
  failures: AuditFailure[];
};

type AuditComparisonDelta = {
  field: string;
  before?: unknown;
  after?: unknown;
};

type AuditComparisonArtifact = {
  version: 1;
  comparedAt: string;
  latestArtifactPath: string;
  previousArtifactPath: string;
  comparableIdentity: ArtifactComparableIdentity;
  auditWeek: number;
  deltaCount: number;
  deltas: AuditComparisonDelta[];
};

type ActiveMesocycleRecord = {
  id: string;
  mesoNumber: number;
  focus: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  splitType: string;
  state: MesocycleState;
  startWeek: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  macroCycle: {
    startDate: Date;
  };
};

type ActiveMesocycleWithMacro = ActiveMesocycleRecord & {
  volumeTarget: string;
  intensityBias: string;
  completedSessions: number;
  daysPerWeek: number;
  isActive: boolean;
  rirBandConfig: unknown;
  volumeRampConfig: unknown;
};

type AuditWorkoutRecord = {
  id: string;
  status: WorkoutStatus;
  scheduledDate: Date;
  mesocycleWeekSnapshot: number | null;
  exercises: Array<{
    exercise: {
      id: string;
      name: string;
      aliases: Array<{ alias: string }>;
      exerciseMuscles: Array<{
        role: string;
        muscle: { name: string };
      }>;
    };
    sets: Array<{
      logs: Array<{
        wasSkipped: boolean;
      }>;
    }>;
  }>;
};

type Week4AuditSnapshot = {
  identity: {
    userId: string;
    ownerEmail?: string;
  };
  runtimeContext: Awaited<ReturnType<typeof loadWorkoutContext>>;
  activeMesocycle: ActiveMesocycleWithMacro | null;
  nextWorkoutContext: NextWorkoutContext;
  pendingWeekClose: Awaited<ReturnType<typeof findPendingWeekCloseForUser>>;
  incompleteWorkouts: Array<{
    id: string;
    status: string;
    scheduledDate: Date;
    sessionIntent: string | null;
  }>;
  mesocycleRoleRows: PreloadedGenerationSnapshot["mesocycleRoleRows"];
  rotationContext: PreloadedGenerationSnapshot["rotationContext"];
  weekAuditWorkouts: AuditWorkoutRecord[];
  standardMappedContext: PreloadedGenerationSnapshot | null;
  week4GapFillMappedContext: PreloadedGenerationSnapshot | null;
};

function parseArgs(argv: string[]): Args {
  const output: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      output[key] = true;
      continue;
    }
    output[key] = value;
    index += 1;
  }
  return output;
}

function toPositiveInt(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function getWeek4AuditOutputDir(): string {
  return path.join(process.cwd(), "artifacts", "audits", "week4-generation");
}

function toErrorMessage(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

function pushFailure(
  failures: AuditFailure[],
  warnings: AuditWarnings,
  section: string,
  error: unknown
) {
  const detail = toErrorMessage(error);
  failures.push({
    section,
    message: detail.message,
    stack: detail.stack,
  });
  pushAuditWarning(warnings.connectionRuntimeWarnings, {
    code: "AUDIT_SECTION_FAILURE",
    severity: "error",
    source: "audit-runner",
    message: `${section}: ${detail.message}`,
    rawMessage: detail.message,
    details: {
      section,
      stack: detail.stack,
    },
  });
}

function buildWarningKey(warning: AuditWarning): string {
  return JSON.stringify({
    code: warning.code,
    severity: warning.severity,
    source: warning.source,
    message: warning.message,
    rawMessage: warning.rawMessage,
    details: warning.details ?? null,
  });
}

function pushAuditWarning(bucket: AuditWarning[], warning: AuditWarning) {
  const key = buildWarningKey(warning);
  if (!bucket.some((entry) => buildWarningKey(entry) === key)) {
    bucket.push(warning);
  }
}

function classifyCapturedWarning(rawMessage: string): {
  bucket: keyof AuditWarnings;
  warning: AuditWarning;
} {
  const message = rawMessage.trim();
  const sectionRoleMatch = message.match(
    /workout=(\S+)\s+intent=(\S+)\s+exerciseId=(\S+)\s+actual=(\S+)\s+expected=(\S+)\s+role=(\S+)/
  );
  if (message.includes("[stimulus-profile:coverage]")) {
    return {
      bucket: "stimulusFallbackWarnings",
      warning: {
        code: "HELPER_STIMULUS_PROFILE_COVERAGE_MISSING",
        severity: "warn",
        source: "stimulus-profile",
        message,
        rawMessage: rawMessage.trim(),
      },
    };
  }
  if (message.includes("Section/role mismatch")) {
    return {
      bucket: "schemaWarnings",
      warning: {
        code: "HELPER_SECTION_ROLE_MISMATCH",
        severity: "warn",
        source: "template-session",
        message,
        rawMessage: rawMessage.trim(),
        details: sectionRoleMatch
          ? {
              workoutId: sectionRoleMatch[1],
              intent: sectionRoleMatch[2],
              exerciseId: sectionRoleMatch[3],
              actualSection: sectionRoleMatch[4],
              expectedSection: sectionRoleMatch[5],
              role: sectionRoleMatch[6],
            }
          : undefined,
      },
    };
  }
  if (message.startsWith("[template-session]")) {
    return {
      bucket: "generationWarnings",
      warning: {
        code: "HELPER_TEMPLATE_SESSION_WARNING",
        severity: "warn",
        source: "template-session",
        message,
        rawMessage: rawMessage.trim(),
      },
    };
  }
  if (message.startsWith("[exercise-exposure]")) {
    return {
      bucket: "connectionRuntimeWarnings",
      warning: {
        code: "HELPER_UNCLASSIFIED_WARNING",
        severity: "warn",
        source: "exercise-exposure",
        message,
        rawMessage: rawMessage.trim(),
      },
    };
  }
  return {
    bucket: "connectionRuntimeWarnings",
    warning: {
      code: "HELPER_UNCLASSIFIED_WARNING",
      severity: "warn",
      source: "helper",
      message,
      rawMessage: rawMessage.trim(),
    },
  };
}

function recordCapturedWarning(warnings: AuditWarnings, rawMessage: string) {
  const message = rawMessage.trim();
  if (!message) {
    return;
  }
  const classified = classifyCapturedWarning(message);
  pushAuditWarning(warnings[classified.bucket], classified.warning);
}

async function captureWarnings<T>(
  warnings: AuditWarnings,
  operation: () => Promise<T>
): Promise<T> {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const message = args
      .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
      .join(" ");
    recordCapturedWarning(warnings, message);
  };

  try {
    return await operation();
  } finally {
    console.warn = originalWarn;
  }
}

function buildTargetRows(mesocycle: ActiveMesocycleRecord, week: number) {
  return Object.keys(VOLUME_LANDMARKS)
    .map((muscle) => ({
      muscle,
      target: getWeeklyVolumeTarget(mesocycle, muscle, week),
    }))
    .filter((row) => row.target > 0)
    .sort((left, right) => left.muscle.localeCompare(right.muscle));
}

function summarizeWeek(input: {
  week: number;
  targets: Array<{ muscle: string; target: number }>;
  actuals: Record<string, { effectiveSets: number; directSets: number; indirectSets: number }>;
}): WeekStimulusSummary {
  const rows = input.targets.map((targetRow) => {
    const actual = input.actuals[targetRow.muscle] ?? {
      effectiveSets: 0,
      directSets: 0,
      indirectSets: 0,
    };
    return {
      muscle: targetRow.muscle,
      target: targetRow.target,
      effectiveSets: roundToTenth(actual.effectiveSets),
      directSets: roundToTenth(actual.directSets),
      indirectSets: roundToTenth(actual.indirectSets),
      deficit: roundToTenth(Math.max(0, targetRow.target - actual.effectiveSets)),
    };
  });

  return {
    week: input.week,
    totalTarget: roundToTenth(rows.reduce((sum, row) => sum + row.target, 0)),
    totalEffectiveSets: roundToTenth(rows.reduce((sum, row) => sum + row.effectiveSets, 0)),
    totalDeficit: roundToTenth(rows.reduce((sum, row) => sum + row.deficit, 0)),
    rows,
  };
}

function countCompletedSets(
  sets: Array<{
    logs: Array<{ wasSkipped: boolean }>;
  }>
): number {
  return sets.filter((set) => set.logs.length > 0 && !set.logs[0]?.wasSkipped).length;
}

function computeWeekActualsFromSnapshot(
  workouts: AuditWorkoutRecord[],
  week: number
): Record<string, { effectiveSets: number; directSets: number; indirectSets: number }> {
  const byMuscle: Record<string, { effectiveSets: number; directSets: number; indirectSets: number }> = {};

  for (const workout of workouts) {
    if (workout.mesocycleWeekSnapshot !== week) {
      continue;
    }

    for (const workoutExercise of workout.exercises) {
      const completedSets = countCompletedSets(workoutExercise.sets);
      if (completedSets <= 0) {
        continue;
      }

      const primaryMuscles = workoutExercise.exercise.exerciseMuscles
        .filter((mapping) => mapping.role === "PRIMARY")
        .map((mapping) => mapping.muscle.name);
      const secondaryMuscles = workoutExercise.exercise.exerciseMuscles
        .filter((mapping) => mapping.role === "SECONDARY")
        .map((mapping) => mapping.muscle.name);

      for (const muscle of primaryMuscles) {
        byMuscle[muscle] ??= { effectiveSets: 0, directSets: 0, indirectSets: 0 };
        byMuscle[muscle].directSets = roundToTenth(byMuscle[muscle].directSets + completedSets);
      }

      for (const muscle of secondaryMuscles) {
        byMuscle[muscle] ??= { effectiveSets: 0, directSets: 0, indirectSets: 0 };
        byMuscle[muscle].indirectSets = roundToTenth(byMuscle[muscle].indirectSets + completedSets);
      }

      const effectiveContribution = getEffectiveStimulusByMuscle(
        {
          id: workoutExercise.exercise.id,
          name: workoutExercise.exercise.name,
          primaryMuscles,
          secondaryMuscles,
          aliases: workoutExercise.exercise.aliases.map((alias) => alias.alias),
        },
        completedSets
      );

      for (const [muscle, effectiveSets] of effectiveContribution) {
        byMuscle[muscle] ??= { effectiveSets: 0, directSets: 0, indirectSets: 0 };
        byMuscle[muscle].effectiveSets = roundToTenth(byMuscle[muscle].effectiveSets + effectiveSets);
      }
    }
  }

  return byMuscle;
}

function supportedPplPreviewIntents(weeklySchedule: string[]): SessionIntent[] {
  const unique = new Set(
    weeklySchedule
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry): entry is SessionIntent => ["push", "pull", "legs"].includes(entry))
  );
  return ["push", "pull", "legs"].filter((intent) => unique.has(intent as SessionIntent)) as SessionIntent[];
}

function resolveSplitPreviewIntents(
  weeklySchedule: string[],
  splitType: string | null | undefined
): SessionIntent[] {
  const fromSchedule = supportedPplPreviewIntents(weeklySchedule);
  if (fromSchedule.length > 0) {
    return fromSchedule;
  }
  return String(splitType ?? "").toLowerCase() === "ppl" ? ["push", "pull", "legs"] : [];
}

function topPlannerDeficits(result: SessionGenerationResult): Array<{
  muscle: string;
  target: number;
  actual: number;
  deficit: number;
}> {
  if ("error" in result) {
    return [];
  }
  const muscles = result.selection.plannerDiagnostics?.muscles ?? {};
  return Object.entries(muscles)
    .map(([muscle, diagnostic]) => ({
      muscle,
      target: roundToTenth(diagnostic.weeklyTarget),
      actual: roundToTenth(diagnostic.projectedEffectiveVolumeAfterClosure),
      deficit: roundToTenth(diagnostic.finalRemainingDeficit),
    }))
    .filter((row) => row.deficit > 0)
    .sort((left, right) => right.deficit - left.deficit)
    .slice(0, 5);
}

function summarizePreview(input: {
  label: string;
  mode: PreviewSummary["mode"];
  intent: SessionIntent | null;
  targetMuscles?: string[];
  existingWorkoutId?: string | null;
  source?: string | null;
  result: SessionGenerationResult;
}): PreviewSummary {
  if ("error" in input.result) {
    return {
      label: input.label,
      mode: input.mode,
      intent: input.intent,
      targetMuscles: input.targetMuscles ?? [],
      status: "error",
      existingWorkoutId: input.existingWorkoutId ?? null,
      source: input.source ?? null,
      error: input.result.error,
    };
  }

  const receipt = input.result.selection.sessionDecisionReceipt;
  const mainLifts = input.result.workout.mainLifts.map((entry) => entry.exercise.name);
  const accessories = input.result.workout.accessories.map((entry) => entry.exercise.name);
  const totalPlannedSets = Object.values(input.result.selection.perExerciseSetTargets).reduce(
    (sum, value) => sum + value,
    0
  );

  return {
    label: input.label,
    mode: input.mode,
    intent: input.intent,
    targetMuscles: input.targetMuscles ?? [],
    status: "ok",
    existingWorkoutId: input.existingWorkoutId ?? null,
    source: input.source ?? null,
    summary: {
      selectionMode: input.result.selectionMode,
      selectedExerciseCount: input.result.selection.selectedExerciseIds.length,
      mainLiftCount: input.result.selection.mainLiftIds.length,
      accessoryCount: input.result.selection.accessoryIds.length,
      totalPlannedSets,
      filteredExerciseCount: input.result.filteredExercises?.length ?? 0,
      estimatedMinutes: input.result.workout.estimatedMinutes,
    },
    cycleContext: receipt
      ? {
          weekInMeso: receipt.cycleContext.weekInMeso,
          phase: receipt.cycleContext.phase,
          isDeload: receipt.cycleContext.isDeload,
        }
      : undefined,
    exercises: {
      mainLifts,
      accessories,
    },
    topDeficits: topPlannerDeficits(input.result),
    sraWarnings: input.result.sraWarnings.map((warning) => ({
      muscle: warning.muscle,
      lastTrainedHoursAgo: warning.lastTrainedHoursAgo,
      sraWindowHours: warning.sraWindowHours,
      recoveryPercent: warning.recoveryPercent,
    })),
  };
}

function comparePreviewLabel(left: string, right: string): number {
  const rank = (value: string): number => {
    if (value === "next-session") return 0;
    if (value === "optional-gap-fill") return 2;
    return 1;
  };
  const rankDiff = rank(left) - rank(right);
  if (rankDiff !== 0) {
    return rankDiff;
  }
  return left.localeCompare(right);
}

function collectOrderedPreviews(artifact: AuditArtifact): PreviewSummary[] {
  return [
    artifact.generationPreviews.nextSession,
    ...artifact.generationPreviews.splitPreviews,
    artifact.optionalGapFillState.preview,
  ]
    .filter((preview): preview is PreviewSummary => preview != null)
    .sort((left, right) => comparePreviewLabel(left.label, right.label));
}

function buildArtifactSummary(artifact: AuditArtifact): AuditArtifactSummary {
  const previews = collectOrderedPreviews(artifact);
  const topDeficits = artifact.week4Deficits.rows
    .filter((row) => row.deficit > 0)
    .slice(0, 5)
    .map((row) => ({
      muscle: row.muscle,
      deficit: row.deficit,
      target: row.target,
      actual: row.actual,
    }));

  const underRecoveredByMuscle = new Map<
    string,
    {
      muscle: string;
      recoveryPercent: number;
      lastTrainedHoursAgo: number;
      sraWindowHours: number;
      previews: Set<string>;
    }
  >();

  for (const preview of previews) {
    for (const warning of preview.sraWarnings ?? []) {
      const existing = underRecoveredByMuscle.get(warning.muscle);
      if (!existing || warning.recoveryPercent < existing.recoveryPercent) {
        underRecoveredByMuscle.set(warning.muscle, {
          muscle: warning.muscle,
          recoveryPercent: warning.recoveryPercent,
          lastTrainedHoursAgo: warning.lastTrainedHoursAgo,
          sraWindowHours: warning.sraWindowHours,
          previews: new Set([preview.label]),
        });
      } else {
        existing.previews.add(preview.label);
      }
    }
  }

  const topUnderRecoveredMuscles = Array.from(underRecoveredByMuscle.values())
    .sort((left, right) => {
      const recoveryDiff = left.recoveryPercent - right.recoveryPercent;
      if (recoveryDiff !== 0) {
        return recoveryDiff;
      }
      return left.muscle.localeCompare(right.muscle);
    })
    .slice(0, 5)
    .map((row) => ({
      muscle: row.muscle,
      recoveryPercent: row.recoveryPercent,
      lastTrainedHoursAgo: row.lastTrainedHoursAgo,
      sraWindowHours: row.sraWindowHours,
      previews: Array.from(row.previews).sort(comparePreviewLabel),
    }));

  const previewSessionDurations = previews
    .filter((preview) => preview.status === "ok" && preview.summary?.estimatedMinutes != null)
    .map((preview) => ({
      preview: preview.label,
      estimatedMinutes: preview.summary?.estimatedMinutes ?? 0,
    }));

  const unresolvedDeficitsByPreview = previews
    .filter((preview) => preview.status === "ok")
    .map((preview) => {
      const deficits = preview.topDeficits ?? [];
      const topDeficit = deficits[0];
      return {
        preview: preview.label,
        unresolvedDeficitTotal: Math.round(deficits.reduce((sum, row) => sum + row.deficit, 0) * 10) / 10,
        ...(topDeficit
          ? {
              topDeficitMuscle: topDeficit.muscle,
              topDeficitValue: topDeficit.deficit,
            }
          : {}),
      };
    });

  const byCategory: AuditArtifactSummary["warningCounts"]["byCategory"] = [
    { category: "connectionRuntimeWarnings", count: artifact.warnings.connectionRuntimeWarnings.length },
    { category: "generationWarnings", count: artifact.warnings.generationWarnings.length },
    { category: "schemaWarnings", count: artifact.warnings.schemaWarnings.length },
    { category: "stimulusFallbackWarnings", count: artifact.warnings.stimulusFallbackWarnings.length },
  ];

  const warningCodeCounts = new Map<AuditWarning["code"], number>();
  for (const warning of [
    ...artifact.warnings.connectionRuntimeWarnings,
    ...artifact.warnings.generationWarnings,
    ...artifact.warnings.schemaWarnings,
    ...artifact.warnings.stimulusFallbackWarnings,
  ]) {
    warningCodeCounts.set(warning.code, (warningCodeCounts.get(warning.code) ?? 0) + 1);
  }

  const byCode = Array.from(warningCodeCounts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => ({ code, count }));

  return {
    ...(artifact.mesocycleState.currentWeek != null ? { currentWeek: artifact.mesocycleState.currentWeek } : {}),
    ...(artifact.mesocycleState.currentSession != null ? { currentSession: artifact.mesocycleState.currentSession } : {}),
    ...(artifact.mesocycleState.currentPhase ? { phase: artifact.mesocycleState.currentPhase } : {}),
    ...(artifact.mesocycleState.nextSessionIntent ? { nextSessionIntent: artifact.mesocycleState.nextSessionIntent } : {}),
    ...(topDeficits.length > 0 ? { topDeficits } : {}),
    ...(topUnderRecoveredMuscles.length > 0 ? { topUnderRecoveredMuscles } : {}),
    ...(previewSessionDurations.length > 0 ? { previewSessionDurations } : {}),
    ...(unresolvedDeficitsByPreview.length > 0 ? { unresolvedDeficitsByPreview } : {}),
    warningCounts: {
      byCategory,
      byCode,
    },
    optionalGapFillActive:
      artifact.optionalGapFillState.eligible || artifact.optionalGapFillState.preview?.status === "ok",
    pendingWeekClosePresent: artifact.optionalGapFillState.weekCloseId != null,
    failuresPresent: artifact.failures.length > 0,
  };
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)])
  );
}

function normalizeComparableIdentity(artifact: AuditArtifact): ArtifactComparableIdentity {
  return {
    ...(artifact.identity.userId ? { userId: artifact.identity.userId } : {}),
    ...(artifact.identity.ownerEmail ? { ownerEmail: artifact.identity.ownerEmail } : {}),
  };
}

function compareSummaryValues(field: string, before: unknown, after: unknown): AuditComparisonDelta | null {
  const normalizedBefore = sortJsonValue(before);
  const normalizedAfter = sortJsonValue(after);
  if (JSON.stringify(normalizedBefore) === JSON.stringify(normalizedAfter)) {
    return null;
  }
  return {
    field,
    before: normalizedBefore,
    after: normalizedAfter,
  };
}

function buildSummaryComparison(latest: AuditArtifact, previous: AuditArtifact): AuditComparisonArtifact {
  const deltas: AuditComparisonDelta[] = [];
  const fields: Array<keyof AuditArtifactSummary> = [
    "currentWeek",
    "currentSession",
    "phase",
    "nextSessionIntent",
    "topDeficits",
    "topUnderRecoveredMuscles",
    "previewSessionDurations",
    "unresolvedDeficitsByPreview",
    "warningCounts",
    "optionalGapFillActive",
    "pendingWeekClosePresent",
    "failuresPresent",
  ];

  for (const field of fields) {
    const delta = compareSummaryValues(
      field,
      previous.summary[field],
      latest.summary[field]
    );
    if (delta) {
      deltas.push(delta);
    }
  }

  return {
    version: 1,
    comparedAt: new Date().toISOString(),
    latestArtifactPath: "",
    previousArtifactPath: "",
    comparableIdentity: normalizeComparableIdentity(latest),
    auditWeek: latest.auditWeek,
    deltaCount: deltas.length,
    deltas,
  };
}

function formatDeltaValue(value: unknown): string {
  if (value == null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function printComparisonReport(comparison: AuditComparisonArtifact) {
  console.log(
    `[week4-audit:compare] latest=${path.basename(comparison.latestArtifactPath)} previous=${path.basename(comparison.previousArtifactPath)} deltas=${comparison.deltaCount}`
  );

  if (comparison.deltaCount === 0) {
    console.log("[week4-audit:compare] no summary deltas detected");
    return;
  }

  for (const delta of comparison.deltas) {
    console.log(
      `[week4-audit:compare] ${delta.field}: ${formatDeltaValue(delta.before)} -> ${formatDeltaValue(delta.after)}`
    );
  }
}

async function loadComparableArtifacts(args: Args): Promise<Array<{ filePath: string; artifact: AuditArtifact }>> {
  const outputDir = getWeek4AuditOutputDir();
  const names = (await readdir(outputDir))
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => right.localeCompare(left));

  const requestedAuditWeek = toPositiveInt(args.week, 4);
  const requestedUserId = typeof args["user-id"] === "string" ? args["user-id"] : undefined;
  const requestedOwnerEmail =
    typeof args.owner === "string" ? args.owner.trim().toLowerCase() : undefined;

  const artifacts: Array<{ filePath: string; artifact: AuditArtifact }> = [];
  for (const name of names) {
    const filePath = path.join(outputDir, name);
    try {
      const raw = await readFile(filePath, "utf8");
      const artifact = JSON.parse(raw) as AuditArtifact;
      if (artifact.auditWeek !== requestedAuditWeek) {
        continue;
      }
      if (artifact.version !== 1 || !artifact.summary) {
        continue;
      }
      if (requestedUserId && artifact.identity.userId !== requestedUserId) {
        continue;
      }
      if (requestedOwnerEmail && artifact.identity.ownerEmail?.toLowerCase() !== requestedOwnerEmail) {
        continue;
      }
      artifacts.push({ filePath, artifact });
    } catch {
      continue;
    }
  }

  if (!requestedUserId && !requestedOwnerEmail && artifacts.length > 0) {
    const latestIdentity = normalizeComparableIdentity(artifacts[0].artifact);
    return artifacts.filter(({ artifact }) => {
      const identity = normalizeComparableIdentity(artifact);
      return identity.userId === latestIdentity.userId && identity.ownerEmail === latestIdentity.ownerEmail;
    });
  }

  return artifacts;
}

async function runComparisonMode(args: Args): Promise<void> {
  const artifacts = await loadComparableArtifacts(args);
  if (artifacts.length < 2) {
    throw new Error("Need at least two comparable Week 4 audit artifacts with summary blocks");
  }

  const latest = artifacts[0];
  const previous = artifacts[1];

  if (latest.artifact.version !== previous.artifact.version) {
    throw new Error(
      `Artifact version mismatch: latest=${latest.artifact.version} previous=${previous.artifact.version}`
    );
  }
  if (!latest.artifact.summary || !previous.artifact.summary) {
    throw new Error("Comparable artifacts are missing summary blocks");
  }

  const comparison = buildSummaryComparison(latest.artifact, previous.artifact);
  comparison.latestArtifactPath = latest.filePath;
  comparison.previousArtifactPath = previous.filePath;

  printComparisonReport(comparison);

  if (args.json === true || typeof args.output === "string") {
    const outputDir = path.join(getWeek4AuditOutputDir(), "comparisons");
    await mkdir(outputDir, { recursive: true });
    const outputPath =
      typeof args.output === "string"
        ? path.resolve(process.cwd(), args.output)
        : path.join(
            outputDir,
            `${new Date().toISOString().replace(/[:.]/g, "-")}-week4-audit-comparison.json`
          );
    await writeFile(outputPath, JSON.stringify(comparison, null, 2), "utf8");
    console.log(`[week4-audit:compare] wrote ${outputPath}`);
  }
}

async function resolveIdentity(args: Args): Promise<{ userId: string; ownerEmail?: string }> {
  if (typeof args["user-id"] === "string") {
    return {
      userId: args["user-id"],
      ownerEmail: typeof args.owner === "string" ? args.owner : process.env.OWNER_EMAIL,
    };
  }

  const ownerEmail =
    (typeof args.owner === "string" ? args.owner : process.env.OWNER_EMAIL)?.trim().toLowerCase();
  if (!ownerEmail) {
    throw new Error("Provide --user-id or configure OWNER_EMAIL / --owner");
  }

  const user = await prisma.user.findUnique({
    where: { email: ownerEmail },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new Error(`No user found for ownerEmail=${ownerEmail}`);
  }

  return { userId: user.id, ownerEmail: user.email };
}

async function loadWeek4AuditSnapshot(
  identity: { userId: string; ownerEmail?: string },
  auditWeek: number,
  warnings: AuditWarnings
): Promise<Week4AuditSnapshot> {
  const runtimeContextPromise = loadWorkoutContext(identity.userId);
  const activeMesocyclePromise = prisma.mesocycle.findFirst({
    where: {
      isActive: true,
      macroCycle: { userId: identity.userId },
    },
    orderBy: [{ mesoNumber: "desc" }],
    include: {
      macroCycle: {
        select: {
          startDate: true,
        },
      },
    },
  }) as Promise<ActiveMesocycleWithMacro | null>;
  const incompleteWorkoutsPromise = prisma.workout.findMany({
    where: {
      userId: identity.userId,
      status: { in: ["IN_PROGRESS", "PARTIAL", "PLANNED"] },
    },
    orderBy: { scheduledDate: "asc" },
    take: 20,
    select: {
      id: true,
      status: true,
      scheduledDate: true,
      sessionIntent: true,
    },
  });
  const rotationContextPromise = captureWarnings(warnings, () => loadExerciseExposure(identity.userId));

  const [runtimeContext, activeMesocycle, incompleteWorkoutsRaw, rotationContext] = await Promise.all([
    runtimeContextPromise,
    activeMesocyclePromise,
    incompleteWorkoutsPromise,
    rotationContextPromise,
  ]);

  const nextWorkoutContext = resolveNextWorkoutContext({
    mesocycle: activeMesocycle
      ? {
          durationWeeks: activeMesocycle.durationWeeks,
          accumulationSessionsCompleted: activeMesocycle.accumulationSessionsCompleted,
          deloadSessionsCompleted: activeMesocycle.deloadSessionsCompleted,
          sessionsPerWeek: activeMesocycle.sessionsPerWeek,
          state: activeMesocycle.state,
        }
      : null,
    weeklySchedule: (runtimeContext.constraints?.weeklySchedule ?? []).map((intent) => String(intent)),
    incompleteWorkouts: incompleteWorkoutsRaw.map((workout) => ({
      id: workout.id,
      status: workout.status,
      scheduledDate: workout.scheduledDate,
      sessionIntent: workout.sessionIntent?.toLowerCase() ?? null,
    })),
  });

  const mesocycleRoleRows = activeMesocycle?.id
    ? await prisma.mesocycleExerciseRole.findMany({
        where: { mesocycleId: activeMesocycle.id },
        select: {
          exerciseId: true,
          role: true,
          sessionIntent: true,
        },
      })
    : [];

  const pendingWeekClose = activeMesocycle?.id
    ? await findPendingWeekCloseForUser({
        userId: identity.userId,
        mesocycleId: activeMesocycle.id,
      })
    : null;

  const weekAuditWorkouts = activeMesocycle?.id
    ? await prisma.workout.findMany({
        where: {
          userId: identity.userId,
          mesocycleId: activeMesocycle.id,
          status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
          mesocycleWeekSnapshot: { in: Array.from({ length: auditWeek }, (_, index) => index + 1) },
        },
        orderBy: [{ mesocycleWeekSnapshot: "asc" }, { scheduledDate: "asc" }],
        include: {
          exercises: {
            include: {
              exercise: {
                include: {
                  aliases: true,
                  exerciseMuscles: { include: { muscle: true } },
                },
              },
              sets: {
                include: {
                  logs: {
                    orderBy: { completedAt: "desc" },
                    take: 1,
                    select: { wasSkipped: true },
                  },
                },
              },
            },
          },
        },
      })
    : [];

  const standardMappedContext: PreloadedGenerationSnapshot | null =
    runtimeContext.profile && runtimeContext.goals && runtimeContext.constraints
      ? {
          context: runtimeContext,
          activeMesocycle: activeMesocycle as PreloadedGenerationSnapshot["activeMesocycle"],
          rotationContext,
          mesocycleRoleRows,
        }
      : null;

  const week4GapFillMappedContext =
    standardMappedContext && pendingWeekClose?.targetWeek === auditWeek
      ? standardMappedContext
      : null;

  return {
    identity,
    runtimeContext,
    activeMesocycle,
    nextWorkoutContext,
    pendingWeekClose,
    incompleteWorkouts: incompleteWorkoutsRaw.map((workout) => ({
      id: workout.id,
      status: workout.status,
      scheduledDate: workout.scheduledDate,
      sessionIntent: workout.sessionIntent?.toLowerCase() ?? null,
    })),
    mesocycleRoleRows,
    rotationContext,
    weekAuditWorkouts,
    standardMappedContext,
    week4GapFillMappedContext,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.compare === true) {
    await runComparisonMode(args);
    return;
  }
  const auditWeek = toPositiveInt(args.week, 4);
  const failures: AuditFailure[] = [];
  const warnings: AuditWarnings = {
    schemaWarnings: [],
    connectionRuntimeWarnings: [],
    stimulusFallbackWarnings: [],
    generationWarnings: [],
  };

  const identity = await resolveIdentity(args);
  const artifact: AuditArtifact = {
    version: 1,
    generatedAt: new Date().toISOString(),
    auditWeek,
    identity,
    mesocycleState: {
      mesocycleId: null,
      mesoNumber: null,
      state: null,
      focus: null,
      durationWeeks: null,
      sessionsPerWeek: null,
      splitType: null,
      currentWeek: null,
      currentSession: null,
      currentPhase: null,
      nextSessionIntent: null,
      nextSessionSource: null,
      nextExistingWorkoutId: null,
      pendingWeekCloseId: null,
    },
    historicalWeeklyStimulusSummary: [],
    week4Targets: { week: auditWeek, rows: [] },
    week4Actuals: { week: auditWeek, rows: [] },
    week4Deficits: { week: auditWeek, rows: [], totalDeficit: 0 },
    generationPreviews: {
      nextSession: null,
      splitPreviews: [],
    },
    optionalGapFillState: {
      eligible: false,
      reason: null,
      weekCloseId: null,
      targetWeek: null,
      targetPhase: null,
      targetMuscles: [],
      deficitSummary: [],
      linkedWorkout: null,
      policy: null,
      preview: null,
    },
    summary: {
      warningCounts: {
        byCategory: [
          { category: "connectionRuntimeWarnings", count: 0 },
          { category: "generationWarnings", count: 0 },
          { category: "schemaWarnings", count: 0 },
          { category: "stimulusFallbackWarnings", count: 0 },
        ],
        byCode: [],
      },
      optionalGapFillActive: false,
      pendingWeekClosePresent: false,
      failuresPresent: false,
    },
    warnings,
    failures,
  };

  const snapshot = await loadWeek4AuditSnapshot(identity, auditWeek, warnings).catch((error) => {
    pushFailure(failures, warnings, "audit-snapshot", error);
    return null;
  });

  const activeMesocycle = snapshot?.activeMesocycle ?? null;
  const nextWorkoutContext = snapshot?.nextWorkoutContext ?? null;

  if (snapshot && activeMesocycle) {
    const currentSession = deriveCurrentMesocycleSession(activeMesocycle);
    artifact.mesocycleState = {
      mesocycleId: activeMesocycle.id,
      mesoNumber: activeMesocycle.mesoNumber,
      state: activeMesocycle.state,
      focus: activeMesocycle.focus,
      durationWeeks: activeMesocycle.durationWeeks,
      sessionsPerWeek: activeMesocycle.sessionsPerWeek,
      splitType: activeMesocycle.splitType,
      currentWeek: currentSession.week,
      currentSession: currentSession.session,
      currentPhase: currentSession.phase,
      nextSessionIntent: nextWorkoutContext?.intent ?? null,
      nextSessionSource: nextWorkoutContext?.source ?? null,
      nextExistingWorkoutId: nextWorkoutContext?.existingWorkoutId ?? null,
      pendingWeekCloseId: null,
    };

    if (activeMesocycle.durationWeeks < auditWeek) {
      pushAuditWarning(warnings.schemaWarnings, {
        code: "AUDIT_MESOCYCLE_DURATION_SHORT",
        severity: "warn",
        source: "audit-runner",
        message: `Active mesocycle duration (${activeMesocycle.durationWeeks}) is shorter than requested audit week ${auditWeek}.`,
        rawMessage: `Active mesocycle duration (${activeMesocycle.durationWeeks}) is shorter than requested audit week ${auditWeek}.`,
        details: {
          durationWeeks: activeMesocycle.durationWeeks,
          auditWeek,
        },
      });
    }

    if (currentSession.week !== auditWeek) {
      pushAuditWarning(warnings.generationWarnings, {
        code: "AUDIT_WEEK_CONTEXT_MISMATCH",
        severity: "info",
        source: "audit-runner",
        message: `Active mesocycle is currently week ${currentSession.week} ${currentSession.phase}; audit remains anchored to week ${auditWeek}.`,
        rawMessage: `Active mesocycle is currently week ${currentSession.week} ${currentSession.phase}; audit remains anchored to week ${auditWeek}.`,
        details: {
          currentWeek: currentSession.week,
          currentPhase: currentSession.phase,
          auditWeek,
        },
      });
    }

    let mappedStandardContext: ReturnType<typeof buildMappedGenerationContextFromSnapshot> | null = null;
    try {
      if (!snapshot.standardMappedContext) {
        throw new Error("Profile, goals, or constraints missing");
      }
      mappedStandardContext = await captureWarnings(warnings, async () =>
        buildMappedGenerationContextFromSnapshot(identity.userId, snapshot.standardMappedContext!)
      );
    } catch (error) {
      pushFailure(failures, warnings, "generation-context:standard", error);
    }

    for (const week of [1, 2, 3].filter((value) => value < auditWeek && value <= activeMesocycle.durationWeeks)) {
      try {
        const targets = buildTargetRows(activeMesocycle, week);
        const actuals = computeWeekActualsFromSnapshot(snapshot.weekAuditWorkouts, week);
        artifact.historicalWeeklyStimulusSummary.push(
          summarizeWeek({
            week,
            targets,
            actuals,
          })
        );
      } catch (error) {
        pushFailure(failures, warnings, `historical-week-${week}`, error);
      }
    }

    try {
      const targets = buildTargetRows(activeMesocycle, auditWeek);
      artifact.week4Targets = {
        week: auditWeek,
        rows: targets,
      };

      const actuals = computeWeekActualsFromSnapshot(snapshot.weekAuditWorkouts, auditWeek);

      artifact.week4Actuals = {
        week: auditWeek,
        rows: targets.map((row) => ({
          muscle: row.muscle,
          effectiveSets: roundToTenth(actuals[row.muscle]?.effectiveSets ?? 0),
          directSets: roundToTenth(actuals[row.muscle]?.directSets ?? 0),
          indirectSets: roundToTenth(actuals[row.muscle]?.indirectSets ?? 0),
        })),
      };

      const deficitRows = targets
        .map((row) => {
          const actual = actuals[row.muscle]?.effectiveSets ?? 0;
          return {
            muscle: row.muscle,
            target: row.target,
            actual: roundToTenth(actual),
            deficit: roundToTenth(Math.max(0, row.target - actual)),
          };
        })
        .filter((row) => row.target > 0)
        .sort((left, right) => right.deficit - left.deficit);

      artifact.week4Deficits = {
        week: auditWeek,
        rows: deficitRows,
        totalDeficit: roundToTenth(deficitRows.reduce((sum, row) => sum + row.deficit, 0)),
      };
    } catch (error) {
      pushFailure(failures, warnings, "week4-stimulus", error);
    }

    try {
      const deficitSnapshot = snapshot.pendingWeekClose?.deficitSnapshot;
      const policy = {
        requiredSessionsPerWeek: Math.max(
          1,
          deficitSnapshot?.policy.requiredSessionsPerWeek ?? activeMesocycle.sessionsPerWeek ?? 3
        ),
        maxOptionalGapFillSessionsPerWeek:
          deficitSnapshot?.policy.maxOptionalGapFillSessionsPerWeek ?? 1,
        maxGeneratedHardSets: deficitSnapshot?.policy.maxGeneratedHardSets ?? 12,
        maxGeneratedExercises: deficitSnapshot?.policy.maxGeneratedExercises ?? 4,
      };
      const deficitSummary =
        deficitSnapshot?.muscles.slice(0, 3).map((row) => ({
          muscle: row.muscle,
          target: row.target,
          actual: row.actual,
          deficit: row.deficit,
        })) ?? [];
      const targetMuscles =
        deficitSnapshot?.summary.topTargetMuscles?.filter(Boolean) ??
        deficitSummary.map((row) => row.muscle);
      artifact.optionalGapFillState = {
        eligible: Boolean(snapshot.pendingWeekClose?.id && targetMuscles.length > 0),
        reason:
          !snapshot.pendingWeekClose
            ? "no_pending_week_close"
            : targetMuscles.length === 0
              ? "missing_deficit_snapshot"
              : null,
        weekCloseId: snapshot.pendingWeekClose?.id ?? null,
        targetWeek: snapshot.pendingWeekClose?.targetWeek ?? null,
        targetPhase: snapshot.pendingWeekClose?.targetPhase ?? null,
        targetMuscles,
        deficitSummary,
        linkedWorkout: snapshot.pendingWeekClose?.optionalWorkout
          ? {
              id: snapshot.pendingWeekClose.optionalWorkout.id,
              status: snapshot.pendingWeekClose.optionalWorkout.status,
            }
          : null,
        policy,
        preview: null,
      };
      artifact.mesocycleState.pendingWeekCloseId = snapshot.pendingWeekClose?.id ?? null;
    } catch (error) {
      pushFailure(failures, warnings, "optional-gap-fill-state", error);
    }

    try {
      const nextPreviewResult = nextWorkoutContext?.intent && mappedStandardContext
        ? await captureWarnings(warnings, () =>
            Promise.resolve(
              generateSessionFromMappedContext(mappedStandardContext, {
                intent: nextWorkoutContext.intent as SessionIntent,
                plannerDiagnosticsMode: "debug",
              })
            )
          )
        : !mappedStandardContext
          ? { error: "Shared mapped generation context unavailable" }
          : { error: "No next-session intent available" };

      const preview = summarizePreview({
        label: "next-session",
        mode: "next-session",
        intent: (nextWorkoutContext?.intent as SessionIntent | null) ?? null,
        existingWorkoutId: nextWorkoutContext?.existingWorkoutId ?? null,
        source: nextWorkoutContext?.source ?? null,
        result: nextPreviewResult,
      });

      artifact.generationPreviews.nextSession = preview;
      if (preview.status === "error" && preview.error) {
        failures.push({ section: "generation:next-session", message: preview.error });
        pushAuditWarning(warnings.generationWarnings, {
          code: "PREVIEW_GENERATION_ERROR",
          severity: "warn",
          source: "audit-runner",
          message: `next-session preview: ${preview.error}`,
          rawMessage: preview.error,
          details: {
            preview: "next-session",
            intent: preview.intent,
          },
        });
      }
      if (preview.sraWarnings && preview.sraWarnings.length > 0) {
        pushAuditWarning(warnings.generationWarnings, {
          code: "PREVIEW_SRA_WARNINGS_PRESENT",
          severity: "info",
          source: "audit-runner",
          message: `next-session preview emitted ${preview.sraWarnings.length} SRA warning(s).`,
          rawMessage: `next-session preview emitted ${preview.sraWarnings.length} SRA warning(s).`,
          details: {
            preview: "next-session",
            intent: preview.intent,
            count: preview.sraWarnings.length,
            muscles: preview.sraWarnings.map((warning) => warning.muscle),
          },
        });
      }
    } catch (error) {
      pushFailure(failures, warnings, "generation:next-session", error);
    }

    try {
      const previewIntents = resolveSplitPreviewIntents(
        (snapshot.runtimeContext.constraints?.weeklySchedule ?? []).map((entry) => String(entry)),
        activeMesocycle.splitType
      );

      if (previewIntents.length === 0) {
        pushAuditWarning(warnings.generationWarnings, {
          code: "AUDIT_PPL_PREVIEWS_SKIPPED",
          severity: "info",
          source: "audit-runner",
          message: "Push/pull/legs previews were skipped because the active split is not PPL and the weekly schedule does not expose push, pull, or legs slots.",
          rawMessage: "Push/pull/legs previews were skipped because the active split is not PPL and the weekly schedule does not expose push, pull, or legs slots.",
          details: {
            splitType: activeMesocycle.splitType,
            weeklySchedule: snapshot.runtimeContext.constraints?.weeklySchedule ?? [],
          },
        });
      }

      for (const intent of previewIntents) {
        try {
          const result = mappedStandardContext
            ? await captureWarnings(warnings, () =>
                Promise.resolve(
                  generateSessionFromMappedContext(mappedStandardContext, {
                    intent,
                    plannerDiagnosticsMode: "debug",
                  })
                )
              )
            : ({ error: "Shared mapped generation context unavailable" } as SessionGenerationResult);
          const preview = summarizePreview({
            label: intent,
            mode: "intent-preview",
            intent,
            result,
          });
          artifact.generationPreviews.splitPreviews.push(preview);
          if (preview.status === "error" && preview.error) {
            failures.push({ section: `generation:${intent}`, message: preview.error });
            pushAuditWarning(warnings.generationWarnings, {
              code: "PREVIEW_GENERATION_ERROR",
              severity: "warn",
              source: "audit-runner",
              message: `${intent} preview: ${preview.error}`,
              rawMessage: preview.error,
              details: {
                preview: intent,
                intent,
              },
            });
          }
          if (preview.sraWarnings && preview.sraWarnings.length > 0) {
            pushAuditWarning(warnings.generationWarnings, {
              code: "PREVIEW_SRA_WARNINGS_PRESENT",
              severity: "info",
              source: "audit-runner",
              message: `${intent} preview emitted ${preview.sraWarnings.length} SRA warning(s).`,
              rawMessage: `${intent} preview emitted ${preview.sraWarnings.length} SRA warning(s).`,
              details: {
                preview: intent,
                intent,
                count: preview.sraWarnings.length,
                muscles: preview.sraWarnings.map((warning) => warning.muscle),
              },
            });
          }
        } catch (error) {
          pushFailure(failures, warnings, `generation:${intent}`, error);
        }
      }
    } catch (error) {
      pushFailure(failures, warnings, "generation:split-previews", error);
    }

    try {
      const pendingWeekClose = snapshot.pendingWeekClose;
      if (pendingWeekClose?.targetWeek === auditWeek && pendingWeekClose.deficitSnapshot) {
        const targetMuscles =
          pendingWeekClose.deficitSnapshot.summary.topTargetMuscles.filter(Boolean) ??
          pendingWeekClose.deficitSnapshot.muscles.slice(0, 3).map((row) => row.muscle);

        if (targetMuscles.length > 0) {
          const mappedGapFillContext =
            snapshot.week4GapFillMappedContext && mappedStandardContext
              ? await captureWarnings(warnings, async () =>
                  buildMappedGenerationContextFromSnapshot(
                    identity.userId,
                    snapshot.week4GapFillMappedContext!,
                    {
                      anchorWeek: pendingWeekClose.targetWeek,
                      weekCloseContext: { targetWeek: pendingWeekClose.targetWeek },
                      forceAccumulation: true,
                    }
                  )
                )
              : null;

          const gapFillResult = mappedGapFillContext
            ? await captureWarnings(warnings, () =>
                Promise.resolve(
                  generateSessionFromMappedContext(mappedGapFillContext, {
                    intent: "body_part",
                    targetMuscles,
                    optionalGapFill: true,
                    optionalGapFillContext: {
                      weekCloseId: pendingWeekClose.id,
                      targetWeek: pendingWeekClose.targetWeek,
                    },
                    anchorWeek: pendingWeekClose.targetWeek,
                    plannerDiagnosticsMode: "debug",
                  })
                )
              )
            : ({ error: "Shared gap-fill generation context unavailable" } as SessionGenerationResult);
          const preview = summarizePreview({
            label: "optional-gap-fill",
            mode: "optional-gap-fill",
            intent: "body_part",
            targetMuscles,
            existingWorkoutId: pendingWeekClose.optionalWorkout?.id ?? null,
            source: "week-close",
            result: gapFillResult,
          });
          artifact.optionalGapFillState.preview = preview;
          if (preview.status === "error" && preview.error) {
            failures.push({ section: "generation:optional-gap-fill", message: preview.error });
            pushAuditWarning(warnings.generationWarnings, {
              code: "PREVIEW_GENERATION_ERROR",
              severity: "warn",
              source: "audit-runner",
              message: `optional gap-fill preview: ${preview.error}`,
              rawMessage: preview.error,
              details: {
                preview: "optional-gap-fill",
                intent: preview.intent,
                targetMuscles,
              },
            });
          }
        } else {
          pushAuditWarning(warnings.stimulusFallbackWarnings, {
            code: "PENDING_WEEK_CLOSE_MISSING_TARGET_MUSCLES",
            severity: "warn",
            source: "audit-runner",
            message: `Pending week close ${pendingWeekClose.id} does not expose target muscles for optional gap-fill preview.`,
            rawMessage: `Pending week close ${pendingWeekClose.id} does not expose target muscles for optional gap-fill preview.`,
            details: {
              weekCloseId: pendingWeekClose.id,
              targetWeek: pendingWeekClose.targetWeek,
            },
          });
        }
      }
    } catch (error) {
      pushFailure(failures, warnings, "generation:optional-gap-fill", error);
    }
  } else {
    pushAuditWarning(warnings.connectionRuntimeWarnings, {
      code: "AUDIT_NO_ACTIVE_MESOCYCLE",
      severity: "warn",
      source: "audit-runner",
      message: "No active mesocycle found; audit output is partial.",
      rawMessage: "No active mesocycle found; audit output is partial.",
    });
  }

  artifact.summary = buildArtifactSummary(artifact);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ownerSlug = slug(identity.ownerEmail ?? identity.userId);
  const outputDir = getWeek4AuditOutputDir();
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${timestamp}-${ownerSlug}-week${auditWeek}-generation-audit.json`);
  await writeFile(outputPath, JSON.stringify(artifact, null, 2), "utf8");

  const topDeficits = artifact.week4Deficits.rows
    .filter((row) => row.deficit > 0)
    .slice(0, 3)
    .map((row) => `${row.muscle}:${row.deficit}`)
    .join(", ");

  console.log(`[week4-audit] wrote ${outputPath}`);
  console.log(
    `[week4-audit] week=${auditWeek} current=${artifact.mesocycleState.currentWeek ?? "n/a"}/${artifact.mesocycleState.currentSession ?? "n/a"} ${artifact.mesocycleState.currentPhase ?? "n/a"} next=${artifact.mesocycleState.nextSessionIntent ?? "n/a"} warnings=${warnings.schemaWarnings.length + warnings.connectionRuntimeWarnings.length + warnings.stimulusFallbackWarnings.length + warnings.generationWarnings.length} failures=${failures.length}`
  );
  console.log(
    `[week4-audit] deficits=${topDeficits || "none"} previews=${[
      artifact.generationPreviews.nextSession?.status === "ok" ? "next-session" : null,
      ...artifact.generationPreviews.splitPreviews
        .filter((preview) => preview.status === "ok")
        .map((preview) => preview.label),
      artifact.optionalGapFillState.preview?.status === "ok" ? "optional-gap-fill" : null,
    ]
      .filter(Boolean)
      .join(", ") || "none"}`
  );
}

main()
  .catch((error) => {
    const detail = toErrorMessage(error);
    console.error(`[week4-audit] ${detail.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
