export type PlanManagementErrorCode =
  | "PLAN_NOT_FOUND"
  | "PLAN_NOT_PREPARING"
  | "PLAN_INVALID"
  | "PLAN_CREATION_INFEASIBLE"
  | "PLAN_GENERATION_FAILED"
  | "PLAN_CREATION_ID_CONFLICT"
  | "PLAN_DRAFT_NOT_FOUND"
  | "PLAN_DRAFT_BLOCKED"
  | "PLAN_DRAFT_MEASUREMENT_PROVENANCE_INVALID"
  | "PLAN_VERSION_NOT_EXECUTABLE"
  | "PLAN_UNSUPPORTED_TOPOLOGY"
  | "PLAN_PREVIEW_HASH_MISMATCH"
  | "PLAN_WARNING_CONFIRMATION_REQUIRED"
  | "PLAN_HEALTH_EVALUATION_FAILED"
  | "PLAN_COPY_UNAVAILABLE"
  | "PLAN_LIMITATION_UNRECOGNIZED"
  | "PLAN_MUTATION_CONFLICT"
  | "ACTIVE_PLAN_ARCHIVE_FORBIDDEN"
  | "PLAN_OWNER_NOT_READY";

export class PlanManagementError extends Error {
  constructor(
    readonly code: PlanManagementErrorCode,
    readonly details: Record<string, string | null> = {},
    readonly responseData: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "PlanManagementError";
  }
}
