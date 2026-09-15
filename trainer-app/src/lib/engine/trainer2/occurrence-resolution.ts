// Saved array order is authoritative. Optional sets do not remove an occurrence
// from the approved endpoint; the admitted model has no optional occurrences.
export function unresolvedOccurrences<T extends { id: string }>(occurrences: T[], resolvedIds: ReadonlySet<string>) {
  return occurrences.filter(o => !resolvedIds.has(o.id));
}
