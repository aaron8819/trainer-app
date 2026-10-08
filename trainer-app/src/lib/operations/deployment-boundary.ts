export type BuiltMode = "v1" | "preview" | "hosted-test" | "v2-production";
// Next replaces this direct reference in the server artifact at build time.
const BOUND_BUILD_MODE = process.env.TRAINER_BUILT_MODE;

/** The built value is injected by next.config.ts; the runtime value is never defaulted for Preview. */
export function deploymentDecision(input: { built: string | undefined; runtime: string | undefined;
  vercelEnvironment: string | undefined; legacyCredentialsPresent: boolean;
  restrictedCredentialsPresent?: boolean; restrictedCredentialsAny?: boolean;
  hostedConfigurationPresent?: boolean; productionOriginValid?: boolean }) {
  if (!input.built || !["v1", "preview", "hosted-test", "v2-production"].includes(input.built)) return "deny" as const;
  if (input.built === "v2-production") {
    return input.runtime === "v2-production" && input.vercelEnvironment === "production" &&
      !input.legacyCredentialsPresent && input.restrictedCredentialsPresent &&
      input.hostedConfigurationPresent && input.productionOriginValid
      ? "v2-production" as const : "deny" as const;
  }
  if (input.built === "hosted-test") {
    return input.runtime === "hosted-test" && input.vercelEnvironment === "preview" &&
      !input.legacyCredentialsPresent && input.restrictedCredentialsPresent &&
      input.hostedConfigurationPresent ? "hosted-test" as const : "deny" as const;
  }
  if (input.built === "preview") {
    return input.runtime === "preview" && input.vercelEnvironment !== "production" &&
      !input.legacyCredentialsPresent && !input.restrictedCredentialsAny ? "preview" as const : "deny" as const;
  }
  return (input.runtime === undefined || input.runtime === "" || input.runtime === "v1") &&
    input.vercelEnvironment !== "preview" ? "v1" as const : "deny" as const;
}

export function currentDeploymentDecision(env: Record<string, string | undefined> = process.env) {
  return deploymentDecision({ built: BOUND_BUILD_MODE ?? env.TRAINER_BUILT_MODE ?? (!env.VERCEL && !env.VERCEL_ENV ? "v1" : undefined), runtime: env.TRAINER_DEPLOYMENT_MODE,
    vercelEnvironment: env.VERCEL_ENV,
    legacyCredentialsPresent: !!(env.DATABASE_URL || env.DIRECT_URL || env.OWNER_EMAIL || env.DATABASE_SSL_NO_VERIFY),
    restrictedCredentialsPresent: !!(env.TRAINER2_IDENTITY_CONNECTION_STRING && env.TRAINER2_READ_CONNECTION_STRING && env.TRAINER2_WRITE_CONNECTION_STRING),
    restrictedCredentialsAny: !!(env.TRAINER2_IDENTITY_CONNECTION_STRING || env.TRAINER2_READ_CONNECTION_STRING || env.TRAINER2_WRITE_CONNECTION_STRING),
    hostedConfigurationPresent: !!(env.TRAINER2_DB_CA_CERT_PEM && env.TRAINER2_OWNER_USER_ID && env.TRAINER2_APP_ORIGIN),
    productionOriginValid: validProductionOrigin(env.TRAINER2_APP_ORIGIN) });
}

function validProductionOrigin(origin: string | undefined): boolean {
  try {
    const url = new URL(origin ?? "");
    return url.protocol === "https:" && url.origin === origin && !url.username && !url.password;
  } catch { return false; }
}

export function assertLegacyDatabaseAllowed() {
  if (isIsolatedBuildCollection()) {
    if (process.env.DATABASE_URL || process.env.DIRECT_URL || process.env.OWNER_EMAIL || process.env.DATABASE_SSL_NO_VERIFY ||
      (BOUND_BUILD_MODE === "preview" && (process.env.TRAINER2_IDENTITY_CONNECTION_STRING ||
        process.env.TRAINER2_READ_CONNECTION_STRING || process.env.TRAINER2_WRITE_CONNECTION_STRING)))
      throw new Error("PREVIEW_BUILD_INHERITED_DATABASE_CREDENTIALS");
    return;
  }
  if (currentDeploymentDecision() !== "v1") throw new Error("LEGACY_DATABASE_UNAVAILABLE");
}

export function previewBuildPlaceholder() {
  return isIsolatedBuildCollection() ? "postgresql://blocked:blocked@127.0.0.1:9/blocked" : undefined;
}

function isIsolatedBuildCollection() {
  return process.env["NEXT_PHASE"] === "phase-production-build" &&
    (["preview", "hosted-test", "v2-production"].includes(BOUND_BUILD_MODE ?? "") ||
      ["preview", "hosted-test", "v2-production"].includes(process.env.TRAINER_BUILD_MODE ?? ""));
}
