import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { parse } from "dotenv";
import { provisionSingleUser } from "./provision-single-user";

/** One-time operator runner. Never supply an administrator URL to the deployment. */
async function main() {
  if (process.argv.slice(2).join(" ") !== "--confirm-production-synthetic")
    throw new Error("EXPLICIT_SYNTHETIC_CONFIRMATION_REQUIRED");
  const path = process.env.TRAINER2_OPERATOR_ENV_PATH;
  const ca = process.env.TRAINER2_OPERATOR_CA_CERT_PEM;
  const setupCode = process.env.TRAINER2_SYNTHETIC_SETUP_CODE;
  if (!path || !ca?.includes("BEGIN CERTIFICATE") || !setupCode || setupCode.length < 24)
    throw new Error("OPERATOR_CONFIGURATION_REQUIRED");
  const operator = parse(readFileSync(path));
  const url = new URL(operator.DIRECT_URL ?? "");
  if (url.protocol !== "postgresql:" || !url.hostname.endsWith(".pooler.supabase.com") ||
    url.port !== "5432" || url.pathname !== "/postgres" ||
    url.username !== "postgres.siqmohcbvnbdrssgofzu" || !url.password || !operator.OWNER_EMAIL)
    throw new Error("PRODUCTION_TARGET_MISMATCH");
  url.search = "";
  const pool = new Pool({ connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true }, max: 1 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const preflight = await db.$transaction(async tx => {
      const migration = await tx.$queryRaw<Array<{ applied: bigint; incomplete: bigint }>>`
        SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,
               count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS incomplete
        FROM public._prisma_migrations`;
      const realOwner = await tx.user.findMany({ where: { email: operator.OWNER_EMAIL }, select: { id: true }, take: 2 });
      const [ownerCount, principalCount, sessionCount, userCount] = await Promise.all([
        tx.trainer2Owner.count(), tx.trainer2AccountPrincipal.count(), tx.trainer2DeviceSession.count(), tx.user.count(),
      ]);
      return { migration: migration[0], realOwnerCount: realOwner.length, ownerCount, principalCount, sessionCount, userCount };
    }, { isolationLevel: "Serializable" });
    if (preflight.migration?.applied !== BigInt(35) || preflight.migration.incomplete !== BigInt(0) ||
      preflight.realOwnerCount !== 1 || preflight.ownerCount !== 0 ||
      preflight.principalCount !== 0 || preflight.sessionCount !== 0)
      throw new Error("SYNTHETIC_PROVISION_PREFLIGHT_FAILED");
    const id = randomUUID();
    const email = `trainer2-hosted-synthetic-${id}@example.invalid`;
    await db.user.create({ data: { id, email } });
    await provisionSingleUser(db, id, setupCode);
    const owner = await db.trainer2Owner.findUnique({ where: { id: 1 }, select: { accountId: true } });
    if (owner?.accountId !== id) throw new Error("SYNTHETIC_OWNER_POSTCHECK_FAILED");
    console.log(JSON.stringify({ syntheticUserId: id, syntheticEmail: email,
      v1UserCountBefore: preflight.userCount, v1UserCountAfter: preflight.userCount + 1,
      trainer2OwnerCount: 1, trainer2SessionCount: 0 }));
  } finally {
    await db.$disconnect();
    await pool.end();
  }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "SYNTHETIC_PROVISION_FAILED"); process.exitCode = 1; });
