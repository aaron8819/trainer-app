/**
 * Utilities for displaying exercise loads consistently.
 *
 * Storage convention: all loads are stored as total weight in lbs.
 * Dumbbell exercises display per-dumbbell weight (total / 2) to match
 * how users think about dumbbell loads.
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
 * Format a stored total load for display.
 * Dumbbell exercises show per-dumbbell weight with "lbs each" label.
 */
export function formatLoad(
  totalLbs: number | null | undefined,
  isDumbbell: boolean,
  isBodyweight: boolean
): string | undefined {
  if (totalLbs != null) {
    if (isDumbbell) {
      return `${snapToDumbbell(totalLbs / 2)} lbs each`;
    }
    return `${totalLbs} lbs`;
  }
  if (isBodyweight) {
    return "BW";
  }
  return undefined;
}

/**
 * Convert a stored total load to its display value.
 * Returns half the value for dumbbell exercises (per-dumbbell).
 */
export function toDisplayLoad(totalLbs: number, isDumbbell: boolean): number;
export function toDisplayLoad(totalLbs: number | null | undefined, isDumbbell: boolean): number | null | undefined;
export function toDisplayLoad(
  totalLbs: number | null | undefined,
  isDumbbell: boolean
): number | null | undefined {
  if (totalLbs == null) return totalLbs;
  return isDumbbell ? totalLbs / 2 : totalLbs;
}

/**
 * Convert a per-dumbbell display value back to the stored total.
 * Multiplies by 2 for dumbbell exercises.
 */
export function toStoredLoad(displayLbs: number, isDumbbell: boolean): number;
export function toStoredLoad(displayLbs: number | null, isDumbbell: boolean): number | null;
export function toStoredLoad(displayLbs: number | null | undefined, isDumbbell: boolean): number | null | undefined;
export function toStoredLoad(
  displayLbs: number | null | undefined,
  isDumbbell: boolean
): number | null | undefined {
  if (displayLbs == null) return displayLbs;
  return isDumbbell ? displayLbs * 2 : displayLbs;
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
    const displayMin = isDumbbell ? snapToDumbbell(min / 2) : min;
    const displayMax = isDumbbell ? snapToDumbbell(max / 2) : max;
    return `${displayMin}–${displayMax} lbs${isDumbbell ? " each" : ""}`;
  }
  return undefined;
}
