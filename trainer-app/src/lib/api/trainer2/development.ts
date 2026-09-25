import { DraftAccessError } from "./principal";

export function developmentEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "development" && env.TRAINER2_LOCAL_DRAFTS === "enabled" &&
    !env.VERCEL && !env.VERCEL_ENV && !env.CI && !env.NETLIFY && !env.RENDER && !env.WEBSITE_SITE_NAME;
}
export function assertLocalRequest(request: Request) {
  // Next may normalize request.url to its internal hostname. Validate the
  // browser-facing Host (including port) against Origin instead.
  const url = new URL(`http://${request.headers.get("host") ?? new URL(request.url).host}`);
  if (!developmentEnabled() || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new DraftAccessError("LOCAL_ONLY");
  if (request.method !== "GET" && request.headers.get("origin") !== url.origin) throw new DraftAccessError("ORIGIN_MISMATCH");
}
