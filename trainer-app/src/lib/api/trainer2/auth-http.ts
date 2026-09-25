import "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_HOME, assertSessionMutationOrigin, authConfiguration } from "./authentication";
import { databaseFor } from "./database";
import { developmentEnabled } from "./development";
import { DraftAccessError } from "./principal";
import { enterPasscode, revokeSession, SESSION_COOKIE, sessionCookieOptions } from "./sessions";
import { productionWritePauseResponse } from "@/lib/operations/production-write-gate-http";

export function privateAuthResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  response.headers.set("Referrer-Policy", "same-origin");
  return response;
}

/** These POSTs never accept credentials in a URL or return them in a response body. */
export async function authHttp(request: NextRequest, operation: "sign-in" | "setup" | "logout" | "revoke-all") {
  const paused = productionWritePauseResponse("operational_principal", request.nextUrl.pathname);
  if (paused) return privateAuthResponse(paused);
  try {
    if (!developmentEnabled()) throw new DraftAccessError("HOSTED_ADMISSION_DISABLED");
    const { origin } = authConfiguration();
    assertSessionMutationOrigin(request);
    if (request.headers.has("authorization")) throw new DraftAccessError("UNSUPPORTED_CREDENTIAL_TRANSPORT");
    const db = await databaseFor("identity", true);
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
    const response = NextResponse.redirect(origin + AUTH_HOME, 303);
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return privateAuthResponse(response);
  } catch {
    return privateAuthResponse(NextResponse.json({ error: "AUTHENTICATION_FAILED" }, { status: 400 }));
  }
}
