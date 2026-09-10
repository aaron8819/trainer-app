import "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, AUTH_HOME, authConfiguration, authCookieOptions, requestAuthClient, verifyAuthSession, type AuthConfig, type CookieChange } from "./authentication";
import { DraftAccessError } from "./principal";

export function privateAuthResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie, Authorization");
  // no-referrer on the form page makes Chromium send Origin: null on its POST.
  response.headers.set("Referrer-Policy", response.headers.get("Referrer-Policy") ?? "same-origin");
  return response;
}

export function authDestination(value: string | null) {
  // Exact allowlist, checked before URL normalization. No arbitrary paths or decoding.
  if (value !== null && value !== AUTH_HOME) throw new DraftAccessError("INVALID_REDIRECT");
  return AUTH_HOME;
}

export function assertAuthMutation(request: Request, config: AuthConfig) {
  if (request.method !== "POST" || request.headers.get("origin") !== config.origin ||
    ![null, "same-origin", "none"].includes(request.headers.get("sec-fetch-site")))
    throw new DraftAccessError("INVALID_ORIGIN");
}

function applyCookies(response: NextResponse, changes: CookieChange[]) {
  for (const c of changes) response.cookies.set(c.name, c.value, c.options);
  return privateAuthResponse(response);
}

export function clearAuthCookies(request: NextRequest, config: AuthConfig, response: NextResponse) {
  for (const c of [...request.cookies.getAll(), ...response.cookies.getAll()]) {
    if (c.name === AUTH_COOKIE || c.name.startsWith(AUTH_COOKIE + ".") ||
      c.name === AUTH_COOKIE + "-code-verifier" || c.name.startsWith(AUTH_COOKIE + "-code-verifier."))
      response.cookies.set(c.name, "", { ...authCookieOptions(config), maxAge: 0 });
  }
  return response;
}

export async function authHttp(request: NextRequest, operation: "sign-in" | "callback" | "logout") {
  let config: AuthConfig;
  const changes: CookieChange[] = [];
  try {
    config = authConfiguration();
    if (request.headers.has("authorization")) throw new DraftAccessError("UNSUPPORTED_CREDENTIAL_TRANSPORT");
    if (operation !== "callback") assertAuthMutation(request, config);
    const client = requestAuthClient(request, config, c => changes.push(...c));
    if (operation === "sign-in") {
      const body = await request.text();
      if (body.length > 4096) throw new DraftAccessError("INVALID_INPUT");
      const form = new URLSearchParams(body);
      authDestination(form.get("next"));
      const email = form.get("email") ?? "";
      // Same response for absent users, malformed emails, provider failures and success.
      if (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        try { await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false,
          emailRedirectTo: config.origin + AUTH_HOME + "/callback" } }); } catch { /* generic response */ }
      }
      return applyCookies(NextResponse.redirect(config.origin + AUTH_HOME + "?notice=sent", 303), changes);
    }
    if (operation === "logout") {
      // Local scope revokes this session's refresh token; other devices stay signed in.
      let failed = false;
      try { failed = !!(await client.auth.signOut({ scope: "local" })).error; } catch { failed = true; }
      const response = applyCookies(NextResponse.redirect(config.origin + AUTH_HOME + (failed ? "?notice=logout-incomplete" : "?notice=signed-out"), 303), changes);
      return clearAuthCookies(request, config, response);
    }
    const params = request.nextUrl.searchParams;
    authDestination(params.get("next"));
    if ([...params.keys()].some(k => !["code", "next"].includes(k)) ||
      params.getAll("code").length !== 1 || params.getAll("next").length > 1 ||
      !/^[0-9a-f-]{36}$/i.test(params.get("code") ?? "")) throw new DraftAccessError("INVALID_CALLBACK");
    // SSR owns the browser-bound PKCE verifier cookie. Token hashes/implicit flows are not accepted.
    const exchanged = await client.auth.exchangeCodeForSession(params.get("code")!);
    if (exchanged.error) throw new DraftAccessError("INVALID_CALLBACK");
    await verifyAuthSession(client, config);
    return applyCookies(NextResponse.redirect(config.origin + AUTH_HOME, {
      status: 303, headers: { "Referrer-Policy": "no-referrer" },
    }), changes);
  } catch (error) {
    // Never expose provider error text, codes, cookies, tokens or email addresses.
    const response = privateAuthResponse(NextResponse.json({ error:
      error instanceof DraftAccessError && ["INVALID_ORIGIN", "INVALID_REDIRECT", "UNSUPPORTED_CREDENTIAL_TRANSPORT"].includes(error.message)
        ? error.message : "AUTHENTICATION_FAILED" }, { status: 400,
          headers: operation === "callback" ? { "Referrer-Policy": "no-referrer" } : undefined }));
    // Discard pending callback cookies on failure. Preserve any pre-existing valid
    // session: an unsolicited invalid callback must not become a logout-CSRF path.
    return response;
  }
}

/** Run before identity-dependent routes; propagate refreshed cookies to both RSC and browser. */
export async function refreshAuthRequest(request: NextRequest) {
  let response = NextResponse.next({ request });
  try {
    const config = authConfiguration();
    if (request.headers.has("authorization")) return privateAuthResponse(response);
    const client = requestAuthClient(request, config, changes => {
      for (const c of changes) request.cookies.set(c.name, c.value);
      const next = NextResponse.next({ request });
      for (const c of response.cookies.getAll()) next.cookies.set(c);
      response = applyCookies(next, changes);
    });
    await verifyAuthSession(client, config);
  } catch { /* downstream verifier independently denies; no synthetic identity header */ }
  return privateAuthResponse(response);
}
