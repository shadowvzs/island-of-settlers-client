import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { NATION_DRINK_CHAINS } from "../../../island-of-settlers-shared/src/catalog/building-data/drinks";
import { launchBrowser, startDevServer } from "./browser";
import { openFixturePage, writeFlatIslandGame } from "./flat-island-fixture";

/**
 * Drink-maker brewer stance (RED-TESTS 0757ce6c0 moved the stand to z .49): the real recruited worker
 * of building 6 for the four building-first nations, at rotations 0 and 1, frozen in its `work`
 * phase on the actual island renderer. Close front/side views and the normal gameplay view, High and
 * Minimal. Usage (from island-of-settlers-client): npx tsx tools/bench/drink-maker-stance-review.ts <out>
 */
const output = resolve(process.argv[2] ?? "../../captures/visual-acceptance/brewer");
mkdirSync(output, { recursive: true });
const nations = (process.env.NATIONS ?? "chinese,persian,maya,indigenous").split(",");
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const ROTATIONS = [0, 1];
/** Flat generated island, one finished level 1 drink maker per rotation, saved as the startup game. */
const writeFixture = (page: Page, nation: string) => writeFlatIslandGame(page, {
  buildings: ROTATIONS.map(rotation => ({ rotation, typeId: 6, x: 32 + rotation * 16, z: 30 })),
  name: "Drink-maker stance review", nation,
  stock: { cloth: 40, planks: 40, stone: 40, water: 40, [NATION_DRINK_CHAINS[nation]!.raw]: 40 }
});

/** Runs the real simulation until the plot's worker stands in `work`, then freezes the clock. */
const freezeAtWork = (page: Page, uid: number) => page.evaluate(id => {
  const review = (window as any).__stanceReview, simulation = review.simulation;
  const advance = review.advance ??= simulation.update.bind(simulation);
  simulation.update = () => {};
  for (let tick = 0; tick < 40000; tick++) {
    const actor = simulation.frames().find((entry: any) => entry.building === id && entry.phase === "work");
    if (actor) {
      for (let step = 0; step < 40; step++) advance(.025);
      const settled = simulation.frames().find((entry: any) => entry.uid === actor.uid);
      return { action: settled.action, phase: settled.phase, x: settled.x, yaw: settled.yaw, z: settled.z };
    }
    advance(.025);
  }
  throw new Error(`Drink maker ${id} never reached work`);
}, uid);

const shoot = async (page: Page, name: string, view: { x: number; yaw: number; z: number; zoom: number }) => {
  await page.evaluate(({ x, yaw, z, zoom }) => {
    const { camera, settlement } = (window as any).__stanceReview;
    settlement.update(.5); settlement.update(.5);
    Object.assign(camera, { centerX: x, centerZ: z, tilt: 0, yaw, zoom });
  }, view);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(output, `${name}.png`) });
};

const reviewNation = async (page: Page, baseUrl: string, nation: string, quality: string, errors: string[]) => {
  const plots = await writeFixture(page, nation);
  await page.route("**/src/app/island-runtime.ts*", async route => {
    const response = await route.fetch(), source = await response.text();
    assert(source.includes("window.__islandReady = true"), "runtime readiness marker must be instrumented");
    await route.fulfill({ response, body: source.replace("window.__islandReady = true",
      "(window.__stanceReview = { camera, settlement, simulation: settlement?.simulation }, window.__islandReady = true)") });
  });
  await page.goto(`${baseUrl}?quality=${quality}`);
  await page.waitForFunction(() => Boolean((window as any).__stanceReview), null, { timeout: 180000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  const samples: unknown[] = [];
  for (const plot of plots) {
    const worker = await freezeAtWork(page, plot.uid);
    const prefix = `${nation}-${quality}-r${plot.rotation}`, at = { x: worker.x, z: worker.z };
    await shoot(page, `${prefix}-close-front`, { ...at, yaw: 0, zoom: 4.2 });
    await shoot(page, `${prefix}-close-side`, { ...at, yaw: Math.PI / 2, zoom: 4.2 });
    await shoot(page, `${prefix}-normal`, { ...at, yaw: 0, zoom: 1.6 });
    samples.push({ plot, worker });
  }
  return { errors: [...errors], nation, quality, samples };
};

const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const nation of nations) for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { height: 800, width: 1200 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await openFixturePage(page, url);
    reports.push(await reviewNation(page, url, nation, quality, errors));
    await page.close();
  }
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify(reports, null, 2));
  await browser.close(); await server.close();
}
console.log(`Drink-maker stance review: ${output}`);
