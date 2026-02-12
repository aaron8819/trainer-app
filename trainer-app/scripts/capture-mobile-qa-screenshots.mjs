#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const PROJECT_ROOT = process.cwd();
const ARTIFACTS_ROOT = path.join(PROJECT_ROOT, "docs", "plans", "mobile-optimization-artifacts");
const BASELINE_BEFORE_ROOT = path.join(ARTIFACTS_ROOT, "phase-01", "screenshots", "before");
const BASE_URL = process.env.QA_BASE_URL ?? "http://127.0.0.1:3000";

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
];

const FIXTURES = {
  workoutId: "97c83782-e26e-415e-9c7c-5ce53bf3ff5b",
  templateId: "7aa92b84-aeac-4cb0-aec4-a77e1a7bf748",
};

const ROUTES = {
  home: "/",
  "workout-id": `/workout/${FIXTURES.workoutId}`,
  "log-id": `/log/${FIXTURES.workoutId}`,
  templates: "/templates",
  "templates-new": "/templates/new",
  "templates-id-edit": `/templates/${FIXTURES.templateId}/edit`,
  library: "/library",
  analytics: "/analytics",
  settings: "/settings",
  onboarding: "/onboarding",
};

const PHASE_ROUTES = {
  "phase-03": ["home", "templates", "templates-new", "templates-id-edit"],
  "phase-04": ["library", "settings", "onboarding"],
  "phase-05": ["analytics"],
  "phase-06": [
    "home",
    "workout-id",
    "log-id",
    "templates",
    "templates-new",
    "templates-id-edit",
    "library",
    "analytics",
    "settings",
    "onboarding",
  ],
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  copyBaselineBeforeScreenshots();
  await captureAfterScreenshots();
  console.log("Screenshot capture completed.");
}

function copyBaselineBeforeScreenshots() {
  for (const [phase, routeKeys] of Object.entries(PHASE_ROUTES)) {
    const phaseBeforeDir = path.join(ARTIFACTS_ROOT, phase, "screenshots", "before");
    for (const routeKey of routeKeys) {
      for (const viewport of VIEWPORTS) {
        const src = path.join(BASELINE_BEFORE_ROOT, routeKey, `${viewport.name}.png`);
        const dst = path.join(phaseBeforeDir, routeKey, `${viewport.name}.png`);
        if (!fs.existsSync(src)) {
          continue;
        }
        ensureDir(path.dirname(dst));
        fs.copyFileSync(src, dst);
      }
    }
  }
}

async function captureAfterScreenshots() {
  const browser = await chromium.launch({ headless: true });

  try {
    const uniqueRouteKeys = Array.from(
      new Set(Object.values(PHASE_ROUTES).flat())
    );
    const captured = new Map();

    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      const page = await context.newPage();

      for (const routeKey of uniqueRouteKeys) {
        const routePath = ROUTES[routeKey];
        if (!routePath) {
          continue;
        }
        await capturePageScreenshot(page, `${BASE_URL}${routePath}`, routeKey, viewport.name);
        const phase06Target = path.join(
          ARTIFACTS_ROOT,
          "phase-06",
          "screenshots",
          "after",
          routeKey,
          `${viewport.name}.png`
        );
        ensureDir(path.dirname(phase06Target));
        await page.screenshot({ path: phase06Target, fullPage: true });
        captured.set(`${routeKey}:${viewport.name}`, phase06Target);
      }

      if (viewport.width <= 390) {
        await captureAnalyticsTabScreenshot(
          page,
          viewport.name,
          "Volume",
          "volume"
        );
        await captureAnalyticsTabScreenshot(
          page,
          viewport.name,
          "Overview",
          "overview"
        );
      }

      await context.close();
    }

    for (const [phase, routeKeys] of Object.entries(PHASE_ROUTES)) {
      if (phase === "phase-06") {
        continue;
      }
      for (const routeKey of routeKeys) {
        for (const viewport of VIEWPORTS) {
          const src = captured.get(`${routeKey}:${viewport.name}`);
          if (!src || !fs.existsSync(src)) {
            continue;
          }
          const dst = path.join(
            ARTIFACTS_ROOT,
            phase,
            "screenshots",
            "after",
            routeKey,
            `${viewport.name}.png`
          );
          ensureDir(path.dirname(dst));
          fs.copyFileSync(src, dst);
        }
      }
    }
  } finally {
    await browser.close();
  }
}

async function capturePageScreenshot(page, url, routeKey, viewportName) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  const title = await page.title();
  console.log(`[capture] ${viewportName} ${routeKey} -> ${url} (title: ${title})`);
}

async function captureAnalyticsTabScreenshot(page, viewportName, tabName, fileSuffix) {
  await page.goto(`${BASE_URL}/analytics`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(1500);
  const tabButton = page.getByRole("button", { name: tabName });
  if ((await tabButton.count()) > 0) {
    await tabButton.first().click();
    await page.waitForTimeout(1500);
  }

  const target = path.join(
    ARTIFACTS_ROOT,
    "phase-05",
    "screenshots",
    "after",
    "chart-readability",
    `${viewportName}-${fileSuffix}.png`
  );
  ensureDir(path.dirname(target));
  await page.screenshot({ path: target, fullPage: true });
  console.log(`[capture] ${viewportName} analytics-${fileSuffix} chart readability`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}
