import "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_HOME, assertSessionMutationOrigin, authConfiguration } from "./authentication";
import { databaseFor } from "./database";
import { developmentEnabled } from "./development";
import { DraftAccessError } from "./principal";
import { enterPasscode, revokeSession, replacePasscode, SESSION_COOKIE, sessionCookieOptions } from "./sessions";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";
import { hostedEnabled, assertProductionRequest } from "./access";
import { privateAuthResponse } from "./auth-response";

/** These POSTs never accept credentials in a URL or return them in a response body. */
export async function authHttp(request: NextRequest, operation: "sign-in" | "setup" | "logout" | "revoke-all" | "replace-passcode") {
  const paused = productionWritePauseResponse("operational_principal", request.nextUrl.pathname);
  if (paused) return privateAuthResponse(paused);
  try {
    if (!developmentEnabled() && !hostedEnabled()) throw new DraftAccessError("HOSTED_ADMISSION_DISABLED");
    assertProductionRequest(request);
    const { origin } = authConfiguration();
    assertSessionMutationOrigin(request);
    if (request.headers.has("authorization")) throw new DraftAccessError("UNSUPPORTED_CREDENTIAL_TRANSPORT");
    const db = await databaseFor("identity", developmentEnabled());
    if (operation === "replace-passcode") {
      const body = await request.text();
      if (body.length > 4096) throw new DraftAccessError("INVALID_INPUT");
      const form = new URLSearchParams(body);
      const fields = ["accountId", "epoch", "passcode", "confirmation"];
      if ([...form.keys()].some(key => !fields.includes(key)) ||
        fields.some(key => form.getAll(key).length !== 1) ||
        !/^(0|[1-9][0-9]{0,9})$/.test(form.get("epoch")!))
        throw new DraftAccessError("INVALID_INPUT");
      await replacePasscode(db, request, {
        accountId: form.get("accountId")!, epoch: Number(form.get("epoch")),
        passcode: form.get("passcode")!, confirmation: form.get("confirmation")!,
      });
      const response = NextResponse.redirect(origin + AUTH_HOME, 303);
      response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
      return privateAuthResponse(response);
    }
    if (operation === "logout" || operation === "revoke-all") {
      await revokeSession(db, request, operation === "revoke-all");
      const response = NextResponse.redirect(origin + AUTH_HOME, 303);
      response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
      return privateAuthResponse(response);
    }
    const body = await request.text();
    if (body.length > 512) throw new DraftAccessError("INVALID_INPUT");
    const form = new URLSearchParams(body);
    if ([...form.keys()].some(k => !["passcode", "setupCode"].includes(k)) ||
      form.getAll("passcode").length !== 1 || form.getAll("setupCode").length > 1)
      throw new DraftAccessError("INVALID_INPUT");
    const passcode = form.get("passcode") ?? "";
    const token = await enterPasscode(db, operation === "setup"
      ? { setupCode: form.get("setupCode") ?? "", passcode }
      : { passcode });
    const response = NextResponse.redirect(origin + "/trainer2", 303);
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return privateAuthResponse(response);
  } catch {
    return privateAuthResponse(NextResponse.json({ error: "AUTHENTICATION_FAILED" }, { status: 400 }));
  }
}
