import type { SessionGenerationResult } from "@/lib/api/template-session/types";
import {
  PRE_SESSION_READINESS_CONTRACT_OWNER_SEAM,
  type PreSessionReadinessCoachingRecommendation,
  type PreSessionReadinessConsistencyCheck,
  type PreSessionReadinessContract,
  type PreSessionReadinessPrescriptionConfidenceWatchRow,
} from "./pre-session-readiness-contract";
import type {
  PreSessionReadinessContractBuildInput,
  PreSessionReadinessEvidence,
  PreSessionReadinessProjectedWeekEvidence,
} from "./pre-session-readiness-evidence";
import type { NextWorkoutContext } from "@/lib/api/next-session";
import type { AcceptedMesocycleSeedProvenanceConsistency } from "@/lib/api/accepted-mesocycle-seed-provenance";
import type { SessionAuditSnapshot } from "@/lib/evidence/session-audit-types";

type PreSessionDoseDiagnostic = NonNullable<
  PreSessionReadinessProjectedWeekEvidence["runtimeDoseAdjustmentDiagnostics"]
>[number];
type ProjectedWeekMuscleRow =
  PreSessionReadinessProjectedWeekEvidence["fullWeekByMuscle"][number];
type ProjectedWeekSession =
  PreSessionReadinessProjectedWeekEvidence["projectedSessions"][number];

const UPPER_BODY_MUSCLES = new Set([
  "Chest",
  "Lats",
  "Upper Back",
  "Side Delts",
  "Rear Delts",
  "Biceps",
  "Triceps",
]);
const LOWER_BODY_MUSCLES = new Set([
  "Quads",
  "Hamstrings",
  "Glutes",
  "Calves",
  "Adductors",
  "Abductors",
  "Lower Back",
]);
const TARGET_TIER_MEANINGFUL = new Set(["A_PRIMARY", "B_SUPPORT"]);
const MAX_BOUNDED_TOP_UP_RAW_SETS = 5;
const FLOOR_BUFFER_MARGIN_SETS = 1;
const ALREADY_COVERED_NEXT_SESSION_SETS = 4;

function formatAuditDecimal(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function getMuscleRegion(muscle: string): "upper" | "lower" | null {
  if (UPPER_BODY_MUSCLES.has(muscle)) {
    return "upper";
  }
  if (LOWER_BODY_MUSCLES.has(muscle)) {
    return "lower";
  }
  return null;
}

function sessionMatchesRegion(
  session: ProjectedWeekSession | undefined,
  region: "upper" | "lower"
): boolean {
  if (!session) {
    return false;
  }
  const label = `${session.slotId ?? ""} ${session.intent ?? ""}`.toLowerCase();
  if (label.includes("full_body")) {
    return true;
  }
  if (region === "upper") {
    return (
      label.includes("upper") ||
      label.includes("push") ||
      label.includes("pull")
    );
  }
  return label.includes("lower") || label.includes("legs");
}

function isFinalPracticalOpportunity(input: {
  muscle: string;
  nextSession: ProjectedWeekSession | undefined;
  projectedSessions: PreSessionReadinessProjectedWeekEvidence["projectedSessions"];
}): boolean {
  const region = getMuscleRegion(input.muscle);
  if (!region || !sessionMatchesRegion(input.nextSession, region)) {
    return false;
  }

  const nextIndex = input.projectedSessions.findIndex(
    (session) => session === input.nextSession
  );
  const remainingSessions =
    nextIndex >= 0
      ? input.projectedSessions.slice(nextIndex + 1)
      : input.projectedSessions.slice(1);
  return !remainingSessions.some((session) => sessionMatchesRegion(session, region));
}

function getLowFatigueIsolationLabel(input: {
  muscle: string;
  exerciseName?: string;
}): string {
  const exerciseName = input.exerciseName;
  if (input.muscle === "Chest") {
    const normalized = exerciseName?.toLowerCase();
    if (
      normalized?.includes("fly") ||
      normalized?.includes("crossover") ||
      normalized?.includes("pec deck")
    ) {
      return `${exerciseName} or Pec Deck`;
    }
    return "Cable Fly or Pec Deck";
  }
  if (input.muscle === "Triceps") {
    return exerciseName?.toLowerCase().includes("pushdown")
      ? exerciseName
      : "Pushdown";
  }
  if (input.muscle === "Biceps") {
    return exerciseName?.toLowerCase().includes("curl") ? exerciseName : "Curl";
  }
  if (input.muscle === "Side Delts") {
    const normalized = exerciseName?.toLowerCase();
    return normalized?.includes("lateral raise") ||
      normalized?.includes("side raise")
      ? exerciseName ?? "Lateral Raise"
      : "Lateral Raise";
  }
  if (input.muscle === "Rear Delts") {
    return exerciseName?.toLowerCase().includes("rear delt")
      ? exerciseName
      : "Rear Delt Fly";
  }
  if (input.muscle === "Calves") {
    const normalized = exerciseName?.toLowerCase();
    if (normalized?.includes("seated calf")) {
      return `${exerciseName} or equivalent Standing Calf Raise`;
    }
    if (normalized?.includes("standing calf")) {
      return `${exerciseName} or equivalent Seated Calf Raise`;
    }
    return exerciseName?.toLowerCase().includes("calf")
      ? `${exerciseName} or equivalent Calf Raise`
      : "Calf Raise";
  }
  return exerciseName ?? "low-fatigue isolation";
}

function findLowFatigueIsolationExercise(input: {
  muscle: string;
  nextSession: ProjectedWeekSession | undefined;
}): string | undefined {
  const exercises = input.nextSession?.exercises ?? [];
  const matches = (tokens: string[]) =>
    exercises.find((exercise) => {
      const normalized = exercise.name.toLowerCase();
      return tokens.some((token) => normalized.includes(token));
    })?.name;

  if (input.muscle === "Chest") {
    return matches(["crossover", "fly", "pec deck"]);
  }
  if (input.muscle === "Triceps") {
    return matches(["pushdown", "extension"]);
  }
  if (input.muscle === "Biceps") {
    return matches(["curl"]);
  }
  if (input.muscle === "Side Delts") {
    return matches(["lateral raise", "side raise"]);
  }
  if (input.muscle === "Rear Delts") {
    return matches(["rear delt", "reverse pec", "face pull"]);
  }
  if (input.muscle === "Calves") {
    return matches(["calf"]);
  }
  return undefined;
}

function getDoseClosureAddonCaveat(muscle: string): string {
  if (muscle === "Calves") {
    return "if calves/Achilles/feet feel good";
  }
  if (muscle === "Triceps") {
    return "if readiness/time/elbows are good";
  }
  return "if readiness/time allow";
}

function getSuppressionAction(muscle: string): string {
  if (muscle === "Biceps") {
    return "no extra curls";
  }
  if (muscle === "Side Delts") {
    return "no extra lateral raises";
  }
  if (muscle === "Rear Delts") {
    return "no extra rear-delt work";
  }
  if (muscle === "Lats") {
    return "no extra pulldowns";
  }
  if (muscle === "Upper Back") {
    return "no extra rows";
  }
  return "seed only";
}

function formatMevProjection(input: {
  effectiveSets: number;
  mev: number;
}): string {
  return `projected ${formatAuditDecimal(input.effectiveSets)} / MEV ${formatAuditDecimal(input.mev)}`;
}

function formatWeightedSetGap(value: number): string {
  return `${formatAuditDecimal(Math.max(0, value))} weighted sets`;
}

function formatRawSetCount(value: number): string {
  return `${value} raw ${value === 1 ? "set" : "sets"}`;
}

function getCandidateContributionEstimate(input: {
  muscle: string;
  diagnostic: PreSessionDoseDiagnostic | undefined;
  nextSession: ProjectedWeekSession | undefined;
}): { exerciseName: string; weightedSetsPerRawSet: number } | null {
  const exerciseName = input.diagnostic?.recommendedAction.exerciseName;
  if (!exerciseName || !input.nextSession?.exercises?.length) {
    return null;
  }

  const normalizedExerciseName = exerciseName.toLowerCase();
  const exercise = input.nextSession.exercises.find(
    (candidate) => candidate.name.toLowerCase() === normalizedExerciseName
  );
  if (!exercise || exercise.setCount <= 0) {
    return null;
  }

  const weightedSets = exercise.effectiveStimulusByMuscle?.[input.muscle];
  if (typeof weightedSets !== "number" || !Number.isFinite(weightedSets) || weightedSets <= 0) {
    return null;
  }

  return {
    exerciseName: exercise.name,
    weightedSetsPerRawSet: Math.round((weightedSets / exercise.setCount) * 10) / 10,
  };
}

function hasMismatchedCandidate(input: {
  muscle: string;
  diagnostic: PreSessionDoseDiagnostic | undefined;
  nextSession: ProjectedWeekSession | undefined;
}): boolean {
  const exerciseName = input.diagnostic?.recommendedAction.exerciseName;
  if (!exerciseName || !input.nextSession?.exercises?.length) {
    return false;
  }
  const exercise = input.nextSession.exercises.find(
    (candidate) => candidate.name.toLowerCase() === exerciseName.toLowerCase()
  );
  if (!exercise) {
    return false;
  }
  return (exercise.effectiveStimulusByMuscle?.[input.muscle] ?? 0) <= 0;
}

function formatContributionEstimate(input: {
  muscle: string;
  estimate: { exerciseName: string; weightedSetsPerRawSet: number } | null;
}): string {
  if (!input.estimate) {
    return "Estimated contribution unavailable; raw set recommendation may reduce but not guarantee MEV closure.";
  }
  return `Estimated contribution: ~${formatAuditDecimal(input.estimate.weightedSetsPerRawSet)} weighted ${input.muscle} sets per raw ${input.estimate.exerciseName} set.`;
}

function buildPriorityRecommendation(input: {
  row: ProjectedWeekMuscleRow;
  diagnostic: PreSessionDoseDiagnostic | undefined;
  nextSession: ProjectedWeekSession | undefined;
  isolation: string;
}): PreSessionReadinessCoachingRecommendation {
  const weightedGap = Math.max(0, input.row.mev - input.row.projectedFullWeekEffectiveSets);
  const projection = formatMevProjection({
    effectiveSets: input.row.projectedFullWeekEffectiveSets,
    mev: input.row.mev,
  });
  const estimate = getCandidateContributionEstimate({
    muscle: input.row.muscle,
    diagnostic: input.diagnostic,
    nextSession: input.nextSession,
  });
  const base = `- ${input.row.muscle}: ${projection}; gap ${formatWeightedSetGap(weightedGap)}. Candidate: ${input.isolation}. ${formatContributionEstimate({ muscle: input.row.muscle, estimate })}`;

  if (!estimate) {
    return {
      kind: "priority",
      muscle: input.row.muscle,
      targetMuscle: input.row.muscle,
      candidateExerciseName: input.isolation,
      line: `${base} Recommended: +1-2 raw low-fatigue ${input.row.muscle} isolation sets if readiness/time allow. Expected outcome: reduce deficit but may still miss MEV. Guardrail: accept the miss if full closure would require too much volume today; do not chase full target or add pressing.`,
      addonLine: `- Add +1-2 raw low-fatigue ${input.row.muscle} isolation sets ${getDoseClosureAddonCaveat(input.row.muscle)}.`,
      suppressed: false,
      suppressionReasons: [],
    };
  }

  const rawSetsNeeded = Math.ceil(weightedGap / estimate.weightedSetsPerRawSet);
  const oneToTwoRawSetsLikelyCloses =
    estimate.weightedSetsPerRawSet * 2 >= weightedGap;
  const oneToTwoNote = oneToTwoRawSetsLikelyCloses
    ? ""
    : " A +1-2 raw add-on is expected to reduce the deficit, not fully close MEV.";

  if (rawSetsNeeded > MAX_BOUNDED_TOP_UP_RAW_SETS) {
    return {
      kind: "priority",
      muscle: input.row.muscle,
      targetMuscle: input.row.muscle,
      candidateExerciseName: input.isolation,
      line: `${base} Closing would require about ${formatRawSetCount(rawSetsNeeded)}, above the bounded top-up cap. Recommended: +2-${MAX_BOUNDED_TOP_UP_RAW_SETS} raw low-fatigue isolation sets only if readiness/time allow. Expected outcome: reduce deficit but may still miss MEV; accept the miss rather than chase volume today. Guardrail: do not chase full target or add pressing.`,
      addonLine: `- Add +2-${MAX_BOUNDED_TOP_UP_RAW_SETS} raw sets of ${input.isolation} ${getDoseClosureAddonCaveat(input.row.muscle)}; accept the miss rather than chase more volume today.`,
      suppressed: false,
      suppressionReasons: [],
    };
  }

  return {
    kind: "priority",
    muscle: input.row.muscle,
    targetMuscle: input.row.muscle,
    candidateExerciseName: input.isolation,
    line: `${base} Recommended: +${rawSetsNeeded} raw low-fatigue isolation ${rawSetsNeeded === 1 ? "set" : "sets"} if readiness/time allow. Expected outcome: likely closes MEV floor.${oneToTwoNote} Guardrail: do not chase full target or add pressing.`,
    addonLine: `- Add +${rawSetsNeeded} raw ${rawSetsNeeded === 1 ? "set" : "sets"} of ${input.isolation} ${getDoseClosureAddonCaveat(input.row.muscle)}.`,
    suppressed: false,
    suppressionReasons: [],
  };
}

function buildOptionalRecommendation(input: {
  row: ProjectedWeekMuscleRow;
  isolation: string;
}): PreSessionReadinessCoachingRecommendation {
  const weightedGap = Math.max(0, input.row.mev - input.row.projectedFullWeekEffectiveSets);
  const projection = formatMevProjection({
    effectiveSets: input.row.projectedFullWeekEffectiveSets,
    mev: input.row.mev,
  });
  return {
    kind: "optional",
    muscle: input.row.muscle,
    targetMuscle: input.row.muscle,
    candidateExerciseName: input.isolation,
    line: `- ${input.row.muscle}: ${projection}; gap ${formatWeightedSetGap(weightedGap)}. Optional +1 ${input.isolation} ${getDoseClosureAddonCaveat(input.row.muscle)}. Expected outcome: close or reduce tiny MEV gap; low-fatigue isolation only.`,
    addonLine: `- Add +1 ${input.isolation} ${getDoseClosureAddonCaveat(input.row.muscle)}.`,
    suppressed: false,
    suppressionReasons: [],
  };
}

function buildFloorBufferRecommendation(input: {
  row: ProjectedWeekMuscleRow;
  isolation: string;
}): PreSessionReadinessCoachingRecommendation {
  const projection = formatMevProjection({
    effectiveSets: input.row.projectedFullWeekEffectiveSets,
    mev: input.row.mev,
  });
  const margin = Math.max(
    0,
    input.row.projectedFullWeekEffectiveSets - input.row.mev
  );
  return {
    kind: "floor_buffer",
    muscle: input.row.muscle,
    targetMuscle: input.row.muscle,
    candidateExerciseName: input.isolation,
    line: `- ${input.row.muscle}: ${projection}; floor margin ${formatWeightedSetGap(margin)}. Optional +1 ${input.isolation} ${getDoseClosureAddonCaveat(input.row.muscle)} as a session-local buffer only. Expected outcome: add a thin MEV cushion without changing the accepted seed; low-fatigue isolation only.`,
    addonLine: `- Optional session-local +1 ${input.isolation} ${getDoseClosureAddonCaveat(input.row.muscle)} for floor buffer only.`,
    suppressed: false,
    suppressionReasons: [],
  };
}

function isMeaningfulFatigueOrReadinessLimited(
  diagnostic: PreSessionDoseDiagnostic | undefined
): boolean {
  return (
    diagnostic?.fatigueDensityConcern.level === "meaningful" ||
    diagnostic?.fatigueDensityConcern.level === "high" ||
    diagnostic?.recoveryReadinessCaveat.status === "local_soreness" ||
    diagnostic?.recoveryReadinessCaveat.status === "low_overall_readiness" ||
    diagnostic?.recoveryReadinessCaveat.status === "pain_or_fatigue_flag"
  );
}

function shouldOfferFloorBuffer(input: {
  row: ProjectedWeekMuscleRow;
  diagnostic: PreSessionDoseDiagnostic | undefined;
  nextSession: ProjectedWeekSession | undefined;
  projectedSessions: PreSessionReadinessProjectedWeekEvidence["projectedSessions"];
}): boolean {
  const margin = input.row.projectedFullWeekEffectiveSets - input.row.mev;
  const nextContribution =
    input.nextSession?.projectedContributionByMuscle[input.row.muscle] ?? 0;
  const finalOpportunity = isFinalPracticalOpportunity({
    muscle: input.row.muscle,
    nextSession: input.nextSession,
    projectedSessions: input.projectedSessions,
  });

  return (
    input.row.mev > 0 &&
    margin >= 0 &&
    margin <= FLOOR_BUFFER_MARGIN_SETS &&
    finalOpportunity &&
    nextContribution > 0 &&
    nextContribution <= ALREADY_COVERED_NEXT_SESSION_SETS &&
    input.row.deltaToMav < -FLOOR_BUFFER_MARGIN_SETS &&
    !isMeaningfulFatigueOrReadinessLimited(input.diagnostic)
  );
}

function buildSuppressedMuscles(
  diagnostics: PreSessionDoseDiagnostic[]
): Set<string> {
  return new Set(
    diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.targetStatus === "near_mav" ||
          diagnostic.targetStatus === "over_mav" ||
          diagnostic.fatigueDensityConcern.level === "meaningful" ||
          diagnostic.fatigueDensityConcern.level === "high" ||
          diagnostic.recoveryReadinessCaveat.status === "local_soreness" ||
          diagnostic.recoveryReadinessCaveat.status === "low_overall_readiness" ||
          diagnostic.recoveryReadinessCaveat.status === "pain_or_fatigue_flag"
      )
      .map((diagnostic) => diagnostic.muscle)
  );
}

function buildDoseClosure(input: {
  isActiveDeload: boolean;
  diagnostics: PreSessionDoseDiagnostic[];
  fullWeekRows: PreSessionReadinessProjectedWeekEvidence["fullWeekByMuscle"];
  projectedSessions: PreSessionReadinessProjectedWeekEvidence["projectedSessions"];
  nextSession: ProjectedWeekSession | undefined;
}): PreSessionReadinessContract["doseClosure"] {
  if (input.isActiveDeload) {
    return {
      heading: "Dose Closure Guidance (Deload Context)",
      priority: ["- none - deload volume deficits are expected/non-actionable."],
      optional: ["- none"],
      monitor: [],
      suppress: ["- all hypertrophy add-set / MEV closure top-ups during ACTIVE_DELOAD."],
      guardrails: [
        "- run the deload prescription as generated unless a real blocker appears",
        "- no hypertrophy add-ons or MEV closure work during deload",
        "- no seed/runtime/save/progression mutation",
      ],
      recommendations: [],
    };
  }

  const diagnosticByMuscle = new Map(
    input.diagnostics.map((diagnostic) => [diagnostic.muscle, diagnostic])
  );
  const suppressedMuscles = buildSuppressedMuscles(input.diagnostics);
  const relevantRows = input.fullWeekRows
    .filter((row) => TARGET_TIER_MEANINGFUL.has(row.targetTier ?? ""))
    .filter((row) => {
      const region = getMuscleRegion(row.muscle);
      return Boolean(region && sessionMatchesRegion(input.nextSession, region));
    })
    .sort((left, right) => {
      const leftGap = left.mev - left.projectedFullWeekEffectiveSets;
      const rightGap = right.mev - right.projectedFullWeekEffectiveSets;
      return rightGap - leftGap || left.muscle.localeCompare(right.muscle);
    });
  const priority: string[] = [];
  const optional: string[] = [];
  const monitor: string[] = [];
  const suppress: string[] = [];
  const recommendations: PreSessionReadinessCoachingRecommendation[] = [];

  for (const row of relevantRows) {
    const diagnostic = diagnosticByMuscle.get(row.muscle);
    const mevGap = row.mev - row.projectedFullWeekEffectiveSets;
    const finalOpportunity = isFinalPracticalOpportunity({
      muscle: row.muscle,
      nextSession: input.nextSession,
      projectedSessions: input.projectedSessions,
    });
    const projection = formatMevProjection({
      effectiveSets: row.projectedFullWeekEffectiveSets,
      mev: row.mev,
    });

    if (mevGap > 0) {
      if (!finalOpportunity) {
        const region = getMuscleRegion(row.muscle);
        monitor.push(
          `- ${row.muscle}: ${projection}. Below MEV, but another practical ${region ?? "training"} opportunity remains; monitor after the seed.`
        );
        continue;
      }

      if (
        diagnostic?.recommendedAction.setDelta === 0 ||
        diagnostic?.reasonCode === "no_candidate_hold_seed"
      ) {
        monitor.push(
          `- ${row.muscle}: ${projection}. Below MEV, but runtime dose evidence has no safe matching add-on candidate; hold seed.`
        );
        continue;
      }

      if (
        hasMismatchedCandidate({
          muscle: row.muscle,
          diagnostic,
          nextSession: input.nextSession,
        })
      ) {
        const candidate = diagnostic?.recommendedAction.exerciseName ?? "unknown";
        suppress.push(
          `- ${row.muscle}: add-on candidate ${candidate} does not match the flagged muscle need; hold seed.`
        );
        recommendations.push({
          kind: mevGap <= 1.25 ? "optional" : "priority",
          muscle: row.muscle,
          targetMuscle: row.muscle,
          candidateExerciseName: candidate,
          line: `- ${row.muscle}: suppressed mismatched optional add-on candidate ${candidate}.`,
          addonLine: `- none - ${row.muscle} add-on suppressed because candidate ${candidate} does not target ${row.muscle}.`,
          suppressed: true,
          suppressionReasons: ["candidate_muscle_mismatch"],
        });
        continue;
      }

      const isolation = getLowFatigueIsolationLabel({
        muscle: row.muscle,
        exerciseName: diagnostic?.recommendedAction.exerciseName,
      });
      const recommendation =
        mevGap <= 1.25
          ? buildOptionalRecommendation({ row, isolation })
          : buildPriorityRecommendation({
              row,
              diagnostic,
              nextSession: input.nextSession,
              isolation,
            });
      if (suppressedMuscles.has(recommendation.muscle)) {
        recommendation.suppressed = true;
        recommendation.suppressionReasons.push("target_muscle_suppressed");
        suppress.push(
          `- ${recommendation.muscle}: optional add-on suppressed because this muscle is in suppress/avoid guidance.`
        );
      } else if (recommendation.kind === "priority") {
        priority.push(recommendation.line);
      } else {
        optional.push(recommendation.line);
      }
      recommendations.push(recommendation);
      continue;
    }

    if (
      shouldOfferFloorBuffer({
        row,
        diagnostic,
        nextSession: input.nextSession,
        projectedSessions: input.projectedSessions,
      })
    ) {
      const isolation = getLowFatigueIsolationLabel({
        muscle: row.muscle,
        exerciseName:
          findLowFatigueIsolationExercise({
            muscle: row.muscle,
            nextSession: input.nextSession,
          }) ?? diagnostic?.recommendedAction.exerciseName,
      });
      const recommendation = buildFloorBufferRecommendation({ row, isolation });
      if (suppressedMuscles.has(recommendation.muscle)) {
        recommendation.suppressed = true;
        recommendation.suppressionReasons.push("target_muscle_suppressed");
        suppress.push(
          `- ${recommendation.muscle}: optional floor-buffer add-on suppressed because this muscle is in suppress/avoid guidance.`
        );
      } else {
        optional.push(recommendation.line);
      }
      recommendations.push(recommendation);
      continue;
    }

    const relation =
      row.projectedFullWeekEffectiveSets === row.mev
        ? "at MEV after seed"
        : "projected above MEV after seed";
    suppress.push(`- ${row.muscle}: ${relation}; ${getSuppressionAction(row.muscle)}.`);
  }

  return {
    heading: "Dose Closure Guidance",
    priority: priority.length > 0 ? priority : ["- none"],
    optional: optional.length > 0 ? optional : ["- none"],
    monitor,
    suppress: suppress.length > 0 ? suppress.slice(0, 8) : ["- none"],
    guardrails: [
      "- session-local only; no seed/runtime/save/progression mutation",
      "- do not add extra pressing",
      "- do not add extra rows/pulldowns",
      "- do not chase full target deficit",
      "- avoid exceeding MAV/MRV; accept the miss if closure requires excessive raw volume",
    ],
    recommendations,
  };
}

function formatDoseAction(
  action: PreSessionDoseDiagnostic["recommendedAction"],
  diagnostic?: PreSessionDoseDiagnostic
): string {
  if (action.kind === "hold_seed") {
    if (
      diagnostic?.targetStatus === "below_preferred" ||
      diagnostic?.targetStatus === "stretch_miss"
    ) {
      return "monitor, no default add-on";
    }
    if (diagnostic?.targetStatus === "near_mav") {
      return "hold seed; near MAV cap";
    }
    if (diagnostic?.targetStatus === "over_mav") {
      return "hold seed; over MAV caution";
    }
    if (diagnostic?.reasonCode === "no_candidate_hold_seed") {
      return "hold seed; no viable add-on";
    }
    return "hold seed";
  }
  if (action.kind === "optional_add_set") {
    return `optional +1 ${action.exerciseName ?? "set"}`;
  }
  if (action.kind === "add_set") {
    return `consider +1 ${action.exerciseName ?? "set"}`;
  }
  if (action.kind === "reduce_set_if_fatigue_meaningful") {
    return `reduce -1 ${action.exerciseName ?? "set"} if fatigue meaningful`;
  }
  if (action.kind === "avoid_default_reduction") {
    return "avoid default reduction";
  }
  return action.kind;
}

function formatDoseStatus(diagnostic: PreSessionDoseDiagnostic): string {
  const end = diagnostic.projectedEndOfWeekVolume;
  return `${formatAuditDecimal(end.effectiveSets)} vs MEV ${formatAuditDecimal(end.mev)} / target ${formatAuditDecimal(end.weeklyTarget)} / MAV ${formatAuditDecimal(end.mav)}`;
}

function buildProjectedWeekStatus(input: {
  isActiveDeload: boolean;
  projectedWeek: PreSessionReadinessProjectedWeekEvidence | undefined;
  doseDiagnostics: PreSessionDoseDiagnostic[];
  startable: boolean;
  hasAvailableAddOns: boolean;
}): PreSessionReadinessContract["projectedWeekStatus"] {
  const doseGuidanceRows = input.doseDiagnostics.map((diagnostic) => {
    const status = input.isActiveDeload
      ? `deload_non_actionable:${diagnostic.targetStatus}`
      : diagnostic.targetStatus;
    const recommendedAction = input.isActiveDeload
      ? "deload context: non-actionable; do not top up"
      : formatDoseAction(diagnostic.recommendedAction, diagnostic);
    return {
      muscle: diagnostic.muscle,
      projectedVsTargets: formatDoseStatus(diagnostic),
      status,
      recommendedAction,
      confidence: formatAuditDecimal(diagnostic.confidence),
      line: `${diagnostic.muscle} | ${formatDoseStatus(diagnostic)} | ${status} | ${recommendedAction} | ${formatAuditDecimal(diagnostic.confidence)}`,
    };
  });
  const belowMev = input.projectedWeek?.currentWeekAudit?.belowMEV ?? [];
  const overMav = input.projectedWeek?.currentWeekAudit?.overMAV ?? [];
  const fatigueRisks = input.projectedWeek?.currentWeekAudit?.fatigueRisks ?? [];
  const projectionNotes = input.projectedWeek?.projectionNotes ?? [];
  const status = !input.startable
    ? "blocked"
    : input.isActiveDeload
      ? "deload_non_actionable"
      : input.hasAvailableAddOns
        ? "top_up_candidate"
        : belowMev.length > 0 || overMav.length > 0 || fatigueRisks.length > 0
          ? "watch"
          : "no_further_action";

  return {
    status,
    currentWeek: input.projectedWeek?.currentWeek.week ?? null,
    phase: input.projectedWeek?.currentWeek.phase ?? null,
    belowMev,
    overMav,
    fatigueRisks,
    projectionNotes,
    doseGuidanceRows,
    ...(status === "no_further_action"
      ? {
          noAddOnReason:
            "Projected week status is no_further_action; no optional add-ons are recommended.",
        }
      : {}),
  };
}

function buildAvoidList(input: {
  diagnostics: PreSessionDoseDiagnostic[];
  sessionRisks: NonNullable<PreSessionReadinessProjectedWeekEvidence["sessionRisks"]>;
  nextSession: ProjectedWeekSession | undefined;
  recommendations: PreSessionReadinessCoachingRecommendation[];
}): string[] {
  const avoid = new Set<string>();
  const activeRecommendations = input.recommendations.filter(
    (recommendation) => !recommendation.suppressed
  );

  if (activeRecommendations.some((recommendation) => recommendation.muscle === "Chest")) {
    avoid.add("extra pressing");
  }
  if (
    input.diagnostics.some(
      (diagnostic) =>
        diagnostic.muscle === "Triceps" &&
        diagnostic.recommendedAction.setDelta > 0
    )
  ) {
    avoid.add("extra pressing for triceps");
  }
  if (
    input.diagnostics.some(
      (diagnostic) =>
        diagnostic.muscle === "Side Delts" &&
        diagnostic.recommendedAction.setDelta > 0
    )
  ) {
    avoid.add("extra lateral raise");
  }

  for (const diagnostic of input.diagnostics) {
    if (
      diagnostic.targetStatus === "near_mav" ||
      diagnostic.targetStatus === "over_mav" ||
      diagnostic.fatigueDensityConcern.level === "meaningful" ||
      diagnostic.fatigueDensityConcern.level === "high"
    ) {
      avoid.add(`extra ${diagnostic.muscle}`);
    }
  }
  for (const risk of input.sessionRisks) {
    avoid.add(`${risk.slotId}: ${risk.issue}`);
  }
  const region = getMuscleRegion(activeRecommendations[0]?.muscle ?? "");
  if (
    region === "lower" ||
    (activeRecommendations.length > 0 && sessionMatchesRegion(input.nextSession, "lower"))
  ) {
    avoid.add("upper-body work");
    avoid.add("extra hinge");
  }

  return Array.from(avoid);
}

function buildPrescriptionConfidenceWatches(
  generated: SessionAuditSnapshot["generated"] | undefined
): PreSessionReadinessPrescriptionConfidenceWatchRow[] {
  return (generated?.exercises ?? []).flatMap<PreSessionReadinessPrescriptionConfidenceWatchRow>((exercise) => {
    const trace = generated?.traces.progression[exercise.exerciseId];
    if (!trace) {
      return [
        {
          exerciseLabel: exercise.exerciseName,
          watchType: "prescription_confidence",
          reasonCode: "progression_trace_unavailable",
          displayActionCode: "use_target_as_starting_point",
          severity: "warning",
          source: "generated_progression_trace",
        },
      ];
    }
    const confidence = trace.confidence.combinedScale;
    const reasons = trace.confidence.reasons.slice(0, 2);
    const hasEstimateOrLowSignal = reasons.some(
      (reason) =>
        reason.toLowerCase().includes("estimate") ||
        reason.toLowerCase().includes("low")
    );
    const hasLoadCalibrationSignal = reasons.some((reason) => {
      const normalized = reason.toLowerCase();
      return (
        normalized.includes("calibration") ||
        normalized.includes("equipment") ||
        normalized.includes("machine") ||
        normalized.includes("cable")
      );
    });
    if (
      confidence < 0.75 ||
      trace.outcome.action === "decrease" ||
      hasEstimateOrLowSignal ||
      hasLoadCalibrationSignal
    ) {
      const reasonCode =
        trace.outcome.action === "decrease"
          ? "decrease_recommended"
          : hasLoadCalibrationSignal
            ? "load_calibration"
            : hasEstimateOrLowSignal
              ? "estimate_or_low_signal"
              : "low_confidence";
      const displayActionCode =
        hasLoadCalibrationSignal
          ? "machine_or_cable_target_may_need_calibration"
          : trace.outcome.action === "hold"
            ? "hold_target_load"
            : "calibrate_from_first_working_set";

      return [
        {
          exerciseLabel: exercise.exerciseName,
          watchType: "prescription_confidence",
          reasonCode,
          displayActionCode,
          severity: confidence < 0.75 ? "warning" : "info",
          confidence,
          source: "generated_progression_trace",
        },
      ];
    }
    return [];
  });
}

function formatPrescriptionConfidenceWatchMessage(
  row: PreSessionReadinessPrescriptionConfidenceWatchRow
): string {
  switch (row.displayActionCode) {
    case "use_target_as_starting_point":
      return `- ${row.exerciseLabel}: use the target as a starting point; adjust by feel.`;
    case "hold_target_load":
      return `- ${row.exerciseLabel}: hold the target load unless the first set feels clearly too easy or too hard.`;
    case "machine_or_cable_target_may_need_calibration":
      return `- ${row.exerciseLabel}: machine/cable target may need calibration.`;
    default:
      return `- ${row.exerciseLabel}: use the written target as guidance and calibrate from the first working set.`;
  }
}

function buildStartability(input: {
  generation: SessionGenerationResult | undefined;
  nextSession: NextWorkoutContext | undefined;
  sessionSnapshot: SessionAuditSnapshot | undefined;
  projectedWeek: PreSessionReadinessProjectedWeekEvidence | undefined;
  evidence: PreSessionReadinessEvidence;
  isActiveDeload: boolean;
}): PreSessionReadinessContract["startability"] {
  const reasons: string[] = [];
  if (input.generation && "error" in input.generation) {
    reasons.push(`generation failed: ${input.generation.error}`);
  }
  if (!input.sessionSnapshot?.generated && !input.generation) {
    reasons.push("missing generated session preview");
  }
  if (
    input.nextSession?.source === "existing_incomplete" &&
    input.nextSession.selectedIncompleteReadiness?.safeToTrain !== true
  ) {
    reasons.push(
      `incomplete workout blocker: ${input.nextSession.existingWorkoutId ?? "unknown"} (${input.nextSession.selectedIncompleteStatus ?? "unknown"})`
    );
  }
  if (input.nextSession?.source === "final_week_close_pending") {
    reasons.push(
      input.nextSession.lifecycleBlocker?.message ??
        "final accumulation closeout is pending"
    );
  }
  if (input.evidence.activeMesocycle.mesocycleIdMatchesRequest === false) {
    reasons.push("requested mesocycle id does not match the active mesocycle");
  }
  if (!input.projectedWeek) {
    reasons.push("missing current-week projection and dose guidance");
  }

  const safeToTrain = reasons.length === 0;
  return {
    status: safeToTrain ? "startable" : "blocked",
    safeToTrain,
    normalStartCoachingAllowed: safeToTrain,
    action: safeToTrain
      ? input.isActiveDeload
        ? "run_deload_seed_as_prescribed"
        : "run_seed_as_prescribed"
      : "resolve_blocker_first",
    reasons: safeToTrain
      ? ["no blocking audit, state, or generation blockers detected"]
      : reasons,
    blockerSummary: safeToTrain ? "none" : Array.from(new Set(reasons)).join("; "),
  };
}

function buildSeedRuntimeProof(input: {
  compositionSource: string | null;
  receiptMesocycleId: string | null;
  seedConsistency: AcceptedMesocycleSeedProvenanceConsistency | undefined;
}): PreSessionReadinessContract["seedRuntimeProof"] {
  const seed = input.seedConsistency?.seed;
  const seedOrderSetCountsRespected =
    input.compositionSource === "persisted_slot_plan_seed"
      ? true
      : input.compositionSource === "deload_seed_replay"
        ? true
        : input.compositionSource == null
          ? null
          : false;
  const proofLines =
    input.compositionSource === "persisted_slot_plan_seed"
      ? [
          "Seed order/set counts respected: yes, generated preview is from persisted seed replay",
          "Exercise identity/order source: accepted seed replay",
          "Set-count policy: accumulation seed set counts preserved",
        ]
      : input.compositionSource === "deload_seed_replay"
        ? [
            "Seed order/set counts respected: yes, generated preview is from deload seed replay",
            "Exercise identity/order source: accepted seed replay for deload",
            "Set-count policy: deload-adjusted; accumulation seed set counts intentionally reduced",
          ]
        : [
            "Seed order/set counts respected: unknown, composition source is not persisted seed replay",
          ];

  return {
    status:
      input.seedConsistency?.status === "valid"
        ? "valid"
        : input.seedConsistency
          ? "warning"
          : "not_available",
    compositionSource: input.compositionSource,
    receiptMesocycleId: input.receiptMesocycleId,
    seedSource: seed?.source ?? null,
    seedExecutableShape: seed?.executableShape ?? null,
    seedOrderSetCountsRespected,
    readOnlyEvidenceOnly: true,
    seedRuntimeChanged: false,
    proofLines,
  };
}

function buildConsistencyChecks(input: {
  recommendations: PreSessionReadinessCoachingRecommendation[];
  projectedWeekStatus: PreSessionReadinessContract["projectedWeekStatus"];
  startability: PreSessionReadinessContract["startability"];
  seedRuntimeProof: PreSessionReadinessContract["seedRuntimeProof"];
}): PreSessionReadinessConsistencyCheck[] {
  const mismatched = input.recommendations.filter((recommendation) =>
    recommendation.suppressionReasons.includes("candidate_muscle_mismatch")
  );
  const suppressedTarget = input.recommendations.filter((recommendation) =>
    recommendation.suppressionReasons.includes("target_muscle_suppressed")
  );
  const hasActiveAddOn = input.recommendations.some(
    (recommendation) => !recommendation.suppressed
  );
  const noAddOnExplicit =
    input.projectedWeekStatus.status !== "no_further_action" ||
    Boolean(input.projectedWeekStatus.noAddOnReason);
  const blockedAllowsNormalStart =
    !input.startability.safeToTrain &&
    input.startability.normalStartCoachingAllowed;
  const seedProofReadOnly =
    input.seedRuntimeProof.readOnlyEvidenceOnly === true &&
    input.seedRuntimeProof.seedRuntimeChanged === false;

  return [
    {
      id: "optional_add_on_matches_flagged_muscle",
      status: mismatched.length > 0 ? "warning" : "pass",
      severity: mismatched.length > 0 ? "warning" : "info",
      message:
        mismatched.length > 0
          ? "One or more optional add-on candidates did not match the flagged muscle need and were suppressed."
          : "Optional add-on candidates match their flagged muscle need.",
      evidence: mismatched.map(
        (recommendation) =>
          `${recommendation.muscle}:${recommendation.candidateExerciseName}`
      ),
    },
    {
      id: "optional_add_on_not_suppressed_muscle",
      status: suppressedTarget.length > 0 ? "warning" : "pass",
      severity: suppressedTarget.length > 0 ? "warning" : "info",
      message:
        suppressedTarget.length > 0
          ? "One or more optional add-ons targeted a suppressed muscle and were suppressed."
          : "No active optional add-on targets a suppressed muscle.",
      evidence: suppressedTarget.map((recommendation) => recommendation.muscle),
    },
    {
      id: "no_add_on_state_explicit",
      status: noAddOnExplicit && (hasActiveAddOn || input.projectedWeekStatus.noAddOnReason || input.projectedWeekStatus.status !== "no_further_action") ? "pass" : "fail",
      severity: noAddOnExplicit ? "info" : "error",
      message: noAddOnExplicit
        ? "No-add-on state is explicit when projected week requires no further action."
        : "No-add-on state is missing for projected week no_further_action.",
      evidence: [
        `projected_week_status=${input.projectedWeekStatus.status}`,
        `active_add_ons=${hasActiveAddOn ? "yes" : "no"}`,
      ],
    },
    {
      id: "blocked_state_no_normal_start_coaching",
      status: blockedAllowsNormalStart ? "fail" : "pass",
      severity: blockedAllowsNormalStart ? "error" : "info",
      message: blockedAllowsNormalStart
        ? "Blocked/not-runnable state exposes normal start coaching."
        : "Blocked/not-runnable state does not expose normal start coaching.",
      evidence: [
        `safe_to_train=${input.startability.safeToTrain ? "yes" : "no"}`,
        `normal_start=${input.startability.normalStartCoachingAllowed ? "yes" : "no"}`,
      ],
    },
    {
      id: "seed_runtime_proof_read_only",
      status: seedProofReadOnly ? "pass" : "fail",
      severity: seedProofReadOnly ? "info" : "error",
      message: seedProofReadOnly
        ? "Seed/runtime proof remains read-only evidence only."
        : "Seed/runtime proof implies behavior mutation.",
      evidence: [
        `read_only=${input.seedRuntimeProof.readOnlyEvidenceOnly ? "yes" : "no"}`,
        `seed_runtime_changed=${input.seedRuntimeProof.seedRuntimeChanged ? "yes" : "no"}`,
      ],
    },
  ];
}

export function buildPreSessionReadinessContract(
  input: PreSessionReadinessContractBuildInput
): PreSessionReadinessContract {
  const active = input.evidence.activeMesocycle;
  const isActiveDeload = active.state === "ACTIVE_DELOAD";
  const generated = input.sessionSnapshot?.generated;
  const nextProjectedSession =
    input.projectedWeek?.projectedSessions.find((session) => session.isNext) ??
    input.projectedWeek?.projectedSessions[0];
  const doseDiagnostics = input.projectedWeek?.runtimeDoseAdjustmentDiagnostics ?? [];
  const startability = buildStartability({
    generation: input.generation,
    nextSession: input.nextSession,
    sessionSnapshot: input.sessionSnapshot,
    projectedWeek: input.projectedWeek,
    evidence: input.evidence,
    isActiveDeload,
  });
  const receiptProvenance =
    input.generation && !("error" in input.generation)
      ? input.generation.selection.sessionDecisionReceipt?.sessionProvenance
      : undefined;
  const seedRuntimeProof = buildSeedRuntimeProof({
    compositionSource: receiptProvenance?.compositionSource ?? null,
    receiptMesocycleId: receiptProvenance?.mesocycleId ?? null,
    seedConsistency: input.seedConsistency,
  });
  const doseClosure = buildDoseClosure({
    isActiveDeload,
    diagnostics: doseDiagnostics,
    fullWeekRows: input.projectedWeek?.fullWeekByMuscle ?? [],
    projectedSessions: input.projectedWeek?.projectedSessions ?? [],
    nextSession: nextProjectedSession,
  });
  const availableRecommendations = doseClosure.recommendations.filter(
    (recommendation) => !recommendation.suppressed
  );
  const projectedWeekStatus = buildProjectedWeekStatus({
    isActiveDeload,
    projectedWeek: input.projectedWeek,
    doseDiagnostics,
    startable: startability.safeToTrain,
    hasAvailableAddOns: availableRecommendations.length > 0,
  });
  const fatigueRows = [
    ...(input.weeklyRetro?.volumeTargeting.overMav ?? []).map(
      (muscle) => `${muscle}: over MAV`
    ),
    ...(input.weeklyRetro?.volumeTargeting.overTargetOnly ?? []).map(
      (muscle) => `${muscle}: over target`
    ),
    ...(input.projectedWeek?.currentWeekAudit?.fatigueRisks ?? []),
  ];
  const avoid = buildAvoidList({
    diagnostics: doseDiagnostics,
    sessionRisks: input.projectedWeek?.sessionRisks ?? [],
    nextSession: nextProjectedSession,
    recommendations: doseClosure.recommendations,
  });
  const prescriptionConfidenceWatches = buildPrescriptionConfidenceWatches(generated);
  const diagnosticFatigue = doseDiagnostics.flatMap((diagnostic) => {
    if (diagnostic.fatigueDensityConcern.level === "none") {
      return [];
    }
    const drivers =
      diagnostic.fatigueDensityConcern.drivers
        .slice(0, 2)
        .map((driver) => driver.exerciseName)
        .join(", ") || "projected session";
    return [
      `- ${diagnostic.muscle}: ${diagnostic.fatigueDensityConcern.level} fatigue watch via ${drivers}`,
    ];
  });
  const fatigueCautions = Array.from(
    new Set([
      ...fatigueRows.map((row) => `- ${row}`),
      ...(input.projectedWeek?.sessionRisks ?? []).map(
        (risk) => `- ${risk.slotId}: ${risk.issue}`
      ),
      ...diagnosticFatigue,
    ])
  );
  const safeOptionalAddOns = startability.safeToTrain
    ? availableRecommendations.map((recommendation) => recommendation.addonLine)
    : [];
  const addOnState =
    !startability.safeToTrain
      ? {
          status: "blocked" as const,
          reason: "Readiness is blocked; resolve blocker before considering add-ons.",
        }
      : isActiveDeload
        ? {
            status: "deload_suppressed" as const,
            reason: "ACTIVE_DELOAD suppresses hypertrophy add-ons and MEV closure top-ups.",
          }
        : safeOptionalAddOns.length > 0
          ? {
              status: "available" as const,
              reason: "Contract has session-local optional add-on rows.",
            }
          : {
              status: "none" as const,
              reason:
                projectedWeekStatus.noAddOnReason ??
                "No safe session-local optional add-ons from current contract evidence.",
            };
  const suppressAvoid = isActiveDeload
    ? ["- all hypertrophy add-ons / MEV closure top-ups during ACTIVE_DELOAD"]
    : avoid.length > 0
      ? avoid.slice(0, 6).map((item) => `- ${item}`)
      : ["- no extra work beyond session-local readiness judgment"];
  const contractSource = input.contractSource ?? {
    producerMode: "audit_readout" as const,
    producer: "workout_audit" as const,
    provenance: "operator_audit" as const,
  };
  const prescriptionConfidenceWatchMessages =
    prescriptionConfidenceWatches.map(formatPrescriptionConfidenceWatchMessage);
  const boundaryNotes = input.boundaryNotes ?? [
    "contract is audit/readout only",
    "no workout/session/log/seed/progression mutation",
    "seed/runtime proof is evidence only",
  ];

  const contractBase = {
    contractVersion: 1 as const,
    scope: {
      mode: "pre-session-readiness" as const,
      ownerSeam: PRE_SESSION_READINESS_CONTRACT_OWNER_SEAM,
      source: contractSource,
      readOnly: true as const,
      auditOnly: input.auditOnly ?? true,
      affectsScoringOrGeneration: false as const,
      consumedByProduction: false as const,
    },
    nextSessionIdentity: {
      userId: input.userId,
      ...(input.ownerEmail ? { ownerEmail: input.ownerEmail } : {}),
      activeMesocycleId: active.mesocycleId,
      ...(active.requestedMesocycleId
        ? { requestedMesocycleId: active.requestedMesocycleId }
        : {}),
      ...(active.mesocycleIdMatchesRequest != null
        ? { mesocycleIdMatchesRequest: active.mesocycleIdMatchesRequest }
        : {}),
      activeState: active.state,
      currentWeek: active.currentWeek,
      currentSession: active.currentSession,
      nextSlotId: input.nextSession?.slotId ?? null,
      nextIntent: input.nextSession?.intent ?? null,
      existingWorkoutId: input.nextSession?.existingWorkoutId ?? null,
      incompleteWorkoutStatus: input.nextSession?.selectedIncompleteStatus ?? null,
      incompleteWorkoutReadiness: input.nextSession?.existingWorkoutId
        ? input.nextSession.selectedIncompleteReadiness
          ? `${input.nextSession.selectedIncompleteReadiness.classification} (${input.nextSession.selectedIncompleteReadiness.action})`
          : `unclassified (${input.nextSession.selectedIncompleteStatus ?? "unknown"})`
        : "none",
      existingWorkoutAction:
        input.nextSession?.selectedIncompleteReadiness?.reason ?? "none",
      generationPath: input.generationPath?.executionMode ?? "unknown",
      generator: input.generationPath?.generator ?? "unknown",
    },
    startability,
    seedRuntimeProof,
    projectedWeekStatus,
    doseClosure,
    sessionLocalCoaching: {
      defaultInstruction: startability.safeToTrain
        ? isActiveDeload
          ? "Run deload seed as prescribed."
          : "Default: run seed as prescribed. All suggestions are optional, session-local, and do not mutate the accepted seed."
        : "Resolve blocker before starting; do not start this as a normal session.",
      floorBufferOpportunities: isActiveDeload || !startability.safeToTrain
        ? ["- none"]
        : availableRecommendations
            .filter((recommendation) => recommendation.kind === "floor_buffer")
            .map((recommendation) => recommendation.line),
      prescriptionConfidenceWatches:
        prescriptionConfidenceWatchMessages.length > 0
          ? prescriptionConfidenceWatchMessages
          : ["- none"],
      fatigueCautions:
        fatigueCautions.length > 0 ? fatigueCautions.slice(0, 6) : ["- none"],
      safeOptionalAddOns:
        safeOptionalAddOns.length > 0
          ? safeOptionalAddOns.slice(0, 4)
          : [
              addOnState.status === "blocked"
                ? "- none - readiness is blocked"
                : addOnState.status === "deload_suppressed"
                  ? "- none - deload context suppresses hypertrophy top-ups"
                  : `- none - ${addOnState.reason}`,
            ],
      suppressAvoid,
      addOnState,
    },
    calibrationWatches: {
      prescriptionConfidence: prescriptionConfidenceWatches,
      recoveryCaveats: doseDiagnostics
        .filter((diagnostic) => diagnostic.recoveryReadinessCaveat.status !== "none")
        .map(
          (diagnostic) =>
            `${diagnostic.muscle}:${diagnostic.recoveryReadinessCaveat.status}`
        ),
      fatigue: fatigueCautions,
    },
    boundaries: {
      readOnly: true as const,
      affectsScoringOrGeneration: false as const,
      consumedByProduction: false as const,
      wouldWriteTransaction: false as const,
      dbMutation: false as const,
      workoutLogSessionCreated: false as const,
      seedRuntimeChanged: false as const,
      plannerMaterializerChanged: false as const,
      notes: boundaryNotes,
    },
  };

  return {
    ...contractBase,
    consistencyChecks: buildConsistencyChecks({
      recommendations: doseClosure.recommendations,
      projectedWeekStatus,
      startability,
      seedRuntimeProof,
    }),
  };
}
