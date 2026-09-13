import { createHash } from "node:crypto";

import { canonicalJson } from '../../trainer2-contracts/canonical-json';
export { canonicalJson } from '../../trainer2-contracts/canonical-json';

export function integrityHash(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
export const COMMAND_HASH_VERSION = "trainer2-command-envelope-v1";
export function commandBinding(envelope: unknown) {
  const submittedEnvelope = canonicalJson(envelope);
  return { submittedEnvelope, envelopeHash: integrityHash(`${COMMAND_HASH_VERSION}\n${submittedEnvelope}`), hashVersion: COMMAND_HASH_VERSION };
}
