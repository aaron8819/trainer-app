import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { authWebPlatformEnvironment } from "./auth-web-environment";

export async function verifySingleUserBrowser(input: { accountId: string; passcode: string;
  identityUrl: string; readUrl: string; writeUrl: string }) {
  const port = 32000 + Math.floor(Math.random() * 10000);
  const origin = `http://localhost:${port}`;
  const profileRoot = mkdtempSync(join(tmpdir(), "trainer2-session-browser-"));
  const env: NodeJS.ProcessEnv = { ...authWebPlatformEnvironment(process.env), NODE_ENV: "development",
    TRAINER2_LOCAL_DRAFTS: "enabled", TRAINER2_APP_ORIGIN: origin,
    TRAINER2_OWNER_USER_ID: input.accountId,
    TRAINER2_IDENTITY_CONNECTION_STRING: input.identityUrl,
    TRAINER2_READ_CONNECTION_STRING: input.readUrl,
    TRAINER2_WRITE_CONNECTION_STRING: input.writeUrl };
  let server: ChildProcess | undefined;
  const start = async () => {
    server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--webpack", "-p", String(port)],
      { cwd: process.cwd(), env, windowsHide: true, stdio: "ignore" });
    for (let i = 0; i < 90; i++) {
      try { if ((await fetch(origin + "/trainer2/auth")).ok) return; } catch { /* starting */ }
      if (server.exitCode !== null) throw new Error("NEXT_SERVER_EXITED");
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error("NEXT_SERVER_TIMEOUT");
  };
  const stop = async () => {
    if (server?.pid) spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true });
    server = undefined;
    await new Promise(r => setTimeout(r, 1500));
  };
  const signedIn = async (profile: string, mobile: boolean, signIn: boolean) => {
    const context = await chromium.launchPersistentContext(profile, {
      channel: "msedge", headless: true, viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 },
      ...(mobile ? { isMobile: true, hasTouch: true } : {}),
    });
    try {
      const page = await context.newPage();
      await page.goto(origin + "/trainer2/auth");
      if (signIn) {
        await page.locator('input[name="passcode"]').fill(input.passcode);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
      }
      await page.getByText("Signed in.", { exact: true }).waitFor();
      await page.goto(origin + "/trainer2/dev/drafts");
      assert.equal(page.url().startsWith(origin + "/trainer2/dev/drafts"), true);
      await page.getByRole("heading", { name: "Build your training plan" }).waitFor();
      return context;
    } catch (error) { await context.close(); throw error; }
  };
  let desktop: Awaited<ReturnType<typeof signedIn>> | undefined;
  let phone: Awaited<ReturnType<typeof signedIn>> | undefined;
  try {
    await start();
    const desktopProfile = join(profileRoot, "desktop");
    const phoneProfile = join(profileRoot, "phone");
    desktop = await signedIn(desktopProfile, false, true);
    await desktop.close(); desktop = undefined;
    await stop(); await start();
    desktop = await signedIn(desktopProfile, false, false);
    phone = await signedIn(phoneProfile, true, true);
    try { await desktop.pages().at(-1)!.getByRole("textbox", { name: "Plan name" }).waitFor({ timeout: 60000 }); }
    catch { await desktop.pages().at(-1)!.screenshot({ path: resolve("artifacts/trainer2-single-user/desktop-diagnostic.png"), fullPage: true });
      throw new Error("DESKTOP_PLAN_RENDER_TIMEOUT"); }
    try { await phone.pages().at(-1)!.getByRole("textbox", { name: "Plan name" }).waitFor({ timeout: 60000 }); }
    catch { throw new Error("PHONE_PLAN_RENDER_TIMEOUT"); }
    const images = resolve("artifacts/trainer2-single-user"); mkdirSync(images, { recursive: true });
    await desktop.pages().at(-1)!.screenshot({ path: join(images, "desktop.png"), fullPage: true });
    await phone.pages().at(-1)!.screenshot({ path: join(images, "phone.png"), fullPage: true });
    await phone.close(); phone = undefined;
    await stop(); await start();
    phone = await signedIn(phoneProfile, true, false);
    const page = phone.pages()[0];
    await page.goto(origin + "/trainer2/auth");
    await page.getByRole("button", { name: "Sign out this device" }).click();
    await page.getByText("Signed out.", { exact: true }).waitFor();
    await desktop.pages()[0].goto(origin + "/trainer2/auth");
    await desktop.pages()[0].getByText("Signed in.", { exact: true }).waitFor();
    await desktop.pages()[0].getByRole("button", { name: "Sign out every device" }).click();
    await desktop.pages()[0].getByText("Signed out.", { exact: true }).waitFor();
    console.log("PASS desktop and phone viewport login, browser restart, Next restart, independent sign-out and global revocation");
  } finally {
    await phone?.close().catch(() => {});
    await desktop?.close().catch(() => {});
    await stop();
    const safe = resolve(profileRoot).startsWith(resolve(tmpdir(), "trainer2-session-browser-"));
    if (!safe) throw new Error("UNSAFE_BROWSER_PROFILE_PATH");
    rmSync(profileRoot, { recursive: true, force: true });
  }
}
