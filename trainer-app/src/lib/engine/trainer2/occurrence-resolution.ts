// Saved array order is authoritative. Optional sets do not remove an occurrence
// from the approved endpoint; the admitted model has no optional occurrences.
export function unresolvedOccurrences<T extends { id: string }>(occurrences: T[], resolvedIds: ReadonlySet<string>) {
  return occurrences.filter(o => !resolvedIds.has(o.id));
}

// A week is a contiguous stage run in authored occurrence order. Stage labels
// may recur; grouping by display name or by all matching stage IDs loses order.
export function currentWeekOccurrences<T extends { id: string; stageId: string }>(occurrences: T[], resolvedIds: ReadonlySet<string>) {
  const first = occurrences.findIndex(o => !resolvedIds.has(o.id));
  if (first < 0) return [];
  let start = first, end = first + 1;
  while (start > 0 && occurrences[start - 1].stageId === occurrences[first].stageId) start--;
  while (end < occurrences.length && occurrences[end].stageId === occurrences[first].stageId) end++;
  return occurrences.slice(start, end);
}

export function eligibleCurrentWeekOccurrences<T extends { id: string; stageId: string }>(occurrences: T[], resolvedIds: ReadonlySet<string>) {
  return unresolvedOccurrences(currentWeekOccurrences(occurrences, resolvedIds), resolvedIds);
}
