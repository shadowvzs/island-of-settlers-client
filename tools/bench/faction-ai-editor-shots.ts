import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * EAI0b review: the Map rules section's Computer factions rows in the real editor (`editor.html`). Two added
 * factions in different modes with the details open, then a second develop faction (the Ready error). Uses only
 * visible controls. OUT_DIR receives the section screenshots.
 */
const outDir = process.env.OUT_DIR ?? "eai0b-captures";
mkdirSync(outDir, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
await page.routeWebSocket("**/*", () => {});
const button = (name: string) => page.getByRole("button", { exact: true, name });
const section = page.locator(".map-rules");
/** The whole Map rules section (a tall viewport; the panel's sticky header is unstuck so it covers nothing). */
const shot = async (name: string) => {
  await page.locator(".map-editor").first().evaluate(panel => {
    for (const element of panel.querySelectorAll<HTMLElement>("*"))
      if (getComputedStyle(element).position === "sticky") element.style.position = "static";
  });
  await section.evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(200);
  await section.screenshot({ path: resolve(outDir, `${name}.png`) });
};
const row = (faction: number) => page.locator(".faction-ai__row").filter({
  has: page.getByTitle(`Computer faction ${faction}`, { exact: true })
});
const pick = (faction: number, label: RegExp) => row(faction).getByRole("button", { name: label }).click();

try {
  await page.goto(`${url}editor.html?quality=${process.env.QUALITY ?? "minimal"}&size=64&seed=1234&cache=0`);
  await page.waitForFunction(() => (window as any).__editorReady, null, { timeout: 180000 });
  await page.getByRole("tab", { name: "Map, headquarters and scenario", exact: true }).click();
  await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("colony");
  const add = button("Add a computer faction row (it is saved once its mode is not None)");
  await add.click(); await add.click();
  await shot("01-two-rows-none");
  await pick(1, /^Develop:/);
  await pick(2, /^Maintain:/);
  await pick(1, /^Turtle:/);
  await row(1).getByRole("combobox").selectOption("hard");
  await row(1).locator("summary").click();
  const build = row(1).getByRole("spinbutton").first();
  await build.fill("150"); await build.blur();
  await shot("02a-develop-maintain-details-top");
  await row(2).evaluate(element => element.scrollIntoView({ block: "end" }));
  await page.waitForTimeout(200);
  await page.locator(".map-editor").first().screenshot({ path: resolve(outDir, "02b-details-bonus-limits.png") });
  await row(1).locator("summary").click();
  await pick(2, /^Develop:/);
  await shot("03-two-develop-error");
  const text = await section.innerText();
  assert.match(text, /2 computer factions develop an economy/);
  const pressed = await page.locator(".faction-ai__row").evaluateAll(rows => rows.map(row =>
    [...row.querySelectorAll("button[aria-pressed=\"true\"]")].map(button => button.getAttribute("aria-label"))));
  console.log(JSON.stringify({ errors, pressed, section: text }));
  assert.deepEqual(errors, []);
} finally {
  await browser.close(); await server.close();
}
