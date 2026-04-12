import type { NextConfig } from "next";
import path from "node:path";

const isUiAuditFixtureMode =
  process.env.UI_AUDIT_FIXTURE_MODE === "1" && process.env.NODE_ENV !== "production";
const uiAuditFixtureDistDir = process.env.UI_AUDIT_NEXT_DIST_DIR?.trim();

const nextConfig: NextConfig = {
  ...(isUiAuditFixtureMode
    ? { distDir: uiAuditFixtureDistDir || ".next-ui-audit/managed" }
    : {}),
  devIndicators: false,
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
