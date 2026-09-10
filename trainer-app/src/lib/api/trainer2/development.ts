import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { DraftAccessError, type ServerPrincipal } from "./planning";

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
let localDb: PrismaClient | undefined;
export async function developmentContext(): Promise<{ db: PrismaClient; principal: ServerPrincipal }> {
  if (!developmentEnabled()) throw new DraftAccessError("LOCAL_ONLY");
  // This slice cannot connect to an arbitrary local/shared target or privileged role.
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.username !== "trainer2_draft_runtime" ||
      !/^\/trainer2_disposable_[a-z0-9_]+$/.test(url.pathname) || url.search) throw new DraftAccessError("DISPOSABLE_TARGET_REQUIRED");
  localDb ??= new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url.toString(), max: 5 })) });
  const roles = await localDb.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
  if (roles[0]?.current_user !== "trainer2_draft_runtime") throw new DraftAccessError("RUNTIME_ROLE_REQUIRED");
  const mapping = await localDb.trainer2AccountPrincipal.findUnique({ where: { issuer_subject: { issuer: "trainer2-local-disposable", subject: "developer" } } });
  if (!mapping) throw new DraftAccessError("DEVELOPMENT_PRINCIPAL_NOT_PROVISIONED");
  return { db: localDb, principal: { issuer: mapping.issuer, subject: mapping.subject, accountId: mapping.accountId } };
}
