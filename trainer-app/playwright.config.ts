import { defineConfig } from "@playwright/test";

const auditPort = process.env.UI_AUDIT_PORT ?? "3100";
const auditDistDir = process.env.UI_AUDIT_NEXT_DIST_DIR ?? ".next-ui-audit/managed";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${auditPort}`;
const shouldStartManagedServer = !process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests/ui-audit",
  outputDir: "./test-results/ui-audit",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.03,
    },
  },
  ...(shouldStartManagedServer
    ? {
        webServer: {
          command: `npx next dev --hostname 127.0.0.1 --port ${auditPort}`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            UI_AUDIT_FIXTURE_MODE: "1",
            UI_AUDIT_NEXT_DIST_DIR: auditDistDir,
          },
        },
      }
    : {}),
  projects: [
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "desktop",
      use: {
        viewport: { width: 1366, height: 768 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
