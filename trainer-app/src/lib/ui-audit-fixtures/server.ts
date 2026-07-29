import { headers } from "next/headers";
import {
  getUiAuditFixtureByScenario,
  type UiAuditFixture,
} from "./fixtures";
import {
  UI_AUDIT_FIXTURE_HEADER,
  authorizeUiAuditFixtureRequest,
  isUiAuditFixtureModeEnabled as isFixtureModeEnabled,
} from "./access";

export { UI_AUDIT_FIXTURE_HEADER };

export function isUiAuditFixtureModeEnabled(): boolean {
  return isFixtureModeEnabled({
    mode: process.env.UI_AUDIT_FIXTURE_MODE,
    nodeEnv: process.env.NODE_ENV,
  });
}

function resolveScenarioFromHeaders(requestHeaders: Headers) {
  return authorizeUiAuditFixtureRequest({
    mode: process.env.UI_AUDIT_FIXTURE_MODE,
    nodeEnv: process.env.NODE_ENV,
    requestHeader: requestHeaders.get(UI_AUDIT_FIXTURE_HEADER),
  });
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
