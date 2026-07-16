export const TRAINER_WRITE_PAUSE_VARIABLE = "TRAINER_WRITE_PAUSE";
export const TRAINER_WRITE_PAUSE_ENABLED_VALUE = "enabled";

export type ProductionWriteOperation =
  | "application_configuration"
  | "mesocycle_acceptance"
  | "mesocycle_lifecycle"
  | "mesocycle_reseed"
  | "workout_materialization"
  | "workout_structural_edit"
  | "workout_save"
  | "set_logging"
  | "readiness_preparation"
  | "readiness_submission"
  | "operational_backfill";

export type ProductionWriteStatus = "PAUSED" | "ENABLED";

export class ProductionWritePausedError extends Error {
  readonly code = "PRODUCTION_WRITE_PAUSED";

  constructor(readonly operation: ProductionWriteOperation) {
    super("PRODUCTION_WRITE_PAUSED");
    this.name = "ProductionWritePausedError";
  }
}

export function productionWriteStatus(
  environment: Record<string, string | undefined> = process.env,
): ProductionWriteStatus {
  return environment[TRAINER_WRITE_PAUSE_VARIABLE] === TRAINER_WRITE_PAUSE_ENABLED_VALUE
    ? "PAUSED"
    : "ENABLED";
}

export function assertProductionWriteAllowed(
  operation: ProductionWriteOperation,
  environment: Record<string, string | undefined> = process.env,
): void {
  if (productionWriteStatus(environment) === "PAUSED") {
    throw new ProductionWritePausedError(operation);
  }
}

export function isProductionWritePausedError(
  error: unknown,
): error is ProductionWritePausedError {
  return error instanceof ProductionWritePausedError;
}
