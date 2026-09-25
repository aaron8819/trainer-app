import "next/headers";
import { DraftAccessError } from "./principal";

export const AUTH_HOME = "/trainer2/auth";

export function authConfiguration(env: Record<string, string | undefined> = process.env) {
  const origin = env.TRAINER2_APP_ORIGIN;
  if (!origin) throw new DraftAccessError("AUTHENTICATION_NOT_CONFIGURED");
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password ||
      (url.protocol !== "https:" && !(url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname) && !env.VERCEL))) throw new Error();
  } catch { throw new DraftAccessError("AUTHENTICATION_CONFIGURATION_INVALID"); }
  return { origin };
}

export function assertSessionMutationOrigin(request: Request) {
  const { origin } = authConfiguration();
  if (request.headers.get("origin") !== origin ||
    ![null, "same-origin", "none"].includes(request.headers.get("sec-fetch-site")))
    throw new DraftAccessError("INVALID_ORIGIN");
}
