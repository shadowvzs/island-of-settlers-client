import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * In-game verge tool captures: the Road-tab flower card, the stretch preview badge, and a planted
 * stretch beside an unplanted one after the carriers and builder finished, on High and Minimal.
 * Run: QUALITIES=high,minimal OUTPUT=<dir> npx tsx tools/bench/verge-captures.ts
 */
const output = resolve(process.env.OUTPUT ?? "../../captures/verge-tool");
mkdirSync(output, { recursive: true });
const seed = process.env.SEED ?? "123";
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");

const frames = (page: Page, count = 3) => page.evaluate(async total => {
  for (let index = 0; index < total; index += 1)
    await new Promise(done => requestAnimationFrame(done));
}, count);

/** One straight half-cell road: the first half gets flowers, the second half stays bare. */
const prepareRoads = (page: Page) => page.evaluate(() => {
  const live = (window as any).__settlement, sim = live.simulation, hq = sim.headquarters;
  live.realUpdate = sim.update;
  sim.update = () => {};
  hq.inventory.planks = Math.max(hq.inventory.planks ?? 0, 60);
  const step = .5;
  const axisRoad = (from: any, to: any) => {
    const dx = Math.sign(to.x - from.x) * step;
    let at = { ...from };
    const steps: any[] = [];
    while (Math.abs(to.x - at.x) > 1e-6) {
      const next = { x: at.x + dx, z: at.z };
      steps.push({ end: next, start: at, tier: "dirt" });
      at = next;
    }
    return steps;
  };
  const edgeKey = (segment: any) => [segment.start, segment.end]
    .map((point: any) => `${point.x}:${point.z}`).sort().join("/");
  const access = { x: hq.access.x, z: hq.access.z };
  const mid = { x: access.x + 3, z: access.z };
  const east = { x: access.x + 6, z: access.z };
  const existing = live.roads.segments();
  const present = new Set(existing.map(edgeKey));
  const added = axisRoad(access, east).filter((segment: any) => !present.has(edgeKey(segment)));
  const replaced = live.roads.replaceSegments([...existing, ...added]);
  const preview = sim.previewRoadVerge(access, mid, "flowers");
  return { access, added: added.length, east, mid, planks: sim.resourceTotal("planks"),
    preview: { ok: preview.ok, planks: preview.planks, reason: preview.reason,
      tiles: preview.segments.length }, replaced };
});

/** The Road tab with the flower card; then the card itself for a readable close-up. */
const captureRoadTab = async (page: Page, quality: string) => {
  await page.click('[data-launcher-id="build"]');
  const roadsTab = page.locator("#settlement-buildings-tab-roads");
  await roadsTab.waitFor({ state: "visible", timeout: 60_000 });
  await roadsTab.click();
  const card = page.locator('[data-road="verge-flowers"]');
  await card.waitFor({ state: "visible", timeout: 60_000 });
  await card.scrollIntoViewIfNeeded();
  await frames(page, 10);
  await page.locator(".settlement-ui__picker").screenshot({
    path: resolve(output, `${quality}-road-tab.png`)
  });
  await card.screenshot({ path: resolve(output, `${quality}-tool-card.png`) });
  await card.click();
  const panel = page.locator(".settlement-ui__panel", { has: page.locator(".settlement-ui__picker") });
  await panel.locator(".settlement-ui__panel-header button").click();
  await frames(page, 6);
};

const screenPoint = (page: Page, x: number, z: number) => page.evaluate(([px, pz]) =>
  (window as any).__settlement.projectGround(px, pz), [x, z]);

/** First click picks the stretch start; the hovered end draws the preview and the cost badge. */
const capturePreview = async (page: Page, quality: string, road: {
  access: { x: number; z: number }; mid: { x: number; z: number };
}) => {
  const focus = { x: road.mid.x, z: road.access.z };
  await page.evaluate(([x, z]) => (window as any).__settlement.focusGround(x, z, 1.9), [focus.x, focus.z]);
  await frames(page, 20);
  const startPoint = { x: road.access.x + .5, z: road.access.z };
  const start = await screenPoint(page, startPoint.x, startPoint.z);
  const end = await screenPoint(page, road.mid.x, road.mid.z);
  await page.mouse.click(start.x, start.y);
  await frames(page, 6);
  await page.mouse.move(end.x, end.y);
  await frames(page, 12);
  await page.screenshot({ path: resolve(output, `${quality}-stretch-preview.png`) });
  return end;
};

/** The end click plants, carriers deliver, a builder plants, then the tool clears the preview. */
const plantAndWait = async (page: Page, end: { x: number; y: number }) => {
  await page.mouse.click(end.x, end.y);
  await page.waitForFunction(() => (window as any).__settlement.simulation.roadVergeSites().length > 0,
    null, { timeout: 60_000 });
  const report = await page.evaluate(() => {
    const live = (window as any).__settlement, sim = live.simulation;
    let ticks = 0;
    while (sim.roadVergeSites().length > 0 && ticks < 8000) { live.realUpdate(.05); ticks += 1; }
    const planted = sim.roadSegments().filter((segment: any) => segment.verge === "flowers");
    return { planted: planted.length, sites: sim.roadVergeSites().length, ticks };
  });
  await page.evaluate(() => (window as any).__settlement.controls.cancel());
  console.log("planting", JSON.stringify(report));
  return report;
};

/** The planted first half beside the bare second half, at gameplay distance and close up. */
const capturePlanted = async (page: Page, quality: string, road: {
  access: { x: number; z: number }; mid: { x: number; z: number };
}) => {
  const focus = { x: road.mid.x, z: road.access.z };
  for (const [label, zoom] of [["iso", 1.7], ["close", 3.2]] as const) {
    await page.evaluate(([x, z, level]) => (window as any).__settlement.focusGround(x, z, level),
      [focus.x, focus.z, zoom]);
    await frames(page, 24);
    await page.screenshot({ path: resolve(output, `${quality}-planted-vs-unplanted-${label}.png`) });
  }
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on("pageerror", error => console.log("pageerror", error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name=v=>v;");
    await page.goto(`${url}admin.html?quality=${quality}&seed=${seed}&size=96&rivers=2&forest=0`
      + "&cache=0&time=day");
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement),
      null, { timeout: 180_000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    const road = await prepareRoads(page);
    console.log(quality, "roads", JSON.stringify(road));
    if (!road.preview.ok) throw new Error(`Verge preview refused: ${road.preview.reason}`);
    await captureRoadTab(page, quality);
    const end = await capturePreview(page, quality, road);
    const planted = await plantAndWait(page, end);
    if (!planted.planted) throw new Error("The verge stretch did not finish planting");
    await capturePlanted(page, quality, road);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
