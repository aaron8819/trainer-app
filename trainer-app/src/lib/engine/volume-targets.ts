export type WeeklyVolumeLandmarks = {
  mev: number;
  mav: number;
  mrv: number;
};

export function getAccumulationWeeks(durationWeeks: number): number {
  return Math.max(1, durationWeeks - 1);
}

function getLifecycleVolumeFraction(durationWeeks: number, week: number): number {
  const accumulationWeeks = getAccumulationWeeks(durationWeeks);
  const boundedWeek = Math.max(1, Math.min(week, accumulationWeeks));

  if (durationWeeks === 5) {
    const fractions: Record<number, number> = {
      1: 0,
      2: 1 / 3,
      3: 2 / 3,
      4: 1,
    };
    return fractions[boundedWeek] ?? fractions[1];
  }

  if (accumulationWeeks <= 1) return 0;
  return (boundedWeek - 1) / (accumulationWeeks - 1);
}

export function interpolateWeeklyVolumeTarget(
  landmarks: WeeklyVolumeLandmarks,
  durationWeeks: number,
  week: number
): number {
  const accumulationWeeks = getAccumulationWeeks(durationWeeks);
  const week4 = Math.min(landmarks.mav, landmarks.mrv);

  if (week <= 1) return landmarks.mev;
  if (week <= accumulationWeeks) {
    const progress = getLifecycleVolumeFraction(durationWeeks, week);
    return Math.round(landmarks.mev + progress * (week4 - landmarks.mev));
  }

  return Math.round(week4 * 0.45);
}
