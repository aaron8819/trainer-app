export function canonicalizeJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("CANONICAL_JSON_NON_FINITE_NUMBER");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("CANONICAL_JSON_NON_PLAIN_OBJECT");
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => {
        if (record[key] === undefined) {
          throw new Error("CANONICAL_JSON_UNDEFINED_VALUE");
        }
        return `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`;
      })
      .join(",")}}`;
  }
  throw new Error("CANONICAL_JSON_UNSUPPORTED_VALUE");
}
