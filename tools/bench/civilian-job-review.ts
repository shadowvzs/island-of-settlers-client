import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
const output = resolve("../resources/settlement-previews/civilian-jobs");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({
      viewport: quality === "high" ? { width: 1440, height: 1000 } : { width: 390, height: 844 }
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
    await page.addInitScript("window.__name = value => value;");
    await page.goto(`${url}?quality=${quality}&seed=123&cache=0`);
    await page.waitForFunction(
      () => Boolean((window as any).__islandReady && (window as any).__settlement),
      null,
      { timeout: 120000 }
    );
    const initial = await page.evaluate(() => (window as any).__settlement.simulation.snapshot());
    const endpoint = await page.evaluate(() => {
      const live = (window as any).__settlement,
        origin = live.simulation.headquarters.access;
      for (const [dx, dz] of [
        [0, 1],
        [1, 0],
        [-1, 0],
        [0, -1],
        [0, 2],
        [2, 0]
      ]) {
        const target = { x: origin.x + dx, z: origin.z + dz };
        if (live.roads.addRoad(origin, target)) return target;
      }
      throw new Error("No valid Scout dispatch road");
    });
    const scout = page.getByRole("button", { name: "Scout", exact: true });
    await scout.scrollIntoViewIfNeeded();
    await scout.click();
    const target = await page.evaluate((endpoint) => {
      const point = (window as any).__worker.projectGround(endpoint.x, endpoint.z);
      const rect = document.querySelector("canvas")!.getBoundingClientRect();
      return { x: point.x + rect.x, y: point.y + rect.y };
    }, endpoint);
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(100);
    assert(
      await page.evaluate(() =>
        (window as any).__settlement.simulation.frames().some((a: any) => a.job === "Scout")
      ),
      `${quality}: actual Scout UI dispatch`
    );
    const scoutEvidence = await page.evaluate(() => {
      const live = (window as any).__settlement;
      const jobs = new Set<string>();
      let complete = false;
      for (let i = 0; i < 8000; i++) {
        live.update(0.05);
        for (const actor of live.simulation.frames())
          if (actor.job === "Scout") jobs.add(actor.phase);
        if (
          live.simulation
            .frames()
            .filter((a: any) => a.job !== "Mount" && a.phase !== "retired").length === 0
        ) {
          complete = true;
          break;
        }
      }
      return { complete, phases: [...jobs], snapshot: live.simulation.snapshot() };
    });
    writeFileSync(
      resolve(output, `${quality}-scout-debug.json`),
      JSON.stringify(scoutEvidence, null, 2)
    );
    assert(scoutEvidence.complete, `${quality}: Scout returns to storage`);
    assert.equal(scoutEvidence.snapshot.settlersInside, 20);
    assert.equal(
      scoutEvidence.snapshot.buildings[0].inventory.bow,
      initial.buildings[0].inventory.bow
    );
    assert(scoutEvidence.phases.includes("surveyWalk"));
    await page.screenshot({ path: resolve(output, `${quality}-scout-return.png`) });
    const geoTarget = await page.evaluate(() => {
      const live = (window as any).__settlement,
        origin = live.simulation.headquarters.access;
      const zones = live.simulation
        .surveyedDeposits()
        .filter((zone: any) => !zone.surveyed)
        .sort(
          (a: any, b: any) =>
            Math.hypot(a.x - origin.x, a.z - origin.z) - Math.hypot(b.x - origin.x, b.z - origin.z)
        );
      for (const zone of zones.slice(0, 10))
        for (const target of zone.oreCells
          .slice()
          .sort(
            (a: any, b: any) =>
              Math.hypot(a.x - origin.x, a.z - origin.z) -
              Math.hypot(b.x - origin.x, b.z - origin.z)
          )) {
          if (live.simulation.connectRoads(origin, target)) {
            live.focusGround(target.x, target.z);
            return target;
          }
        }
      return null;
    });
    assert(geoTarget, `${quality}: generated deposit reachable by an actual road`);
    await page.waitForTimeout(300);
    const geologist = page.getByRole("button", { name: "Geologist", exact: true });
    await geologist.scrollIntoViewIfNeeded();
    await geologist.click();
    const geoPixel = await page.evaluate((point) => {
      const projection = (window as any).__worker.projectGround(point.x, point.z);
      const rect = document.querySelector("canvas")!.getBoundingClientRect();
      return { x: projection.x + rect.x, y: projection.y + rect.y };
    }, geoTarget);
    await page.mouse.click(geoPixel.x, geoPixel.y);
    assert(
      await page.evaluate(() =>
        (window as any).__settlement.simulation.frames().some((a: any) => a.job === "Geologist")
      ),
      `${quality}: actual Geologist UI dispatch`
    );
    const geological = await page.evaluate(() => {
      const live = (window as any).__settlement;
      let completed = false;
      for (let i = 0; i < 30000; i++) {
        live.update(0.05);
        if (
          !live.simulation.frames().some((a: any) => a.job !== "Mount" && a.phase !== "retired")
        ) {
          completed = true;
          break;
        }
      }
      return {
        completed,
        zones: live.simulation.surveyedDeposits(),
        snapshot: live.simulation.snapshot()
      };
    });
    assert(geological.completed, `${quality}: Geologist returns with reserved hammer`);
    assert(
      geological.zones.some((zone: any) => zone.surveyed),
      `${quality}: survey marks actual deposit`
    );
    assert.equal(geological.snapshot.settlersInside, 20);
    assert.equal(
      geological.snapshot.buildings[0].inventory.hammer,
      initial.buildings[0].inventory.hammer
    );
    await page.screenshot({ path: resolve(output, `${quality}-geologist-survey.png`) });
    const workshop = await page.evaluate(() => {
      const live = (window as any).__settlement,
        hq = live.simulation.headquarters;
      for (let dz = -12; dz <= 12; dz++)
        for (let dx = -12; dx <= 12; dx++) {
          const x = Math.floor(hq.x) + dx + 0.5,
            z = Math.floor(hq.z) + dz;
          if (live.simulation.validatePlacement(25, x, z, 0)) continue;
          const result = live.simulation.placeBuilding(25, x, z, 0);
          if (result.ok) {
            live.update(0.5);
            return result.building.uid;
          }
        }
      return null;
    });
    assert(workshop, `${quality}: real workshop placement for output mode`);
    const overview = page.getByRole("button", { name: "Buildings", exact: true });
    await overview.scrollIntoViewIfNeeded();
    await overview.click();
    const production = page.locator(`[data-building-uid="${workshop}"]`);
    await production.getByRole("radio", { name: "Produce hammer", exact: true }).check();
    assert.equal(
      await page.evaluate(
        (uid) =>
          (window as any).__settlement.simulation.buildings().find((b: any) => b.uid === uid)
            .selectedOutput,
        workshop
      ),
      "hammer"
    );
    await production.getByRole("radio", { name: "Produce random tools", exact: true }).check();
    assert.equal(
      await page.evaluate(
        (uid) =>
          (window as any).__settlement.simulation.buildings().find((b: any) => b.uid === uid)
            .selectedOutput,
        workshop
      ),
      undefined
    );
    await page.screenshot({ path: resolve(output, `${quality}-production-selection.png`) });
    await page.getByRole("button", { name: "Close settlement window", exact: true }).click();
    assert.deepEqual(errors, []);
    reports.push({
      quality,
      phases: scoutEvidence.phases,
      population: scoutEvidence.snapshot.settlersInside,
      geologistSurveyed: geological.zones.filter((zone: any) => zone.surveyed).length,
      errors
    });
    await page.close();
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports));
} finally {
  await browser.close();
  await server.close();
}
