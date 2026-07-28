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

const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console.error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

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
  test("fixture route, readiness, and API boundaries require the exact header", async ({
    page,
    request,
  }) => {
    const direct = await page.goto(
      "/ui-audit-fixture?path=/plans&scenario=active",
      { waitUntil: "domcontentloaded" },
    );
    expect(direct?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Training plans" }),
    ).toHaveCount(0);
    browserErrors.set(page, []);

    const missingReadiness = await request.get("/ui-audit-fixture/ready");
    expect(missingReadiness.status()).toBe(404);
    const incorrectReadiness = await request.get(
      "/ui-audit-fixture/ready",
      { headers: { [FIXTURE_HEADER]: "incorrect" } },
    );
    expect(incorrectReadiness.status()).toBe(404);
    const authorizedReadiness = await request.get(
      "/ui-audit-fixture/ready",
      { headers: { [FIXTURE_HEADER]: "active" } },
    );
    expect(authorizedReadiness.status()).toBe(200);
    await expect(authorizedReadiness.json()).resolves.toEqual({
      status: "ready",
      database: "unused",
    });

    const authorizedUnhandledApi = await request.get(
      "/api/ui-audit-unhandled",
      { headers: { [FIXTURE_HEADER]: "active" } },
    );
    expect(authorizedUnhandledApi.status()).toBe(501);
    expect(await authorizedUnhandledApi.json()).toMatchObject({
      error: expect.stringContaining("explicit browser fixture handler"),
    });
    const unauthorizedUnhandledApi = await request.get(
      "/api/ui-audit-unhandled",
      { headers: { [FIXTURE_HEADER]: "incorrect" } },
    );
    expect(unauthorizedUnhandledApi.status()).toBe(404);
  });

  test("plan management stays usable at representative viewport sizes", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ [FIXTURE_HEADER]: "active" });
    await page.goto("/plans", { waitUntil: "domcontentloaded" });
    await waitForStableRoute(page);

    await expect(
      page.getByRole("heading", { name: "Training plans" }),
    ).toBeVisible();
    await expect(page.getByText("Current Hypertrophy")).toBeVisible();
    await expect(page.getByText("Fall Hypertrophy")).toBeVisible();
    await expect(page.getByText("Plan in Review")).toBeVisible();
    await expect(page.getByText("Strength Base")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Make active" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Review and finalize" }).first(),
    ).toBeVisible();
    await expectMainWithinViewport(page);

    await page.getByRole("button", { name: "Create another plan" }).click();
    await expect(
      page.getByRole("heading", { name: "New hypertrophy plan" }),
    ).toBeVisible();
    await expect(page.getByLabel("Plan name")).toBeVisible();
    await expect(page.getByLabel("Start date")).toBeVisible();
    await expect(page.getByLabel("Duration")).toBeVisible();

    await page.getByRole("radio", { name: /Strength/i }).check({ force: true });
    await expect(
      page.getByRole("heading", { name: "New strength plan" }),
    ).toBeVisible();
    await expect(page.getByLabel("Main emphasis")).toBeVisible();
    await expect(page.getByLabel("Training days")).toBeVisible();
    await expect(page.getByLabel("Time per session")).toBeVisible();
    await expect(page.getByLabel("Available equipment")).toBeVisible();
    await expect(page.getByLabel("Squat pattern")).toBeVisible();
    await expect(page.getByLabel("Main press")).toBeVisible();
    await expect(page.getByLabel("Hinge pattern")).toBeVisible();
    await expectMainWithinViewport(page);
    await expectNoAppError(page);
  });

  test("strength review is readable without mutating fixture data", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ [FIXTURE_HEADER]: "active" });
    await installMutationGuards(page);
    await page.goto(
      "/plans/10000000-0000-4000-8000-000000000004/review",
      { waitUntil: "domcontentloaded" },
    );
    await waitForStableRoute(page);

    await expect(
      page.getByRole("heading", { name: "Strength Base" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Weekly strength structure" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Plan outline" }),
    ).toBeVisible();
    await expect(page.getByText("Main emphasis")).toBeVisible();
    await expect(page.getByText("Balanced", { exact: true })).toBeVisible();
    await expect(page.getByText("Equipment")).toBeVisible();
    await expect(page.getByText("Full Gym", { exact: true })).toBeVisible();
    await expect(page.getByText("Mesocycle 1")).toBeVisible();
    await expect(page.getByText("3 training blocks")).toBeVisible();
    await expect(page.getByText("Primary:", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Assistance:", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(/Primary lifts stay stable so performance can progress/),
    ).toBeVisible();
    await expect(
      page.getByText(/no 1RM is assumed/),
    ).toBeVisible();
    await expect(page.getByText("Back Squat")).toBeVisible();
    await expect(page.getByText("Conventional Deadlift")).toBeVisible();
    await expect(page.getByText("4 sets · Back Squat")).toBeVisible();
    await expect(page.getByText("4 sets · Conventional Deadlift")).toBeVisible();
    const sixtyMinuteEstimates = await page
      .getByText(/~\d+ min/)
      .allTextContents();
    expect(
      sixtyMinuteEstimates.every(
        (value) => Number(value.match(/\d+/)?.[0] ?? Infinity) <= 60,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Finalize as READY" }),
    ).toBeVisible();
    await expectMainWithinViewport(page);
    await expectNoHorizontalOverflow(page);
    await expectNoAppError(page);

    await page.goto(
      "/plans/10000000-0000-4000-8000-000000000005/review",
      { waitUntil: "domcontentloaded" },
    );
    await waitForStableRoute(page);
    await expect(
      page.getByRole("heading", { name: "Strength Express" }),
    ).toBeVisible();
    await expect(page.getByText("2 days · about 45 min")).toBeVisible();
    const fortyFiveMinuteEstimates = await page
      .getByText(/~\d+ min/)
      .allTextContents();
    expect(
      fortyFiveMinuteEstimates.every(
        (value) => Number(value.match(/\d+/)?.[0] ?? Infinity) <= 45,
      ),
    ).toBe(true);
    await expect(page.getByText("3 sets · Back Squat")).toBeVisible();
    await expectMainWithinViewport(page);
    await expectNoHorizontalOverflow(page);
    await expectNoAppError(page);

    await page.goto(
      "/plans/10000000-0000-4000-8000-000000000006/review",
      { waitUntil: "domcontentloaded" },
    );
    await waitForStableRoute(page);
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Return to Plan Management" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Finalize as READY" }),
    ).toHaveCount(0);

    for (const [planId, planName] of [
      ["10000000-0000-4000-8000-000000000007", "Strength Empty Structure"],
      ["10000000-0000-4000-8000-000000000008", "Strength Malformed Structure"],
    ] as const) {
      await page.goto(`/plans/${planId}/review`, {
        waitUntil: "domcontentloaded",
      });
      await waitForStableRoute(page);
      await expect(
        page.getByRole("heading", { name: planName }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Plan outline" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Weekly strength structure" }),
      ).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoAppError(page);
    }
  });

  test("strength creation, finalization, and activation controls complete their UI flow", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ [FIXTURE_HEADER]: "active" });
    const createdPlanId = "10000000-0000-4000-8000-000000000004";
    const readyPlanId = "10000000-0000-4000-8000-000000000006";
    let createPayload: Record<string, unknown> | null = null;
    let finalizedPlanId: string | null = null;
    let activatedPlanId: string | null = null;

    await page.route("**/api/plans", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      createPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { plan: { id: createdPlanId } } });
    });
    await page.route(`**/api/plans/${createdPlanId}/finalize`, async (route) => {
      finalizedPlanId = createdPlanId;
      await route.fulfill({ json: { plan: { id: createdPlanId, status: "READY" } } });
    });
    await page.route(`**/api/plans/${readyPlanId}/activate`, async (route) => {
      activatedPlanId = readyPlanId;
      await route.fulfill({ json: { plan: { id: readyPlanId, isActive: true } } });
    });

    await page.goto("/plans", { waitUntil: "domcontentloaded" });
    await waitForStableRoute(page);
    await page.getByRole("button", { name: "Create another plan" }).click();
    await page.getByRole("radio", { name: /Strength/i }).check({ force: true });
    await page.getByLabel("Plan name").fill("Browser Strength");
    await page.getByLabel("Time per session").selectOption("45");
    await page.getByRole("button", { name: "Generate and review" }).click();

    await expectAuditPath(page, `/plans/${createdPlanId}/review`);
    await expect(
      page.getByRole("heading", { name: "Strength Base" }),
    ).toBeVisible();
    expect(createPayload).toMatchObject({
      planType: "STRENGTH",
      name: "Browser Strength",
      configuration: { sessionDurationMinutes: 45 },
    });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Finalize as READY" }).click();
    await expectAuditPath(page, "/plans");
    expect(finalizedPlanId).toBe(createdPlanId);

    const readyPlan = page.locator("article").filter({ hasText: "Strength Ready" });
    page.once("dialog", (dialog) => dialog.accept());
    await readyPlan.getByRole("button", { name: "Make active" }).click();
    await expect(
      page.getByText("Strength Ready is now your active plan."),
    ).toBeVisible();
    await expect(readyPlan.getByText("Active", { exact: true })).toBeVisible();
    expect(activatedPlanId).toBe(readyPlanId);
    await expectMainWithinViewport(page);
    await expectNoAppError(page);
  });

  test("strength creation surfaces fail-closed limitation guidance before success", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ [FIXTURE_HEADER]: "active" });
    const createdPlanId = "10000000-0000-4000-8000-000000000004";
    let limitationIsRecognized = false;
    let createAttempts = 0;

    await page.route("**/api/plans", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      createAttempts += 1;
      if (!limitationIsRecognized) {
        await route.fulfill({
          json: {
            code: "PLAN_LIMITATION_UNRECOGNIZED",
            error:
              "Update the active limitation “left ankle” to a recognized area before generating this plan.",
          },
        });
        return;
      }
      await route.fulfill({ json: { plan: { id: createdPlanId } } });
    });

    await page.goto("/plans", { waitUntil: "domcontentloaded" });
    await waitForStableRoute(page);
    await page.getByRole("button", { name: "Create another plan" }).click();
    await page.getByRole("radio", { name: /Strength/i }).check({
      force: true,
    });
    await page.getByLabel("Plan name").fill("Limitation Check");
    await page.getByRole("button", { name: "Generate and review" }).click();

    await expect(
      page.getByText(/Update the active limitation “left ankle”/),
    ).toBeVisible();
    await expectAuditPath(page, "/plans");
    expect(createAttempts).toBe(1);

    limitationIsRecognized = true;
    await page.getByRole("button", { name: "Generate and review" }).click();
    await expectAuditPath(page, `/plans/${createdPlanId}/review`);
    expect(createAttempts).toBe(2);
    await expect(
      page.getByRole("heading", { name: "Strength Base" }),
    ).toBeVisible();
    await expectNoAppError(page);
  });

  test("strength creation surfaces creation-specific infeasibility guidance", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ [FIXTURE_HEADER]: "active" });
    const message =
      "The requested Strength plan could not be created because the available equipment and/or active limitations leave no compatible exercise for required programming. Adjust your available equipment, active limitations, training schedule or configuration, or lift preferences, then try again.";
    await page.route("**/api/plans", async (route) => {
      await route.fulfill({
        json: {
          code: "PLAN_CREATION_INFEASIBLE",
          error: message,
        },
      });
    });

    await page.goto("/plans", { waitUntil: "domcontentloaded" });
    await waitForStableRoute(page);
    await page.getByRole("button", { name: "Create another plan" }).click();
    await page.getByRole("radio", { name: /Strength/i }).check({
      force: true,
    });
    await page.getByLabel("Plan name").fill("Infeasible Strength");
    await page.getByRole("button", { name: "Generate and review" }).click();

    await expect(page.getByText(message)).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      "cannot be finalized",
    );
    await expectAuditPath(page, "/plans");
    await expectNoAppError(page);
  });

  test("strength alternative selection reaches generation, logging, and completion", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({
      [FIXTURE_HEADER]: "strength-alternative",
    });
    let generatePayload: Record<string, unknown> | null = null;
    let plannedSavePayload: Record<string, unknown> | null = null;
    let completionPayload: Record<string, unknown> | null = null;
    let loggedSetPayload: Record<string, unknown> | null = null;

    await page.route("**/api/workouts/generate-from-intent", async (route) => {
      generatePayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: {
          workout: {
            id: "ui-audit-strength-lower-b",
            scheduledDate: "2026-07-28T12:00:00.000Z",
            warmup: [],
            mainLifts: [
              {
                id: "ui-audit-strength-deadlift-we",
                orderIndex: 0,
                isMainLift: true,
                exercise: {
                  id: "fixture-deadlift",
                  name: "Conventional Deadlift",
                  equipment: ["barbell"],
                },
                sets: [
                  {
                    setIndex: 1,
                    targetReps: 4,
                    targetRepRange: { min: 3, max: 6 },
                    targetLoad: 275,
                    targetRpe: 7,
                    restSeconds: 300,
                  },
                ],
              },
            ],
            accessories: [],
            estimatedMinutes: 45,
          },
          selectionMode: "INTENT",
          sessionIntent: "lower",
          selectionMetadata: {
            selectedExerciseIds: ["fixture-deadlift"],
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 1,
                weekInBlock: 1,
                mesocycleLength: 5,
                phase: "accumulation",
                blockType: "accumulation",
                isDeload: false,
                source: "computed",
              },
              sessionProvenance: {
                mesocycleId: "ui-audit-strength-meso",
                compositionSource: "persisted_slot_plan_seed",
                seedProvenance: {
                  revisionId: "ui-audit-strength-revision-1",
                  revision: 1,
                  hash:
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                },
              },
              sessionSlot: {
                slotId: "strength_lower_b",
                intent: "lower",
                sequenceIndex: 3,
                sequenceLength: 4,
                source: "mesocycle_slot_sequence",
              },
              lifecycleVolume: { source: "unknown" },
              sorenessSuppressedMuscles: [],
              deloadDecision: {
                mode: "none",
                reason: [],
                reductionPercent: 0,
                appliedTo: "none",
              },
              readiness: {
                wasAutoregulated: false,
                signalAgeHours: null,
                fatigueScoreOverall: null,
                intensityScaling: {
                  applied: false,
                  exerciseIds: [],
                  scaledUpCount: 0,
                  scaledDownCount: 0,
                },
              },
              exceptions: [],
            },
          },
          filteredExercises: [],
          selectionSummary: {
            selectedCount: 1,
            pinnedCount: 1,
            setTargetCount: 1,
          },
          sessionCapacity: {
            requestedMode: "as_planned",
            status: "as_planned",
          },
          sraWarnings: [],
          substitutions: [],
          volumePlanByMuscle: {},
        },
      });
    });
    await page.route("**/api/workouts/save", async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      if (payload.action === "mark_completed") {
        completionPayload = payload;
        await route.fulfill({
          json: {
            status: "saved",
            workoutId: "ui-audit-strength-lower-b",
            revision: 3,
            workoutStatus: "COMPLETED",
            action: "mark_completed",
          },
        });
        return;
      }
      plannedSavePayload = payload;
      await route.fulfill({
        json: { workoutId: "ui-audit-strength-lower-b" },
      });
    });
    await page.route("**/api/logs/set", async (route) => {
      loggedSetPayload =
        route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: { status: "ok", wasCreated: true, revision: 2 },
      });
    });
    await page.route(
      "**/api/workouts/ui-audit-strength-lower-b/logging-weekly-volume-check",
      async (route) => {
        await route.fulfill({
          json: {
            workoutId: "ui-audit-strength-lower-b",
            currentWeek: {
              mesocycleId: "ui-audit-strength-meso",
              week: 1,
              phase: "accumulation",
              blockType: "accumulation",
            },
            shouldShow: false,
            summary: {
              status: "no_addons_recommended",
              recommendationKind: "no_action",
              reasonCopy: "The accepted Strength slot is complete.",
            },
            rows: [],
          },
        });
      },
    );
    await page.route(
      "**/api/workouts/ui-audit-strength-lower-b/post-session-review",
      async (route) => {
        await route.fulfill({ json: { postSessionReview: null } });
      },
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForStableRoute(page);
    await page
      .getByRole("button", { name: "Choose a different session" })
      .click();
    await page
      .getByRole("radio", { name: "Lower B · Hinge" })
      .check();
    await expect(
      page.getByText("Selected for today:"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start workout" }).click();

    await expectAuditPath(page, "/log/ui-audit-strength-lower-b");
    expect(generatePayload).toEqual({
      intent: "lower",
      slotId: "strength_lower_b",
      sessionCapacity: "as_planned",
    });
    expect(plannedSavePayload).toMatchObject({
      workoutId: "ui-audit-strength-lower-b",
      sessionIntent: "LOWER",
      selectionMetadata: {
        sessionDecisionReceipt: {
          sessionProvenance: {
            seedProvenance: {
              revisionId: "ui-audit-strength-revision-1",
              revision: 1,
            },
          },
          sessionSlot: {
            slotId: "strength_lower_b",
            sequenceIndex: 3,
          },
        },
      },
      exercises: [
        {
          exerciseId: "fixture-deadlift",
          sets: [
            {
              setIndex: 1,
              targetReps: 4,
              targetRepRange: { min: 3, max: 6 },
              targetLoad: 275,
              targetRpe: 7,
            },
          ],
        },
      ],
    });

    await expect(
      page.getByRole("heading", { name: "Workout Log" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Conventional Deadlift" }),
    ).toBeVisible();
    const repsInput = page.getByLabel("Reps");
    await repsInput.fill("4");
    await repsInput.blur();
    await page.getByRole("button", { name: "Log set" }).click();
    await expect(
      page.getByRole("button", { name: "Finish workout" }),
    ).toBeVisible();
    expect(loggedSetPayload).toMatchObject({
      workoutSetId: "ui-audit-strength-deadlift-set-1",
      expectedRevision: 1,
      actualReps: 4,
    });

    await page.getByRole("button", { name: "Finish workout" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("What's next")).toBeVisible();
    expect(completionPayload).toMatchObject({
      workoutId: "ui-audit-strength-lower-b",
      expectedRevision: 2,
      action: "mark_completed",
      status: "COMPLETED",
    });
    await page.setExtraHTTPHeaders({
      [FIXTURE_HEADER]: "strength-after-lower-b",
    });
    await page
      .getByRole("link", { name: "Generate next workout" })
      .click();
    await expectAuditPath(page, "/");
    await expect(
      page.getByText("Upper A · Bench", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Choose a different session" }),
    ).toHaveCount(0);
    await expect(page.getByText("Lower B · Hinge")).toHaveCount(0);
    await expectMainWithinViewport(page);
    await expectNoAppError(page);
  });

  test("logging screen active set and swap sheet survive safe interactions", async ({ page }) => {
    await page.setExtraHTTPHeaders({ [FIXTURE_HEADER]: "active" });
    await installMutationGuards(page);
    await installSwapFixtureRoutes(page);
    await installAddExerciseFixtureRoutes(page);

    await page.goto(ACTIVE_LOG_WORKOUT_PATH, { waitUntil: "domcontentloaded" });
    await waitForStableRoute(page);

    await expectAuditPath(page, ACTIVE_LOG_WORKOUT_PATH);
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

    await expectAuditPath(page, TIMER_VISIBLE_LOG_WORKOUT_PATH);
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
  await page.goto(route.path, { waitUntil: "domcontentloaded" });
  await expectAuditPath(page, route.path);
}

async function expectAuditPath(page: Page, expectedPath: string) {
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return url.pathname === "/ui-audit-fixture"
        ? url.searchParams.get("path")
        : url.pathname;
    })
    .toBe(expectedPath);
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

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
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
