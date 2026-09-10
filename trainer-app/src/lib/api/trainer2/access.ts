import { authenticateHostedRequest } from "./authentication";
import { assertLocalRequest, developmentContext, developmentEnabled } from "./development";
import { databaseFor } from "./database";
import { DraftAccessError, resolveAccount } from "./principal";

// No flag can enable hosted Draft/training admission in this slice.
export function assertHostedAdmission(): never { throw new DraftAccessError("HOSTED_ADMISSION_DISABLED"); }

export async function requestContext(request: Request, purpose: "read" | "write") {
  if (developmentEnabled()) {
    assertLocalRequest(request);
    return developmentContext(purpose);
  }
  // Authentication failure propagates. Never retry with the development identity.
  const verified = await authenticateHostedRequest(request);
  await resolveAccount(await databaseFor("identity", false), verified);
  // When admission is separately implemented, validate configured canonical origin
  // for cookie mutations before opening a write connection. No write pool opens here.
  return assertHostedAdmission();
}
