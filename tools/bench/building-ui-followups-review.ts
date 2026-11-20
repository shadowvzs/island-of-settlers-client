import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { openDevelopmentCategory } from "./development-ui-helpers";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "building-ui-followups-2026-11-02");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of (process.env.QUALITIES ?? "minimal,high").split(",")) {
    const page = await browser.newPage({ viewport: { height: 900, width: 1280 } });
    const scenario = process.env.OWNER_FIXTURE ? "owner-fixture" : "fresh";
    const errors: string[] = [];
    const failedResources: string[] = [];
    let fixtureBuildingCount: number | undefined;
    let fixtureDiagnostics: object | undefined;
    page.on("response", response => {
      if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`);
    });
    page.on("console", message => {
      if (message.type() === "error") console.log("CONSOLE", message.text());
      if (/Render frame failed|WebGL webglcontextlost/.test(message.text())) errors.push(message.text());
    });
    page.on("pageerror", error => { errors.push(error.message); console.log("PAGE ERROR", error.message); });
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    if (process.env.OWNER_FIXTURE) {
      const source = readFileSync(process.env.OWNER_FIXTURE, "utf8");
      const save = JSON.parse(source);
      fixtureBuildingCount = save.settlement.buildings.length;
      fixtureDiagnostics = { sourceSha256: createHash("sha256").update(source).digest("hex"),
        originalAccumulator: save.settlement.accumulator, originalGameTick: save.settlement.gameTick,
        changes: ["game/settlement version 3", "Monument 63→7", "savedAt reset to current time",
          "accumulator modulo 0.05 (discard failing tick backlog)"] };
      // Isolated diagnostic fixture only: production explicitly rejects old saves and has no migration.
      save.version = 3; save.settlement.version = 3; save.savedAt = Date.now();
      // The captured failing tick accumulated >45 s while repeatedly throwing. Discard that invalid
      // backlog only in this diagnostic copy so the snapshot can enter current validation.
      save.settlement.accumulator %= .05;
      const formerMonumentId = 63;
      for (const building of save.settlement.buildings)
        if (building.typeId === formerMonumentId) building.typeId = 7;
      await page.route("**/fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
      await page.goto(`${url}fixture.html`);
      await page.evaluate(async saved => {
        const { openLocalSaveStore } = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
        await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(saved));
      }, save);
    }
    const mapQuery = process.env.OWNER_FIXTURE ? "" : "size=96&";
    await page.goto(`${url}admin.html?${mapQuery}quality=${quality}&cache=0&time=day`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement),
      null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180000 });
    console.log("ready", quality);
    const initialBuildings = await page.evaluate(() => (window as any).__settlement.simulation.buildings().length);
    if (fixtureBuildingCount !== undefined && initialBuildings !== fixtureBuildingCount) {
      console.log("RESTORE", await page.evaluate(() => ({
        error: (window as any).__islandBoot?.restore?.gameLoadError,
        params: (window as any).__islandBoot?.params,
        text: document.body.innerText.slice(-2000)
      })));
    }
    if (fixtureBuildingCount !== undefined) assert.equal(initialBuildings, fixtureBuildingCount,
      "Owner fixture must restore completely rather than falling back to a new game");
    await page.keyboard.press("n");
    assert.equal(await page.locator(".settlement-building-names").isVisible(), true);
    await page.evaluate(() => {
      const input = document.createElement("input"); input.id = "label-shortcut-review-input";
      document.body.append(input); input.focus();
    });
    await page.keyboard.press("n");
    assert.equal(await page.locator(".settlement-building-names").isVisible(), true);
    await page.locator("#label-shortcut-review-input").evaluate(element => element.remove());
    await page.keyboard.press("n");
    assert.equal(await page.locator(".settlement-building-names").isVisible(), false);
    await page.keyboard.press("n");
    await page.getByRole("button", { exact: true, name: "Build" }).click();
    await page.getByRole("tab", { exact: true, name: "Materials" }).click();
    const card = page.locator('button[data-building="17"]:visible');
    await card.hover();
    const tooltip = page.locator('.building-card__tooltip:visible');
    await tooltip.waitFor();
    assert.match(await tooltip.innerText(), /Woodcutter/);
    assert(await tooltip.locator("li img").count() > 0);
    await page.screenshot({ path: resolve(output, `${quality}-${scenario}-material-popover.png`) });
    await page.keyboard.press("Escape");
    assert.equal(await tooltip.count(), 0);
    await card.focus();
    assert.equal(await tooltip.count(), 1);
    await page.keyboard.press("Escape");
    await card.click();
    assert.equal(await tooltip.count(), 1);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    console.log("UI checks passed", quality);
    await openDevelopmentCategory(page, "Appearance");
    const picker = page.getByRole("radiogroup", { exact: true, name: "Nation" });
    const switches = [];
    for (const nation of ["persian", "maya"]) {
      await picker.locator(`[data-nation="${nation}"]`).click();
      console.log("nation requested", nation);
      await page.waitForFunction(n => (window as any).__settlement.simulation.playerNation() === n,
        nation, { timeout: 180000 });
      const before = await page.evaluate(() => (window as any).__settlement.simulation.gameTick());
      await page.waitForFunction(tick => (window as any).__settlement.simulation.gameTick() > tick + 20,
        before, { timeout: 20000 });
      switches.push({ nation, tick: await page.evaluate(() => (window as any).__settlement.simulation.gameTick()) });
      console.log("switched", quality, nation);
    }
    await page.screenshot({ path: resolve(output, `${quality}-${scenario}-maya-after-persian.png`) });
    reports.push({ errors, failedResources, fixtureDiagnostics, initialBuildings, quality, switches,
      ownerFixture: process.env.OWNER_FIXTURE ?? null });
    writeFileSync(resolve(output, `${quality}-${scenario}-review.json`), JSON.stringify(reports.at(-1), null, 2));
    writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
