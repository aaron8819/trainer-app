import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

function signal() {
  let release!: () => void;
  const promise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Controlled browser response timed out")), 30_000);
    release = () => { clearTimeout(timeout); resolve(); };
  });
  return { promise, release };
}
export async function verifyWorkbenchBrowser(tab: Page, advance: (planId: string) => Promise<void>) {
  await tab.reload();
  let posts = 0;
  tab.on("request", request => { if (request.method() === "POST" && request.url().includes("/api/trainer2/drafts/")) posts++; });
  const postReceived = signal(), deliverPost = signal(), getReceived = signal(), deliverGet = signal();
  let failure: "503" | "network" | null = "503";
  let delayRead = true;
  await tab.route("**/api/trainer2/drafts/*", async route => {
    if (route.request().method() === "POST") {
      if (posts === 1) {
        const response = await route.fetch(); // Real command accepted; delay only its delivery.
        assert.equal(response.status(), 200);
        postReceived.release(); await deliverPost.promise;
        await route.fulfill({ response });
      } else await route.continue();
      return;
    }
    if (delayRead) { getReceived.release(); await deliverGet.promise; delayRead = false; }
    const next = failure; failure = null;
    if (next === "503") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "CONTROLLED_REFRESH_FAILURE" }) });
    else if (next === "network") await route.abort("failed");
    else await route.continue();
  });
  const name = tab.getByLabel("Draft name", { exact: true }), plan = tab.getByLabel("Saved plan ID");
  const status = tab.getByRole("status");
  const reload = tab.getByRole("button", { name: "Reload persisted draft", exact: true });
  const create = tab.getByRole("button", { name: "Create finite draft", exact: true });
  await create.click(); await postReceived.promise;
  assert(await name.isDisabled()); assert(await plan.isDisabled()); assert(await reload.isDisabled());
  await tab.keyboard.type("Newer unsaved intention");
  assert.equal(await name.inputValue(), "My finite draft"); assert.equal(posts, 1);
  deliverPost.release(); await getReceived.promise;
  const planId = await plan.inputValue(); assert(planId);
  await tab.getByText(/Last accepted result: Accepted revision 1/).waitFor();
  assert(await name.isDisabled()); assert(await plan.isDisabled()); assert(await create.isDisabled());
  deliverGet.release();
  await status.filter({ hasText: "Accepted, refresh failed" }).waitFor();
  assert(!(await status.innerText()).includes("Current head reloaded"));
  assert.equal(await plan.inputValue(), planId); assert(await reload.isEnabled());
  await tab.screenshot({ path: resolve("artifacts/trainer2/accepted-refresh-failed.png"), fullPage: true });
  await reload.click(); await tab.getByRole("heading", { name: "Revision 1: My finite draft" }).waitFor();
  assert.equal(posts, 1);
  await name.fill("Browser accepted edit"); failure = "network";
  await tab.getByRole("button", { name: "Save name revision", exact: true }).click();
  await status.filter({ hasText: "Accepted, refresh failed" }).waitFor();
  await tab.getByText(/Stale snapshot/).waitFor();
  assert((await status.innerText()).includes("Accepted revision 2"));
  assert(!(await status.innerText()).includes("Delivery uncertain")); assert.equal(await plan.inputValue(), planId);
  await reload.click(); await tab.getByRole("heading", { name: "Revision 2: Browser accepted edit" }).waitFor();
  assert.equal(posts, 2);
  await advance(planId); // Server has a newer head than the replayed acceptance.
  failure = "503";
  await tab.getByRole("button", { name: "Retry same action", exact: true }).click();
  await status.filter({ hasText: "Accepted, refresh failed" }).waitFor();
  assert((await status.innerText()).includes("Replayed original accepted revision 2"));
  assert(!(await status.innerText()).includes("Current head reloaded"));
  await tab.getByText(/Stale snapshot/).waitFor();
  await reload.click(); await tab.getByRole("heading", { name: "Revision 3: Newer server head" }).waitFor();
  assert.equal(posts, 3); assert(await name.isEnabled());
  await name.fill("New intention after recovery");
  assert.equal(await name.inputValue(), "New intention after recovery");
  await tab.screenshot({ path: resolve("artifacts/trainer2/recovered-current-head.png"), fullPage: true });
  await tab.unroute("**/api/trainer2/drafts/*");
  return { actualBrowser: true, intercepted: "response delivery delays; GET 503 and aborted transport only; POSTs use actual server handlers",
    results: ["inputs locked during delayed POST and accepted GET", "accepted plan ID visible before GET finishes", "accepted create + 503 retains read recovery",
      "accepted edit + network failure retains identity and stale snapshot", "GET retry recovers with unchanged POST count", "historical replay + failed read never claims freshness", "retry loads newer head, inputs usable"] };
}
