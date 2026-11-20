import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { CATAPULT_DECK_HEIGHT } from "../../src/render-common/buildings/catapult-dimensions";
import { CATAPULT_STONE_DIAMETER } from "../../src/render-common/buildings/catapult-mechanism";
import { launchBrowser, startDevServer } from "./browser";
import { readCatapultContacts } from "./catapult-contact-metrics";
import { checkPossessedActionConfig } from "./possessed-action-config-check";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "catapult-final-fixed-deck-34cm-2026-11-03");
const sourceHashes = Object.fromEntries([
  "src/render-common/buildings/catapult-dimensions.ts", "src/render-common/buildings/catapult-mechanism.ts",
  "src/render-common/buildings/catapult-hatch.ts", "src/render-common/buildings/catapult-tower-recipe.ts",
  "src/shared/settlement/catapult-cycle.ts", "src/shared/settlement/military-catapult-resupply-actors.ts",
  "src/shared/settlement/military-catapult-impact.ts", "src/renderers/three/worker-stone-carry.ts",
  "src/renderers/three/worker-catapult-hands.ts", "src/renderers/three/worker-handcart-grip.ts"
].map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of (process.env.QUALITIES ?? "high,minimal").split(",")) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 },
      ...(quality === "high" && !process.env.PROBE ? { recordVideo: { dir: "/tmp/catapult-native-raw", size: { width: 1280, height: 900 } } } : {}) });
    const errors: string[] = [], captureTasks: Promise<unknown>[] = [];
    page.on("console", message => {
      if (message.text() === "CATAPULT_HATCH_EMERGENCE") captureTasks.push(page.screenshot({ path: resolve(output,
        quality === "high" ? "roof-hatch-open-carrier-carrying-stone.png" : "minimal-roof-hatch-open-carrier-carrying-stone.png") }));
      if (message.text() === "CATAPULT_ROOF_PLACEMENT") captureTasks.push(page.screenshot({ path: resolve(output, `${quality}-roof-stock-placement.png`) }));
    });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(`window.__name=value=>value; window.__catapultProbe=${Boolean(process.env.PROBE)};`);
    await page.routeWebSocket("**/*", () => {});
    for (const [path, before, after] of [
      ["app/island-runtime.ts", "window.__islandReady = true", "(window.__catapultCamera = camera, window.__islandReady = true)"],
      ["renderers/three/three-worker.ts", "const scene = new Scene();", "const scene = new Scene(); window.__catapultWorkerScene = scene;"]
    ]) await page.route(`**/src/${path}*`, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace(before!, after!) });
    });
    await page.goto(`${url}admin.html?quality=${quality}&seed=123&size=96&forest=0&cache=0&time=day`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement), null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    const fixture = await page.evaluate(({ deck }) => {
      const sim = (window as any).__settlement.simulation;
      const result = sim.debugRaiseBuilding(16);
      if (!result.ok) throw new Error(result.reason);
      const uid = result.building.uid, raw = sim.update.bind(sim);
      sim.receiveTroops([{ type: "heavy", rank: 0, hp: 150 }, { type: "shield", rank: 0, hp: 125 }]);
      sim.setMilitaryComposition(uid, { heavy: 1, shield: 1, archer: 0 });
      const review: any = { elapsed: 0, phases: [], phaseTimes: {}, launches: [], seen: new Set(), targets: [] };
      Object.defineProperty(review, "tower", { get: () => sim.buildings().find((site: any) => site.uid === uid) });
      review.update = (dt: number) => {
        for (const target of review.targets) sim.commandMilitaryOpponent([target.uid], target.point, 1, "move");
        raw(dt); review.elapsed += dt;
        for (const shot of sim.militaryArrows()) if (shot.boulder && !review.seen.has(shot.id)) {
          review.seen.add(shot.id); review.launches.push(review.elapsed);
        }
        const porter = review.tower.catapultSupply?.porter, phase = porter?.phase;
        if (review.captureJourney && phase === "stairs-up") {
          if (!review.hatchView) { review.hatchView = true; review.camera(true); }
          const body = sim.snapshot().actors.find((actor: any) => actor.uid === porter.actor);
          if (!review.hatchCaptured && body?.visible && body.y >= review.tower.y + deck - .45) {
            review.hatchCaptured = true; console.log("CATAPULT_HATCH_EMERGENCE");
          }
        }
        if (review.captureJourney && phase === "place" && porter.elapsed >= .25 && !review.placementCaptured) {
          review.placementCaptured = true; console.log("CATAPULT_ROOF_PLACEMENT");
        }
        if (phase && !review.phases.includes(phase)) { review.phases.push(phase); review.phaseTimes[phase] = review.elapsed; }
      };
      for (let tick = 0; tick < 12000 && !review.tower.catapultSupply?.porter; tick++) review.update(.05);
      if (!review.tower.catapultSupply?.porter) throw new Error("Employed Carrier did not begin ground collection");
      (window as any).__catapultReview = review;
      sim.update = () => {}; sim.tickFraction = () => 1;
      const tower = review.tower;
      review.camera = (roof: boolean, front = false, close = false) => {
        const height = tower.y + (roof ? deck + .40 : deck * .5), offset = height / Math.tan(Math.PI / 6) / Math.SQRT2;
        const back = roof && !front;
        let zoom = roof ? 2.8 : 2.0;
        if (close) zoom = 4.2;
        Object.assign((window as any).__catapultCamera, { yaw: back ? -Math.PI / 2 : Math.PI / 2, tilt: 0, zoom,
          centerX: tower.x + (back ? offset : -offset), centerZ: tower.z + (back ? -offset : offset) });
      };
      review.camera(false);
      return { uid, x: tower.x, y: tower.y, z: tower.z, ground: tower.catapultSupply.ground, roof: tower.input.stone ?? 0 };
    }, { deck: CATAPULT_DECK_HEIGHT * (16 / 11) });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(output, `${quality}-fixed-deck-overview.png`) });
    await page.evaluate(() => { (window as any).__catapultReview.captureJourney = true; });
    const started = Date.now();
    const journey = await page.evaluate(() => new Promise<any>((done, reject) => {
      const review = (window as any).__catapultReview;
      let ticks = 0;
      const timer = setInterval(() => {
        review.update(.05); ticks++;
        if ((review.tower.input.stone ?? 0) >= 1 && !review.tower.catapultSupply?.porter) {
          clearInterval(timer); done({ phases: review.phases, phaseTimes: review.phaseTimes, roof: review.tower.input.stone,
            ground: review.tower.catapultSupply?.ground, seconds: ticks * .05 });
        }
        if (ticks > 1800) { clearInterval(timer); reject(new Error("Restocking journey timed out")); }
      }, (window as any).__catapultProbe ? 1 : 50);
    }));
    const journeyEnded = Date.now();
    await Promise.all(captureTasks);
    await page.screenshot({ path: resolve(output, `${quality}-roof-hatch-closed.png`) });
    for (const phase of ["outbound", "pickup", "inbound", "stairs-up", "roof", "place", "roof-return", "stairs-down"])
      assert(journey.phases.includes(phase), `${phase}: ${JSON.stringify(journey)}`);
    await page.screenshot({ path: resolve(output, `${quality}-stock-delivered.png`) });
    await page.evaluate(() => {
      const sim = (window as any).__settlement.simulation, review = (window as any).__catapultReview;
      // Finish the same real hauling jobs before admitting hostile review targets.
      for (let tick = 0; tick < 8000 && ((review.tower.input.stone ?? 0) < 6 || review.tower.catapultSupply?.porter); tick++) review.update(.05);
      if (review.tower.input.stone !== 6) throw new Error("Physical roof refill failed");
      review.camera(false);
      for (const [x, z] of [[6, 0], [0, 6], [-6, 0], [0, -6]]) {
        const point = { x: review.tower.x + x!, z: review.tower.z + z! };
        const uid = sim.spawnMilitaryOpponent(point, "archer");
        if (uid !== null) review.targets.push({ uid, point });
      }
    });
    const firingStarted = Date.now();
    const cycle = await page.evaluate(() => new Promise<any>((done, reject) => {
      const review = (window as any).__catapultReview;
      let ticks = 0;
      const timer = setInterval(() => {
        review.update(.05); ticks++;
        if (review.launches.length && !review.tower.catapultCycle) { clearInterval(timer); done({ launches: review.launches, seconds: ticks * .05 }); }
        if (ticks > 1400) { clearInterval(timer); reject(new Error("Physical firing cycle timed out")); }
      }, (window as any).__catapultProbe ? 1 : 50);
    }));
    const firingEnded = Date.now();
    const phases = [];
    for (const [phase, elapsed] of [["pick", 1.3], ["load", 3.30], ["clear", 3.65], ["traverse", .3], ["fire", .15], ["return", .3]] as const) {
      const state = await page.evaluate(({ elapsed, phase }) => {
        const review = (window as any).__catapultReview;
        const observed: Record<string, number> = {};
        for (let tick = 0; tick < 3000; tick++) {
          review.update(.01);
          const current = review.tower.catapultCycle;
          if (current) observed[current.phase] = Math.max(observed[current.phase] ?? 0, current.elapsed);
          if (review.tower.catapultCycle?.phase === phase && review.tower.catapultCycle.elapsed >= elapsed - 1e-6)
            return { cycle: structuredClone(review.tower.catapultCycle), roof: review.tower.input.stone, aim: review.tower.catapultAim };
        }
        throw new Error(`Missing ${phase}: ${JSON.stringify({ cycle: review.tower.catapultCycle, observed, input: review.tower.input, launches: review.launches })}`);
      }, { phase, elapsed });
      await page.waitForTimeout(500);
      const contacts = await page.evaluate(readCatapultContacts);
      assert(!("error" in contacts), JSON.stringify(contacts));
      if (phase === "pick" || phase === "load") assert(contacts.carryErrors.every((value: number | null | undefined) => value != null && value < .005), JSON.stringify(contacts));
      if (phase === "traverse" || phase === "fire") assert(contacts.crankErrors?.every((value: number | null | undefined) => value != null && value < .005), JSON.stringify(contacts));
      assert(Math.min(contacts.soles.left, contacts.soles.right) >= -.01, JSON.stringify(contacts));
      phases.push({ ...state, contacts });
      await page.screenshot({ path: resolve(output, `${quality}-${phase}.png`) });
      await page.evaluate(() => (window as any).__catapultReview.camera(true, true, true));
      await page.waitForTimeout(200);
      await page.screenshot({ path: resolve(output, `${quality}-${phase}-close.png`) });
      await page.evaluate(() => (window as any).__catapultReview.camera(false));
    }
    const cadence = await page.evaluate(() => {
      const review = (window as any).__catapultReview, sim = (window as any).__settlement.simulation;
      for (let tick = 0; tick < 6000 && review.launches.length < 3; tick++) review.update(.01);
      const saved = sim.saveState(), restored = sim.loadState(JSON.parse(JSON.stringify(saved)));
      return { launches: review.launches, restored };
    });
    assert.equal(cadence.restored.ok, true);
    assert(cadence.launches.length >= 2);
    for (let index = 1; index < cadence.launches.length; index++) assert(cadence.launches[index]! - cadence.launches[index - 1]! >= 5 - 1e-6);
    assert.deepEqual(errors, []);
    const possessedConfig = await checkPossessedActionConfig(page);
    reports.push({ quality, probe: Boolean(process.env.PROBE), sourceHashes, possessedConfig,
      parameters: { shaftHeight: 2.475, deckHeight: CATAPULT_DECK_HEIGHT, stoneDiameterModel: CATAPULT_STONE_DIAMETER,
        stoneDiameterWorld: CATAPULT_STONE_DIAMETER * (16 / 11), structureHP: 27_500, impactRadius: .75, range: [1, 7.5], minimumReload: 5 },
      fixture, journey, cycle, phases, cadence, errors });
    const video = page.video(); await page.close();
    if (video) {
      // This raw recording includes setup and inspections; the final clip is the two real-time journeys only.
      const raw = await video.path();
      const closed = Date.now();
      const encode = (name: string, from: number, to: number) => {
        const encoded = spawnSync("ffmpeg", ["-y", "-sseof", String(-(closed - from) / 1000), "-i", raw,
          "-t", String((to - from) / 1000), "-an", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p",
          resolve(output, name)], { encoding: "utf8" });
        assert.equal(encoded.status, 0, encoded.stderr);
      };
      encode("fixed-deck-restocking-high.mp4", started, journeyEnded);
      encode("fixed-deck-turntable-firing-high.mp4", firingStarted, firingEnded);
      const concat = spawnSync("ffmpeg", ["-y", "-i", resolve(output, "fixed-deck-restocking-high.mp4"),
        "-i", resolve(output, "fixed-deck-turntable-firing-high.mp4"), "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map", "[v]", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p",
        resolve(output, "fixed-deck-turntable-restocking-high.mp4")], { encoding: "utf8" });
      assert.equal(concat.status, 0, concat.stderr);
      for (const [name, seconds] of [["pickup-ground", 2.5]]) {
        const shot = spawnSync("ffmpeg", ["-y", "-ss", String(seconds), "-i", resolve(output, "fixed-deck-restocking-high.mp4"),
          "-frames:v", "1", resolve(output, `high-${name}.png`)], { encoding: "utf8" });
        assert.equal(shot.status, 0, shot.stderr);
      }
    }
  }
  writeFileSync(resolve(output, process.env.PROBE ? "probe-native-report.json" : "final-native-report.json"), JSON.stringify(reports, null, 2));
} finally { await browser.close(); await server.close(); }
