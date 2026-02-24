/**
 * Utilities for displaying exercise loads consistently.
 *
 * Storage convention: loads are stored in the same unit shown to users.
 * Dumbbell exercises use per-dumbbell ("each") values.
 */

const DUMBBELL_WEIGHTS = [
  2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25,
  27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50,
  55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 110,
];

function snapToDumbbell(lbs: number): number {
  return DUMBBELL_WEIGHTS.reduce((prev, curr) =>
    Math.abs(curr - lbs) < Math.abs(prev - lbs) ? curr : prev
  );
}

export function isDumbbellEquipment(equipment: string[] | undefined): boolean {
  return (equipment ?? []).some((e) => e.toLowerCase() === "dumbbell");
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
    if (isDumbbell) {
      return `${snapToDumbbell(lbs)} lbs each`;
    }
    return `${lbs} lbs`;
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
  return isDumbbell ? snapToDumbbell(lbs) : lbs;
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
  void isDumbbell;
  if (displayLbs == null) return displayLbs;
  return displayLbs;
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
    const displayMin = isDumbbell ? snapToDumbbell(min) : min;
    const displayMax = isDumbbell ? snapToDumbbell(max) : max;
    return `${displayMin}–${displayMax} lbs${isDumbbell ? " each" : ""}`;
  }
  return undefined;
}
