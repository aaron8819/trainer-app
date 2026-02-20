"use client";

import { useMemo, useState } from "react";
import type {
  ExerciseSection,
  FlatSetItem,
  LogExerciseInput,
  NormalizedExercises,
  SectionedExercises,
} from "./types";

const SECTION_ORDER: ExerciseSection[] = ["warmup", "main", "accessory"];

export function normalizeExercises(
  exercises: LogExerciseInput[] | SectionedExercises
): NormalizedExercises {
  if (Array.isArray(exercises)) {
    return { warmup: [], main: exercises, accessory: [] };
  }
  return {
    warmup: exercises.warmup ?? [],
    main: exercises.main ?? [],
    accessory: exercises.accessory ?? [],
  };
}

export function formatSectionLabel(section: ExerciseSection): string {
  if (section === "warmup") return "Warmup";
  if (section === "main") return "Main Lifts";
  return "Accessories";
}

export function resolveRestSeconds(item: FlatSetItem): number {
  if (item.set.restSeconds != null && item.set.restSeconds > 0) {
    return item.set.restSeconds;
  }
  if (item.section === "warmup") return 60;
  if (item.section === "main") return 180;
  return 90;
}

export function getNextUnloggedSetId(
  flatSets: FlatSetItem[],
  loggedSetIds: Set<string>,
  currentSetId: string
): string | null {
  if (flatSets.length === 0) return null;
  const currentIndex = flatSets.findIndex((item) => item.set.setId === currentSetId);
  if (currentIndex === -1) return flatSets[0]?.set.setId ?? null;

  for (let index = currentIndex + 1; index < flatSets.length; index += 1) {
    const candidate = flatSets[index];
    if (!loggedSetIds.has(candidate.set.setId)) {
      return candidate.set.setId;
    }
  }
  for (let index = 0; index < currentIndex; index += 1) {
    const candidate = flatSets[index];
    if (!loggedSetIds.has(candidate.set.setId)) {
      return candidate.set.setId;
    }
  }
  return null;
}

export function useWorkoutLogState(exercises: LogExerciseInput[] | SectionedExercises) {
  const initial = useMemo(() => normalizeExercises(exercises), [exercises]);
  const [data, setData] = useState<NormalizedExercises>(initial);
  const [loggedSetIds, setLoggedSetIds] = useState<Set<string>>(new Set());
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<ExerciseSection, boolean>>({
    warmup: false,
    main: true,
    accessory: false,
  });
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(null);
  const [restTimerSeconds, setRestTimerSeconds] = useState<number | null>(null);

  const flatSets = useMemo<FlatSetItem[]>(() => {
    const output: FlatSetItem[] = [];
    for (const section of SECTION_ORDER) {
      const exercisesInSection = data[section];
      exercisesInSection.forEach((exercise, exerciseIndex) => {
        exercise.sets.forEach((set, setIndex) => {
          output.push({
            section,
            sectionLabel: formatSectionLabel(section),
            exerciseIndex,
            setIndex,
            exercise,
            set,
          });
        });
      });
    }
    return output;
  }, [data]);

  const fallbackActiveSet = useMemo(
    () => flatSets.find((item) => !loggedSetIds.has(item.set.setId)) ?? flatSets[0] ?? null,
    [flatSets, loggedSetIds]
  );

  const activeSet = useMemo(
    () => flatSets.find((item) => item.set.setId === activeSetId) ?? fallbackActiveSet,
    [activeSetId, fallbackActiveSet, flatSets]
  );

  return {
    data,
    setData,
    loggedSetIds,
    setLoggedSetIds,
    activeSetId,
    setActiveSetId,
    expandedSections,
    setExpandedSections,
    expandedExerciseId,
    setExpandedExerciseId,
    restTimerSeconds,
    setRestTimerSeconds,
    flatSets,
    activeSet,
  };
}
