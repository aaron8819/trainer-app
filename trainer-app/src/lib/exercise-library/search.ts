import { MUSCLE_GROUP_HIERARCHY, MUSCLE_TO_GROUP } from "./constants";
import type { MuscleGroup } from "./types";

export type ExerciseSearchCandidate = {
  id: string;
  name: string;
  aliases: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
};

export type ExerciseSearchResult = {
  id: string;
  name: string;
  primaryMuscles: string[];
  equipment: string[];
};

const EQUIPMENT_SEARCH_TERMS: Record<string, string[]> = {
  BARBELL: ["barbell", "bb", "bar"],
  DUMBBELL: ["dumbbell", "dumbbells", "db"],
  MACHINE: ["machine", "machines"],
  CABLE: ["cable", "cables", "pulley"],
  BODYWEIGHT: ["bodyweight", "body weight", "bw"],
  KETTLEBELL: ["kettlebell", "kettlebells", "kb"],
  BAND: ["band", "bands", "resistance band", "resistance bands"],
  SLED: ["sled"],
  BENCH: ["bench"],
  RACK: ["rack", "squat rack", "power rack"],
  EZ_BAR: ["ez bar", "curl bar"],
  TRAP_BAR: ["trap bar", "hex bar"],
  OTHER: ["other"],
};

const MUSCLE_GROUP_QUERY_TERMS: Record<MuscleGroup, string[]> = {
  chest: ["chest", "pec", "pecs"],
  back: ["back"],
  shoulders: ["shoulder", "shoulders", "delt", "delts"],
  arms: ["arm", "arms"],
  legs: ["leg", "legs"],
  core: ["core", "ab", "abs"],
};

const EQUIPMENT_QUERY_INDEX = new Map<string, Set<string>>();
const MUSCLE_QUERY_INDEX = new Map<string, Set<string>>();

for (const [equipmentType, searchTerms] of Object.entries(EQUIPMENT_SEARCH_TERMS)) {
  for (const searchTerm of searchTerms) {
    const normalizedTerm = normalizeSearchText(searchTerm);
    const matches = EQUIPMENT_QUERY_INDEX.get(normalizedTerm) ?? new Set<string>();
    matches.add(equipmentType);
    EQUIPMENT_QUERY_INDEX.set(normalizedTerm, matches);
  }
}

for (const [muscleGroup, muscles] of Object.entries(MUSCLE_GROUP_HIERARCHY)) {
  const queryTerms = MUSCLE_GROUP_QUERY_TERMS[muscleGroup as MuscleGroup] ?? [];
  for (const queryTerm of queryTerms) {
    const normalizedTerm = normalizeSearchText(queryTerm);
    const matches = MUSCLE_QUERY_INDEX.get(normalizedTerm) ?? new Set<string>();
    for (const muscle of muscles) {
      matches.add(muscle);
    }
    MUSCLE_QUERY_INDEX.set(normalizedTerm, matches);
  }
}

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSearchText(value: string): string[] {
  const normalized = normalizeSearchText(value);
  if (normalized.length === 0) {
    return [];
  }

  return Array.from(new Set(normalized.split(" ").filter(Boolean)));
}

export function resolveEquipmentSearchTypes(query: string): string[] {
  const matches = new Set<string>();
  const normalizedQuery = normalizeSearchText(query);

  for (const searchTerm of [normalizedQuery, ...tokenizeSearchText(normalizedQuery)]) {
    for (const equipmentType of EQUIPMENT_QUERY_INDEX.get(searchTerm) ?? []) {
      matches.add(equipmentType);
    }
  }

  return [...matches];
}

export function resolveMuscleSearchNames(query: string): string[] {
  const matches = new Set<string>();
  const normalizedQuery = normalizeSearchText(query);

  for (const searchTerm of [normalizedQuery, ...tokenizeSearchText(normalizedQuery)]) {
    for (const muscleName of MUSCLE_QUERY_INDEX.get(searchTerm) ?? []) {
      matches.add(muscleName);
    }
  }

  return [...matches];
}

function hasWordPrefixMatch(value: string, token: string): boolean {
  return value.split(" ").some((part) => part.startsWith(token));
}

function scoreFieldMatch(haystacks: string[], query: string, weights: [number, number, number]): number {
  let bestScore = 0;

  for (const haystack of haystacks) {
    if (haystack === query) {
      bestScore = Math.max(bestScore, weights[0]);
      continue;
    }
    if (haystack.startsWith(query) || hasWordPrefixMatch(haystack, query)) {
      bestScore = Math.max(bestScore, weights[1]);
      continue;
    }
    if (haystack.includes(query)) {
      bestScore = Math.max(bestScore, weights[2]);
    }
  }

  return bestScore;
}

function scoreTokenMatch(haystacks: string[], token: string, weights: [number, number, number]): number {
  let bestScore = 0;

  for (const haystack of haystacks) {
    if (haystack === token) {
      bestScore = Math.max(bestScore, weights[0]);
      continue;
    }
    if (haystack.startsWith(token) || hasWordPrefixMatch(haystack, token)) {
      bestScore = Math.max(bestScore, weights[1]);
      continue;
    }
    if (haystack.includes(token)) {
      bestScore = Math.max(bestScore, weights[2]);
    }
  }

  return bestScore;
}

function buildSearchTerms(candidate: ExerciseSearchCandidate) {
  const normalizedName = normalizeSearchText(candidate.name);
  const normalizedAliases = candidate.aliases.map(normalizeSearchText).filter(Boolean);
  const normalizedPrimaryMuscles = candidate.primaryMuscles.map(normalizeSearchText).filter(Boolean);
  const normalizedSecondaryMuscles = candidate.secondaryMuscles.map(normalizeSearchText).filter(Boolean);
  const normalizedMuscleGroups = Array.from(
    new Set(
      [...candidate.primaryMuscles, ...candidate.secondaryMuscles]
        .map((muscle) => MUSCLE_TO_GROUP[muscle])
        .filter((group): group is MuscleGroup => Boolean(group))
        .map((group) => normalizeSearchText(group))
    )
  );
  const normalizedEquipment = Array.from(
    new Set(
      candidate.equipment.flatMap((equipmentType) => {
        const searchTerms = EQUIPMENT_SEARCH_TERMS[equipmentType] ?? [];
        return [equipmentType, ...searchTerms].map(normalizeSearchText).filter(Boolean);
      })
    )
  );

  return {
    normalizedName,
    normalizedAliases,
    normalizedPrimaryMuscles,
    normalizedSecondaryMuscles,
    normalizedMuscleGroups,
    normalizedEquipment,
  };
}

function scoreCandidate(candidate: ExerciseSearchCandidate, query: string): number {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = tokenizeSearchText(normalizedQuery);
  if (normalizedQuery.length === 0 || tokens.length === 0) {
    return 0;
  }

  const {
    normalizedName,
    normalizedAliases,
    normalizedPrimaryMuscles,
    normalizedSecondaryMuscles,
    normalizedMuscleGroups,
    normalizedEquipment,
  } = buildSearchTerms(candidate);

  let score = 0;

  score += scoreFieldMatch([normalizedName], normalizedQuery, [140, 118, 92]);
  score += scoreFieldMatch(normalizedAliases, normalizedQuery, [128, 108, 86]);
  score += scoreFieldMatch(
    [...normalizedPrimaryMuscles, ...normalizedMuscleGroups],
    normalizedQuery,
    [92, 74, 58]
  );
  score += scoreFieldMatch(normalizedSecondaryMuscles, normalizedQuery, [70, 56, 42]);
  score += scoreFieldMatch(normalizedEquipment, normalizedQuery, [64, 50, 36]);

  let matchedTokens = 0;

  for (const token of tokens) {
    const tokenScore = Math.max(
      scoreTokenMatch([normalizedName], token, [32, 24, 16]),
      scoreTokenMatch(normalizedAliases, token, [28, 22, 14]),
      scoreTokenMatch(
        [...normalizedPrimaryMuscles, ...normalizedMuscleGroups],
        token,
        [24, 18, 12]
      ),
      scoreTokenMatch(normalizedSecondaryMuscles, token, [18, 14, 10]),
      scoreTokenMatch(normalizedEquipment, token, [18, 14, 10])
    );

    if (tokenScore > 0) {
      matchedTokens += 1;
      score += tokenScore;
    }
  }

  if (matchedTokens === tokens.length) {
    score += 40 + tokens.length * 6;
  } else {
    score += matchedTokens * 6;
  }

  return score;
}

export function rankExerciseSearchResults(
  candidates: ExerciseSearchCandidate[],
  query: string,
  limit = 8
): ExerciseSearchResult[] {
  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.candidate.name.localeCompare(right.candidate.name);
    })
    .slice(0, limit)
    .map(({ candidate }) => ({
      id: candidate.id,
      name: candidate.name,
      primaryMuscles: candidate.primaryMuscles,
      equipment: candidate.equipment,
    }));
}
