export const WORKOUT_AUDIT_CANONICAL_MODES = [
  "future-week",
  "pre-session-readiness",
  "projected-week-volume",
  "current-week-audit",
  "active-mesocycle-slot-reseed",
  "replace-empty-mesocycle-with-v2",
  "v2-accepted-seed-prepare-compare",
  "mesocycle-explain",
  "historical-week",
  "weekly-retro",
  "deload",
  "progression-anchor",
] as const;

export const WORKOUT_AUDIT_ARTIFACT_VERSION = 4 as const;
export const HISTORICAL_WEEK_AUDIT_PAYLOAD_VERSION = 1 as const;
export const WEEKLY_RETRO_AUDIT_PAYLOAD_VERSION = 1 as const;
export const PROGRESSION_ANCHOR_AUDIT_PAYLOAD_VERSION = 1 as const;
export const PROJECTED_WEEK_VOLUME_AUDIT_PAYLOAD_VERSION = 1 as const;
export const ACTIVE_MESOCYCLE_SLOT_RESEED_AUDIT_PAYLOAD_VERSION = 1 as const;
export const REPLACE_EMPTY_MESOCYCLE_WITH_V2_AUDIT_PAYLOAD_VERSION = 1 as const;
export const V2_ACCEPTED_SEED_PREPARE_COMPARE_AUDIT_PAYLOAD_VERSION = 1 as const;
export const MESOCYCLE_EXPLAIN_AUDIT_PAYLOAD_VERSION = 1 as const;
export const SPLIT_SANITY_AUDIT_ARTIFACT_VERSION = 1 as const;
export const WEEK_CLOSE_HANDOFF_AUDIT_ARTIFACT_VERSION = 1 as const;
export const SEQUENCING_AUDIT_ARTIFACT_VERSION = 1 as const;
export const ACCOUNTING_AUDIT_ARTIFACT_VERSION = 1 as const;

export const WORKOUT_AUDIT_SIZE_LIMIT_BYTES = 1024 * 1024;
export const WORKOUT_AUDIT_MAIN_ARTIFACT_BUDGET_BYTES =
  WORKOUT_AUDIT_SIZE_LIMIT_BYTES;
export const V2_DEBUG_INDEX_BUDGET_BYTES = 128 * 1024;
export const V2_DEBUG_DEFAULT_SHARD_BUDGET_BYTES = 512 * 1024;
export const V2_DEBUG_FULL_DETAIL_SHARD_BUDGET_BYTES =
  WORKOUT_AUDIT_SIZE_LIMIT_BYTES;

export const AUDIT_RECONSTRUCTION_GUARDRAIL =
  "[audit-guardrail:do-not-reconstruct] Do not reconstruct generated-layer truth from saved workout state; treat saved-only coverage as saved-state semantics only.";

export const HISTORICAL_WEEK_MISSING_GENERATED_LAYER_LIMITATION =
  "Generated-layer snapshots are missing for some legacy workouts, so generated-vs-saved drift and generation-time traces are unavailable for those sessions.";

export type WorkoutAuditCanonicalMode =
  (typeof WORKOUT_AUDIT_CANONICAL_MODES)[number];

export type WorkoutAuditRequestMode = WorkoutAuditCanonicalMode;
