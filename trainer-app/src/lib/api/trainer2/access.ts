import { assertLocalRequest, developmentEnabled } from "./development";
import { databaseFor } from "./database";
import { DraftAccessError, resolveAccount } from "./principal";
import { renewSession } from "./sessions";
import { assertSessionMutationOrigin } from "./authentication";
import { productionWriteStatus } from "@/lib/operations/production-write-gate";

// No flag can enable hosted Draft/training admission in this slice.
export function assertHostedAdmission(): never { throw new DraftAccessError("HOSTED_ADMISSION_DISABLED"); }

export async function requestContext(request: Request, purpose: "read" | "write") {
  const local = developmentEnabled();
  if (local) assertLocalRequest(request);
  if (purpose === "write") assertSessionMutationOrigin(request);
  const identity = await databaseFor("identity", local);
  const principal = await resolveAccount(identity, request);
  if (productionWriteStatus() !== "PAUSED") await renewSession(identity, request);
  if (!local) return assertHostedAdmission();
  return { db: await databaseFor(purpose, true), principal };
}
