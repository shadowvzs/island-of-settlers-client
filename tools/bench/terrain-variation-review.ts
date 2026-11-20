import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "terrain-variation-2026-11-03", process.argv[2] ?? "first");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
const errors: string[] = [];
try {
  for (const quality of ["high", "minimal"] as const) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
    await page.route("**/src/app/editor-main.ts", async route => {
      const response = await route.fetch(), source = await response.text();
      const marker = "window.__editorReady = true";
      assert(source.includes(marker));
      await route.fulfill({ response, body: source.replace(marker,
        "window.__terrainReview = runtime; window.__editorReady = true") });
    });
    await page.goto(`${url}editor.html?quality=${quality}&size=128&landform=archipelago&seed=7&forest=0&mountains=2&cache=0&time=12&reveal=1&view=64,64,.55`);
    const ready = async () => {
      await page.waitForFunction(() => Boolean((window as any).__editorReady), null, { timeout: 120_000 });
      await page.locator("#loading-screen").waitFor({ state: "detached" });
    };
    await ready();
    for (const [name, value] of [["natural", 2], ["flat", 0], ["very-hilly", 4]] as const) {
      await page.getByRole("button", { name: "Map generator", exact: true }).click();
      const slider = page.getByRole("slider", { name: /^Terrain variation:/ });
      await slider.waitFor();
      if (name === "natural") assert.equal(await slider.inputValue(), "2");
      else {
        await slider.focus();
        await slider.press("Home");
        for (let step = 0; step < value; step++) await slider.press("ArrowRight");
        assert.equal(await slider.inputValue(), String(value));
        await page.getByRole("spinbutton", { name: "Seed (optional)", exact: true }).fill("7");
        await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Recreate island", exact: true }).click()]);
        await ready();
        assert.equal(new URL(page.url()).searchParams.get("terrainVariation"), String(value));
        await page.getByRole("button", { name: "Map generator", exact: true }).click();
        assert.equal(await slider.inputValue(), String(value));
      }
      await slider.scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(output, `${quality}-${name}-panel.png`) });
      const metrics = await page.evaluate(() => {
        const world = (window as any).__terrainReview.world;
        return { seed: world.seed, variation: world.generationProvenance?.options.terrainVariation,
          peak: world.heights.reduce((a: number, b: number) => Math.max(a, b), -Infinity),
          sites: world.playableIslands?.sites.length };
      });
      assert.equal(metrics.variation, value / 2);
      assert.equal(metrics.seed, 7);
      assert.equal(metrics.sites, 1);
      if (value === 0) assert(metrics.peak <= 2.01);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Map editor", exact: true }).evaluate(element => {
        if (element.getAttribute("aria-pressed") === "true") (element as HTMLButtonElement).click();
      });
      await page.screenshot({ path: resolve(output, `${quality}-${name}-terrain.png`) });
      reports.push({ quality, name, ...metrics });
      console.log(JSON.stringify({ quality, name, ...metrics }));
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ reports, errors }, null, 2));
} finally { await browser.close(); await server.close(); }
