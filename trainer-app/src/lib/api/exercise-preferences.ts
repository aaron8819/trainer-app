import { Prisma } from "@prisma/client";

type PreferenceSnapshot = {
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
  favoriteExerciseIds: string[];
  avoidExerciseIds: string[];
  state: ExercisePreferenceState;
};

const addUnique = (items: string[], value: string): string[] =>
  items.includes(value) ? items : [...items, value];

export function resolveExercisePreferenceState(
  preferences: PreferenceSnapshot | null | undefined,
  exercise: ExerciseIdentity
): ExercisePreferenceState {
  const favoriteIds = new Set(preferences?.favoriteExerciseIds ?? []);
  const avoidIds = new Set(preferences?.avoidExerciseIds ?? []);

  return {
    isFavorite: favoriteIds.has(exercise.id),
    isAvoided: avoidIds.has(exercise.id),
  };
}

export function computeExercisePreferenceToggle(
  preferences: PreferenceSnapshot | null | undefined,
  exercise: ExerciseIdentity,
  mode: "favorite" | "avoid"
): ExercisePreferenceUpdate {
  const currentState = resolveExercisePreferenceState(preferences, exercise);

  let nextFavoriteExerciseIds = [...(preferences?.favoriteExerciseIds ?? [])];
  let nextAvoidExerciseIds = [...(preferences?.avoidExerciseIds ?? [])];

  if (mode === "favorite") {
    if (currentState.isFavorite) {
      nextFavoriteExerciseIds = nextFavoriteExerciseIds.filter((id) => id !== exercise.id);
    } else {
      nextFavoriteExerciseIds = addUnique(nextFavoriteExerciseIds, exercise.id);
      nextAvoidExerciseIds = nextAvoidExerciseIds.filter((id) => id !== exercise.id);
    }
  } else if (currentState.isAvoided) {
    nextAvoidExerciseIds = nextAvoidExerciseIds.filter((id) => id !== exercise.id);
  } else {
    nextAvoidExerciseIds = addUnique(nextAvoidExerciseIds, exercise.id);
    nextFavoriteExerciseIds = nextFavoriteExerciseIds.filter((id) => id !== exercise.id);
  }

  const nextState = resolveExercisePreferenceState(
    { favoriteExerciseIds: nextFavoriteExerciseIds, avoidExerciseIds: nextAvoidExerciseIds },
    exercise
  );

  return {
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
