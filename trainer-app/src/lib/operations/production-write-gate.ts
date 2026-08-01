export const TRAINER_WRITE_PAUSE_VARIABLE = "TRAINER_WRITE_PAUSE";
export const TRAINER_WRITE_PAUSE_ENABLED_VALUE = "enabled";
export const PRODUCTION_WRITE_STATUS_CONTRACT_VERSION = 2 as const;
export const PRODUCTION_WRITE_ENFORCEMENT_CONTRACT_VERSION = 2 as const;
export const PRODUCTION_WRITE_ENFORCEMENT_COVERAGE =
  "application_all_classified_write_paths" as const;

export type ProductionWriteOperation =
  | "application_configuration"
  | "mesocycle_acceptance"
  | "mesocycle_lifecycle"
  | "mesocycle_reseed"
  | "workout_materialization"
  | "workout_structural_edit"
  | "workout_save"
  | "finisher_execution"
  | "set_logging"
  | "readiness_preparation"
  | "readiness_submission"
  | "operational_backfill"
  | "operational_seed"
  | "operational_cleanup"
  | "operational_administration"
  | "operational_lifecycle"
  | "operational_principal"
  | "operational_migration";

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

export function productionWritePauseOperationId(input: {
  projectId: string;
  environment: "production";
  commitSha: string;
  deploymentId: string;
}): string {
  return [
    "trainer-write-pause",
    input.projectId,
    input.environment,
    input.commitSha,
    input.deploymentId,
  ].join(":");
}

export function productionWriteRuntimeEvidence(
  commitSha: string,
  environment: Record<string, string | undefined> = process.env,
) {
  const deploymentEnvironment = environment.VERCEL_ENV;
  if (deploymentEnvironment !== "production") {
    throw new Error("Production write status evidence is unavailable outside Vercel production.");
  }
  const deploymentCommit = environment.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
  if (!deploymentCommit || deploymentCommit !== commitSha.trim().toLowerCase()) {
    throw new Error("Production write status commit binding is unavailable.");
  }
  const deploymentId = environment.VERCEL_DEPLOYMENT_ID?.trim();
  if (!deploymentId) {
    throw new Error("Production write status deployment binding is unavailable.");
  }
  const projectId = environment.VERCEL_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error("Production write status project binding is unavailable.");
  }
  return {
    schema: "trainer-production-write-status" as const,
    version: PRODUCTION_WRITE_STATUS_CONTRACT_VERSION,
    environment: "production" as const,
    commitSha: deploymentCommit,
    deploymentId,
    pauseOperationId: productionWritePauseOperationId({
      projectId,
      environment: "production",
      commitSha: deploymentCommit,
      deploymentId,
    }),
    status: productionWriteStatus(environment),
    enforcement: PRODUCTION_WRITE_ENFORCEMENT_COVERAGE,
    enforcementContractVersion: PRODUCTION_WRITE_ENFORCEMENT_CONTRACT_VERSION,
  };
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
