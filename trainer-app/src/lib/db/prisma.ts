import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Missing DATABASE_URL");
}

const disableVerify = process.env.DATABASE_SSL_NO_VERIFY === "true";
const ssl = disableVerify ? { rejectUnauthorized: false } : undefined;

const sanitizedConnectionString = (() => {
  if (!disableVerify) {
    return connectionString;
  }
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");
  return url.toString();
})();

const pool = new Pool({ connectionString: sanitizedConnectionString, ssl });
const adapter = new PrismaPg(pool);

export const prisma =
  globalThis.prisma ??
  new PrismaClient({
    adapter,
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}
