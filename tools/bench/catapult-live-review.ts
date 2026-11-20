import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { readCatapultContacts } from "./catapult-contact-metrics";
import { lookAt } from "./expedition-review-helpers";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "catapult-live-2026-11-02");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of (process.env.QUALITIES ?? (process.argv.includes("--walkthrough") ? "high" : "high,minimal")).split(",")) {
    const page = await browser.newPage({ viewport: { height: 900, width: 1280 },
      ...(quality === "high" ? { recordVideo: { dir: resolve(output, "raw-video"), size: { height: 900, width: 1280 } } } : {}) });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/src/app/island-runtime.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      await route.fulfill({ response, body: source.replace("window.__islandReady = true",
        "(window.__catapultCamera = camera, window.__islandReady = true)") });
    });
    await page.route("**/src/renderers/three/three-worker.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      await route.fulfill({ response, body: source.replace("const scene = new Scene();",
        "const scene = new Scene(); window.__catapultWorkerScene = scene;") });
    });
    await page.goto(`${url}admin.html?quality=${quality}&seed=123&size=96&forest=0&cache=0&time=day`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement),
      null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    const fixture = await page.evaluate(() => {
      const sim = (window as any).__settlement.simulation;
      const result = sim.debugRaiseBuilding(16);
      if (!result.ok) throw new Error(result.reason);
      const tower = result.building;
      sim.receiveTroops([{ type: "heavy", rank: 0, hp: 150 }, { type: "shield", rank: 0, hp: 125 }]);
      for (let tick = 0; tick < 20 * 180; tick++) sim.update(.05);
      const snapshot = sim.militaryBuildings().find((site: any) => site.uid === tower.uid);
      const rawUpdate = sim.update.bind(sim);
      const review: any = { elapsed: 0, interruptions: [], launches: [], seenShots: new Set() };
      review.update = (dt: number) => {
        const before = review.tower.catapultCycle ? { ...review.tower.catapultCycle } : undefined;
        rawUpdate(dt); review.elapsed += dt;
        if (before && before.phase !== "return" && !review.tower.catapultCycle)
          review.interruptions.push({ phase: before.phase, target: before.target, time: review.elapsed,
            targetVisible: sim.frames().some((actor: any) => actor.uid === before.target && actor.visible) });
        for (const shot of sim.militaryArrows()) if (shot.boulder && !review.seenShots.has(shot.id)) {
          review.seenShots.add(shot.id); review.launches.push(review.elapsed);
        }
      };
      Object.defineProperty(review, "tower", { get: () => sim.buildings().find((site: any) => site.uid === tower.uid) });
      (window as any).__catapultReview = review;
      // Hold simulation at this concrete review state while the renderer loads the native actors.
      sim.update = () => {}; sim.tickFraction = () => 1;
      return { uid: tower.uid, x: tower.x, z: tower.z, snapshot, stone: tower.input.stone };
    });
    assert.equal(fixture.stone, 6); assert.equal(fixture.snapshot.stationedTroops.heavy, 1);
    await lookAt(page, fixture);
    await page.evaluate(({ x, z }) => Object.assign((window as any).__catapultCamera,
      { centerX: x, centerZ: z, tilt: 0, yaw: 0, zoom: 2.0 }), fixture);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: resolve(output, `${quality}-crew.png`) });
    const enemies = await page.evaluate(() => {
      const sim = (window as any).__settlement.simulation, tower = (window as any).__catapultReview.tower;
      const targets = [[4, 0], [0, 4], [-4, 0], [0, -4]].flatMap(([x, z]) => {
        const uid = sim.spawnMilitaryOpponent({ x: tower.x + x!, z: tower.z + z! }, "archer");
        return uid === null ? [] : [{ uid, point: { x: tower.x + x!, z: tower.z + z! } }];
      });
      (window as any).__catapultReview.targets = targets;
      return targets.map(target => target.uid);
    });
    const phases = [];
    for (const [phase, elapsed] of [["pick", .4], ["load", 1.05], ["wind", 1.3],
      ["clear", .2], ["fire", .1], ["return", .3]] as const) {
      const state = await page.evaluate(({ elapsed, phase }) => {
        const review = (window as any).__catapultReview;
        for (let tick = 0; tick < 20 * 10; tick++) {
          // Repeated normal Move orders hold the review targets at their authored posts.
          // Natural approaching-enemy cancellation is covered independently in simulation tests.
          for (const target of review.targets)
            (window as any).__settlement.simulation.commandMilitaryOpponent([target.uid], target.point, 1, "move");
          review.update(.05);
          if (review.tower.catapultCycle?.phase === phase && review.tower.catapultCycle.elapsed >= elapsed - 1e-6)
            return { cycle: structuredClone(review.tower.catapultCycle), stock: review.tower.input.stone };
        }
        throw new Error(`Tower did not reach ${phase}: ${JSON.stringify({ cycle: review.tower.catapultCycle,
          stock: review.tower.input, status: (window as any).__settlement.simulation.militaryBuildings()
            .find((site: any) => site.uid === review.tower.uid) })}`);
      }, { elapsed, phase });
      await page.waitForTimeout(600);
      const contacts = await page.evaluate(readCatapultContacts);
      assert(!("error" in contacts), JSON.stringify(contacts));
      if (phase === "pick" || phase === "load")
        assert(contacts.carryErrors.every((error: number | null | undefined) => error != null && error < .005), JSON.stringify(contacts));
      if (phase === "wind")
        assert(contacts.crankErrors?.every((error: number | null) => error !== null && error < .005), JSON.stringify(contacts));
      assert(Math.min(contacts.soles.left, contacts.soles.right) >= -.01, JSON.stringify(contacts));
      phases.push({ ...state, contacts });
      await page.screenshot({ path: resolve(output, `${quality}-${phase}.png`) });
      await page.evaluate(() => {
        const tower = (window as any).__catapultReview.tower;
        const offset = (tower.y + 3.2) / Math.tan(Math.PI / 6) / Math.SQRT2;
        Object.assign((window as any).__catapultCamera,
          { yaw: Math.PI / 2, zoom: 3.0, centerX: tower.x - offset, centerZ: tower.z + offset });
      });
      await page.waitForTimeout(100);
      await page.screenshot({ path: resolve(output, `${quality}-${phase}-side-close.png`) });
      await page.evaluate(() => Object.assign((window as any).__catapultCamera, { yaw: 0, zoom: 2.0, centerZ: (window as any).__catapultReview.tower.z,
        centerX: (window as any).__catapultReview.tower.x }));
    }
    const shot = await page.evaluate(() => {
      const sim = (window as any).__settlement.simulation, review = (window as any).__catapultReview;
      const shot = sim.militaryArrows().find((projectile: any) => projectile.boulder);
      return { shot, stone: review.tower.input.stone };
    });
    assert(shot.shot.boulder); assert.equal(shot.stone, 5);
    await page.screenshot({ path: resolve(output, `${quality}-boulder-flight.png`) });
    const restored = await page.evaluate(() => {
      const sim = (window as any).__settlement.simulation;
      const before = structuredClone(sim.militaryArrows());
      const result = sim.loadState(structuredClone(sim.saveState()));
      return { before, after: sim.militaryArrows(), result };
    });
    assert.equal(restored.result.ok, true); assert.deepEqual(restored.before, restored.after);
    const cadence = await page.evaluate(() => {
      const review = (window as any).__catapultReview;
      for (let tick = 0; tick < 200 && review.launches.length < 2; tick++) {
        for (const target of review.targets)
          (window as any).__settlement.simulation.commandMilitaryOpponent([target.uid], target.point, 1, "move");
        review.update(.05);
      }
      return { interruptions: review.interruptions, launches: review.launches, minimumSeconds: 5,
        seconds: review.launches[1] - review.launches[0] };
    });
    assert(cadence.seconds >= 5 - 1e-6 && cadence.seconds < 10, JSON.stringify(cadence));
    // A separate authored low-stock fixture checks the farthest rack pickup, including after save restore.
    await page.evaluate(() => {
      const tower = (window as any).__catapultReview.tower;
      tower.input.stone = 1; tower.catapultCycle = undefined; tower.catapultReload = 0;
    });
    const rear = await page.evaluate(() => {
      const review = (window as any).__catapultReview;
      for (let tick = 0; tick < 200; tick++) {
        for (const target of review.targets)
          (window as any).__settlement.simulation.commandMilitaryOpponent([target.uid], target.point, 1, "move");
        review.update(.05);
        if (review.tower.catapultCycle?.phase === "pick" && review.tower.catapultCycle.elapsed >= .4 - 1e-6)
          return structuredClone(review.tower.catapultCycle);
      }
      throw new Error("Rear rack fixture did not reach pickup");
    });
    assert.equal(rear.stoneSlot, 0);
    await page.waitForTimeout(600);
    const rearContacts = await page.evaluate(readCatapultContacts);
    assert(!("error" in rearContacts), JSON.stringify(rearContacts));
    assert(rearContacts.carryErrors.every((error: number | null | undefined) => error != null && error < .005), JSON.stringify(rearContacts));
    await page.screenshot({ path: resolve(output, `${quality}-rear-pick.png`) });
    let clipSeconds = 0;
    if (quality === "high") {
      await page.evaluate(() => {
        const review = (window as any).__catapultReview, sim = (window as any).__settlement.simulation;
        review.tower.input.stone = 0; review.tower.catapultCycle = undefined;
        for (let tick = 0; tick < 40; tick++) {
          for (const target of review.targets) sim.commandMilitaryOpponent([target.uid], target.point, 1, "move");
          review.update(.05);
        }
        review.tower.input.stone = 6; review.tower.catapultReload = 0; review.tower.catapultCycle = undefined;
        const offset = (review.tower.y + 1.7) / Math.tan(Math.PI / 6) / Math.SQRT2;
        Object.assign((window as any).__catapultCamera, { yaw: Math.PI / 2, zoom: 2.1,
          centerX: review.tower.x - offset, centerZ: review.tower.z + offset });
      });
      await page.waitForTimeout(600);
      const started = Date.now();
      await page.evaluate(() => new Promise<void>((resolve, reject) => {
        const review = (window as any).__catapultReview, sim = (window as any).__settlement.simulation;
        let fired = false, ticks = 0;
        const timer = setInterval(() => {
          const living = new Set(sim.frames().filter((actor: any) => actor.visible).map((actor: any) => actor.uid));
          for (const target of review.targets) if (living.has(target.uid))
            sim.commandMilitaryOpponent([target.uid], target.point, 1, "move");
          review.update(.05); ticks++;
          fired ||= sim.militaryArrows().some((shot: any) => shot.boulder);
          if (fired && !review.tower.catapultCycle) { clearInterval(timer); resolve(); }
          if (ticks > 300) { clearInterval(timer); reject(new Error("Real-time cycle did not finish")); }
        }, 50);
      }));
      await page.waitForTimeout(600);
      clipSeconds = (Date.now() - started) / 1000 + .4;
    }
    assert.deepEqual(errors, []);
    reports.push({ cadence, enemies, errors, fixture, phases, quality, rear, rearContacts, restored: true, shot });
    const video = page.video(); await page.close();
    if (video && clipSeconds) {
      const raw = await video.path();
      const result = spawnSync("ffmpeg", ["-y", "-sseof", String(-clipSeconds), "-i", raw,
        "-an", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", resolve(output, "high-cycle.mp4")], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  writeFileSync(resolve(output, "final-report.json"), JSON.stringify({
    preset: { deckSpan: 1.65, shaftSpan: 1.45, canopySpan: 1.70, engineScale: .78,
      scoop: [.36, .14, .40], stoneDiameter: .11, crewFloor: 1.77,
      upperAssembly: "original rectangular deck, canopy, posts, rack, engine and crew rotate together",
      cycleSeconds: 5, minimumLaunchSpacingSeconds: 5, preparationSeconds: 4.4,
      phases: { pick: .6, load: 1.2, wind: 2, clear: .4, fire: .2, return: .6 } },
    qualities: reports
  }, null, 2));
  console.log(JSON.stringify(reports));
} finally { await browser.close(); await server.close(); }
