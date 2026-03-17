import type { SessionAuditSnapshot } from "@/lib/evidence/session-audit-types";
import type { AuditCanonicalSemantics } from "./types";

export function resolveAuditCanonicalSemantics(
  snapshot: SessionAuditSnapshot | undefined
): AuditCanonicalSemantics | undefined {
  if (!snapshot) {
    return undefined;
  }

  const sourceLayer = snapshot.saved
    ? "saved"
    : snapshot.generated
      ? "generated"
      : "none";
  const semantics = snapshot.saved?.semantics ?? snapshot.generated?.semantics;
  const phase =
    snapshot.saved?.mesocycleSnapshot?.phase ??
    snapshot.generated?.cycleContext?.phase ??
    null;

  return {
    sourceLayer,
    phase,
    isDeload: semantics?.isDeload ?? false,
    countsTowardProgressionHistory: semantics?.countsTowardProgressionHistory ?? false,
    countsTowardPerformanceHistory: semantics?.countsTowardPerformanceHistory ?? false,
    updatesProgressionAnchor: semantics?.updatesProgressionAnchor ?? false,
  };
}
