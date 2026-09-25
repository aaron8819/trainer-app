import type { NextConfig } from "next";
import path from "node:path";

const isUiAuditFixtureMode =
  process.env.UI_AUDIT_FIXTURE_MODE === "1" && process.env.NODE_ENV !== "production";
const uiAuditFixtureDistDir = process.env.UI_AUDIT_NEXT_DIST_DIR?.trim();

const nextConfig: NextConfig = {
  env: { TRAINER_BUILT_MODE: process.env.TRAINER_BUILD_MODE === "preview" ||
    process.env.VERCEL_ENV === "preview" ? "preview" : "v1" },
  ...(isUiAuditFixtureMode
    ? { distDir: uiAuditFixtureDistDir || ".next-ui-audit/managed" }
    : {}),
  devIndicators: false,
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
