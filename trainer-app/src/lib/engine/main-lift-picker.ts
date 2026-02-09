import type {
  Exercise,
  MovementPatternV2,
  SplitTag,
  WorkoutHistoryEntry,
} from "./types";
import {
  buildRecencyIndex,
  getNoveltyMultiplier,
  getRecencyMultiplier,
  normalizeName,
  weightedPick,
} from "./utils";

export function pickMainLiftsForPpl(
  dayTag: SplitTag,
  mainPool: Exercise[],
  favoriteSet: Set<string>,
  painFlags?: Record<string, 0 | 1 | 2 | 3>,
  fallbackPool?: Exercise[],
  history: WorkoutHistoryEntry[] = [],
  rng: () => number = Math.random
) {
  const pickFavoriteFirst = (items: Exercise[]) =>
    items.sort((a, b) => {
      const aFav = favoriteSet.has(normalizeName(a.name)) ? 1 : 0;
      const bFav = favoriteSet.has(normalizeName(b.name)) ? 1 : 0;
      return bFav - aFav;
    });

  const mainLifts: Exercise[] = [];
  const hasPattern = (exercise: Exercise, pattern: MovementPatternV2) =>
    exercise.movementPatterns?.includes(pattern);
  const recencyIndex = buildRecencyIndex(history);
  const pickWeighted = (items: Exercise[]) =>
    weightedPick(
      items.map((exercise) => ({
        exercise,
        weight:
          Math.max(0.1, favoriteSet.has(normalizeName(exercise.name)) ? 3 : 1) *
          getRecencyMultiplier(exercise.id, recencyIndex) *
          getNoveltyMultiplier(exercise.id, recencyIndex),
      })),
      rng
    );

  if (dayTag === "push") {
    const horizontal = pickFavoriteFirst(
      mainPool.filter((exercise) => hasPattern(exercise, "horizontal_push"))
    );
    const vertical = pickFavoriteFirst(
      mainPool.filter((exercise) => hasPattern(exercise, "vertical_push"))
    );
    const horizontalPick = pickWeighted(horizontal);
    if (horizontalPick) {
      mainLifts.push(horizontalPick);
    }
    let verticalPick =
      pickWeighted(vertical.filter((exercise) => !mainLifts.includes(exercise))) ??
      vertical.find((exercise) => !mainLifts.includes(exercise));
    if (!verticalPick && fallbackPool) {
      const fallbackVertical = fallbackPool
        .filter((exercise) => hasPattern(exercise, "vertical_push"))
        .sort((a, b) => {
          const fatigueDiff = (b.fatigueCost ?? 0) - (a.fatigueCost ?? 0);
          if (fatigueDiff !== 0) {
            return fatigueDiff;
          }
          const aFav = favoriteSet.has(normalizeName(a.name)) ? 1 : 0;
          const bFav = favoriteSet.has(normalizeName(b.name)) ? 1 : 0;
          return bFav - aFav;
        });
      verticalPick =
        pickWeighted(
          fallbackVertical.filter((exercise) => !mainLifts.includes(exercise))
        ) ?? fallbackVertical.find((exercise) => !mainLifts.includes(exercise));
    }
    if (verticalPick) {
      mainLifts.push(verticalPick);
    }
  } else if (dayTag === "pull") {
    const vertical = pickFavoriteFirst(
      mainPool.filter((exercise) => hasPattern(exercise, "vertical_pull"))
    );
    let horizontal = pickFavoriteFirst(
      mainPool.filter((exercise) => hasPattern(exercise, "horizontal_pull"))
    );
    if (painFlags?.low_back && painFlags.low_back >= 2) {
      horizontal = horizontal.sort((a, b) => {
        const aPref = /chest[- ]?supported/i.test(a.name) ? 1 : 0;
        const bPref = /chest[- ]?supported/i.test(b.name) ? 1 : 0;
        return bPref - aPref;
      });
    }
    const verticalPick = pickWeighted(vertical);
    if (verticalPick) {
      mainLifts.push(verticalPick);
    }
    if (mainLifts.length === 0 && fallbackPool) {
      const fallbackVertical = fallbackPool
        .filter((exercise) => hasPattern(exercise, "vertical_pull"))
        .sort((a, b) => {
          const fatigueDiff = (b.fatigueCost ?? 0) - (a.fatigueCost ?? 0);
          if (fatigueDiff !== 0) {
            return fatigueDiff;
          }
          const aFav = favoriteSet.has(normalizeName(a.name)) ? 1 : 0;
          const bFav = favoriteSet.has(normalizeName(b.name)) ? 1 : 0;
          return bFav - aFav;
        });
      const fallbackPick =
        pickWeighted(
          fallbackVertical.filter((exercise) => !mainLifts.includes(exercise))
        ) ?? fallbackVertical.find((exercise) => !mainLifts.includes(exercise));
      if (fallbackPick) {
        mainLifts.push(fallbackPick);
      }
    }
    const horizontalPick =
      pickWeighted(horizontal.filter((exercise) => !mainLifts.includes(exercise))) ??
      horizontal.find((exercise) => !mainLifts.includes(exercise));
    if (horizontalPick) {
      mainLifts.push(horizontalPick);
    }
  } else {
    const squat = pickFavoriteFirst(
      mainPool.filter((exercise) => hasPattern(exercise, "squat") || hasPattern(exercise, "lunge"))
    );
    const hinge = pickFavoriteFirst(
      mainPool.filter((exercise) => hasPattern(exercise, "hinge"))
    );
    const squatPick = pickWeighted(squat);
    if (squatPick) {
      mainLifts.push(squatPick);
    }
    const hingePick =
      pickWeighted(hinge.filter((exercise) => !mainLifts.includes(exercise))) ??
      hinge.find((exercise) => !mainLifts.includes(exercise));
    if (hingePick) {
      mainLifts.push(hingePick);
    }
  }

  return mainLifts;
}
