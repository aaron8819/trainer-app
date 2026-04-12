import { expect, test, type Locator, type Page } from "@playwright/test";

const CORE_ROUTES = [
  { key: "home", label: "Home", path: "/", heading: /Today's Training|Mesocycle Handoff/i },
  { key: "program", label: "Program", path: "/program", heading: /My Program/i },
  { key: "history", label: "History", path: "/history", heading: /Workout History/i },
  { key: "analytics", label: "Analytics", path: "/analytics", heading: /Analytics/i },
  { key: "settings", label: "Settings", path: "/settings", heading: /Settings/i },
] as const;

const MOBILE_NAV_ITEM_COUNT = CORE_ROUTES.length;
const FIXTURE_HEADER = "x-ui-audit-fixture";
const ACTIVE_LOG_WORKOUT_PATH = "/log/ui-audit-workout-planned";

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

test.describe("lightweight fixture interaction checks", () => {
  test("logging screen active set and swap sheet survive safe interactions", async ({ page }) => {
    await page.setExtraHTTPHeaders({ [FIXTURE_HEADER]: "active" });
    await installMutationGuards(page);
    await installSwapFixtureRoutes(page);

    await page.goto(ACTIVE_LOG_WORKOUT_PATH, { waitUntil: "domcontentloaded" });
    await waitForStableRoute(page);

    await expect(page).toHaveURL(new RegExp(`${escapeRegex(ACTIVE_LOG_WORKOUT_PATH)}/?$`));
    await expect(page.getByRole("heading", { name: "Workout Log" })).toBeVisible();
    await expect(page.getByText("Active set")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chest-Supported Row" })).toBeVisible();

    const repsInput = page.getByLabel("Reps");
    await expect(repsInput).toBeVisible();
    await repsInput.fill("10");
    await repsInput.blur();
    await expect(repsInput).toHaveValue("10");
    await expect(page.getByRole("button", { name: "Log set" })).toBeEnabled();
    await expectMainWithinViewport(page);
    await expectNoAppError(page);

    await page.getByRole("button", { name: "Swap" }).first().click();
    await expect(page.getByRole("heading", { name: "Swap Chest-Supported Row" })).toBeVisible();
    await expect(page.getByText("Search replacements")).toBeVisible();
    await expect(page.getByText("Cable Row")).toBeVisible();
    await expect(page.getByText("Post-swap prescription")).toBeVisible();
    await expect(
      page.getByText("Set 1: 10 reps (8-12) | Load hint 100 lbs | Target RPE 8 | 2 min rest")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Use swap" })).toBeEnabled();
    await expectElementWithinViewport(page, page.locator("dialog").first());

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: "Swap Chest-Supported Row" })).toBeHidden();
    await expectNoAppError(page);
  });
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
  await expectElementWithinViewport(page, page.locator("main").first());
}

async function expectElementWithinViewport(page: Page, locator: Locator) {
  const viewport = page.viewportSize();
  if (!viewport) {
    return;
  }

  const box = await locator.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(viewport.width + 2);
}

async function expectNoAppError(page: Page) {
  await expect(page.locator("body")).not.toContainText(
    /Application error|Internal Server Error|Unhandled Runtime Error|This page could not be found/i
  );
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

async function installMutationGuards(page: Page) {
  await page.route("**/api/logs/set", async (route) => {
    await route.fulfill({
      status: 405,
      json: { error: "UI audit interaction check does not persist set logs." },
    });
  });
  await page.route("**/api/workouts/save", async (route) => {
    await route.fulfill({
      status: 405,
      json: { error: "UI audit interaction check does not persist workout saves." },
    });
  });
}

async function installSwapFixtureRoutes(page: Page) {
  await page.route("**/api/workouts/ui-audit-workout-planned/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (
      request.method() === "GET" &&
      url.pathname === "/api/workouts/ui-audit-workout-planned/swap-exercise"
    ) {
      await route.fulfill({
        json: {
          candidates: [
            {
              exerciseId: "ui-audit-cable-row",
              exerciseName: "Cable Row",
              primaryMuscles: ["Lats", "Upper Back"],
              equipment: ["cable"],
              reason: "Keeps the pull pattern close and reduces setup friction.",
            },
          ],
        },
      });
      return;
    }

    if (
      request.method() === "GET" &&
      url.pathname === "/api/workouts/ui-audit-workout-planned/swap-exercise-preview"
    ) {
      await route.fulfill({
        json: {
          exercise: {
            workoutExerciseId: "ui-audit-row-we",
            exerciseId: "ui-audit-cable-row",
            name: "Cable Row",
            equipment: ["cable"],
            movementPatterns: ["horizontal_pull"],
            isMainLift: false,
            isSwapped: true,
            section: "MAIN",
            sessionNote:
              "Swapped from Chest-Supported Row. Session-only; future progression stays exercise-specific.",
            sets: [
              {
                setId: "ui-audit-row-set-1",
                setIndex: 1,
                targetReps: 10,
                targetRepRange: { min: 8, max: 12 },
                targetLoad: 100,
                targetRpe: 8,
                restSeconds: 120,
              },
              {
                setId: "ui-audit-row-set-2",
                setIndex: 2,
                targetReps: 10,
                targetRepRange: { min: 8, max: 12 },
                targetLoad: 100,
                targetRpe: 8,
                restSeconds: 120,
              },
            ],
          },
        },
      });
      return;
    }

    if (
      request.method() !== "GET" &&
      url.pathname === "/api/workouts/ui-audit-workout-planned/swap-exercise"
    ) {
      await route.fulfill({
        status: 405,
        json: { error: "UI audit interaction check does not persist exercise swaps." },
      });
      return;
    }

    await route.continue();
  });
}
