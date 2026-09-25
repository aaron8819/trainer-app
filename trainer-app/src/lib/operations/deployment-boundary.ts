export type BuiltMode = "v1" | "preview";
// Next replaces this direct reference in the server artifact at build time.
const BOUND_BUILD_MODE = process.env.TRAINER_BUILT_MODE;

/** The built value is injected by next.config.ts; the runtime value is never defaulted for Preview. */
export function deploymentDecision(input: { built: string | undefined; runtime: string | undefined;
  vercelEnvironment: string | undefined; legacyCredentialsPresent: boolean }) {
  if (!input.built || !["v1", "preview"].includes(input.built)) return "deny" as const;
  if (input.built === "preview") {
    return input.runtime === "preview" && input.vercelEnvironment !== "production" &&
      !input.legacyCredentialsPresent ? "preview" as const : "deny" as const;
  }
  return (input.runtime === undefined || input.runtime === "" || input.runtime === "v1") &&
    input.vercelEnvironment !== "preview" ? "v1" as const : "deny" as const;
}

export function currentDeploymentDecision(env: Record<string, string | undefined> = process.env) {
  return deploymentDecision({ built: BOUND_BUILD_MODE ?? env.TRAINER_BUILT_MODE ?? (!env.VERCEL && !env.VERCEL_ENV ? "v1" : undefined), runtime: env.TRAINER_DEPLOYMENT_MODE,
    vercelEnvironment: env.VERCEL_ENV,
    legacyCredentialsPresent: !!(env.DATABASE_URL || env.DIRECT_URL || env.OWNER_EMAIL || env.DATABASE_SSL_NO_VERIFY ||
      env.TRAINER2_IDENTITY_CONNECTION_STRING || env.TRAINER2_READ_CONNECTION_STRING || env.TRAINER2_WRITE_CONNECTION_STRING) });
}

export function assertLegacyDatabaseAllowed() {
  if (isPreviewBuildCollection()) {
    if (process.env.DATABASE_URL || process.env.DIRECT_URL || process.env.OWNER_EMAIL || process.env.DATABASE_SSL_NO_VERIFY ||
      process.env.TRAINER2_IDENTITY_CONNECTION_STRING || process.env.TRAINER2_READ_CONNECTION_STRING || process.env.TRAINER2_WRITE_CONNECTION_STRING)
      throw new Error("PREVIEW_BUILD_INHERITED_DATABASE_CREDENTIALS");
    return;
  }
  if (currentDeploymentDecision() !== "v1") throw new Error("LEGACY_DATABASE_UNAVAILABLE");
}

export function previewBuildPlaceholder() {
  return isPreviewBuildCollection() ? "postgresql://blocked:blocked@127.0.0.1:9/blocked" : undefined;
}

function isPreviewBuildCollection() {
  return process.env["NEXT_PHASE"] === "phase-production-build" &&
    (BOUND_BUILD_MODE === "preview" || process.env.TRAINER_BUILD_MODE === "preview");
}
