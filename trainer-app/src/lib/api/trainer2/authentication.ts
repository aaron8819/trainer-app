import "next/headers";
import { DraftAccessError, type VerifiedPrincipal } from "./principal";

/** Provider integration is absent. There is deliberately no environment-selectable fixture,
 * forwarded-header identity, owner fallback, or unverified token decoder here.
 * Replace only after the provider/application and verification contract are established. */
export async function authenticateHostedRequest(_request: Request): Promise<VerifiedPrincipal> {
  void _request;
  throw new DraftAccessError("AUTHENTICATION_NOT_CONFIGURED");
}
