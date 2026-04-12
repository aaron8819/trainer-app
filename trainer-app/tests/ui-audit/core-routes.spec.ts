import { expect, test, type Page } from "@playwright/test";

const CORE_ROUTES = [
  { key: "home", label: "Home", path: "/", heading: /Today's Training|Mesocycle Handoff/i },
  { key: "program", label: "Program", path: "/program", heading: /My Program/i },
  { key: "history", label: "History", path: "/history", heading: /Workout History/i },
  { key: "analytics", label: "Analytics", path: "/analytics", heading: /Analytics/i },
  { key: "settings", label: "Settings", path: "/settings", heading: /Settings/i },
] as const;

const MOBILE_NAV_ITEM_COUNT = CORE_ROUTES.length;
const FIXTURE_HEADER = "x-ui-audit-fixture";

type CoreRoute = (typeof CORE_ROUTES)[number];
type AuditScenarioKey = "active" | "empty" | "handoff";

const ROUTES_BY_KEY = Object.fromEntries(
  CORE_ROUTES.map((route) => [route.key, route])
) as Record<CoreRoute["key"], CoreRoute>;

const AUDIT_SCENARIOS: Array<{
  key: AuditScenarioKey;
  description: string;
  routes: CoreRoute[];
}> = [
  {
    key: "active",
    description: "active mesocycle with populated route state",
    routes: [...CORE_ROUTES],
  },
  {
    key: "empty",
    description: "empty-ish program setup state",
    routes: [ROUTES_BY_KEY.home, ROUTES_BY_KEY.program],
  },
  {
    key: "handoff",
    description: "pending handoff state",
    routes: [ROUTES_BY_KEY.home],
  },
];

test.describe("core route UI audit", () => {
  for (const scenario of AUDIT_SCENARIOS) {
    test.describe(`${scenario.key} fixture`, () => {
      for (const route of scenario.routes) {
        test(`${route.key} renders ${scenario.description}`, async ({ page }, testInfo) => {
          await page.setExtraHTTPHeaders({ [FIXTURE_HEADER]: scenario.key });
          await openRoute(page, route);
          await waitForStableRoute(page);

          await expect(page.getByRole("heading", { name: route.heading }).first()).toBeVisible();
          await expect(page.locator("main").first()).toBeVisible();
          await expect(page.locator("body")).not.toContainText(
            /Application error|Internal Server Error|Unhandled Runtime Error|This page could not be found/i
          );
          await expectMainWithinViewport(page);

          if (testInfo.project.name === "mobile") {
            await expectMobileBottomNav(page);
          }

          await expect(page).toHaveScreenshot(
            buildAuditScreenshotName({
              route: route.key,
              viewport: testInfo.project.name,
              state: scenario.key,
            })
          );
        });
      }
    });
  }
});

async function openRoute(page: Page, route: CoreRoute) {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  if (route.path === "/") {
    await expect(page).toHaveURL(/\/$/);
    return;
  }

  const nav = page.getByRole("navigation");
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: route.label }).click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegex(route.path)}/?$`));
}

async function waitForStableRoute(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
}

async function expectMainWithinViewport(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) {
    return;
  }

  const box = await page.locator("main").first().boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(viewport.width + 2);
}

async function expectMobileBottomNav(page: Page) {
  const nav = page.getByRole("navigation");
  await expect(nav).toBeVisible();
  await expect(nav).toHaveCSS("position", "fixed");
  await expect(nav.getByRole("link")).toHaveCount(MOBILE_NAV_ITEM_COUNT);
  for (const route of CORE_ROUTES) {
    await expect(nav.getByRole("link", { name: route.label })).toBeVisible();
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function buildAuditScreenshotName(input: {
  route: CoreRoute["key"];
  viewport: string;
  state: AuditScenarioKey;
}) {
  const name = [
    normalizeScreenshotSegment(input.route),
    normalizeScreenshotSegment(input.viewport),
    normalizeScreenshotSegment(input.state),
  ].join(".") + ".png";

  return [name];
}

function normalizeScreenshotSegment(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    throw new Error(`Invalid UI audit screenshot segment: ${value}`);
  }

  return normalized;
}
