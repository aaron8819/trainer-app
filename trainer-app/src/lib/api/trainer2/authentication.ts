import "next/headers";
import { createServerClient, parseCookieHeader, type CookieOptions } from "@supabase/ssr";
import { DraftAccessError, type VerifiedPrincipal } from "./principal";

export const AUTH_COOKIE = "trainer2-auth";
export const AUTH_HOME = "/trainer2/auth";
export type AuthConfig = ReturnType<typeof authConfiguration>;
export type CookieChange = { name: string; value: string; options: CookieOptions };

/** Only server configuration selects the verification endpoint and trust domain. */
export function authConfiguration(env: Record<string, string | undefined> = process.env) {
  const { TRAINER2_AUTH_URL: url, TRAINER2_AUTH_PUBLISHABLE_KEY: key,
    TRAINER2_AUTH_ISSUER: issuer, TRAINER2_AUTH_AUDIENCE: audience,
    TRAINER2_APP_ORIGIN: origin } = env;
  if (!url || !key || !issuer || !audience || !origin)
    throw new DraftAccessError("AUTHENTICATION_NOT_CONFIGURED");
  try {
    for (const value of [url, origin]) {
      const parsed = new URL(value);
      if (parsed.origin !== value || parsed.username || parsed.password ||
        (parsed.protocol !== "https:" && !(parsed.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(parsed.hostname) && !env.VERCEL))) throw new Error();
    }
    if (issuer !== `${url}/auth/v1` || audience !== "authenticated" || key.trim() !== key)
      throw new Error();
  } catch { throw new DraftAccessError("AUTHENTICATION_CONFIGURATION_INVALID"); }
  return { url, key, issuer, audience, origin };
}

export function authCookieOptions(config: AuthConfig): CookieOptions {
  return { path: "/", sameSite: "lax", secure: config.origin.startsWith("https:"), httpOnly: false };
}

export function requestAuthClient(request: Request, config: AuthConfig, write: (changes: CookieChange[]) => void = () => {}) {
  const jar = new Map(parseCookieHeader(request.headers.get("cookie") ?? "").map(c => [c.name, c.value ?? ""]));
  return createServerClient(config.url, config.key, {
    cookieOptions: { name: AUTH_COOKIE, ...authCookieOptions(config) },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(5000) }) },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: changes => { for (const c of changes) jar.set(c.name, c.value); write(changes); },
    },
  });
}

/** getSession supplies transport only. Both verification calls use that exact token.
 * getUser is deliberate: even cached signing keys cannot mask provider failure. */
export async function verifyAuthSession(client: ReturnType<typeof requestAuthClient>, config: AuthConfig): Promise<VerifiedPrincipal> {
  try {
    const session = await client.auth.getSession();
    const token = session.data.session?.access_token;
    if (session.error || !token) throw new Error();
    const verified = await client.auth.getClaims(token);
    if (verified.error || !verified.data) throw new Error();
    const claims = verified.data.claims;
    const now = Date.now() / 1000;
    if (claims.iss !== config.issuer || claims.aud !== config.audience ||
      typeof claims.sub !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub) ||
      !Number.isFinite(claims.exp) || claims.exp <= now ||
      !Number.isFinite(claims.iat) || claims.iat > now ||
      (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now))) throw new Error();
    const user = await client.auth.getUser(token);
    if (user.error || user.data.user?.id !== claims.sub) throw new Error();
    return { issuer: config.issuer, subject: claims.sub };
  } catch { throw new DraftAccessError("UNAUTHENTICATED"); }
}

export async function authenticateHostedRequest(request: Request): Promise<VerifiedPrincipal> {
  const config = authConfiguration();
  // Cookie-only contract. Reject bearer-only and conflicting dual transports alike.
  if (request.headers.has("authorization")) throw new DraftAccessError("UNSUPPORTED_CREDENTIAL_TRANSPORT");
  return verifyAuthSession(requestAuthClient(request, config), config);
}
