import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { patchAtmosphereLiveCost } from "./atmosphere-live-cost-patch";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "verification-completion-2026-11-05", "garrison", process.env.RUN ?? "native-a");
assert(!existsSync(resolve(output, "report.json")), "Use a new RUN to preserve evidence");
mkdirSync(output, { recursive: true });
const reports: unknown[] = [], errors: string[] = [];
const focused = process.env.FOCUSED === "1";
const { server, url } = await startDevServer();
const browser = await launchBrowser();
let status = "running", failure: string | undefined;
const save = () => writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, failure, reports, errors,
  scope: "Real received troops assigned and stationed by simulation; current rendered equipped bodies at window slots. " +
    "Controlled completed construction fixture; not an earned progression or occupied-neighbour acceptance." }, null, 2));
try {
  for (const quality of (process.env.QUALITIES ?? "high,minimal").split(","))
    for (const nation of (process.env.NATIONS ?? "persian,roman,viking,nubian,japanese,chinese,maya,indigenous").split(",")) {
      const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript("window.__name=value=>value;");
      await page.routeWebSocket("**/*", () => {});
      await page.route("**/verification-garrison.html", route => route.fulfill({ body: "<body></body>", contentType: "text/html" }));
      await page.route("**/create-three-renderer.ts*", async route => {
        const response = await route.fetch();
        const source = patchAtmosphereLiveCost(await response.text()).replace(
          "window.__atmosphereLiveDebug = atmosphereDebug;", "atmosphereDebug.scene=scene;window.__atmosphereLiveDebug=atmosphereDebug;");
        await route.fulfill({ response, body: source });
      });
      await page.route("**/three-worker.ts*", async route => {
        const response = await route.fetch(), source = await response.text();
        assert(source.includes("const scene = new Scene();"));
        await route.fulfill({ response, body: source.replace("const scene = new Scene();",
          "const scene=new Scene();window.__garrisonCrowdScene=scene;") });
      });
      await page.route("**/three-buildings.ts*", async route => {
        const response = await route.fetch(), source = await response.text();
        assert(source.includes("const scene = new Scene();"));
        await route.fulfill({ response, body: source.replace("const scene = new Scene();",
          "const scene=new Scene();window.__garrisonBuildingScene=scene;") });
      });
      await page.route("**/island-runtime.ts*", async route => {
        const response = await route.fetch(), source = await response.text();
        assert(source.includes("window.__islandReady = true"));
        await route.fulfill({ response, body: source.replace("window.__islandReady = true",
          "window.__garrisonCamera=camera;window.__islandReady=true") });
      });
      await page.goto(`${url}verification-garrison.html`);
      let types = [1, 2, 4, 9];
      if (focused) types = nation === "persian" ? [2, 4, 9] : [2];
      const fixture = await page.evaluate(async ({ nation, types }) => {
        const { createVerificationGarrisonSave } = await import(
          /* @vite-ignore */ String("/tools/bench/verification-garrison-fixture.ts"));
        return createVerificationGarrisonSave(nation, types);
      }, { nation, types });
      assert(fixture.stationed.every((entry: { count: number }) => entry.count > 0), `${nation}: real stationed soldiers required`);
      await page.goto(`${url}?quality=${quality}&skipLogin=1&time=day&reveal=1`);
      await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__atmosphereLiveDebug), null,
        { timeout: 180000 });
      await page.locator("#loading-screen").waitFor({ state: "detached" });
      for (const plot of fixture.plots) {
        const result = await page.evaluate(async ({ nation, plot, quality }) => {
          const imp = (path: string) => import(/* @vite-ignore */ path);
          const { garrisonViewActors } = await imp("/src/app/settlement/garrison-view.ts");
          const { ISO_PITCH } = await imp("/src/render-common/iso-projection.ts");
          const { snapshotAtmosphereFrame } = await imp("/tools/bench/atmosphere-frame-snapshot.ts");
          const simulation = (window as any).__settlement.simulation, debug = (window as any).__atmosphereLiveDebug;
          const buildings = simulation.buildings();
          const building = buildings.find((entry: any) => entry.uid === plot.uid);
          const stationed = simulation.militarySoldiers().filter((soldier: any) => soldier.building === plot.uid && soldier.stationed);
          const actors = garrisonViewActors([building], stationed, simulation.frames(), nation, quality === "high");
          const front = actors.filter((actor: any) => actor.lean > 0)
            .sort((a: any, b: any) => Math.cos(b.yaw) - Math.cos(a.yaw))[0] ?? actors[0];
          // The real application's camera owns the High/Minimal garrison-anchor choice.
          // Let it publish the matching live pose before freezing any presentation frame.
          debug.frozen = false;
          const initial = front ?? { x: plot.x, y: building.y + 1, yaw: 0, z: plot.z };
          const initialDistance = (initial.y + .86) / Math.tan(ISO_PITCH);
          Object.assign((window as any).__garrisonCamera, {
            centerX: initial.x - Math.sin(initial.yaw) * initialDistance,
            centerZ: initial.z - Math.cos(initial.yaw) * initialDistance,
            zoom: front ? 3.8 : 1.6, tilt: 0, yaw: initial.yaw - Math.PI / 4
          });
          await new Promise(resolve => setTimeout(resolve, 450));
          debug.snapshotFrame = snapshotAtmosphereFrame;
          if (!debug.frozen) debug.freeze();
          const shown = front && debug.frozenFrame.workers.find((worker: any) => worker.actorId === front.uid);
          const actual = shown ? { ...front, x: shown.x, y: shown.y, z: shown.z, yaw: shown.heading, lean: shown.lean } : front;
          const target = actual ?? { x: plot.x, y: building.y + 1, yaw: 0, z: plot.z };
          const yaw = target.yaw - Math.PI / 4, targetY = target.y + .86;
          const distance = targetY / Math.tan(ISO_PITCH);
          Object.assign(debug.frozenFrame.camera, { centerX: target.x - Math.sin(target.yaw) * distance,
            centerZ: target.z - Math.cos(target.yaw) * distance, zoom: front ? 3.8 : 1.4, tilt: 0, yaw });
          debug.draw();
          let viewKind = "inside";
          if (front) viewKind = front.lean ? "window" : "open-post";
          return { actor: actual ?? null, sourceSlot: front ?? null,
            stationed: stationed.length, views: actors.length, viewKind };
        }, { plot, quality, nation });
        await page.waitForTimeout(1800);
        const bones = await page.evaluate(async ({ actor, plot }) => {
          if (!actor) return [];
          const { Raycaster, Vector3 } = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
          const debug = (window as any).__atmosphereLiveDebug;
          const crowdScene = (window as any).__garrisonCrowdScene;
          debug.draw();
          let building: any;
          (window as any).__garrisonBuildingScene.traverse((object: any) => {
            if (object.userData.buildingId !== plot.type) return;
            const position = object.getWorldPosition(new Vector3());
            if (Math.hypot(position.x - plot.x, position.z - plot.z) < .1) building = object;
          });
          const normal = new Vector3(Math.sin(actor.yaw), 0, Math.cos(actor.yaw));
          const raysTo = (point: any) => {
            if (!building || !point) return null;
            const ray = new Raycaster(point.clone().addScaledVector(normal, .6), normal.clone().negate(), 0, .599);
            return ray.intersectObject(building, true).map((hit: any) => ({ name: hit.object.name,
              distance: hit.distance, openingShadow: Boolean(hit.object.userData.openingShadow) }));
          };
          const bodies: unknown[] = [];
          crowdScene.traverse((object: any) => {
            if (!object.isGroup || Math.abs(object.position.x - actor.x) > .01 || Math.abs(object.position.z - actor.z) > .01)
              return;
            for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return;
            const head = object.getObjectByName("Head"), chest = object.getObjectByName("Spine2"), hips = object.getObjectByName("Hips");
            if (!head || !hips) return;
            let skinnedMeshes = 0, armourMeshes = 0;
            object.traverse((child: any) => { if (child.isSkinnedMesh) skinnedMeshes++;
              if (child.isMesh && child.name.startsWith("armour_")) armourMeshes++; });
            const headAt = head.getWorldPosition(new Vector3()), chestAt = chest?.getWorldPosition(new Vector3());
            const hipsAt = hips.getWorldPosition(new Vector3());
            bodies.push({ head: headAt.toArray(), chest: chestAt?.toArray(), hips: hipsAt.toArray(),
              rays: { head: raysTo(headAt), chest: raysTo(chestAt), hips: raysTo(hipsAt) },
              skinnedMeshes, armourMeshes });
          });
          return bodies;
        }, { actor: result.actor, plot });
        if (result.actor && !bones.length) {
          const diagnostics = await page.evaluate(actor => {
            const debug = (window as any).__atmosphereLiveDebug, skins: unknown[] = [];
            (window as any).__garrisonCrowdScene.traverse((object: any) => {
              if (!object.isSkinnedMesh) return;
              skins.push({ name: object.name, visible: object.visible,
                parentName: object.parent?.name, parentPosition: object.parent?.position.toArray(),
                boneNames: object.skeleton.bones.slice(0, 12).map((bone: any) => bone.name) });
            });
            return { actor, workers: debug.frozenFrame.workers, skins };
          }, result.actor);
          writeFileSync(resolve(output, `${nation}-${plot.type}-${quality}-failure.json`), JSON.stringify(diagnostics, null, 2));
          await page.screenshot({ path: resolve(output, `${nation}-${plot.type}-${quality}-failure.png`) });
        }
        if (result.actor)
          assert(bones.length > 0, `${nation}/${plot.type}/${quality}: actual current soldier body must be resident`);
        const stem = `${nation}-${plot.type}-${quality}`;
        await page.screenshot({ path: resolve(output, `${stem}-window.png`) });
        await page.evaluate(() => {
          const debug = (window as any).__atmosphereLiveDebug;
          // High buildings stay High at gameplay zoom (the production threshold is 1.5).
          debug.frozenFrame.camera.zoom = 1.6; debug.draw();
        });
        await page.screenshot({ path: resolve(output, `${stem}-gameplay.png`) });
        reports.push({ nation, quality, plot, ...result, bones }); save();
      }
      await context.close();
    }
  assert.deepEqual(errors, []);
  status = "passed"; save();
} catch (error) {
  status = "failed"; failure = String(error); save(); throw error;
} finally {
  await browser.close(); await server.close();
}
console.log(`Actual garrison: ${reports.length} building/LOD cases, ${output}`);
