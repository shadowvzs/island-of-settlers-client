import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const source =
  process.env.CROWDED_GAME_PATH ?? "/home/shadowvzs/Downloads/island-settlers-2026-10-09.json";
const saved = readFileSync(source, "utf8");
const connectBridge = process.env.CROWDED_GAME_CONNECT_BRIDGE === "1";
const farmFixture = process.env.CROWDED_GAME_FARM === "1";
const cropReview = process.env.CROWDED_GAME_CROP === "1";
let reviewSuffix = connectBridge ? "-connected" : "";
if (farmFixture) reviewSuffix = "-farm";
const reviewName = process.env.CROWDED_GAME_REVIEW_ID ?? `user-crowded-game${reviewSuffix}`;
const output = resolve(`../resources/settlement-previews/${reviewName}`);
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      if (process.env.CROWDED_GAME_ERROR_STACK === "1") console.error(error.stack);
    });
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name = value => value;");
    await page.route("**/src/app/main.ts", async (route) => {
      const response = await route.fetch();
      const text = await response.text();
      await route.fulfill({
        response,
        body: text.replace(
          "window.__islandReady = true",
          "window.__userCrowd = {world,camera}; window.__islandReady = true"
        )
      });
    });
    await page.goto(`${url}?quality=${quality}&seed=1234&reveal=1&cache=0`);
    await page.waitForFunction(() => window.__islandReady, null, { timeout: 180000 });
    const reloaded = page.waitForEvent("load", { timeout: 120000 });
    await page.evaluate((text) => {
      void (window as any).__settlement.savedGames.importJson(text);
    }, saved);
    await reloaded;
    await page.waitForFunction(() => window.__islandReady && (window as any).__userCrowd, null, {
      timeout: 180000
    });
    const initial = await page.evaluate(
      ({ bridge, farm }) => {
        const live = (window as any).__settlement,
          sim = live.simulation;
        const review = (window as any).__userCrowd;
        review.update = sim.update.bind(sim);
        sim.update = () => {};
        if (bridge && !sim.connectRoads({ x: 160, z: 212.5 }, { x: 160.5, z: 212.5 }))
          throw new Error("Missing road bridge could not be connected");
        review.pending = new Map(
          sim
            .frames()
            .filter((a: any) => a.delivery)
            .map((a: any) => [a.uid, a.delivery])
        );
        if (farm) {
          const hq = sim.headquarters;
          for (let radius = 16; radius <= 48 && !review.farmUid; radius += 2) {
            for (const [dx, dz] of [
              [radius, 0],
              [-radius, 0],
              [0, radius],
              [0, -radius],
              [radius, 6],
              [-radius, 6],
              [6, radius],
              [6, -radius]
            ]) {
              const x = Math.round(hq.x + dx),
                z = Math.round(hq.z + dz);
              if (sim.validatePlacement(37, x, z)) continue;
              const placed = sim.placeBuilding(37, x, z);
              if (!placed.ok) continue;
              if (!sim.connectRoads(hq.access, placed.building.access)) {
                sim.demolishBuilding(placed.building.uid);
                continue;
              }
              review.farmUid = placed.building.uid;
              break;
            }
          }
          if (!review.farmUid) throw new Error("No reachable Farm construction fixture");
        }
        review.cropCycle = {
          sow: false,
          growing: false,
          harvest: false,
          carry: false,
          stock: false
        };
        review.cropMaximumRange = 0;
        review.farmStonePeak = 0;
        review.farmNearPeak = 0;
        review.planIds = sim
          .buildings()
          .filter((b: any) => b.construction < 1)
          .map((b: any) => b.uid);
        review.elapsed = 0;
        review.completed = [];
        review.maxStep = 0;
        review.visiblePeak = 0;
        const focus = review.farmUid
          ? sim.buildings().find((b: any) => b.uid === review.farmUid)
          : sim.headquarters;
        const existingFarm = sim
          .buildings()
          .find((b: any) => b.typeId === 37 && b.construction < 1);
        review.camera.centerX = (existingFarm ?? focus).x - 6;
        review.camera.centerZ = (existingFarm ?? focus).z - 2;
        review.camera.zoom = 1.8;
        return {
          seed: review.world.seed,
          actors: sim.frames().length,
          available: sim.availableSettlers(),
          pending: [...review.pending.keys()],
          farmUid: review.farmUid,
          plans: sim
            .buildings()
            .filter((b: any) => b.construction < 1)
            .map((b: any) => b.uid),
          inventory: { ...sim.headquarters.inventory },
          disconnectedPlans: sim
            .buildings()
            .filter(
              (b: any) => b.construction < 1 && !live.roads.route(sim.headquarters.access, b.access)
            )
            .map((b: any) => b.uid)
        };
      },
      { bridge: connectBridge, farm: farmFixture }
    );
    await page.screenshot({ path: resolve(output, `${quality}-loaded.png`) });
    const checkpoints: unknown[] = [];
    for (let checkpoint = 0; checkpoint < 15; checkpoint++) {
      const state = await page.evaluate(async () => {
        const live = (window as any).__settlement,
          sim = live.simulation;
        const review = (window as any).__userCrowd;
        let maxTickMs = 0;
        for (let tick = 0; tick < 1200; tick++) {
          const positions = new Map(
            sim
              .frames()
              .filter((a: any) => a.visible)
              .map((a: any) => [a.uid, { x: a.x, z: a.z, job: a.job }])
          );
          const start = performance.now();
          review.update(0.05);
          review.elapsed += 0.05;
          maxTickMs = Math.max(maxTickMs, performance.now() - start);
          for (const actor of sim.frames()) {
            const before = positions.get(actor.uid) as any;
            if (before && actor.visible && before.job === actor.job)
              review.maxStep = Math.max(
                review.maxStep,
                Math.hypot(before.x - actor.x, before.z - actor.z)
              );
            if (review.pending.has(actor.uid) && review.pending.get(actor.uid) !== actor.delivery) {
              review.completed.push({ uid: actor.uid, seconds: review.elapsed });
              review.pending.delete(actor.uid);
            }
          }
          const farm = review.farmUid && sim.buildings().find((b: any) => b.uid === review.farmUid);
          if (farm) {
            const stone = sim
              .frames()
              .filter((a: any) => a.ware === "stone" && a.delivery?.destination === farm.uid);
            review.farmStonePeak = Math.max(review.farmStonePeak, stone.length);
            review.farmNearPeak = Math.max(
              review.farmNearPeak,
              stone.filter((a: any) => Math.hypot(a.x - farm.access.x, a.z - farm.access.z) < 4)
                .length
            );
          }
          const farmers = sim.frames().filter((a: any) => a.job === "Farmer");
          review.cropCycle.sow ||= farmers.some(
            (a: any) => a.fieldWork === "sow" && a.action === "work"
          );
          review.cropCycle.harvest ||= farmers.some(
            (a: any) => a.fieldWork === "harvest" && a.action === "work"
          );
          review.cropCycle.carry ||= farmers.some((a: any) => a.visible && a.ware === "grain");
          review.cropCycle.growing ||= sim
            .fieldFrames()
            .some((f: any) => f.kind === "grain" && f.state === "growing");
          review.cropCycle.stock ||= sim
            .buildings()
            .some((b: any) => b.typeId === 37 && (b.output.grain ?? 0) > 0);
          for (const field of sim.fieldFrames().filter((f: any) => f.kind === "grain")) {
            const owner = sim.buildings().find((b: any) => b.uid === field.owner);
            if (owner)
              review.cropMaximumRange = Math.max(
                review.cropMaximumRange,
                Math.hypot(field.x - owner.access.x, field.z - owner.access.z)
              );
          }
          review.visiblePeak = Math.max(
            review.visiblePeak,
            sim.frames().filter((a: any) => a.visible).length
          );
          if (tick % 100 === 0) {
            live.update(0);
            await new Promise((r) => setTimeout(r, 0));
          }
        }
        live.update(0);
        return {
          seconds: review.elapsed,
          pending: [...review.pending.keys()],
          completed: review.completed,
          visiblePeak: review.visiblePeak,
          maxStep: review.maxStep,
          maxTickMs,
          farm: review.farmUid
            ? {
                ...sim.buildings().find((b: any) => b.uid === review.farmUid),
                stonePeak: review.farmStonePeak,
                nearPeak: review.farmNearPeak
              }
            : undefined,
          available: sim.availableSettlers(),
          population:
            sim.availableSettlers() + sim.frames().filter((a: any) => a.phase !== "retired").length,
          plans: sim
            .buildings()
            .filter((b: any) => review.planIds.includes(b.uid))
            .map((b: any) => ({
              uid: b.uid,
              construction: b.construction,
              status: b.status,
              input: b.input,
              incoming: b.incoming,
              worker: b.worker
            })),
          cargo: sim
            .frames()
            .filter((a: any) => a.delivery)
            .map((a: any) => ({
              uid: a.uid,
              phase: a.phase,
              x: a.x,
              z: a.z,
              ware: a.ware,
              delivery: a.delivery
            })),
          cropCycle: review.cropCycle,
          cropMaximumRange: review.cropMaximumRange,
          fields: sim.fieldFrames(),
          hunters: sim
            .frames()
            .filter((a: any) => a.job === "Hunter")
            .map((a: any) => ({
              uid: a.uid,
              phase: a.phase,
              building: a.building,
              home: a.home,
              visible: a.visible,
              x: a.x,
              z: a.z,
              pathIndex: a.pathIndex,
              pathLength: a.path.length
            })),
          inventory: { ...sim.headquarters.inventory },
          disconnectedPlans: sim
            .buildings()
            .filter(
              (b: any) => b.construction < 1 && !live.roads.route(sim.headquarters.access, b.access)
            )
            .map((b: any) => b.uid)
        };
      });
      checkpoints.push(state);
      writeFileSync(
        resolve(output, `${quality}-progress.json`),
        JSON.stringify({ initial, checkpoints, errors }, null, 2)
      );
      assert.equal(state.population, 100);
      assert(state.maxStep <= 0.071, "No recovery teleport");
      if ([0, 4, 9, 14].includes(checkpoint))
        await page.screenshot({
          path: resolve(output, `${quality}-minute-${checkpoint + 1}.png`)
        });
    }
    const final = checkpoints.at(-1) as any;
    assert.deepEqual(final.pending, [], "Every original delivery must complete individually");
    assert(
      final.plans.every(
        (b: any) => b.construction === 1 || initial.disconnectedPlans.includes(b.uid)
      ),
      "Connected original construction sites must finish; disconnected saved graph is reported separately"
    );
    if (farmFixture) {
      assert.equal(final.farm.construction, 1, "Farm construction materials must fully drain");
      assert(final.farm.stonePeak >= 3, "Three concurrent stone deliveries");
      assert(
        final.farm.nearPeak >= 2,
        "Concurrent loaded stone carriers reached the farm staging area"
      );
    }
    if (cropReview) {
      assert(
        Object.values(final.cropCycle).every(Boolean),
        "Actual Farmer must sow, grow, harvest, carry and stock wheat"
      );
      assert(final.cropMaximumRange <= 12, "Every field remains within the selected 12-tile range");
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.getByRole("button", { name: "Buildings", exact: true }).click();
      await page.locator('.settlement-ui__building-register-card[data-building-type="37"]').click();
      await page.screenshot({ path: resolve(output, `${quality}-farm-details.png`) });
      const cancel = page
        .locator('section[role="dialog"]:visible button[aria-label*="Close"]')
        .last();
      assert(
        (await cancel.locator('svg[data-icon="cancel"] image').count()) === 1,
        "Close uses the rendered 3D cancel icon"
      );
      await cancel.screenshot({ path: resolve(output, `${quality}-clean-close.png`) });
    }
    assert.deepEqual(errors, []);
    reports.push({ quality, source, initial, checkpoints, errors });
    await page.close();
  }
  writeFileSync(resolve(output, "app-review.json"), JSON.stringify(reports, null, 2));
  console.log(
    JSON.stringify(
      reports.map((r: any) => ({
        quality: r.quality,
        initial: r.initial,
        final: r.checkpoints.at(-1),
        errors: r.errors
      }))
    )
  );
} finally {
  await browser.close();
  await server.close();
}
