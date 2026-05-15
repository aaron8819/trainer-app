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
const TIMER_VISIBLE_LOG_WORKOUT_PATH = "/log/ui-audit-workout-timer-visible";

type CoreRoute = (typeof CORE_ROUTES)[number];
type AuditScenarioKey = "active" | "empty" | "handoff";
type ElementBox = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

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
    await installAddExerciseFixtureRoutes(page);

    await page.goto(ACTIVE_LOG_WORKOUT_PATH, { waitUntil: "domcontentloaded" });
    await waitForStableRoute(page);

    await expect(page).toHaveURL(new RegExp(`${escapeRegex(ACTIVE_LOG_WORKOUT_PATH)}/?$`));
    await expect(page.getByRole("heading", { name: "Workout Log" })).toBeVisible();
    await expect(page.getByText("Active set")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chest-Supported Row" })).toBeVisible();
    await expectLogClientUsesClosedKeyboardPadding(page);
    await expect(page.getByTestId("queue-row-ui-audit-pulldown-we").getByRole("button", { name: "Swap" })).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForStableRoute(page);
    await expect(page.getByRole("heading", { name: "Workout Log" })).toBeVisible();
    await expectLogClientUsesClosedKeyboardPadding(page);
    await expect(page.getByTestId("queue-row-ui-audit-pulldown-we").getByRole("button", { name: "Swap" })).toHaveCount(0);

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
    await expect(page.getByText("Cable Row", { exact: true })).toBeVisible();
    await expect(page.getByText("Post-swap prescription").first()).toBeVisible();
    await expect(
      page.getByText("Set 1: 8–12 reps | Load hint 100 lbs | Target RPE 8 | 2 min rest").first()
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Use swap" }).first()).toBeEnabled();
    await expectElementWithinViewport(page, page.locator("dialog").first());
    await expectSheetBodyReachable(page);

    const swapSearch = page.getByPlaceholder("Search by name, alias, muscle, or equipment...");
    await expect(swapSearch).toBeVisible();
    await swapSearch.focus();
    await expect(swapSearch).toBeFocused();
    await swapSearch.fill("cable");
    await expect(page.getByText("Cable Row", { exact: true })).toBeVisible();
    await swapSearch.blur();
    await expectSheetBodyReachable(page);

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: "Swap Chest-Supported Row" })).toBeHidden();

    await page.getByRole("button", { name: "+ Add Exercise" }).click();
    await expect(page.getByRole("heading", { name: "Add Exercise" })).toBeVisible();
    await expect(page.getByText("Recommended for this session")).toBeVisible();
    await expect(page.getByText("Browse all exercises")).toBeVisible();
    await expect(page.getByText("Cable Fly")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add" }).first()).toBeVisible();
    await expectSheetBodyReachable(page);

    const addSearch = page.getByPlaceholder("Search by name, alias, muscle, or equipment...");
    await expect(addSearch).toBeVisible();
    await addSearch.focus();
    await expect(addSearch).toBeFocused();
    await addSearch.fill("row");
    await expect(page.getByText("Cable Row", { exact: true })).toBeVisible();
    await addSearch.blur();
    await expectSheetBodyReachable(page);

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: "Add Exercise" })).toBeHidden();
    await expectNoAppError(page);
  });

  test("logging screen rest timer fixture stays visible and reachable", async ({ page }, testInfo) => {
    await page.setExtraHTTPHeaders({ [FIXTURE_HEADER]: "timer-visible" });
    await installMutationGuards(page);

    await page.goto(TIMER_VISIBLE_LOG_WORKOUT_PATH, { waitUntil: "domcontentloaded" });
    await waitForStableRoute(page);

    await expect(page).toHaveURL(new RegExp(`${escapeRegex(TIMER_VISIBLE_LOG_WORKOUT_PATH)}/?$`));
    await expect(page.getByRole("heading", { name: "Workout Log" })).toBeVisible();
    await expect(page.getByText("1/4 logged")).toBeVisible();

    const timerHud = page.getByTestId("rest-timer-hud");
    const activeSetCard = page.locator("section").filter({ hasText: "Active set" }).first();
    const logSetButton = page.getByRole("button", { name: "Log set" });
    const leaveForNowButton = page.getByRole("button", { name: "Leave for now" });

    await expect(timerHud).toBeVisible();
    await expect(timerHud).toContainText("Rest");
    await expect(timerHud).toContainText("Controls");
    await expect(activeSetCard).toBeVisible();
    await expect(logSetButton).toBeVisible();
    await expect(leaveForNowButton).toBeVisible();
    await expect(page.getByTestId("workout-finish-bar")).toHaveCount(0);

    await expectElementFullyWithinViewport(page, timerHud);
    await expectNoElementOverlap(timerHud, activeSetCard);
    await expectNoElementOverlap(timerHud, logSetButton);
    await expectLayoutStable(page, [timerHud, activeSetCard, logSetButton]);

    if (testInfo.project.name === "mobile") {
      const bottomNav = page.getByRole("navigation");
      await expectMobileBottomNav(page);
      await expectNoElementOverlap(timerHud, bottomNav);
      await expectNoElementOverlap(logSetButton, bottomNav);
    }

    await timerHud.click();
    await expect(page.getByTestId("rest-timer-expanded-controls")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rest timer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "-15s" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+15s" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mute alerts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip rest" })).toBeVisible();

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("rest-timer-expanded-controls")).toBeHidden();
    await expect(timerHud).toBeVisible();
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
  const expectedUrl = new RegExp(`${escapeRegex(route.path)}/?$`);
  await nav.getByRole("link", { name: route.label }).click();
  await page.waitForURL(expectedUrl, { timeout: 3_000 }).catch(async () => {
    await page.goto(route.path, { waitUntil: "domcontentloaded" });
  });
  await expect(page).toHaveURL(expectedUrl);
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

async function expectElementFullyWithinViewport(page: Page, locator: Locator) {
  const viewport = page.viewportSize();
  if (!viewport) {
    return;
  }

  const box = await getRequiredBox(locator);
  expect(box.x).toBeGreaterThanOrEqual(-2);
  expect(box.y).toBeGreaterThanOrEqual(-2);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 2);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 2);
}

async function expectSheetBodyReachable(page: Page) {
  const panel = page.getByTestId("slide-up-sheet-panel");
  const body = page.getByTestId("slide-up-sheet-body");

  await expectElementFullyWithinViewport(page, panel);
  await expect(body).toBeVisible();

  const metrics = await body.evaluate((element) => {
    const startScrollTop = element.scrollTop;
    element.scrollTop = element.scrollHeight;
    const afterScrollTop = element.scrollTop;
    const bottomGap = element.scrollHeight - element.clientHeight - element.scrollTop;
    element.scrollTop = startScrollTop;
    const rect = element.getBoundingClientRect();
    return {
      canScroll: element.scrollHeight > element.clientHeight,
      afterScrollTop,
      bottomGap,
      bottom: rect.bottom,
    };
  });
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(metrics.bottom).toBeLessThanOrEqual((viewport?.height ?? 0) + 2);
  if (metrics.canScroll) {
    expect(metrics.afterScrollTop).toBeGreaterThan(0);
    expect(Math.abs(metrics.bottomGap)).toBeLessThanOrEqual(2);
  }
}

async function expectNoElementOverlap(first: Locator, second: Locator) {
  const firstBox = await getRequiredBox(first);
  const secondBox = await getRequiredBox(second);
  const overlapsHorizontally =
    firstBox.x < secondBox.x + secondBox.width && firstBox.x + firstBox.width > secondBox.x;
  const overlapsVertically =
    firstBox.y < secondBox.y + secondBox.height && firstBox.y + firstBox.height > secondBox.y;

  expect(overlapsHorizontally && overlapsVertically).toBe(false);
}

async function expectLayoutStable(page: Page, locators: Locator[]) {
  const before = await Promise.all(locators.map((locator) => getRequiredBox(locator)));
  await page.waitForTimeout(150);
  const after = await Promise.all(locators.map((locator) => getRequiredBox(locator)));

  before.forEach((box, index) => {
    expect(Math.abs(box.x - after[index]!.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y - after[index]!.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.width - after[index]!.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.height - after[index]!.height)).toBeLessThanOrEqual(2);
  });
}

async function getRequiredBox(locator: Locator): Promise<ElementBox> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box as ElementBox;
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

async function expectLogClientUsesClosedKeyboardPadding(page: Page) {
  const inlinePaddingBottom = await page
    .getByRole("button", { name: "... Workout options" })
    .evaluate((button) => {
      const root = button.closest(".mt-5");
      if (!(root instanceof HTMLElement)) {
        throw new Error("Could not find log workout client root");
      }
      return root.style.paddingBottom;
    });

  expect(inlinePaddingBottom).toBe("env(safe-area-inset-bottom, 16px)");
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
            {
              exerciseId: "ui-audit-machine-row",
              exerciseName: "Machine Row",
              primaryMuscles: ["Lats", "Upper Back"],
              equipment: ["machine"],
              reason: "Keeps the pull pattern close with guided setup.",
            },
            {
              exerciseId: "ui-audit-single-arm-row",
              exerciseName: "Single-Arm Cable Row",
              primaryMuscles: ["Lats", "Upper Back"],
              equipment: ["cable"],
              reason: "Keeps the pull pattern close while reducing bracing demand.",
            },
            {
              exerciseId: "ui-audit-seated-row",
              exerciseName: "Seated Row",
              primaryMuscles: ["Lats", "Upper Back"],
              equipment: ["machine"],
              reason: "Keeps the target muscles and stable setup.",
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
      const exerciseId = url.searchParams.get("exerciseId") ?? "ui-audit-cable-row";
      const exerciseNameById: Record<string, string> = {
        "ui-audit-cable-row": "Cable Row",
        "ui-audit-machine-row": "Machine Row",
        "ui-audit-single-arm-row": "Single-Arm Cable Row",
        "ui-audit-seated-row": "Seated Row",
      };
      await route.fulfill({
        json: {
          exercise: {
            workoutExerciseId: "ui-audit-row-we",
            exerciseId,
            name: exerciseNameById[exerciseId] ?? "Cable Row",
            equipment: [exerciseId.includes("machine") ? "machine" : "cable"],
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

async function installAddExerciseFixtureRoutes(page: Page) {
  await page.route("**/api/workouts/ui-audit-workout-planned/bonus-suggestions", async (route) => {
    await route.fulfill({
      json: {
        suggestions: [
          {
            exerciseId: "ui-audit-cable-fly",
            exerciseName: "Cable Fly",
            primaryMuscles: ["Chest"],
            equipment: ["cable"],
            reason: "Chest has room for a small accessory top-up.",
          },
          {
            exerciseId: "ui-audit-lateral-raise",
            exerciseName: "Cable Lateral Raise",
            primaryMuscles: ["Side Delts"],
            equipment: ["cable"],
            reason: "Side delts can take a low-fatigue accessory.",
          },
          {
            exerciseId: "ui-audit-rope-pressdown",
            exerciseName: "Rope Pressdown",
            primaryMuscles: ["Triceps"],
            equipment: ["cable"],
            reason: "Triceps accessory work fits the session finish.",
          },
          {
            exerciseId: "ui-audit-rear-delt-fly",
            exerciseName: "Rear Delt Fly",
            primaryMuscles: ["Rear Delts"],
            equipment: ["dumbbell"],
            reason: "Rear delts can use a small isolation dose.",
          },
        ],
      },
    });
  });

  await page.route("**/api/exercises/search**", async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("q");
    await route.fulfill({
      json: {
        results:
          query === "row"
            ? [
                {
                  id: "ui-audit-search-cable-row",
                  name: "Cable Row",
                  primaryMuscles: ["Lats", "Upper Back"],
                  equipment: ["cable"],
                },
              ]
            : [],
      },
    });
  });

  await page.route("**/api/workouts/ui-audit-workout-planned/add-exercise-preview", async (route) => {
    const body = route.request().postDataJSON() as { exerciseIds?: string[] };
    await route.fulfill({
      json: {
        previews: (body.exerciseIds ?? []).map((exerciseId) => ({
          exerciseId,
          exerciseName: exerciseId,
          equipment: ["cable"],
          section: "ACCESSORY",
          isMainLift: false,
          setCount: 2,
          targetReps: 12,
          targetRepRange: { min: 10, max: 14 },
          targetLoad: null,
          targetRpe: 7,
          restSeconds: 90,
          prescriptionSource: "session_accessory_defaults",
        })),
      },
    });
  });

  await page.route("**/api/workouts/ui-audit-workout-planned/add-exercise", async (route) => {
    await route.fulfill({
      status: 405,
      json: { error: "UI audit interaction check does not persist added exercises." },
    });
  });
}
