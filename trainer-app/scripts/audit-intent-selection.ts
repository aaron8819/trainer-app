import fs from "node:fs";
import path from "node:path";

import {
  getHardFilterFailureReasonForCalibration,
  rankCandidatesForCalibration,
  selectExercises,
  type HardFilterFailureReason,
  type SelectionInput,
  type SessionIntent,
} from "../src/lib/engine/exercise-selection";
import { estimateWorkoutMinutes } from "../src/lib/engine/timeboxing";
import { canResolveLoadForWarmupRamp, buildProjectedWarmupSets } from "../src/lib/engine/warmup-ramp";
import { getRestSeconds } from "../src/lib/engine/prescription";
import { getGoalRepRanges } from "../src/lib/engine/rules";
import type { Exercise, MovementPatternV2, WorkoutExercise, WorkoutSet } from "../src/lib/engine/types";
import { MUSCLE_SPLIT_MAP } from "../src/lib/engine/volume-landmarks";

type JsonExercise = {
  name: string;
  movementPatterns: string[];
  splitTag: string;
  isCompound: boolean;
  isMainLiftEligible: boolean;
  jointStress: "low" | "medium" | "high";
  equipment: string[];
  fatigueCost: number;
  sfrScore: number;
  lengthPositionScore: number;
  stimulusBias: string[];
  contraindications: Record<string, unknown> | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  difficulty?: "beginner" | "intermediate" | "advanced";
  unilateral?: boolean;
  repRangeRecommendation?: { min: number; max: number };
  timePerSetSec?: number;
};

type JsonExerciseLibrary = {
  exercises: JsonExercise[];
};

type Scenario = {
  id: string;
  intent: SessionIntent;
  sessionMinutes: number;
  daysPerWeek: number;
  weekInBlock: number;
  targetMuscles?: string[];
};

type ValidationResult = {
  name: string;
  pass: boolean;
  details: string;
};

const EQUIPMENT = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "bodyweight",
  "bench",
  "rack",
  "ez_bar",
  "trap_bar",
  "kettlebell",
  "band",
  "sled",
] as const;

const SCENARIOS: Scenario[] = [
  { id: "A1", intent: "push", sessionMinutes: 55, daysPerWeek: 4, weekInBlock: 1 },
  { id: "A2", intent: "pull", sessionMinutes: 65, daysPerWeek: 4, weekInBlock: 1 },
  { id: "A3", intent: "legs", sessionMinutes: 55, daysPerWeek: 4, weekInBlock: 1 },
  { id: "A4", intent: "upper", sessionMinutes: 60, daysPerWeek: 4, weekInBlock: 1 },
  { id: "A5", intent: "lower", sessionMinutes: 60, daysPerWeek: 4, weekInBlock: 1 },
  { id: "A6", intent: "full_body", sessionMinutes: 60, daysPerWeek: 5, weekInBlock: 1 },
  {
    id: "A7",
    intent: "body_part",
    sessionMinutes: 55,
    daysPerWeek: 5,
    weekInBlock: 1,
    targetMuscles: ["chest", "triceps"],
  },
  {
    id: "A8",
    intent: "body_part",
    sessionMinutes: 55,
    daysPerWeek: 5,
    weekInBlock: 1,
    targetMuscles: ["lats", "biceps"],
  },
];

const HIGH_PRIORITY_BY_INTENT: Record<Exclude<SessionIntent, "full_body" | "body_part">, string[]> = {
  push: ["Chest", "Side Delts", "Triceps"],
  pull: ["Lats", "Biceps", "Rear Delts"],
  legs: ["Quads", "Hamstrings", "Calves"],
  upper: ["Chest", "Lats"],
  lower: ["Quads", "Hamstrings"],
};

const PUSH_PATTERNS = new Set<MovementPatternV2>(["horizontal_push", "vertical_push"]);
const PULL_PATTERNS = new Set<MovementPatternV2>(["horizontal_pull", "vertical_pull"]);
const LOWER_PATTERNS = new Set<MovementPatternV2>(["squat", "hinge", "lunge"]);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeEnum(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function makeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function titleizeIntent(intent: SessionIntent): string {
  return intent.replaceAll("_", " ");
}

function toEngineExercise(raw: JsonExercise): Exercise {
  return {
    id: makeId(raw.name),
    name: raw.name,
    movementPatterns: raw.movementPatterns.map((pattern) => normalizeEnum(pattern)) as Exercise["movementPatterns"],
    splitTags: [normalizeEnum(raw.splitTag)] as Exercise["splitTags"],
    isCompound: raw.isCompound,
    isMainLiftEligible: raw.isMainLiftEligible,
    jointStress: raw.jointStress,
    equipment: raw.equipment.map((item) => normalizeEnum(item)) as Exercise["equipment"],
    fatigueCost: raw.fatigueCost,
    sfrScore: raw.sfrScore,
    lengthPositionScore: raw.lengthPositionScore,
    stimulusBias: raw.stimulusBias.map((item) => normalizeEnum(item)) as Exercise["stimulusBias"],
    contraindications: raw.contraindications ?? undefined,
    primaryMuscles: raw.primaryMuscles,
    secondaryMuscles: raw.secondaryMuscles,
    difficulty: raw.difficulty ?? "beginner",
    isUnilateral: raw.unilateral ?? false,
    repRangeMin: raw.repRangeRecommendation?.min,
    repRangeMax: raw.repRangeRecommendation?.max,
    timePerSetSec: raw.timePerSetSec,
  };
}

function buildInput(exerciseLibrary: Exercise[], scenario: Scenario): SelectionInput {
  return {
    mode: "intent",
    intent: scenario.intent,
    targetMuscles: scenario.targetMuscles,
    pinnedExerciseIds: [],
    weekInBlock: scenario.weekInBlock,
    mesocycleLength: 4,
    sessionMinutes: scenario.sessionMinutes,
    trainingAge: "intermediate",
    goals: { primary: "hypertrophy", secondary: "none" },
    constraints: {
      availableEquipment: [...EQUIPMENT],
      daysPerWeek: scenario.daysPerWeek,
    },
    fatigueState: { readinessScore: 3 },
    history: [],
    exerciseLibrary,
  };
}

function estimateExerciseMinutes(input: SelectionInput, exercise: Exercise, sets: number, isMainLift: boolean): number {
  if (sets <= 0) {
    return 0;
  }
  const goalRanges = getGoalRepRanges(input.goals.primary);
  const reps = isMainLift ? goalRanges.main[0] : goalRanges.accessory[0];
  const restSeconds = getRestSeconds(exercise, isMainLift, reps);
  const workSeconds = exercise.timePerSetSec ?? (isMainLift ? 60 : 40);
  return ((workSeconds + restSeconds) * sets) / 60;
}

function resolveSetCount(selection: ReturnType<typeof selectExercises>, exerciseId: string): number {
  return Math.max(2, Math.round(selection.perExerciseSetTargets[exerciseId] ?? 2));
}

function resolvePrimaryScope(intent: SessionIntent, targetMuscles?: string[]): Set<string> {
  if (intent === "body_part") {
    return new Set((targetMuscles ?? []).map(normalize));
  }

  const splitGroups =
    intent === "upper"
      ? new Set(["push", "pull"])
      : intent === "lower"
        ? new Set(["legs"])
        : intent === "full_body"
          ? new Set(["push", "pull", "legs"])
          : new Set([intent]);

  const scope = new Set<string>();
  for (const [muscle, split] of Object.entries(MUSCLE_SPLIT_MAP)) {
    if (splitGroups.has(split)) {
      scope.add(normalize(muscle));
    }
  }
  return scope;
}

function dominantPattern(exercise: Exercise): string {
  return normalize(exercise.movementPatterns?.[0] ?? "none");
}

function isLowerCompound(exercise: Exercise): boolean {
  if (!exercise.isCompound) {
    return false;
  }
  return (exercise.movementPatterns ?? []).some((pattern) => LOWER_PATTERNS.has(pattern));
}

function validateSession(
  input: SelectionInput,
  selection: ReturnType<typeof selectExercises>,
  byId: Map<string, Exercise>
): {
  validations: ValidationResult[];
  estimatedMinutes: number;
  budgetRemaining: number;
  missingTargetsForAudit: string[];
} {
  const selected = selection.selectedExerciseIds
    .map((id) => byId.get(id))
    .filter((exercise): exercise is Exercise => Boolean(exercise));

  const estimatedMinutes = selection.selectedExerciseIds.reduce((sum, id) => {
    const exercise = byId.get(id);
    if (!exercise) {
      return sum;
    }
    return (
      sum +
      estimateExerciseMinutes(input, exercise, resolveSetCount(selection, id), selection.mainLiftIds.includes(id))
    );
  }, 0);
  const budgetRemaining = input.sessionMinutes - estimatedMinutes;

  const scope = resolvePrimaryScope(input.intent, input.targetMuscles);
  const outOfScope = selected.filter((exercise) => {
    const primary = (exercise.primaryMuscles ?? []).map(normalize);
    return !primary.some((muscle) => scope.has(muscle));
  });

  const validations: ValidationResult[] = [];
  validations.push({
    name: "Intent scope",
    pass: outOfScope.length === 0,
    details:
      outOfScope.length === 0
        ? "all selected exercises have in-scope primary muscles"
        : `out-of-scope: ${outOfScope.map((exercise) => exercise.name).join(", ")}`,
  });

  const accessories = selection.accessoryIds
    .map((id) => byId.get(id))
    .filter((exercise): exercise is Exercise => Boolean(exercise));
  const duplicatePairs: string[] = [];
  for (let i = 0; i < accessories.length; i += 1) {
    for (let j = i + 1; j < accessories.length; j += 1) {
      const a = accessories[i];
      const b = accessories[j];
      const primaryA = new Set((a.primaryMuscles ?? []).map(normalize));
      const primaryB = new Set((b.primaryMuscles ?? []).map(normalize));
      const sharedPrimary = [...primaryA].filter((muscle) => primaryB.has(muscle));
      if (sharedPrimary.length === 0) {
        continue;
      }
      if (dominantPattern(a) !== dominantPattern(b)) {
        continue;
      }
      duplicatePairs.push(`${a.name} <> ${b.name} (${sharedPrimary.join(", ")} | ${dominantPattern(a)})`);
    }
  }
  validations.push({
    name: "No redundant same-primary-pattern pairs",
    pass: duplicatePairs.length === 0,
    details: duplicatePairs.length === 0 ? "no duplicate accessory pairs detected" : duplicatePairs.join("; "),
  });

  const primaryCoverage = new Set(
    selected.flatMap((exercise) => (exercise.primaryMuscles ?? []).map((muscle) => normalize(muscle)))
  );
  const missingCoverageTargets: string[] = [];
  if (input.intent === "full_body") {
    const hasPushCompound = selected.some(
      (exercise) =>
        exercise.isCompound && (exercise.movementPatterns ?? []).some((pattern) => PUSH_PATTERNS.has(pattern))
    );
    const hasPullCompound = selected.some(
      (exercise) =>
        exercise.isCompound && (exercise.movementPatterns ?? []).some((pattern) => PULL_PATTERNS.has(pattern))
    );
    const hasLowerCompound = selected.some((exercise) => isLowerCompound(exercise));
    if (!hasPushCompound) {
      missingCoverageTargets.push("Chest");
    }
    if (!hasPullCompound) {
      missingCoverageTargets.push("Lats");
    }
    if (!hasLowerCompound) {
      missingCoverageTargets.push("Quads");
    }
    validations.push({
      name: "Expected muscle coverage",
      pass: hasPushCompound && hasPullCompound && hasLowerCompound,
      details: `pushCompound=${hasPushCompound}, pullCompound=${hasPullCompound}, lowerCompound=${hasLowerCompound}`,
    });
  } else if (input.intent === "body_part") {
    const targets = (input.targetMuscles ?? []).map(normalize);
    for (const target of targets) {
      if (!primaryCoverage.has(target)) {
        missingCoverageTargets.push(target);
      }
    }
    validations.push({
      name: "Expected muscle coverage",
      pass: missingCoverageTargets.length === 0,
      details:
        missingCoverageTargets.length === 0
          ? "all target muscles covered"
          : `missing target muscles: ${missingCoverageTargets.join(", ")}`,
    });
  } else {
    const targets = HIGH_PRIORITY_BY_INTENT[input.intent].map(normalize);
    for (const target of targets) {
      if (!primaryCoverage.has(target)) {
        missingCoverageTargets.push(target);
      }
    }
    if (input.intent === "upper") {
      const hasPush = selected.some((exercise) =>
        (exercise.movementPatterns ?? []).some((pattern) => PUSH_PATTERNS.has(pattern))
      );
      const hasPull = selected.some((exercise) =>
        (exercise.movementPatterns ?? []).some((pattern) => PULL_PATTERNS.has(pattern))
      );
      if (!hasPush) {
        missingCoverageTargets.push("Chest");
      }
      if (!hasPull) {
        missingCoverageTargets.push("Lats");
      }
      validations.push({
        name: "Expected muscle coverage",
        pass: missingCoverageTargets.length === 0 && hasPush && hasPull,
        details: `missing=${missingCoverageTargets.join(", ") || "none"}; hasPush=${hasPush}; hasPull=${hasPull}`,
      });
    } else {
      validations.push({
        name: "Expected muscle coverage",
        pass: missingCoverageTargets.length === 0,
        details: missingCoverageTargets.length === 0 ? "all high-priority muscles covered" : `missing: ${missingCoverageTargets.join(", ")}`,
      });
    }
  }

  validations.push({
    name: "Time budget",
    pass: estimatedMinutes <= input.sessionMinutes + 1e-6,
    details: `${estimatedMinutes.toFixed(1)} min / ${input.sessionMinutes} min`,
  });

  validations.push({
    name: "Exercise count",
    pass: selected.length >= 3 && selected.length <= 7,
    details: `${selected.length} exercises`,
  });

  const setIssues = selection.selectedExerciseIds
    .map((id) => ({ id, sets: resolveSetCount(selection, id), exercise: byId.get(id) }))
    .filter(({ sets }) => sets < 2 || sets > 5)
    .map(({ sets, exercise }) => `${exercise?.name ?? "unknown"}=${sets}`);
  validations.push({
    name: "Set count range",
    pass: setIssues.length === 0,
    details: setIssues.length === 0 ? "all exercises within 2-5 sets" : setIssues.join(", "),
  });

  return {
    validations,
    estimatedMinutes,
    budgetRemaining,
    missingTargetsForAudit: Array.from(new Set(missingCoverageTargets)),
  };
}

function formatHardFilterReason(reason: HardFilterFailureReason | "not_found" | undefined): string {
  if (reason === undefined) {
    return "eligible";
  }
  if (reason === "not_found") {
    return "exercise_not_found";
  }
  return reason;
}

function buildFailCandidateAuditSection(
  input: SelectionInput,
  selection: ReturnType<typeof selectExercises>,
  byId: Map<string, Exercise>,
  missingTargets: string[]
): string[] {
  const lines: string[] = [];
  const seedPicks = selection.mainLiftIds.map((exerciseId) => ({ exerciseId, role: "main" as const }));
  const ranked = rankCandidatesForCalibration(input, "accessory", seedPicks);
  const rankById = new Map(ranked.map((entry, index) => [entry.exerciseId, index + 1]));
  const selectedSet = new Set(selection.selectedExerciseIds);

  lines.push("#### Candidate audit (fail context)");
  lines.push("");
  lines.push("Top 10 accessory candidates with score components:");
  lines.push("");
  for (const [index, entry] of ranked.slice(0, 10).entries()) {
    const c = entry.components;
    lines.push(
      `${index + 1}. ${entry.name} (score=${entry.score.toFixed(3)}, fatigueCost=${entry.fatigueCost})`
    );
    lines.push(
      `   - muscleDeficitScore=${(c.muscleDeficitScore ?? 0).toFixed(3)}, targetednessScore=${(c.targetednessScore ?? 0).toFixed(3)}, sfrScore=${(c.sfrScore ?? 0).toFixed(3)}, lengthenedScore=${(c.lengthenedScore ?? 0).toFixed(3)}`
    );
    lines.push(
      `   - preferenceScore=${(c.preferenceScore ?? 0).toFixed(3)}, movementDiversityScore=${(c.movementDiversityScore ?? 0).toFixed(3)}, continuityScore=${(c.continuityScore ?? 0).toFixed(3)}, timeFitScore=${(c.timeFitScore ?? 0).toFixed(3)}`
    );
    lines.push(
      `   - recencyPenalty=${(c.recencyPenalty ?? 0).toFixed(3)}, redundancyPenalty=${(c.redundancyPenalty ?? 0).toFixed(3)}, fatigueCostPenalty=${(c.fatigueCostPenalty ?? 0).toFixed(3)}`
    );
  }
  lines.push("");

  if (missingTargets.length === 0) {
    lines.push("Expected-but-missing exercise audit: none (coverage not missing).");
    lines.push("");
    return lines;
  }

  lines.push("Expected-but-missing exercise audit:");
  lines.push("");
  for (const target of missingTargets) {
    const targetKey = normalize(target);
    const pool = input.exerciseLibrary
      .filter((exercise) => !selectedSet.has(exercise.id))
      .filter((exercise) => (exercise.primaryMuscles ?? []).map(normalize).includes(targetKey))
      .sort((a, b) => {
        const rankA = rankById.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const rankB = rankById.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) {
          return rankA - rankB;
        }
        const sfrA = a.sfrScore ?? 3;
        const sfrB = b.sfrScore ?? 3;
        if (sfrB !== sfrA) {
          return sfrB - sfrA;
        }
        const fatigueA = a.fatigueCost ?? 3;
        const fatigueB = b.fatigueCost ?? 3;
        if (fatigueA !== fatigueB) {
          return fatigueA - fatigueB;
        }
        return a.name.localeCompare(b.name);
      })
      .slice(0, 5);

    lines.push(`- Target muscle: ${target}`);
    if (pool.length === 0) {
      lines.push("  - No candidate exercises found in library.");
      continue;
    }
    for (const exercise of pool) {
      const rank = rankById.get(exercise.id);
      if (rank !== undefined) {
        const rankedEntry = ranked[rank - 1];
        lines.push(
          `  - ${exercise.name}: present but outscored (rank=${rank}, score=${rankedEntry.score.toFixed(3)})`
        );
      } else {
        const reason = getHardFilterFailureReasonForCalibration(
          input,
          "accessory",
          exercise.id,
          seedPicks
        );
        lines.push(
          `  - ${exercise.name}: excluded by hard filter (${formatHardFilterReason(reason)})`
        );
      }
    }
  }
  lines.push("");
  return lines;
}

function main() {
  const outputArgIndex = process.argv.findIndex((arg) => arg === "--output");
  const outputPath =
    outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
      ? path.resolve(process.cwd(), process.argv[outputArgIndex + 1])
      : path.resolve(process.cwd(), "docs/debug/multi-intent-audit.md");
  const strict = process.argv.includes("--strict");
  const timeBreakdownArgIndex = process.argv.findIndex((arg) => arg === "--time-breakdown");
  const breakdownScenarioId =
    timeBreakdownArgIndex >= 0 && process.argv[timeBreakdownArgIndex + 1]
      ? process.argv[timeBreakdownArgIndex + 1]
      : undefined;

  const libraryPath = path.resolve(process.cwd(), "prisma/exercises_comprehensive.json");
  const parsed = JSON.parse(fs.readFileSync(libraryPath, "utf8")) as JsonExerciseLibrary;
  const exerciseLibrary = parsed.exercises.map(toEngineExercise);
  const byId = new Map(exerciseLibrary.map((exercise) => [exercise.id, exercise]));

  const lines: string[] = [];
  lines.push("# Multi-Intent Selection Audit");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");

  let failCount = 0;

  for (const scenario of SCENARIOS) {
    const input = buildInput(exerciseLibrary, scenario);
    const selection = selectExercises(input);
    const { validations, estimatedMinutes, budgetRemaining, missingTargetsForAudit } = validateSession(
      input,
      selection,
      byId
    );
    const scenarioPassed = validations.every((result) => result.pass);
    if (!scenarioPassed) {
      failCount += 1;
    }

    lines.push(
      `## ${scenario.id} - ${titleizeIntent(scenario.intent)}${scenario.targetMuscles ? ` (${scenario.targetMuscles.join(", ")})` : ""}`
    );
    lines.push("");
    lines.push(
      `- Status: ${scenarioPassed ? "PASS" : "FAIL"}`
    );
    lines.push(
      `- Session summary: intent=${scenario.intent}, exercises=${selection.selectedExerciseIds.length}, estimatedMinutes=${estimatedMinutes.toFixed(1)}, budgetRemaining=${budgetRemaining.toFixed(1)}`
    );
    lines.push("");
    lines.push("Selected exercises:");
    lines.push("");
    for (const exerciseId of selection.selectedExerciseIds) {
      const exercise = byId.get(exerciseId);
      if (!exercise) {
        continue;
      }
      const role = selection.mainLiftIds.includes(exerciseId) ? "main" : "accessory";
      const sets = resolveSetCount(selection, exerciseId);
      const primaryMuscles = (exercise.primaryMuscles ?? []).join(", ") || "n/a";
      lines.push(`- ${exercise.name} [${role}] - ${sets} sets - primary: ${primaryMuscles}`);
    }
    lines.push("");
    lines.push("Validation checks:");
    lines.push("");
    for (const result of validations) {
      lines.push(`- ${result.name}: ${result.pass ? "PASS" : "FAIL"} (${result.details})`);
    }
    lines.push("");

    if (!scenarioPassed) {
      lines.push(...buildFailCandidateAuditSection(input, selection, byId, missingTargetsForAudit));
    }
  }

  lines.push("## Aggregate");
  lines.push("");
  lines.push(`- Passed: ${SCENARIOS.length - failCount}/${SCENARIOS.length}`);
  lines.push(`- Failed: ${failCount}/${SCENARIOS.length}`);
  lines.push("");

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${outputPath}`);
  console.log(`Pass rate: ${SCENARIOS.length - failCount}/${SCENARIOS.length}`);
  if (breakdownScenarioId) {
    const scenario = SCENARIOS.find((entry) => entry.id === breakdownScenarioId);
    if (!scenario) {
      console.log(`No scenario found for --time-breakdown ${breakdownScenarioId}`);
    } else {
      const input = buildInput(exerciseLibrary, scenario);
      const selection = selectExercises(input);
      const selected = selection.selectedExerciseIds.flatMap((exerciseId, index) => {
        const exercise = byId.get(exerciseId);
        if (!exercise) {
          return [];
        }
        const isMainLift = selection.mainLiftIds.includes(exerciseId);
        const goalRanges = getGoalRepRanges(input.goals.primary);
        const targetReps = isMainLift ? goalRanges.main[0] : goalRanges.accessory[0];
        const sets = Array.from({ length: resolveSetCount(selection, exerciseId) }, (_, setIndex) => ({
          setIndex: setIndex + 1,
          targetReps,
        })) satisfies WorkoutSet[];
        const warmupSets = isMainLift && canResolveLoadForWarmupRamp(exercise)
          ? buildProjectedWarmupSets(input.trainingAge)
          : undefined;
        return [
          {
            id: `debug-${exercise.id}-${index}`,
            exercise,
            orderIndex: index,
            isMainLift,
            role: isMainLift ? ("main" as const) : ("accessory" as const),
            sets,
            warmupSets,
          } satisfies WorkoutExercise,
        ];
      });

      const linesByExercise: string[] = [];
      let warmupWorkSeconds = 0;
      let warmupRestSeconds = 0;
      let workingWorkSeconds = 0;
      let workingRestSeconds = 0;

      const resolveSetTiming = (set: WorkoutSet, exercise: WorkoutExercise, isWarmupSet: boolean) => {
        const restSeconds =
          set.restSeconds ??
          (isWarmupSet ? 45 : getRestSeconds(exercise.exercise, exercise.isMainLift));
        const fallbackWork = exercise.exercise.timePerSetSec ?? (exercise.isMainLift ? 60 : 40);
        const workSeconds = isWarmupSet ? Math.min(30, fallbackWork) : fallbackWork;
        return { workSeconds, restSeconds };
      };

      for (const exercise of selected) {
        let exerciseWarmupWork = 0;
        let exerciseWarmupRest = 0;
        let exerciseWorkingWork = 0;
        let exerciseWorkingRest = 0;
        for (const set of exercise.warmupSets ?? []) {
          const timing = resolveSetTiming(set, exercise, true);
          exerciseWarmupWork += timing.workSeconds;
          exerciseWarmupRest += timing.restSeconds;
          warmupWorkSeconds += timing.workSeconds;
          warmupRestSeconds += timing.restSeconds;
        }
        for (const set of exercise.sets) {
          const timing = resolveSetTiming(set, exercise, false);
          exerciseWorkingWork += timing.workSeconds;
          exerciseWorkingRest += timing.restSeconds;
          workingWorkSeconds += timing.workSeconds;
          workingRestSeconds += timing.restSeconds;
        }
        linesByExercise.push(
          `- ${exercise.exercise.name}: warmup=${((exerciseWarmupWork + exerciseWarmupRest) / 60).toFixed(1)}m (work ${(exerciseWarmupWork / 60).toFixed(1)}m + rest ${(exerciseWarmupRest / 60).toFixed(1)}m), ` +
            `working=${((exerciseWorkingWork + exerciseWorkingRest) / 60).toFixed(1)}m (work ${(exerciseWorkingWork / 60).toFixed(1)}m + rest ${(exerciseWorkingRest / 60).toFixed(1)}m)`
        );
      }

      const warmupMinutes = (warmupWorkSeconds + warmupRestSeconds) / 60;
      const workingMinutes = (workingWorkSeconds + workingRestSeconds) / 60;
      const roundedEstimated = estimateWorkoutMinutes(selected);
      const totalRaw = warmupMinutes + workingMinutes;
      console.log(`\nTime breakdown for ${scenario.id} (${scenario.intent}):`);
      for (const line of linesByExercise) {
        console.log(line);
      }
      console.log(
        `- Warmup total: ${warmupMinutes.toFixed(1)}m (work ${(warmupWorkSeconds / 60).toFixed(1)}m + rest ${(warmupRestSeconds / 60).toFixed(1)}m)`
      );
      console.log(
        `- Working total: ${workingMinutes.toFixed(1)}m (work ${(workingWorkSeconds / 60).toFixed(1)}m + rest ${(workingRestSeconds / 60).toFixed(1)}m)`
      );
      console.log(`- Raw total: ${totalRaw.toFixed(1)}m`);
      console.log(`- estimateWorkoutMinutes (rounded): ${roundedEstimated}m`);
    }
  }

  if (strict && failCount > 0) {
    process.exitCode = 1;
  }
}

main();
