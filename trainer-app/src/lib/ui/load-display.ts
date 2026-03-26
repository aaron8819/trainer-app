import { quantizeLoad } from "@/lib/units/load-quantization";

/**
 * Utilities for displaying exercise loads consistently.
 *
 * Storage convention: loads are stored in the same unit shown to users.
 * Dumbbell exercises use per-dumbbell ("each") values.
 */

function normalizeDisplayLoad(lbs: number, isDumbbell: boolean): number {
  return isDumbbell ? quantizeLoad(lbs) : lbs;
}

const NON_DUMBBELL_FREE_WEIGHT_EQUIPMENT = new Set(["barbell", "ez_bar", "trap_bar"]);

export function isDumbbellEquipment(equipment: string[] | undefined): boolean {
  const normalized = (equipment ?? []).map((item) => item.trim().toLowerCase());
  if (!normalized.includes("dumbbell")) {
    return false;
  }

  return !normalized.some((item) => NON_DUMBBELL_FREE_WEIGHT_EQUIPMENT.has(item));
}

/**
 * Format a stored load for display.
 * Dumbbell exercises show per-dumbbell weight with "lbs each" label.
 */
export function formatLoad(
  lbs: number | null | undefined,
  isDumbbell: boolean,
  isBodyweight: boolean
): string | undefined {
  if (lbs != null) {
    const displayLoad = normalizeDisplayLoad(lbs, isDumbbell);
    return `${displayLoad} lbs${isDumbbell ? " each" : ""}`;
  }
  if (isBodyweight) {
    return "BW";
  }
  return undefined;
}

/**
 * Convert a stored load to its display value.
 */
export function toDisplayLoad(lbs: number, isDumbbell: boolean): number;
export function toDisplayLoad(lbs: number | null | undefined, isDumbbell: boolean): number | null | undefined;
export function toDisplayLoad(
  lbs: number | null | undefined,
  isDumbbell: boolean
): number | null | undefined {
  if (lbs == null) return lbs;
  return normalizeDisplayLoad(lbs, isDumbbell);
}

/**
 * Convert a display value back to the stored value.
 */
export function toStoredLoad(displayLbs: number, isDumbbell: boolean): number;
export function toStoredLoad(displayLbs: number | null, isDumbbell: boolean): number | null;
export function toStoredLoad(displayLbs: number | null | undefined, isDumbbell: boolean): number | null | undefined;
export function toStoredLoad(
  displayLbs: number | null | undefined,
  isDumbbell: boolean
): number | null | undefined {
  if (displayLbs == null) return displayLbs;
  return normalizeDisplayLoad(displayLbs, isDumbbell);
}

/**
 * Format a baseline weight range for display.
 * Dumbbell exercises show per-dumbbell values.
 */
export function formatBaselineRange(
  min: number | null | undefined,
  max: number | null | undefined,
  isDumbbell: boolean
): string | undefined {
  if (min != null && max != null) {
    const displayMin = normalizeDisplayLoad(min, isDumbbell);
    const displayMax = normalizeDisplayLoad(max, isDumbbell);
    return `${displayMin}–${displayMax} lbs${isDumbbell ? " each" : ""}`;
  }
  return undefined;
}
