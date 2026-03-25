export const WORKOUT_AUDIT_CANONICAL_MODES = [
  "future-week",
  "projected-week-volume",
  "historical-week",
  "deload",
  "progression-anchor",
] as const;

export const WORKOUT_AUDIT_ARTIFACT_VERSION = 3 as const;
export const HISTORICAL_WEEK_AUDIT_PAYLOAD_VERSION = 1 as const;
export const PROGRESSION_ANCHOR_AUDIT_PAYLOAD_VERSION = 1 as const;
export const PROJECTED_WEEK_VOLUME_AUDIT_PAYLOAD_VERSION = 1 as const;
export const SPLIT_SANITY_AUDIT_ARTIFACT_VERSION = 1 as const;
export const WEEK_CLOSE_HANDOFF_AUDIT_ARTIFACT_VERSION = 1 as const;
export const SEQUENCING_AUDIT_ARTIFACT_VERSION = 1 as const;
export const ACCOUNTING_AUDIT_ARTIFACT_VERSION = 1 as const;

export const WORKOUT_AUDIT_SIZE_LIMIT_BYTES = 1024 * 1024;

export const AUDIT_RECONSTRUCTION_GUARDRAIL =
  "[audit-guardrail:do-not-reconstruct] Do not reconstruct generated-layer truth from saved workout state; treat saved-only coverage as saved-state semantics only.";

export const HISTORICAL_WEEK_MISSING_GENERATED_LAYER_LIMITATION =
  "Generated-layer snapshots are missing for some legacy workouts, so generated-vs-saved drift and generation-time traces are unavailable for those sessions.";

export type WorkoutAuditCanonicalMode =
  (typeof WORKOUT_AUDIT_CANONICAL_MODES)[number];

export type WorkoutAuditRequestMode = WorkoutAuditCanonicalMode;
