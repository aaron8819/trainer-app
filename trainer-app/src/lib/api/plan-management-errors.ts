export type PlanManagementErrorCode =
  | "PLAN_NOT_FOUND"
  | "PLAN_NOT_PREPARING"
  | "PLAN_INVALID"
  | "PLAN_CREATION_INFEASIBLE"
  | "PLAN_LIMITATION_UNRECOGNIZED"
  | "PLAN_MUTATION_CONFLICT"
  | "ACTIVE_PLAN_ARCHIVE_FORBIDDEN"
  | "PLAN_OWNER_NOT_READY";

export class PlanManagementError extends Error {
  constructor(
    readonly code: PlanManagementErrorCode,
    readonly details: Record<string, string | null> = {},
  ) {
    super(code);
    this.name = "PlanManagementError";
  }
}
