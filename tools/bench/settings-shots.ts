import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/** The settings panel closed and open, desktop and phone (OUT_DIR as in shots). */
const outDir = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/settings";

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  for (const [name, viewport] of [
    ["desktop", { height: 900, width: 1600 }],
    ["phone", { height: 800, width: 390 }]
  ] as const) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (error) => console.log("[pageerror]", error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 120_000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(outDir, `${name}-closed.png`) });
    // Settlement mode: Settings opens from the Menu window; its sections load on first open.
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator(".settings-panel:not([hidden])").getByRole("heading", { name: "Graphics" }).waitFor();
    const resolution = page.locator(".settings-panel__select").filter({ hasText: "Resolution" })
      .locator("select");
    const apply = page.getByRole("button", { name: "Apply resolution (reloads the game)", exact: true });
    if (!await apply.isDisabled()) throw new Error("Resolution apply starts enabled");
    const original = await resolution.inputValue();
    await resolution.selectOption(original === "3" ? "1" : "3");
    if (await apply.isDisabled()) throw new Error("Pending resolution did not enable apply");
    const stored = await page.evaluate(() => localStorage.getItem("island-of-settlers.graphics.resolution"));
    if (stored !== null) throw new Error("Changing resolution saved before applying");
    await resolution.selectOption(original);
    if (!await apply.isDisabled()) throw new Error("Restoring resolution did not disable apply");
    await resolution.selectOption("3");
    await page.screenshot({ path: join(outDir, `${name}-open.png`) });
    await Promise.all([page.waitForEvent("load"), apply.click()]);
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 120_000 });
    const applied = await page.evaluate(() => localStorage.getItem("island-of-settlers.graphics.resolution"));
    if (applied !== "fast") throw new Error("Resolution apply did not persist the selection");
    console.log(name, (await page.locator(".stats-overlay pre").count()) === 1);
    await page.close();
  }
  await browser.close();
  await server.close();
};

await main();
