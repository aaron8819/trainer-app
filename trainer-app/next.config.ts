import type { NextConfig } from "next";
import path from "node:path";

const isUiAuditFixtureMode =
  process.env.UI_AUDIT_FIXTURE_MODE === "1" && process.env.NODE_ENV !== "production";
const uiAuditFixtureDistDir = process.env.UI_AUDIT_NEXT_DIST_DIR?.trim();
const buildMode = process.env.TRAINER_BUILD_MODE === "hosted-test" ? "hosted-test" :
  process.env.TRAINER_BUILD_MODE === "preview" || process.env.VERCEL_ENV === "preview" ? "preview" : "v1";

if (buildMode === "hosted-test" &&
  (process.env.VERCEL_ENV !== "preview" || process.env.DATABASE_URL || process.env.DIRECT_URL ||
    process.env.OWNER_EMAIL || process.env.DATABASE_SSL_NO_VERIFY))
  throw new Error("HOSTED_TEST_BUILD_CONFIGURATION_INVALID");

const nextConfig: NextConfig = {
  env: { TRAINER_BUILT_MODE: buildMode },
  ...(isUiAuditFixtureMode
    ? { distDir: uiAuditFixtureDistDir || ".next-ui-audit/managed" }
    : {}),
  devIndicators: false,
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
