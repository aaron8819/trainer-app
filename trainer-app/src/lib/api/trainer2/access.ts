import { assertLocalRequest, developmentEnabled } from "./development";
import { databaseFor } from "./database";
import { DraftAccessError, resolveAccount } from "./principal";
import { renewSession } from "./sessions";
import { assertSessionMutationOrigin } from "./authentication";
import { productionWriteStatus } from "@/lib/operations/production-write-gate";
import { currentDeploymentDecision } from "@/lib/operations/deployment-boundary";

export function hostedTestEnabled() { return currentDeploymentDecision() === "hosted-test"; }

export async function requestContext(request: Request, purpose: "read" | "write", renew = true) {
  const local = developmentEnabled();
  if (!local && !hostedTestEnabled()) throw new DraftAccessError("HOSTED_ADMISSION_DISABLED");
  if (local) assertLocalRequest(request);
  if (purpose === "write") assertSessionMutationOrigin(request);
  const identity = await databaseFor("identity", local);
  const principal = await resolveAccount(identity, request);
  if (renew && productionWriteStatus() !== "PAUSED") await renewSession(identity, request);
  return { db: await databaseFor(purpose, local), principal };
}
