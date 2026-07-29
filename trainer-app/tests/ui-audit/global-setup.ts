import type { FullConfig } from "@playwright/test";

const FIXTURE_HEADER = "x-ui-audit-fixture";

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== "string") {
    throw new Error("UI audit baseURL is not configured.");
  }

  const response = await fetch(
    new URL("/ui-audit-fixture/ready", baseURL),
    {
      headers: { [FIXTURE_HEADER]: "active" },
      signal: AbortSignal.timeout(120_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (
    response.status !== 200 ||
    body?.status !== "ready" ||
    body?.database !== "unused"
  ) {
    throw new Error(
      `UI audit fixture readiness failed closed with status ${response.status}.`,
    );
  }
}
