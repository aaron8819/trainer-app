import { Prisma } from "@prisma/client";
import { normalizeName } from "../engine/utils";

type PreferenceSnapshot = {
  favoriteExercises?: string[] | null;
  avoidExercises?: string[] | null;
  favoriteExerciseIds?: string[] | null;
  avoidExerciseIds?: string[] | null;
};

type ExerciseIdentity = {
  id: string;
  name: string;
};

export type ExercisePreferenceState = {
  isFavorite: boolean;
  isAvoided: boolean;
};

export type ExercisePreferenceUpdate = {
  favoriteExercises: string[];
  avoidExercises: string[];
  favoriteExerciseIds: string[];
  avoidExerciseIds: string[];
  state: ExercisePreferenceState;
};

const toNormalizedSet = (items: string[] | null | undefined): Set<string> =>
  new Set((items ?? []).map((item) => normalizeName(item)));

const addUnique = (items: string[], value: string): string[] =>
  items.includes(value) ? items : [...items, value];

const removeByNormalizedName = (items: string[], normalizedName: string): string[] =>
  items.filter((item) => normalizeName(item) !== normalizedName);

export function resolveExercisePreferenceState(
  preferences: PreferenceSnapshot | null | undefined,
  exercise: ExerciseIdentity
): ExercisePreferenceState {
  const normalizedName = normalizeName(exercise.name);
  const favoriteIds = new Set(preferences?.favoriteExerciseIds ?? []);
  const avoidIds = new Set(preferences?.avoidExerciseIds ?? []);
  const favoriteNames = toNormalizedSet(preferences?.favoriteExercises);
  const avoidNames = toNormalizedSet(preferences?.avoidExercises);

  return {
    isFavorite: favoriteIds.has(exercise.id) || favoriteNames.has(normalizedName),
    isAvoided: avoidIds.has(exercise.id) || avoidNames.has(normalizedName),
  };
}

export function computeExercisePreferenceToggle(
  preferences: PreferenceSnapshot | null | undefined,
  exercise: ExerciseIdentity,
  mode: "favorite" | "avoid"
): ExercisePreferenceUpdate {
  const normalizedName = normalizeName(exercise.name);
  const currentState = resolveExercisePreferenceState(preferences, exercise);

  let nextFavoriteExercises = [...(preferences?.favoriteExercises ?? [])];
  let nextAvoidExercises = [...(preferences?.avoidExercises ?? [])];
  let nextFavoriteExerciseIds = [...(preferences?.favoriteExerciseIds ?? [])];
  let nextAvoidExerciseIds = [...(preferences?.avoidExerciseIds ?? [])];

  if (mode === "favorite") {
    if (currentState.isFavorite) {
      nextFavoriteExercises = removeByNormalizedName(nextFavoriteExercises, normalizedName);
      nextFavoriteExerciseIds = nextFavoriteExerciseIds.filter((id) => id !== exercise.id);
    } else {
      nextFavoriteExercises = addUnique(nextFavoriteExercises, exercise.name);
      nextFavoriteExerciseIds = addUnique(nextFavoriteExerciseIds, exercise.id);
      nextAvoidExercises = removeByNormalizedName(nextAvoidExercises, normalizedName);
      nextAvoidExerciseIds = nextAvoidExerciseIds.filter((id) => id !== exercise.id);
    }
  } else if (currentState.isAvoided) {
    nextAvoidExercises = removeByNormalizedName(nextAvoidExercises, normalizedName);
    nextAvoidExerciseIds = nextAvoidExerciseIds.filter((id) => id !== exercise.id);
  } else {
    nextAvoidExercises = addUnique(nextAvoidExercises, exercise.name);
    nextAvoidExerciseIds = addUnique(nextAvoidExerciseIds, exercise.id);
    nextFavoriteExercises = removeByNormalizedName(nextFavoriteExercises, normalizedName);
    nextFavoriteExerciseIds = nextFavoriteExerciseIds.filter((id) => id !== exercise.id);
  }

  const nextState = resolveExercisePreferenceState(
    {
      favoriteExercises: nextFavoriteExercises,
      avoidExercises: nextAvoidExercises,
      favoriteExerciseIds: nextFavoriteExerciseIds,
      avoidExerciseIds: nextAvoidExerciseIds,
    },
    exercise
  );

  return {
    favoriteExercises: nextFavoriteExercises,
    avoidExercises: nextAvoidExercises,
    favoriteExerciseIds: nextFavoriteExerciseIds,
    avoidExerciseIds: nextAvoidExerciseIds,
    state: nextState,
  };
}

export function isSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}
