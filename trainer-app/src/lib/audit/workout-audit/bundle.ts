import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadGenerationPhaseBlockContext } from "@/lib/api/generation-phase-block-context";
import {
  getRirTarget,
  getWeeklyVolumeTarget,
  loadActiveMesocycle,
} from "@/lib/api/mesocycle-lifecycle";
import type { SessionIntent } from "@/lib/engine/session-types";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";
import type {
  PlannerDeficitSnapshot,
  PlannerOpportunityMuscleDiagnostic,
  PlannerTradeoffDiagnostic,
} from "@/lib/planner-diagnostics/types";
import {
  buildWorkoutAuditArtifact,
  serializeWorkoutAuditArtifact,
} from "./serializer";
import { WORKOUT_AUDIT_CONCLUSIONS } from "./conclusions";
import { buildWorkoutAuditContext, resolveWorkoutAuditIdentity } from "./context-builder";
import { runWorkoutAuditGeneration } from "./generation-runner";
import type {
  AuditConclusionBlock,
  AuditWarningSummary,
  WorkoutAuditIdentity,
  WorkoutAuditRequest,
  WorkoutAuditRun,
} from "./types";

export const DEFAULT_SPLIT_SANITY_INTENTS: SessionIntent[] = ["push", "pull", "legs"];

export const SPLIT_SANITY_THRESHOLDS = {
  strandedDeficitMinSets: 1,
} as const;

type SplitSanityVerdictStatus = "pass" | "warn" | "fail";

type SplitSanityOverallVerdict = "pass" | "fail";

type SplitSanityCheckCode =
  | "all_intents_generated"
  | "cycle_context_present"
  | "cycle_context_consistent"
  | "lifecycle_rir_matches_block_profile"
  | "accumulation_targets_do_not_drop"
  | "no_stranded_zero_capacity_deficits"
  | "rescue_not_used";

type SplitSanityCheck = {
  code: SplitSanityCheckCode;
  status: SplitSanityVerdictStatus;
  message: string;
  details?: Record<string, unknown>;
};

type SplitSanityTrackedDeficit = {
  muscle: string;
  remainingDeficit: number;
  weeklyTarget: number;
  projectedEffectiveVolume: number;
  futureCapacity: number | null;
  requiredNow: number | null;
};

type SplitSanityFutureCapacityRow = {
  muscle: string;
  futureCapacity: number | null;
  requiredNow: number | null;
};

type SplitSanityIntentSummary = {
  intent: SessionIntent;
  status: "ok" | "error";
  totalSets: number;
  exerciseCount: number;
  primaryPlannedExercises: string[];
  targetedMuscles: string[];
  unresolvedDeficits: SplitSanityTrackedDeficit[];
  futureCapacityByMuscle: SplitSanityFutureCapacityRow[];
  closureUsed: boolean;
  rescueUsed: boolean;
  topTradeoffs: string[];
  sourceArtifactPath?: string;
  error?: string;
};

type SplitSanityWeeklyTargetSnapshotRow = {
  muscle: string;
  currentTarget: number;
  priorTarget: number | null;
  deltaVsPrior: number | null;
};

type SplitSanityStrandedDeficit = {
  intent: SessionIntent;
  muscle: string;
  remainingDeficit: number;
  futureCapacity: number;
  requiredNow: number;
};

type SplitSanityMesocycleContext = {
  mesocycleId: string | null;
  mesoNumber: number | null;
  focus: string | null;
  splitType: string | null;
  state: string | null;
  mesocycleWeek: number | null;
  blockType: string | null;
  weekInBlock: number | null;
  blockDurationWeeks: number | null;
  lifecycleRirTarget: { min: number; max: number } | null;
};

export type SplitSanityAuditRequest = Pick<
  WorkoutAuditRequest,
  "userId" | "ownerEmail" | "plannerDiagnosticsMode" | "sanitizationLevel"
> & {
  intents?: SessionIntent[];
};

export type SplitSanityAuditArtifact = {
  version: 1;
  auditType: "split-sanity";
  generatedAt: string;
  source: "live" | "pii-safe";
  conclusions: AuditConclusionBlock;
  identity: WorkoutAuditIdentity;
  request: SplitSanityAuditRequest & { intents: SessionIntent[] };
  thresholds: typeof SPLIT_SANITY_THRESHOLDS;
  mesocycleContext: SplitSanityMesocycleContext;
  overallVerdict: SplitSanityOverallVerdict;
  failedChecks: SplitSanityCheckCode[];
  warnings: string[];
  warningSummary: AuditWarningSummary;
  suspiciousPatterns: string[];
  verdictChecks: SplitSanityCheck[];
  plannedTotalsByIntent: Array<{
    intent: SessionIntent;
    totalSets: number;
    exerciseCount: number;
  }>;
  weeklyTargetsSnapshot: SplitSanityWeeklyTargetSnapshotRow[];
  intentSummaries: SplitSanityIntentSummary[];
  strandedDeficits: SplitSanityStrandedDeficit[];
};

type SplitSanityIntentRun = {
  intent: SessionIntent;
  request: WorkoutAuditRequest;
  run: WorkoutAuditRun;
};

type SplitSanityAuditRun = {
  generatedAt: string;
  identity: WorkoutAuditIdentity;
  intents: SessionIntent[];
  intentRuns: SplitSanityIntentRun[];
  activeMesocycle: Awaited<ReturnType<typeof loadActiveMesocycle>>;
  phaseContext: Awaited<ReturnType<typeof loadGenerationPhaseBlockContext>>;
};

type SplitSanityWriteResult = {
  artifact: SplitSanityAuditArtifact;
  summaryPath: string;
  richArtifactPaths: Partial<Record<SessionIntent, string>>;
};

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)] as const)
    );
  }
  return value;
}

function serializeSplitSanityAuditArtifact(artifact: SplitSanityAuditArtifact): string {
  return JSON.stringify(sortJson(artifact), null, 2);
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function getIntents(request: SplitSanityAuditRequest): SessionIntent[] {
  const raw = request.intents?.length ? request.intents : DEFAULT_SPLIT_SANITY_INTENTS;
  const deduped = Array.from(new Set(raw));
  return deduped;
}

function getReceipt(run: WorkoutAuditRun): SessionDecisionReceipt | undefined {
  if ("error" in run.generationResult) {
    return undefined;
  }
  return run.generationResult.selection.sessionDecisionReceipt;
}

function getTargetedMuscles(receipt: SessionDecisionReceipt | undefined): string[] {
  const explicit = receipt?.targetMuscles?.filter((entry) => entry.trim().length > 0) ?? [];
  if (explicit.length > 0) {
    return [...explicit].sort((left, right) => left.localeCompare(right));
  }

  const currentSessionMuscleOpportunity =
    receipt?.plannerDiagnostics?.opportunity?.currentSessionMuscleOpportunity ?? {};
  return Object.entries(currentSessionMuscleOpportunity)
    .filter(([, value]) => (value.sessionOpportunityWeight ?? 0) > 0)
    .map(([muscle]) => muscle)
    .sort((left, right) => left.localeCompare(right));
}

function sumWorkoutSets(run: WorkoutAuditRun): number {
  if ("error" in run.generationResult) {
    return 0;
  }

  const exercises = [
    ...run.generationResult.workout.mainLifts,
    ...run.generationResult.workout.accessories,
  ];
  return exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
}

function getPlannedExerciseNames(run: WorkoutAuditRun): string[] {
  if ("error" in run.generationResult) {
    return [];
  }

  return [...run.generationResult.workout.mainLifts, ...run.generationResult.workout.accessories]
    .map((exercise) => exercise.exercise.name)
    .slice(0, 5);
}

function getExerciseCount(run: WorkoutAuditRun): number {
  if ("error" in run.generationResult) {
    return 0;
  }

  return (
    run.generationResult.workout.mainLifts.length +
    run.generationResult.workout.accessories.length
  );
}

function getTradeoffMessages(tradeoffs: PlannerTradeoffDiagnostic[] | undefined): string[] {
  return (tradeoffs ?? []).map((tradeoff) => tradeoff.message).slice(0, 3);
}

function toDeficitRows(
  deficitsAfterClosure: Record<string, PlannerDeficitSnapshot> | undefined,
  opportunity: Record<string, PlannerOpportunityMuscleDiagnostic> | undefined
): SplitSanityTrackedDeficit[] {
  return Object.entries(deficitsAfterClosure ?? {})
    .filter(([, snapshot]) => snapshot.remainingDeficit > 0)
    .map(([muscle, snapshot]) => ({
      muscle,
      remainingDeficit: snapshot.remainingDeficit,
      weeklyTarget: snapshot.weeklyTarget,
      projectedEffectiveVolume: snapshot.projectedEffectiveVolume,
      futureCapacity: opportunity?.[muscle]?.futureCapacity ?? null,
      requiredNow: opportunity?.[muscle]?.requiredNow ?? null,
    }))
    .sort((left, right) => right.remainingDeficit - left.remainingDeficit);
}

function toFutureCapacityRows(
  targetedMuscles: string[],
  opportunity: Record<string, PlannerOpportunityMuscleDiagnostic> | undefined
): SplitSanityFutureCapacityRow[] {
  return targetedMuscles.map((muscle) => ({
    muscle,
    futureCapacity: opportunity?.[muscle]?.futureCapacity ?? null,
    requiredNow: opportunity?.[muscle]?.requiredNow ?? null,
  }));
}

function buildIntentSummary(
  intentRun: SplitSanityIntentRun,
  sourceArtifactPath?: string
): SplitSanityIntentSummary {
  if ("error" in intentRun.run.generationResult) {
    return {
      intent: intentRun.intent,
      status: "error",
      totalSets: 0,
      exerciseCount: 0,
      primaryPlannedExercises: [],
      targetedMuscles: [],
      unresolvedDeficits: [],
      futureCapacityByMuscle: [],
      closureUsed: false,
      rescueUsed: false,
      topTradeoffs: [],
      sourceArtifactPath,
      error: intentRun.run.generationResult.error,
    };
  }

  const receipt = getReceipt(intentRun.run);
  const opportunity = receipt?.plannerDiagnostics?.opportunity?.currentSessionMuscleOpportunity;
  const targetedMuscles = getTargetedMuscles(receipt);

  return {
    intent: intentRun.intent,
    status: "ok",
    totalSets: sumWorkoutSets(intentRun.run),
    exerciseCount: getExerciseCount(intentRun.run),
    primaryPlannedExercises: getPlannedExerciseNames(intentRun.run),
    targetedMuscles,
    unresolvedDeficits: toDeficitRows(
      receipt?.plannerDiagnostics?.outcome?.deficitsAfterClosure,
      opportunity
    ),
    futureCapacityByMuscle: toFutureCapacityRows(targetedMuscles, opportunity),
    closureUsed: receipt?.plannerDiagnostics?.closure.used === true,
    rescueUsed: receipt?.plannerDiagnostics?.rescue?.used === true,
    topTradeoffs: getTradeoffMessages(receipt?.plannerDiagnostics?.outcome?.keyTradeoffs),
    sourceArtifactPath,
  };
}

function getSanitizedIdentity(
  request: SplitSanityAuditRequest,
  identity: WorkoutAuditIdentity
): WorkoutAuditIdentity {
  if (request.sanitizationLevel !== "pii-safe") {
    return identity;
  }

  return {
    userId: "redacted",
  };
}

function getSanitizedRequest(
  request: SplitSanityAuditRequest,
  intents: SessionIntent[]
): SplitSanityAuditArtifact["request"] {
  if (request.sanitizationLevel !== "pii-safe") {
    return {
      ...request,
      intents,
    };
  }

  return {
    ...request,
    userId: undefined,
    ownerEmail: undefined,
    intents,
  };
}

function buildWeeklyTargetsSnapshot(params: {
  activeMesocycle: SplitSanityAuditRun["activeMesocycle"];
  currentWeek: number | null;
  trackedMuscles: string[];
  lifecycleVolumeTargets?: Record<string, number>;
}): SplitSanityWeeklyTargetSnapshotRow[] {
  if (!params.activeMesocycle || !params.currentWeek) {
    return [];
  }

  const activeMesocycle = params.activeMesocycle;
  const currentWeek = params.currentWeek;

  return params.trackedMuscles
    .map((muscle) => {
      const currentTarget =
        params.lifecycleVolumeTargets?.[muscle] ??
        getWeeklyVolumeTarget(activeMesocycle, muscle, currentWeek);
      const priorTarget =
        currentWeek > 1
          ? getWeeklyVolumeTarget(activeMesocycle, muscle, currentWeek - 1)
          : null;

      return {
        muscle,
        currentTarget,
        priorTarget,
        deltaVsPrior: priorTarget == null ? null : currentTarget - priorTarget,
      };
    })
    .sort((left, right) => left.muscle.localeCompare(right.muscle));
}

function buildStrandedDeficits(intentSummaries: SplitSanityIntentSummary[]): SplitSanityStrandedDeficit[] {
  return intentSummaries
    .flatMap((summary) =>
      summary.unresolvedDeficits.flatMap((deficit) => {
        if (
          deficit.remainingDeficit < SPLIT_SANITY_THRESHOLDS.strandedDeficitMinSets ||
          deficit.futureCapacity == null ||
          deficit.requiredNow == null ||
          deficit.futureCapacity > 0 ||
          deficit.requiredNow <= 0
        ) {
          return [];
        }

        return [
          {
            intent: summary.intent,
            muscle: deficit.muscle,
            remainingDeficit: deficit.remainingDeficit,
            futureCapacity: deficit.futureCapacity,
            requiredNow: deficit.requiredNow,
          },
        ];
      })
    )
    .sort((left, right) => right.remainingDeficit - left.remainingDeficit);
}

function buildChecks(params: {
  run: SplitSanityAuditRun;
  intentSummaries: SplitSanityIntentSummary[];
  strandedDeficits: SplitSanityStrandedDeficit[];
  trackedMuscles: string[];
}): SplitSanityCheck[] {
  const successfulReceipts = params.run.intentRuns
    .map((intentRun) => getReceipt(intentRun.run))
    .filter((receipt): receipt is SessionDecisionReceipt => Boolean(receipt));
  const firstReceipt = successfulReceipts[0];
  const currentWeek = firstReceipt?.cycleContext.weekInMeso ?? params.run.phaseContext.weekInMeso ?? null;
  const blockType = firstReceipt?.cycleContext.blockType ?? params.run.phaseContext.profile.blockType ?? null;

  const generationErrors = params.intentSummaries.filter((summary) => summary.status === "error");
  const allGeneratedCheck: SplitSanityCheck =
    generationErrors.length === 0
      ? {
          code: "all_intents_generated",
          status: "pass",
          message: `Generated ${params.run.intents.length}/${params.run.intents.length} requested intents.`,
        }
      : {
          code: "all_intents_generated",
          status: "fail",
          message: `Generation failed for ${generationErrors.map((summary) => summary.intent).join(", ")}.`,
          details: {
            errors: generationErrors.map((summary) => ({
              intent: summary.intent,
              error: summary.error,
            })),
          },
        };

  const cycleContextPresent =
    currentWeek != null &&
    blockType != null &&
    firstReceipt?.cycleContext.weekInBlock != null;
  const cycleContextPresentCheck: SplitSanityCheck = cycleContextPresent
    ? {
        code: "cycle_context_present",
        status: "pass",
        message: `Cycle context resolved to ${blockType} week ${currentWeek} (block week ${firstReceipt?.cycleContext.weekInBlock}).`,
      }
    : {
        code: "cycle_context_present",
        status: "fail",
        message: "Current block/week context is missing from the bundled audit runs.",
      };

  const mismatchedContexts = successfulReceipts
    .filter(
      (receipt) =>
        receipt.cycleContext.weekInMeso !== firstReceipt?.cycleContext.weekInMeso ||
        receipt.cycleContext.weekInBlock !== firstReceipt?.cycleContext.weekInBlock ||
        receipt.cycleContext.blockType !== firstReceipt?.cycleContext.blockType
    )
    .map((receipt) => receipt.cycleContext);
  const cycleContextConsistentCheck: SplitSanityCheck =
    mismatchedContexts.length === 0
      ? {
          code: "cycle_context_consistent",
          status: "pass",
          message: "All successful intent previews agree on the active block/week context.",
        }
      : {
          code: "cycle_context_consistent",
          status: "fail",
          message: "Intent previews disagree on the active block/week context.",
          details: {
            mismatchedContexts,
          },
        };

  let lifecycleRirCheck: SplitSanityCheck;
  if (!params.run.activeMesocycle || !currentWeek || !firstReceipt?.lifecycleRirTarget) {
    lifecycleRirCheck = {
      code: "lifecycle_rir_matches_block_profile",
      status: "fail",
      message: "Unable to verify lifecycle RIR target against the active block profile.",
    };
  } else {
    const expected = getRirTarget(
      params.run.activeMesocycle,
      currentWeek,
      params.run.phaseContext.profile
    );
    const actual = firstReceipt.lifecycleRirTarget;
    lifecycleRirCheck =
      expected.min === actual.min && expected.max === actual.max
        ? {
            code: "lifecycle_rir_matches_block_profile",
            status: "pass",
            message: `Lifecycle RIR target matches the canonical ${blockType} profile (${actual.min}-${actual.max}).`,
          }
        : {
            code: "lifecycle_rir_matches_block_profile",
            status: "fail",
            message: `Lifecycle RIR target ${actual.min}-${actual.max} does not match expected ${expected.min}-${expected.max}.`,
            details: {
              actual,
              expected,
            },
          };
  }

  let accumulationTargetCheck: SplitSanityCheck;
  if (!params.run.activeMesocycle || !currentWeek || blockType !== "accumulation") {
    accumulationTargetCheck = {
      code: "accumulation_targets_do_not_drop",
      status: "warn",
      message: "Accumulation target-drop check skipped outside an accumulation block.",
    };
  } else if (currentWeek <= 1) {
    accumulationTargetCheck = {
      code: "accumulation_targets_do_not_drop",
      status: "warn",
      message: "Accumulation target-drop check skipped for mesocycle week 1.",
    };
  } else {
    const droppedTargets = buildWeeklyTargetsSnapshot({
      activeMesocycle: params.run.activeMesocycle,
      currentWeek,
      trackedMuscles: params.trackedMuscles,
      lifecycleVolumeTargets: firstReceipt?.lifecycleVolume.targets,
    }).filter((row) => row.priorTarget != null && row.currentTarget < row.priorTarget);
    accumulationTargetCheck =
      droppedTargets.length === 0
        ? {
            code: "accumulation_targets_do_not_drop",
            status: "pass",
            message: "Tracked weekly targets did not drop versus the prior week in accumulation.",
          }
        : {
            code: "accumulation_targets_do_not_drop",
            status: "fail",
            message: "Tracked weekly targets dropped versus the prior week during accumulation.",
            details: {
              droppedTargets,
            },
          };
  }

  const strandedDeficitCheck: SplitSanityCheck =
    params.strandedDeficits.length === 0
      ? {
          code: "no_stranded_zero_capacity_deficits",
          status: "pass",
          message: "No same-intent deficits require week-close fallback after future capacity is exhausted.",
        }
      : {
          code: "no_stranded_zero_capacity_deficits",
          status: "warn",
          message:
            "Same-intent future capacity is exhausted for some muscles; unresolved deficits will rely on canonical week-close / optional gap-fill handling.",
          details: {
            strandedDeficits: params.strandedDeficits,
            threshold: SPLIT_SANITY_THRESHOLDS.strandedDeficitMinSets,
          },
        };

  const rescueUsed = params.intentSummaries
    .filter((summary) => summary.rescueUsed)
    .map((summary) => summary.intent);
  const rescueCheck: SplitSanityCheck =
    rescueUsed.length === 0
      ? {
          code: "rescue_not_used",
          status: "pass",
          message: "No bundled intent preview required rescue inventory.",
        }
      : {
          code: "rescue_not_used",
          status: "fail",
          message: `Rescue inventory was used for ${rescueUsed.join(", ")}.`,
          details: {
            intents: rescueUsed,
          },
        };

  return [
    allGeneratedCheck,
    cycleContextPresentCheck,
    cycleContextConsistentCheck,
    lifecycleRirCheck,
    accumulationTargetCheck,
    strandedDeficitCheck,
    rescueCheck,
  ];
}

function buildWarnings(checks: SplitSanityCheck[]): string[] {
  return checks
    .filter((check) => check.status === "warn")
    .map((check) => `${check.code}: ${check.message}`);
}

function buildSplitSanityWarningSummary(params: {
  checks: SplitSanityCheck[];
  suspiciousPatterns: string[];
}): AuditWarningSummary {
  return {
    blockingErrors: params.checks
      .filter((check) => check.status === "fail")
      .map((check) => `${check.code}: ${check.message}`),
    semanticWarnings: params.checks
      .filter((check) => check.status === "warn")
      .map((check) => `${check.code}: ${check.message}`),
    backgroundWarnings: params.suspiciousPatterns.filter(
      (pattern) => !params.checks.some((check) => `${check.code}: ${check.message}` === pattern)
    ),
  };
}

function buildSuspiciousPatterns(params: {
  intentSummaries: SplitSanityIntentSummary[];
  strandedDeficits: SplitSanityStrandedDeficit[];
  checks: SplitSanityCheck[];
}): string[] {
  const errors = params.intentSummaries
    .filter((summary) => summary.status === "error")
    .map((summary) => `${summary.intent} generation failed: ${summary.error}`);
  const stranded = params.strandedDeficits.map(
    (deficit) =>
      `${deficit.intent}:${deficit.muscle} still needs ${deficit.remainingDeficit} sets with futureCapacity=0`
  );
  const failedChecks = params.checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.code}: ${check.message}`);

  return Array.from(new Set([...errors, ...stranded, ...failedChecks]));
}

function buildMesocycleContext(
  run: SplitSanityAuditRun,
  firstReceipt: SessionDecisionReceipt | undefined
): SplitSanityMesocycleContext {
  return {
    mesocycleId: run.activeMesocycle?.id ?? null,
    mesoNumber: run.activeMesocycle?.mesoNumber ?? null,
    focus: run.activeMesocycle?.focus ?? null,
    splitType: run.activeMesocycle?.splitType ?? null,
    state: run.activeMesocycle?.state ?? null,
    mesocycleWeek: firstReceipt?.cycleContext.weekInMeso ?? run.phaseContext.weekInMeso ?? null,
    blockType: firstReceipt?.cycleContext.blockType ?? run.phaseContext.profile.blockType ?? null,
    weekInBlock: firstReceipt?.cycleContext.weekInBlock ?? run.phaseContext.weekInBlock ?? null,
    blockDurationWeeks: run.phaseContext.profile.blockDurationWeeks ?? null,
    lifecycleRirTarget: firstReceipt?.lifecycleRirTarget ?? null,
  };
}

export async function runSplitSanityAudit(
  request: SplitSanityAuditRequest
): Promise<SplitSanityAuditRun> {
  const identity = await resolveWorkoutAuditIdentity(request);
  const intents = getIntents(request);
  const generatedAt = new Date().toISOString();
  const activeMesocycle = await loadActiveMesocycle(identity.userId);
  const phaseContext = await loadGenerationPhaseBlockContext(identity.userId, {
    activeMesocycle,
  });

  const intentRuns: SplitSanityIntentRun[] = [];
  for (const intent of intents) {
    const workoutRequest: WorkoutAuditRequest = {
      mode: "intent-preview",
      userId: identity.userId,
      ownerEmail: identity.ownerEmail,
      intent,
      plannerDiagnosticsMode: request.plannerDiagnosticsMode ?? "standard",
      sanitizationLevel: request.sanitizationLevel ?? "none",
    };
    const context = await buildWorkoutAuditContext(workoutRequest);
    const run = await runWorkoutAuditGeneration(context);
    intentRuns.push({ intent, request: workoutRequest, run });
  }

  return {
    generatedAt,
    identity,
    intents,
    intentRuns,
    activeMesocycle,
    phaseContext,
  };
}

export function buildSplitSanityAuditArtifact(params: {
  request: SplitSanityAuditRequest;
  run: SplitSanityAuditRun;
  richArtifactPaths?: Partial<Record<SessionIntent, string>>;
}): SplitSanityAuditArtifact {
  const firstReceipt = params.run.intentRuns
    .map((intentRun) => getReceipt(intentRun.run))
    .find((receipt): receipt is SessionDecisionReceipt => Boolean(receipt));

  const intentSummaries = params.run.intentRuns.map((intentRun) =>
    buildIntentSummary(intentRun, params.richArtifactPaths?.[intentRun.intent])
  );
  const trackedMuscles = Array.from(
    new Set(
      intentSummaries.flatMap((summary) => [
        ...summary.targetedMuscles,
        ...summary.unresolvedDeficits.map((deficit) => deficit.muscle),
      ])
    )
  ).sort((left, right) => left.localeCompare(right));
  const strandedDeficits = buildStrandedDeficits(intentSummaries);
  const checks = buildChecks({
    run: params.run,
    intentSummaries,
    strandedDeficits,
    trackedMuscles,
  });
  const failedChecks = checks
    .filter((check) => check.status === "fail")
    .map((check) => check.code);
  const warnings = buildWarnings(checks);
  const suspiciousPatterns = buildSuspiciousPatterns({
    intentSummaries,
    strandedDeficits,
    checks,
  });

  return {
    version: 1,
    auditType: "split-sanity",
    generatedAt: params.run.generatedAt,
    source: params.request.sanitizationLevel === "pii-safe" ? "pii-safe" : "live",
    conclusions: WORKOUT_AUDIT_CONCLUSIONS,
    identity: getSanitizedIdentity(params.request, params.run.identity),
    request: getSanitizedRequest(params.request, params.run.intents),
    thresholds: SPLIT_SANITY_THRESHOLDS,
    mesocycleContext: buildMesocycleContext(params.run, firstReceipt),
    overallVerdict: failedChecks.length === 0 ? "pass" : "fail",
    failedChecks,
    warnings,
    warningSummary: buildSplitSanityWarningSummary({
      checks,
      suspiciousPatterns,
    }),
    suspiciousPatterns,
    verdictChecks: checks,
    plannedTotalsByIntent: intentSummaries.map((summary) => ({
      intent: summary.intent,
      totalSets: summary.totalSets,
      exerciseCount: summary.exerciseCount,
    })),
    weeklyTargetsSnapshot: buildWeeklyTargetsSnapshot({
      activeMesocycle: params.run.activeMesocycle,
      currentWeek: firstReceipt?.cycleContext.weekInMeso ?? params.run.phaseContext.weekInMeso ?? null,
      trackedMuscles,
      lifecycleVolumeTargets: firstReceipt?.lifecycleVolume.targets,
    }),
    intentSummaries,
    strandedDeficits,
  };
}

export async function writeSplitSanityAuditArtifacts(params: {
  request: SplitSanityAuditRequest;
  outputDir?: string;
  writeRichArtifacts?: boolean;
}): Promise<SplitSanityWriteResult> {
  const run = await runSplitSanityAudit(params.request);
  const outputDir = params.outputDir ?? path.join(process.cwd(), "artifacts", "audits", "split-sanity");
  const timestamp = run.generatedAt.replace(/[:.]/g, "-");
  const ownerSlug =
    params.request.sanitizationLevel === "pii-safe"
      ? "redacted"
      : slug(run.identity.ownerEmail ?? run.identity.userId);
  const richArtifactPaths: Partial<Record<SessionIntent, string>> = {};

  await mkdir(outputDir, { recursive: true });

  if (params.writeRichArtifacts) {
    const richOutputDir = path.join(outputDir, "rich");
    await mkdir(richOutputDir, { recursive: true });

    for (const intentRun of run.intentRuns) {
      const fileName = `${timestamp}-${ownerSlug}-intent-preview-${slug(intentRun.intent)}.json`;
      const outputPath = path.join(richOutputDir, fileName);
      const artifact = buildWorkoutAuditArtifact(intentRun.request, intentRun.run);
      await writeFile(outputPath, serializeWorkoutAuditArtifact(artifact), "utf8");
      richArtifactPaths[intentRun.intent] = outputPath;
    }
  }

  const artifact = buildSplitSanityAuditArtifact({
    request: params.request,
    run,
    richArtifactPaths,
  });
  const summaryPath = path.join(outputDir, `${timestamp}-${ownerSlug}-split-sanity.json`);
  await writeFile(summaryPath, serializeSplitSanityAuditArtifact(artifact), "utf8");

  return {
    artifact,
    summaryPath,
    richArtifactPaths,
  };
}
