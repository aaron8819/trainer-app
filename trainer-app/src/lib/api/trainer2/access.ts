import { AdmissionInfrastructureError } from "./admission-diagnostics";
import { assertLocalRequest, developmentEnabled } from "./development";
import { databaseFor } from "./database";
import { DraftAccessError, resolveAccount } from "./principal";
import { renewSession } from "./sessions";
import { assertSessionMutationOrigin } from "./authentication";
import { productionWriteStatus } from "@/lib/operations/production-write-gate";
import { currentDeploymentDecision } from "@/lib/operations/deployment-boundary";

export function hostedTestEnabled() { return currentDeploymentDecision() === "hosted-test"; }
export function hostedEnabled() {
  return hostedTestEnabled() || currentDeploymentDecision() === "v2-production";
}
export function assertProductionRequest(request: Request): void {
  if (currentDeploymentDecision() !== "v2-production") return;
  if (request.headers.get("host") !== new URL(process.env.TRAINER2_APP_ORIGIN!).host)
    throw new DraftAccessError("HOSTED_ADMISSION_DISABLED");
}

export async function requestContext(request: Request, purpose: "read" | "write", renew = true) {
  const local = developmentEnabled();
  if (!local && !hostedEnabled()) throw new DraftAccessError("HOSTED_ADMISSION_DISABLED");
  assertProductionRequest(request);
  if (local) assertLocalRequest(request);
  if (purpose === "write") assertSessionMutationOrigin(request);
  let phase = 'identity-database';
  try {
  const identity = await databaseFor("identity", local);
  phase = 'session-resolution';
  const principal = await resolveAccount(identity, request);
  phase = 'session-renewal';
  if (renew && productionWriteStatus() !== "PAUSED") await renewSession(identity, request);
  phase = purpose + '-database';
  return { db: await databaseFor(purpose, local), principal };
  } catch (error) {
    if (error instanceof DraftAccessError || error instanceof AdmissionInfrastructureError) throw error;
    throw new AdmissionInfrastructureError(phase, error);
  }
}
