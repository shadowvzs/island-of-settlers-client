import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "verification-portrait-ui-2026-11-05",
  process.env.RUN ?? "fortress-a");
assert(!existsSync(resolve(output, "report.json")), "Use a new RUN to preserve evidence");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const reports: unknown[] = [], errors: string[] = [];
try {
  browser = await launchBrowser();
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/roster-fixture.html", route => route.fulfill({
      body: "<body></body>", contentType: "text/html"
    }));
    await page.goto(`${url}roster-fixture.html`);
    const fixture = await page.evaluate(async () => {
      const { createVerificationGarrisonSave } = await import(
        /* @vite-ignore */ String("/tools/bench/verification-garrison-fixture.ts"));
      return createVerificationGarrisonSave("roman", [9]);
    });
    assert.equal(fixture.stationed[0]!.count, 10, "Real troops fill the Fortress");
    await page.route("**/src/app/island-runtime.ts", async route => {
      const response = await route.fetch();
      const source = await response.text();
      const marker = "window.__islandReady = true";
      assert(source.includes(marker));
      await route.fulfill({ response, body: source.replace(marker,
        "window.__rosterCamera=camera;window.__islandReady = true") });
    });
    await page.goto(`${url}?quality=${quality}&time=day&cache=0&skipLogin=1`);
    await page.waitForFunction(() => Boolean((window as any).__rosterCamera), null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    const plot = fixture.plots[0]!;
    const troopState = await page.evaluate(uid => {
      const simulation = (window as any).__settlement.simulation;
      const assigned = () => simulation.militarySoldiers().filter((soldier: any) => soldier.building === uid);
      simulation.setMilitaryTarget(uid, 5);
      for (let tick = 0; tick < 12000 && !(assigned().length === 5 &&
        assigned().every((soldier: any) => soldier.stationed)); tick++) simulation.update(.05);
      if (assigned().length !== 5) throw new Error("Fortress did not shrink through real retirement");
      simulation.setMilitaryTarget(uid, 10);
      for (let tick = 0; tick < 12000 && assigned().length < 10; tick++) simulation.update(.05);
      const snapshot = assigned().map((soldier: any) => ({ actor: soldier.actor, rank: soldier.rank,
        stationed: soldier.stationed, phase: simulation.frames().find((actor: any) => actor.uid === soldier.actor)?.phase }));
      simulation.update = () => {};
      return snapshot;
    }, plot.uid);
    assert.equal(troopState.length, 10);
    assert(troopState.some((soldier: any) => soldier.stationed), "Actual stationed troops present");
    assert(troopState.some((soldier: any) => !soldier.stationed), "Actual arriving troops present");
    await page.evaluate(({ x, z }) => Object.assign((window as any).__rosterCamera,
      { centerX: x, centerZ: z, tilt: 0, yaw: 0, zoom: 2.2 }), plot);
    await page.waitForTimeout(700);
    const point = await page.evaluate(({ x, z }) => (window as any).__settlement.projectGround(x, z), plot);
    await page.mouse.click(point.x, point.y);
    const roster = page.locator(".settlement-ui__soldier-roster");
    await roster.waitFor({ state: "visible" });
    await roster.locator("img").evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
    const layout = await roster.evaluate(element => {
      const scroller = element.closest(".settlement-ui__building-details-body") as HTMLElement;
      const rows = [...element.querySelectorAll<HTMLElement>(".settlement-ui__soldier-row")].map(row => {
        const portrait = row.querySelector<HTMLElement>(".settlement-ui__soldier-portrait")!;
        const image = portrait.querySelector("img")!;
        const chevrons = portrait.querySelector<HTMLElement>(".settlement-ui__rank-chevrons")!;
        const text = row.querySelector<HTMLElement>(":scope > span:last-child")!;
        const imageBox = image.getBoundingClientRect(), box = portrait.getBoundingClientRect();
        return { text: text.textContent, rank: row.dataset.rank,
          rankLevel: Number(chevrons.dataset.rankLevel), rankWidth: chevrons.getBoundingClientRect().width,
          width: box.width, height: box.height,
          imageWidth: imageBox.width, rowWidth: row.clientWidth, scrollWidth: row.scrollWidth,
          textClear: text.getBoundingClientRect().left >= box.right,
          rankClear: chevrons.getBoundingClientRect().right <= text.getBoundingClientRect().left };
      });
      const initial = scroller.scrollTop;
      scroller.scrollTop = scroller.scrollHeight;
      const scroll = { clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight,
        initial, final: scroller.scrollTop };
      scroller.scrollTop = 0;
      return { rows, scroll };
    });
    reports.push({ quality, fixture, troopState, layout });
    assert.equal(layout.rows.length, 10);
    assert(layout.rows.some(row => row.text?.includes("Stationed")), "Stationed status is readable");
    assert(layout.rows.some(row => /Travelling to garrison|Entering garrison/.test(row.text ?? "")),
      "Arriving status is readable");
    assert(layout.rows.every(row => row.width === 44 && row.height === 48 && row.imageWidth <= 44));
    assert(layout.rows.every(row => row.rankWidth === 19 && row.rankLevel === Number(row.rank) + 1));
    assert(layout.rows.every(row => row.textClear && row.rankClear && row.scrollWidth <= row.rowWidth + 1));
    assert(layout.scroll.final > layout.scroll.initial, "Crowded panel scrolls");
    await page.screenshot({ path: resolve(output, `${quality}-fortress-roster-top.png`) });
    await roster.evaluate(element => {
      const scroller = element.closest(".settlement-ui__building-details-body")!;
      scroller.scrollTop = scroller.scrollHeight;
    });
    await page.screenshot({ path: resolve(output, `${quality}-fortress-roster-bottom.png`) });
    writeFileSync(resolve(output, "report.json"), JSON.stringify({ reports, errors }, null, 2));
    await page.close();
    console.log(`Fortress roster ${quality}: ten real mixed arriving/stationed rows passed`);
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status: "passed", reports, errors }, null, 2));
} catch (error) {
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status: "failed",
    failure: String(error), reports, errors }, null, 2));
  throw error;
} finally { await browser?.close(); await server.close(); }
