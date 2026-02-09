import { analyzeTemplate, type AnalysisExerciseInput, type TemplateAnalysis } from "./template-analysis";
import { createRng } from "./random";

// --- Types ---

export type SmartBuildExercise = {
  id: string;
  name: string;
  isCompound: boolean;
  movementPatterns: string[];
  splitTags: string[];
  jointStress: string;
  equipment: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  sfrScore?: number;
  lengthPositionScore?: number;
  timePerSetSec?: number;
  isFavorite: boolean;
  isAvoided: boolean;
};

export type SmartBuildInput = {
  targetMuscleGroups: string[];
  exercisePool: SmartBuildExercise[];
  availableEquipment?: string[];
  exerciseCount?: number;
  trainingGoal?: string;
  timeBudgetMinutes?: number;
  seed?: number;
};

export type SmartBuildResult = {
  exercises: SmartBuildExercise[];
  analysis: TemplateAnalysis;
};

// --- Muscle group map (inline for engine purity) ---

const MUSCLE_GROUP_MAP: Record<string, string[]> = {
  chest: ["Chest"],
  back: ["Back", "Upper Back", "Lower Back"],
  shoulders: ["Front Delts", "Side Delts", "Rear Delts"],
  arms: ["Biceps", "Triceps", "Forearms"],
  legs: ["Quads", "Hamstrings", "Glutes", "Adductors", "Calves", "Hip Flexors"],
  core: ["Core"],
};

const BLOCKED_TAGS = new Set(["core", "mobility", "prehab", "conditioning"]);

// --- Helpers ---

function weightedPick<T>(
  items: T[],
  scores: number[],
  rng: () => number
): { item: T; index: number } | null {
  if (items.length === 0) return null;

  // Ensure all scores are non-negative; apply floor of 0.1 so everything has some chance
  const adjusted = scores.map((s) => Math.max(s, 0.1));
  const total = adjusted.reduce((sum, s) => sum + s, 0);
  const roll = rng() * total;

  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += adjusted[i];
    if (roll <= cumulative) {
      return { item: items[i], index: i };
    }
  }
  // Fallback (floating-point edge case)
  return { item: items[items.length - 1], index: items.length - 1 };
}

function toAnalysisInput(ex: SmartBuildExercise): AnalysisExerciseInput {
  return {
    isCompound: ex.isCompound,
    movementPatterns: ex.movementPatterns,
    muscles: [
      ...ex.primaryMuscles.map((name) => ({ name, role: "primary" as const })),
      ...ex.secondaryMuscles.map((name) => ({ name, role: "secondary" as const })),
    ],
    sfrScore: ex.sfrScore,
    lengthPositionScore: ex.lengthPositionScore,
  };
}

// --- Exported functions ---

export function resolveTargetMuscles(groups: string[]): string[] {
  const muscles = new Set<string>();
  for (const group of groups) {
    const mapped = MUSCLE_GROUP_MAP[group];
    if (mapped) {
      for (const m of mapped) muscles.add(m);
    }
  }
  return [...muscles];
}

export function filterPool(
  pool: SmartBuildExercise[],
  targetMuscles: string[],
  availableEquipment?: string[]
): SmartBuildExercise[] {
  const targetSet = new Set(targetMuscles);

  return pool.filter((ex) => {
    // Remove avoided exercises
    if (ex.isAvoided) return false;

    // Remove blocked-tag exercises unless their primary muscles overlap targets
    const hasBlockedTag = ex.splitTags.some((t) => BLOCKED_TAGS.has(t));
    if (hasBlockedTag) {
      const hasTargetOverlap = ex.primaryMuscles.some((m) => targetSet.has(m));
      if (!hasTargetOverlap) return false;
    }

    // Filter by equipment if specified
    if (availableEquipment && availableEquipment.length > 0) {
      const equipSet = new Set(availableEquipment);
      const hasEquipment = ex.equipment.some((e) => equipSet.has(e));
      if (!hasEquipment) return false;
    }

    return true;
  });
}

export function scoreExerciseForBuild(
  ex: SmartBuildExercise,
  targetMuscles: Set<string>,
  coveredMuscles: Set<string>,
  coveredPatterns: Set<string>,
  isCompoundPhase: boolean,
  trainingGoal?: string
): number {
  let score = 0;

  // Primary target muscle hits
  for (const m of ex.primaryMuscles) {
    if (targetMuscles.has(m)) {
      score += 6;
    }
  }

  // Secondary target muscle hits
  for (const m of ex.secondaryMuscles) {
    if (targetMuscles.has(m)) {
      score += 2;
    }
  }

  // Favorite bonus
  if (ex.isFavorite) score += 3;

  if (!isCompoundPhase) {
    // Uncovered muscle bonus (isolation phase)
    for (const m of ex.primaryMuscles) {
      if (targetMuscles.has(m) && !coveredMuscles.has(m)) {
        score += 6;
      }
    }

    // Covered-but-targeted muscles still get a small boost
    for (const m of ex.primaryMuscles) {
      if (targetMuscles.has(m) && coveredMuscles.has(m)) {
        score += 2;
      }
    }

    // Novel movement pattern bonus
    for (const p of ex.movementPatterns) {
      if (!coveredPatterns.has(p)) {
        score += 2;
      }
    }

    // Penalty if all primary muscles already covered
    const allCovered = ex.primaryMuscles.every((m) => coveredMuscles.has(m));
    if (allCovered && ex.primaryMuscles.length > 0) {
      score -= 2;
    }
  } else {
    // Compound phase: uncovered muscle bonus (smaller weight)
    for (const m of ex.primaryMuscles) {
      if (targetMuscles.has(m) && !coveredMuscles.has(m)) {
        score += 0.5;
      }
    }
  }

  // Training goal bias
  if (trainingGoal === "strength") {
    if (ex.isCompound) score += 4;
  } else if (trainingGoal === "hypertrophy") {
    if (!ex.isCompound) score += 2;
    if ((ex.sfrScore ?? 3) >= 4) score += 2;
    if ((ex.lengthPositionScore ?? 3) >= 4) score += 1;
  } else if (trainingGoal === "fat_loss") {
    if (ex.isCompound) score += 2;
  }

  return score;
}

function determineCompoundCount(totalCount: number, trainingGoal?: string): number {
  let count: number;
  if (totalCount <= 5) count = 2;
  else if (totalCount <= 7) count = 3;
  else count = Math.round(totalCount * 0.4);
  if (trainingGoal === "strength") count = Math.min(count + 1, totalCount);
  return count;
}

function updateCoveredSets(
  ex: SmartBuildExercise,
  coveredMuscles: Set<string>,
  coveredPatterns: Set<string>
): void {
  for (const m of ex.primaryMuscles) coveredMuscles.add(m);
  for (const m of ex.secondaryMuscles) coveredMuscles.add(m);
  for (const p of ex.movementPatterns) coveredPatterns.add(p);
}

export function smartBuild(input: SmartBuildInput): SmartBuildResult {
  const {
    targetMuscleGroups,
    exercisePool,
    availableEquipment,
    exerciseCount = 7,
    trainingGoal,
    timeBudgetMinutes,
    seed,
  } = input;

  const rng = createRng(seed);

  // 1. Resolve muscles
  const targetMuscles = resolveTargetMuscles(targetMuscleGroups);
  if (targetMuscles.length === 0) {
    return {
      exercises: [],
      analysis: analyzeTemplate([]),
    };
  }

  // 2. Filter pool
  const pool = filterPool(exercisePool, targetMuscles, availableEquipment);
  if (pool.length === 0) {
    return {
      exercises: [],
      analysis: analyzeTemplate([]),
    };
  }

  // If pool is smaller than requested count, use entire pool
  const targetCount = Math.min(exerciseCount, pool.length);
  const targetMuscleSet = new Set(targetMuscles);
  const coveredMuscles = new Set<string>();
  const coveredPatterns = new Set<string>();
  const selected: SmartBuildExercise[] = [];

  // 3. Determine compound count
  const compoundCount = determineCompoundCount(targetCount, trainingGoal);

  // 4. Select compounds
  const compounds = pool.filter((ex) => ex.isCompound);
  const compoundPool = [...compounds];

  for (let i = 0; i < compoundCount && compoundPool.length > 0; i++) {
    const scores = compoundPool.map((ex) =>
      scoreExerciseForBuild(ex, targetMuscleSet, coveredMuscles, coveredPatterns, true, trainingGoal)
    );

    const pick = weightedPick(compoundPool, scores, rng);
    if (!pick) break;

    selected.push(pick.item);
    updateCoveredSets(pick.item, coveredMuscles, coveredPatterns);
    compoundPool.splice(pick.index, 1);
  }

  // 5. Select isolations/accessories (remaining slots)
  const selectedIds = new Set(selected.map((e) => e.id));
  const accessoryPool = pool.filter((ex) => !selectedIds.has(ex.id));
  const remainingSlots = targetCount - selected.length;

  for (let i = 0; i < remainingSlots && accessoryPool.length > 0; i++) {
    const scores = accessoryPool.map((ex) =>
      scoreExerciseForBuild(ex, targetMuscleSet, coveredMuscles, coveredPatterns, false, trainingGoal)
    );

    const pick = weightedPick(accessoryPool, scores, rng);
    if (!pick) break;

    selected.push(pick.item);
    updateCoveredSets(pick.item, coveredMuscles, coveredPatterns);
    accessoryPool.splice(pick.index, 1);
  }

  // 6. Order: compounds first (by # target muscles hit desc), then isolations
  const compoundSelected = selected
    .filter((e) => e.isCompound)
    .sort((a, b) => {
      const aHits = a.primaryMuscles.filter((m) => targetMuscleSet.has(m)).length;
      const bHits = b.primaryMuscles.filter((m) => targetMuscleSet.has(m)).length;
      return bHits - aHits;
    });

  const isolationSelected = selected
    .filter((e) => !e.isCompound)
    .sort((a, b) => {
      const aHits = a.primaryMuscles.filter((m) => targetMuscleSet.has(m)).length;
      const bHits = b.primaryMuscles.filter((m) => targetMuscleSet.has(m)).length;
      return bHits - aHits;
    });

  const ordered = [...compoundSelected, ...isolationSelected];

  // Trim to time budget
  if (timeBudgetMinutes) {
    const budgetSec = timeBudgetMinutes * 60;
    let cumSec = 0;
    const trimmed: SmartBuildExercise[] = [];
    for (const ex of ordered) {
      const sets = ex.isCompound ? 4 : 3;
      const perSet = (ex.timePerSetSec ?? 120) + (ex.isCompound ? 120 : 75);
      const exTime = sets * perSet;
      if (cumSec + exTime > budgetSec && trimmed.length > 0) break;
      cumSec += exTime;
      trimmed.push(ex);
    }
    ordered.length = 0;
    ordered.push(...trimmed);
  }

  // 7. Score and attempt improvement
  let analysis = analyzeTemplate(ordered.map(toAnalysisInput));

  if (analysis.overallScore < 50 && accessoryPool.length > 0) {
    for (let iter = 0; iter < 2; iter++) {
      // Find weakest exercise: fewest unique muscle contributions
      let weakestIdx = -1;
      let weakestContribution = Infinity;

      for (let i = 0; i < ordered.length; i++) {
        const ex = ordered[i];
        const uniqueContributions = ex.primaryMuscles.filter((m) => {
          return !ordered.some((other, j) => j !== i && other.primaryMuscles.includes(m));
        }).length;
        if (uniqueContributions < weakestContribution) {
          weakestContribution = uniqueContributions;
          weakestIdx = i;
        }
      }

      if (weakestIdx === -1) break;

      // Find best replacement from remaining pool
      const swapScores = accessoryPool.map((ex) =>
        scoreExerciseForBuild(ex, targetMuscleSet, coveredMuscles, coveredPatterns, false, trainingGoal)
      );

      let bestReplacementIdx = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < accessoryPool.length; i++) {
        if (swapScores[i] > bestScore) {
          bestScore = swapScores[i];
          bestReplacementIdx = i;
        }
      }

      if (bestReplacementIdx === -1) break;

      const replacement = accessoryPool[bestReplacementIdx];
      const removed = ordered[weakestIdx];
      ordered[weakestIdx] = replacement;
      accessoryPool.splice(bestReplacementIdx, 1);
      accessoryPool.push(removed);

      const newAnalysis = analyzeTemplate(ordered.map(toAnalysisInput));
      if (newAnalysis.overallScore > analysis.overallScore) {
        analysis = newAnalysis;
      } else {
        // Revert swap
        accessoryPool.pop();
        accessoryPool.splice(bestReplacementIdx, 0, replacement);
        ordered[weakestIdx] = removed;
        break;
      }
    }
  }

  return { exercises: ordered, analysis };
}
