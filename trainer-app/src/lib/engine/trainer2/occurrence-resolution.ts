// Weeks are contiguous stage runs in immutable authored occurrence order.
export function authoredWeeks<T extends { id: string; stageId: string }>(occurrences: T[]): T[][] {
  const weeks: T[][] = [];
  for (const occurrence of occurrences) {
    if (weeks.at(-1)?.[0].stageId !== occurrence.stageId) weeks.push([]);
    weeks.at(-1)!.push(occurrence);
  }
  return weeks;
}
export function unresolvedOccurrences<T extends { id: string }>(occurrences: T[], resolvedIds: ReadonlySet<string>) {
  return occurrences.filter(o => !resolvedIds.has(o.id));
}
// The persisted cursor advances only through AdvanceWeek. Resolution never moves it.
export function currentWeekOccurrences<T extends { id: string; stageId: string }>(occurrences: T[], _resolvedIds: ReadonlySet<string>, weekIndex = 0) {
  return authoredWeeks(occurrences)[weekIndex] ?? [];
}
export function eligibleCurrentWeekOccurrences<T extends { id: string; stageId: string }>(occurrences: T[], resolvedIds: ReadonlySet<string>, weekIndex = 0) {
  return unresolvedOccurrences(currentWeekOccurrences(occurrences, resolvedIds, weekIndex), resolvedIds);
}
