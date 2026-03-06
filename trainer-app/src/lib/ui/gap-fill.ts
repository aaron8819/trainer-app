import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import {
  hasOptionalGapFillMarker as hasOptionalGapFillMarkerStrict,
  isStrictOptionalGapFillSession,
  resolveEffectiveSelectionMode as resolveEffectiveSelectionModeStrict,
} from "@/lib/gap-fill/classifier";

type JsonRecord = Record<string, unknown>;

function toObject(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function resolveEffectiveSelectionMode(input: {
  selectionMode: string | null | undefined;
  sessionIntent: string | null | undefined;
}): string | undefined {
  return resolveEffectiveSelectionModeStrict(input);
}

export function hasOptionalGapFillMarker(selectionMetadata: unknown): boolean {
  return hasOptionalGapFillMarkerStrict(selectionMetadata);
}

export function isGapFillWorkout(input: {
  selectionMetadata: unknown;
  selectionMode: string | null | undefined;
  sessionIntent: string | null | undefined;
}): boolean {
  return isStrictOptionalGapFillSession(input);
}

function readPersistedWorkoutTargetMuscles(selectionMetadata: unknown): string[] {
  const record = toObject(selectionMetadata);
  return uniqueStrings(toStringArray(record?.targetMuscles));
}

export function resolveGapFillTargetMuscles(input: {
  selectionMetadata: unknown;
  persistedTargetMuscles?: string[] | null;
}): string[] {
  const persisted = uniqueStrings(toStringArray(input.persistedTargetMuscles ?? []));
  if (persisted.length > 0) {
    return persisted;
  }

  const workoutPersisted = readPersistedWorkoutTargetMuscles(input.selectionMetadata);
  if (workoutPersisted.length > 0) {
    return workoutPersisted;
  }

  const receipt = readSessionDecisionReceipt(input.selectionMetadata);
  return uniqueStrings(receipt?.targetMuscles ?? []);
}

export function formatGapFillMuscleList(muscles: string[]): string {
  return muscles
    .map((muscle) =>
      muscle
        .split(/[\s_]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(" ")
    )
    .join(", ");
}
