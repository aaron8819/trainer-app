import { headers } from "next/headers";
import {
  UI_AUDIT_FIXTURE_SCENARIOS,
  getUiAuditFixtureByScenario,
  type UiAuditFixture,
  type UiAuditFixtureScenario,
} from "./fixtures";

export const UI_AUDIT_FIXTURE_HEADER = "x-ui-audit-fixture";

function isUiAuditFixtureScenario(value: string | null | undefined): value is UiAuditFixtureScenario {
  return UI_AUDIT_FIXTURE_SCENARIOS.includes(value as UiAuditFixtureScenario);
}

export function isUiAuditFixtureModeEnabled(): boolean {
  return process.env.UI_AUDIT_FIXTURE_MODE === "1" && process.env.NODE_ENV !== "production";
}

function resolveScenarioFromHeaders(requestHeaders: Headers | null): UiAuditFixtureScenario | null {
  if (!isUiAuditFixtureModeEnabled()) {
    return null;
  }

  const requestedScenario =
    requestHeaders?.get(UI_AUDIT_FIXTURE_HEADER) ?? process.env.UI_AUDIT_FIXTURE_SCENARIO;

  return isUiAuditFixtureScenario(requestedScenario) ? requestedScenario : null;
}

export function getUiAuditFixtureFromHeaders(requestHeaders: Headers): UiAuditFixture | null {
  const scenario = resolveScenarioFromHeaders(requestHeaders);
  return scenario ? getUiAuditFixtureByScenario(scenario) : null;
}

export async function getUiAuditFixtureForServer(): Promise<UiAuditFixture | null> {
  const requestHeaders = await headers();
  const scenario = resolveScenarioFromHeaders(requestHeaders);
  return scenario ? getUiAuditFixtureByScenario(scenario) : null;
}
