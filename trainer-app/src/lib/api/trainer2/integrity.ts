import { createHash } from "node:crypto";

// trainer2-json-v1: recursive lexicographic object keys, original array order,
// JSON string escaping; decimal values remain strings. No envelope fields excluded.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error("UNSUPPORTED_CANONICAL_VALUE");
}
export function integrityHash(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
export const COMMAND_HASH_VERSION = "trainer2-command-envelope-v1";
export function commandBinding(envelope: unknown) {
  const submittedEnvelope = canonicalJson(envelope);
  return { submittedEnvelope, envelopeHash: integrityHash(`${COMMAND_HASH_VERSION}\n${submittedEnvelope}`), hashVersion: COMMAND_HASH_VERSION };
}
