// Internal maintenance helpers for stable audit artifact output.
// These are intentionally not exposed as user-facing CLI commands.
export function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonKeys(entry)] as const)
    );
  }
  return value;
}

export function serializeStableJson(value: unknown): string {
  return JSON.stringify(sortJsonKeys(value), null, 2);
}

export function getSerializedArtifactSizeBytes(serialized: string): number {
  return Buffer.byteLength(serialized, "utf8");
}

export type SerializedTopLevelSectionSize = {
  field: string;
  bytes: number;
};

export function getSerializedJsonSizeBytes(value: unknown): number {
  const serialized = serializeStableJson(value) ?? "null";
  return getSerializedArtifactSizeBytes(serialized);
}

export function buildSerializedTopLevelSizeBreakdown(
  value: unknown
): SerializedTopLevelSectionSize[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value as Record<string, unknown>)
    .map(([field, section]) => ({
      field,
      bytes: getSerializedJsonSizeBytes(section),
    }))
    .sort(
      (left, right) =>
        right.bytes - left.bytes || left.field.localeCompare(right.field)
    );
}

export function buildArtifactDiffSummary(previous: unknown, next: unknown): {
  changedTopLevelKeys: string[];
} {
  const previousRecord =
    previous && typeof previous === "object"
      ? (previous as Record<string, unknown>)
      : {};
  const nextRecord =
    next && typeof next === "object" ? (next as Record<string, unknown>) : {};
  const keys = new Set([
    ...Object.keys(previousRecord),
    ...Object.keys(nextRecord),
  ]);

  const changedTopLevelKeys = Array.from(keys)
    .filter((key) => JSON.stringify(previousRecord[key]) !== JSON.stringify(nextRecord[key]))
    .sort((left, right) => left.localeCompare(right));

  return { changedTopLevelKeys };
}
