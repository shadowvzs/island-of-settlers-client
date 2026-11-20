import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  FISHER_MAX_DRY_CAST, FISHING_MIN_WATER_DEPTH
} from "../../src/shared/settlement/settlement-fishing";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/**
 * Real game Fisher review: places actual fisheries at several shore shapes and rotations, runs the
 * live simulation until each Fisher casts, then measures and photographs the stance and the line.
 */
const output = process.env.OUTPUT ?? resourcesPath("settlement-previews", "fishing-shore");
mkdirSync(output, { recursive: true });
const seeds = (process.env.SEEDS ?? "123,7").split(",").map(Number);
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const seed of seeds) for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    const errors: string[] = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name = value => value;");
    await page.route("**/src/app/main.ts", async route => {
      const response = await route.fetch();
      const text = await response.text();
      assert(text.includes("window.__islandReady = true"));
      await route.fulfill({ response, body: text.replace("window.__islandReady = true",
        "window.__shoreReview = { world, camera }; window.__islandReady = true") });
    });
    // Expose the worker crowd scene so the rendered rod and line are measured, not assumed.
    await page.route("**/src/renderers/three/three-worker.ts*", async route => {
      const response = await route.fetch();
      const text = await response.text();
      assert(text.includes("const scene = new Scene();"));
      await route.fulfill({ response, body: text.replace("const scene = new Scene();",
        "const scene = new Scene(); window.__workerCrowdScene = scene;") });
    });
    await page.goto(`${url}?quality=${quality}&seed=${seed}&reveal=1&cache=0`);
    await page.waitForFunction(() => Boolean((window as any).__shoreReview && (window as any).__settlement),
      null, { timeout: 300000 });
    const placements = await page.evaluate(async () => {
      const { fishingSites } = await import(/* @vite-ignore */ String("/src/shared/settlement/settlement-fishing.ts"));
      const { BLOCKING } = await import(/* @vite-ignore */ String("/src/shared/world/world-data.ts"));
      const { world } = (window as any).__shoreReview;
      const live = (window as any).__settlement, simulation = live.simulation, hq = simulation.headquarters;
      hq.inventory.fishingRod = (hq.inventory.fishingRod ?? 0) + 12;
      const context: any = { options: { world }, occupied: new Uint8Array(world.cellsX * world.cellsZ),
        buildings: simulation.buildings(), actors: simulation.frames() };
      const chosen: any[] = [];
      const shoreFacing = (x: number, z: number) => {
        let best: any = null;
        for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
          const cx = Math.floor(x) + dx, cz = Math.floor(z) + dz, cell = cz * world.cellsX + cx;
          if (!world.walkCost[cell]) continue;
          const wet = [cell - 1, cell + 1, cell - world.cellsX, cell + world.cellsX]
            .some(next => world.blocking[next] === BLOCKING.water);
          if (!wet || !fishingSites(context, { id: cell, kind: "fish", x: cx + .5, z: cz + .5 }).length) continue;
          const gap = Math.hypot(dx, dz);
          if (!best || gap < best.gap) best = { gap, dx, dz };
        }
        return best && Math.round(Math.atan2(best.dx, best.dz) / (Math.PI / 2)) & 3;
      };
      for (let ring = 2; ring < 40 && chosen.length < 4; ring++)
        for (let dz = -ring; dz <= ring && chosen.length < 4; dz++) for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const rotation = chosen.length;
          for (const [ox, oz] of [[0, 0], [.5, 0], [0, .5], [.5, .5]]) {
            const x = Math.floor(hq.x) + dx + ox!, z = Math.floor(hq.z) + dz + oz!;
            if (chosen.some(site => Math.hypot(site.x - x, site.z - z) < 9)) continue;
            if (simulation.validatePlacement(18, x, z, rotation)) continue;
            const facing = shoreFacing(x, z);
            if (facing === null || chosen.some(site => site.facing === facing)) continue;
            const placed = simulation.placeBuilding(18, x, z, rotation);
            if (!placed.ok) continue;
            const building = placed.building;
            if (!simulation.connectRoads(hq.access, building.access)) { simulation.demolish?.(building.uid); continue; }
            building.construction = 1; building.required = {};
            chosen.push({ uid: building.uid, x, z, rotation, facing });
            break;
          }
          if (chosen.length > rotation) break;
        }
      return chosen;
    });
    assert(placements.length >= 3, `${seed}/${quality}: only ${placements.length} real fishery placements`);
    for (const placement of placements) {
      const site = await page.evaluate(async uid => {
        const { sampleSmooth } = await import(/* @vite-ignore */ String("/src/shared/world/grid-geometry.ts"));
        const { BLOCKING } = await import(/* @vite-ignore */ String("/src/shared/world/world-data.ts"));
        const { camera, world } = (window as any).__shoreReview;
        const live = (window as any).__settlement, simulation = live.simulation;
        const building = simulation.buildings().find((entry: any) => entry.uid === uid);
        const ground = (x: number, z: number) => sampleSmooth(world, world.heights, x, z);
        const surface = (x: number, z: number) => world.waterSurface ? sampleSmooth(world, world.waterSurface, x, z) : NaN;
        const cell = (point: any) => world.blocking[Math.floor(point.z) * world.cellsX + Math.floor(point.x)];
        for (let tick = 0; tick < 24000; tick++) {
          live.update(.05);
          const actor = simulation.frames().find((entry: any) => entry.uid === building.worker);
          if (actor?.phase !== "fishWait") continue;
          actor.timer = 999;
          const target = actor.target, stance = target.approach;
          const facing = Math.atan2(target.x - actor.x, target.z - actor.z);
          const yawError = Math.abs(Math.atan2(Math.sin(actor.yaw - facing), Math.cos(actor.yaw - facing)));
          // Conservative pole tip: one cell ahead of the shoulder, one cell above the stance.
          const reach = Math.hypot(target.x - actor.x, target.z - actor.z);
          let lineClearance = Infinity;
          for (let sample = 1; sample < 20; sample++) {
            const t = sample / 20, along = Math.min(1, reach) + (reach - Math.min(1, reach)) * t;
            const x = actor.x + Math.sin(facing) * along, z = actor.z + Math.cos(facing) * along;
            const y = actor.y + 1 + (target.y + .025 - actor.y - 1) * t - .025 * Math.sin(Math.PI * t);
            lineClearance = Math.min(lineClearance, y - ground(x, z));
          }
          let dryCast = reach;
          for (let travelled = 0; travelled < reach; travelled += .05) {
            const x = actor.x + Math.sin(facing) * travelled, z = actor.z + Math.cos(facing) * travelled;
            if (ground(x, z) < target.y) { dryCast = travelled; break; }
          }
          camera.centerX = (actor.x + target.x) / 2; camera.centerZ = (actor.z + target.z) / 2;
          camera.zoom = 3; camera.yaw = 0;
          return { uid, actor: { x: actor.x, y: actor.y, z: actor.z, yaw: actor.yaw }, target,
            dryCast, reach, yawError, lineClearance, stanceOnApproach: Math.hypot(actor.x - stance.x, actor.z - stance.z),
            targetCellWater: cell(target) === BLOCKING.water, stanceCellWater: cell(actor) === BLOCKING.water,
            targetDepth: surface(target.x, target.z) - ground(target.x, target.z),
            stanceAboveWater: ground(actor.x, actor.z) - target.y, frame: live.workerFrames
              .find((frame: any) => frame.fishingTarget && Math.abs(frame.fishingTarget.x - target.x) < 1e-6)?.fishingTarget };
        }
        throw new Error(`Fisher of building ${uid} never cast`);
      }, placement.uid);
      const name = `${seed}-${quality}-r${placement.rotation}-shore${placement.facing}`;
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(output, `${name}-close.png`) });
      // Visible workers load asynchronously; wait until this Fisher's rod is in the crowd scene.
      await page.waitForFunction(() => {
        let found = false;
        (window as any).__workerCrowdScene?.traverse((node: any) => { found ||= node.name === "pole_tip_knot"; });
        return found;
      }, null, { timeout: 60000 });
      const rod = await page.evaluate(site => {
        const scene = (window as any).__workerCrowdScene;
        const position = (object: any) => {
          object.updateWorldMatrix(true, false);
          const e = object.matrixWorld.elements;
          return { x: e[12], y: e[13], z: e[14] };
        };
        let best: any = null;
        scene.traverse((knot: any) => {
          if (knot.name !== "pole_tip_knot") return;
          let rodRoot = knot, visible = true;
          for (let node = knot; node; node = node.parent) visible &&= node.visible !== false;
          while (rodRoot.parent && !rodRoot.parent.getObjectByName("Hips")) rodRoot = rodRoot.parent;
          const butt = position(rodRoot), tip = position(knot);
          const gap = Math.hypot(butt.x - site.actor.x, butt.z - site.actor.z);
          if (visible && (!best || gap < best.gap)) best = { butt, gap, rodRoot, tip };
        });
        if (!best) {
          const names: string[] = [];
          scene?.traverse((node: any) => { if (/fish|pole|rod/.test(node.name)) names.push(node.name + ":" + node.visible); });
          throw new Error(`No rendered fishing rod ${Boolean(scene)} ${names.slice(0, 30).join(",")}`);
        }
        const lines: any[] = [];
        best.rodRoot.traverse((child: any) => { if (child.name.startsWith("fishing_line_")) lines.push(child); });
        let hook: any = null, thickness = 0;
        for (const line of lines) {
          line.updateWorldMatrix(true, false);
          const e = line.matrixWorld.elements;
          // The thread geometry is 1.3 mm wide before its world scale.
          thickness = Math.max(thickness, .0013 * Math.hypot(e[0], e[1], e[2]));
        }
        const bobber = best.rodRoot.getObjectByName("fishing_bobber");
        if (bobber) hook = position(bobber);
        const rodAngle = Math.atan2(best.tip.x - best.butt.x, best.tip.z - best.butt.z);
        const targetAngle = Math.atan2(site.target.x - best.butt.x, site.target.z - best.butt.z);
        const rodError = Math.abs(Math.atan2(Math.sin(rodAngle - targetAngle), Math.cos(rodAngle - targetAngle)));
        return { butt: best.butt, hook, lineSegments: lines.length, lineThickness: thickness,
          rodTargetDegrees: rodError * 180 / Math.PI, tip: best.tip };
      }, site);
      await page.evaluate(() => { (window as any).__shoreReview.camera.yaw = Math.PI / 2; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: resolve(output, `${name}-side.png`) });
      await page.evaluate(() => { const { camera } = (window as any).__shoreReview; camera.yaw = 0; camera.zoom = 1.4; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: resolve(output, `${name}-normal.png`) });
      await page.evaluate(uid => {
        const live = (window as any).__settlement;
        const building = live.simulation.buildings().find((entry: any) => entry.uid === uid);
        const actor = live.simulation.frames().find((entry: any) => entry.uid === building.worker);
        actor.timer = 0;
      }, placement.uid);
      reports.push({ seed, quality, placement, ...site, rod });
      assert(site.targetCellWater, `${name}: line target is not a water cell`);
      assert(site.stanceAboveWater > .009, `${name}: fisher feet below the water surface`);
      assert(site.targetDepth >= FISHING_MIN_WATER_DEPTH, `${name}: shallow target ${site.targetDepth}`);
      assert(site.dryCast <= FISHER_MAX_DRY_CAST + .05, `${name}: fisher stands back from the water`);
      assert(site.yawError < 1e-6, `${name}: fisher faces away from the water`);
      assert(site.stanceOnApproach < .05, `${name}: fisher is not on the selected shore stance`);
      assert(site.frame, `${name}: render frame lacks the water line target`);
      assert(rod.rodTargetDegrees < 20, `${name}: rod points ${rod.rodTargetDegrees} degrees off the cast`);
      assert(rod.hook, `${name}: no float on the water`);
      assert(Math.hypot(rod.hook.x - site.target.x, rod.hook.z - site.target.z) < .01, `${name}: float off target`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  console.log(`Fisher shore review passed: ${output}`);
} finally {
  await browser.close(); await server.close();
}
