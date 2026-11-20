import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "important-toasts-2026-11-04"); mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const errors: string[] = [];
let status = "failed", measurement: unknown, themeMeasurements: unknown;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/notification-review.html", route => route.fulfill({ contentType: "text/html",
    body: "<body style='margin:0;background:#b9c6b0'><aside style='position:fixed;bottom:0;right:0;width:400px;height:200px;background:#415748;z-index:2147483646'>Foreground test overlay</aside></body>" }));
  await page.goto(`${url}notification-review.html`);
  await page.evaluate(async () => {
    const fixture = await import(/* @vite-ignore */ String("/tools/bench/notification-review-scene.tsx"));
    (window as any).__notifications = fixture.mountNotificationReview();
  });
  await page.getByRole("checkbox", { name: "Show important notifications", exact: true }).waitFor();
  await page.evaluate(() => {
    const service = (window as any).__notifications.notifications;
    service.info("Routine delivery");
    service.error("Purchase could not be completed.", { important: true });
    service.warning("Expedition needs your attention.", { important: true });
    service.info("Your expedition ship has arrived.", { important: true });
  });
  await page.locator(".app-toast").first().waitFor();
  assert.equal(await page.locator(".app-toast").count(), 3);
  measurement = await page.locator(".app-toast").evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { width: rect.width, height: rect.height, foreground: Boolean(hit?.closest(".app-notification-host")),
      kind: (element as HTMLElement).dataset.toastKind };
  }));
  for (const row of measurement as Array<{ width: number; height: number; foreground: boolean }>) {
    assert(row.width <= 300); assert(row.height <= 52); assert(row.foreground);
  }
  await page.screenshot({ path: resolve(output, "error-warning-information.png") });
  await page.getByRole("checkbox", { name: "Show important notifications", exact: true }).uncheck();
  await page.evaluate(() => (window as any).__notifications.notifications.error("Disabled important event", { important: true }));
  assert.equal(await page.locator(".app-toast").count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem("island-of-settlers.notifications")), "disabled");
  await page.getByRole("checkbox", { name: "Show important notifications", exact: true }).check();
  await page.evaluate(() => {
    const service = (window as any).__notifications.notifications;
    service.success("Decoration purchased.", { important: true }); service.success("Decoration purchased.", { important: true });
  });
  await page.getByText("Decoration purchased.", { exact: true }).waitFor();
  assert.equal(await page.locator(".app-toast").count(), 1);
  assert.equal(await page.locator(".app-toast__count").innerText(), "×2");
  await page.screenshot({ path: resolve(output, "compact-success.png") });
  await page.waitForFunction(() => document.querySelectorAll(".app-toast").length === 0, null, { timeout: 6000 });
  await page.evaluate(() => {
    (window as any).__notifications.notifications.success("Decoration purchased.", { important: true, durationMs: 6000 });
  });
  await page.locator(".app-toast").waitFor();
  themeMeasurements = await page.evaluate(() => {
    const toast = document.querySelector<HTMLElement>(".app-toast")!;
    const reference = document.createElement("div");
    reference.style.cssText = "position:fixed;visibility:hidden;color:var(--hud-ink);background-color:var(--hud-paper);" +
      "border:1px solid var(--hud-paper-edge);background-image:var(--hud-window-texture)";
    document.body.append(reference);
    const rows = [];
    for (const theme of ["light", "dark"]) for (const style of (window as any).__notifications.themeStyles) {
      document.documentElement.dataset.hudTheme = theme;
      document.documentElement.dataset.hudStyle = style;
      const actual = getComputedStyle(toast), expected = getComputedStyle(reference);
      rows.push({ theme, style, ink: actual.color, paper: actual.backgroundColor,
        matches: actual.color === expected.color && actual.backgroundColor === expected.backgroundColor &&
          actual.borderTopColor === expected.borderTopColor && actual.backgroundImage === expected.backgroundImage,
        sameToast: document.querySelector(".app-toast") === toast });
    }
    reference.remove(); return rows;
  });
  for (const row of themeMeasurements as Array<{ matches: boolean; sameToast: boolean }>) {
    assert(row.matches); assert(row.sameToast);
  }
  for (const theme of ["light", "dark"]) for (const style of ["current", "parchment"]) {
    await page.evaluate(({ style, theme }) => {
      document.documentElement.dataset.hudTheme = theme;
      document.documentElement.dataset.hudStyle = style;
    }, { theme, style });
    await page.screenshot({ path: resolve(output, `toast-${theme}-${style}.png`) });
  }
  await page.evaluate(() => (window as any).__notifications.dispose()); assert.deepEqual(errors, []); status = "passed";
} finally {
  await browser.close(); await server.close();
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, errors, measurement,
    themeMeasurements, importantOnly: true, defaultExpiryMs: 4000, visibleLimit: 3, settingsDisable: true }, null, 2));
}
