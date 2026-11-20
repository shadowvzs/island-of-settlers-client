import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { patchAtmosphereLiveCost } from "./atmosphere-live-cost-patch";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "exploration-jump-2026-11-03");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const rows: any[] = [], errors: string[] = [];
const save = () => writeFileSync(resolve(output, "report.json"), JSON.stringify({ rows, errors }, null, 2));
try {
  for (const quality of (process.env.QUALITIES ?? "high,minimal").split(",")) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript(() => {
      (window as any).__name = (value: unknown) => value;
      const active = new Map<string, Set<EventListenerOrEventListenerObject>>();
      const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
      const key = (target: EventTarget, type: string, options: any) => target === window || target === document
        ? `${target === window ? "window" : "document"}:${type}:${typeof options === "boolean" ? options : Boolean(options?.capture)}` : null;
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        const id = key(this, type, options);
        if (id && listener) { const set = active.get(id) ?? new Set(); set.add(listener); active.set(id, set); }
        return add.call(this, type, listener, options);
      };
      EventTarget.prototype.removeEventListener = function(type, listener, options) {
        const id = key(this, type, options); if (id && listener) active.get(id)?.delete(listener);
        return remove.call(this, type, listener, options);
      };
      (window as any).__jumpListenerCount = () => [...active.values()].reduce((sum, set) => sum + set.size, 0);
    });
    await page.route("**/create-three-renderer.ts*", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: patchAtmosphereLiveCost(await response.text()) });
    });
    await page.route("**/three-buildings.ts*", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace("const ceilings = createExplorationCeilingQuery();",
        "const ceilings=createExplorationCeilingQuery();window.__jumpCeilings=ceilings;window.__jumpBuildingScene=scene;") });
    });
    await page.route("**/exploration-appearance.ts*", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace("const explorer = installExplorer(prepared);",
        "const explorer=installExplorer(prepared);window.__jumpSubject=explorer;window.__jumpRoot=explorer.group.parent;") });
    });
    await page.goto(`${url}admin.html?quality=${quality}&size=96&seed=123&forest=0&cache=0&time=day`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__exploration), null,
      { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    await page.evaluate(() => {
      const host = window as any, controller = host.__exploration.controller, update = controller.update;
      controller.update = (dt: number) => {
        const frame = update(dt);
        if (host.__jumpTrace && host.__jumpTrace.length < 300) host.__jumpTrace.push({
          camera: frame.camera?.pose, feetY: frame.appearance?.feetY, jump: frame.appearance?.jump,
          weatherY: frame.weather?.cameraY, groupY: host.__jumpSubject?.group.position.y,
          hipY: host.__jumpSubject?.body.root.getObjectByName("Hips")?.position.y,
          bodyVisible: host.__jumpSubject?.group.visible
        });
        return frame;
      };
    });
    const row: any = { quality, cycles: [], scope: "Actual possessed keyboard hops and actual nearby beam mesh; " +
      "GPU resources after2warmup+10mode cycles. No forced GC or absolute-zero-memory claim." };
    rows.push(row); save();
    for (let cycle = 0; cycle < Number(process.env.CYCLES ?? 12); cycle++) {
      await page.evaluate(() => { void (window as any).__exploration.controller.enter(); });
      await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed", null, { timeout: 180000 });
      if (cycle === 0) {
        const before = await page.evaluate(() => (window as any).__jumpCeilings.stats());
        await page.waitForTimeout(200);
        const after = await page.evaluate(() => (window as any).__jumpCeilings.stats());
        assert.equal(after.queries, before.queries, "Idle exploration must not perform ceiling queries");
        await page.evaluate(() => { (window as any).__jumpTrace = []; });
        await page.keyboard.down("Space"); await page.keyboard.down("Space");
        await page.waitForTimeout(1100); await page.keyboard.up("Space");
        const standing = await page.evaluate(() => {
          const h = window as any, trace = h.__jumpTrace; h.__jumpTrace = null; return trace;
        });
        const active = standing.filter((frame: any) => frame.jump);
        const floor = Math.min(...active.map((frame: any) => frame.feetY));
        const peak = Math.max(...active.map((frame: any) => frame.feetY));
        assert(peak - floor > .45 && peak - floor < .51);
        assert(active.every((frame: any) => Math.abs(frame.camera.y - frame.weatherY) < 1e-8 &&
          Math.abs(frame.groupY - frame.feetY) < 1e-8 && !frame.bodyVisible));
        const hips = active.map((frame: any) => frame.hipY);
        assert(Math.max(...hips) - Math.min(...hips) > .02, "Actual rig must crouch and recover");
        assert(!standing.at(-1).jump); row.standing = { floor, peak, frames: standing };
        await page.keyboard.down("ArrowUp"); await page.keyboard.press("Space");
        await page.waitForTimeout(250);
        await page.screenshot({ path: resolve(output, `${quality}-walking-hop-eye.png`) });
        await page.keyboard.up("ArrowUp"); await page.waitForTimeout(850);
        row.beam = await page.evaluate(async () => {
          const h = window as any, c = h.__exploration.controller;
          const { BoxGeometry, Group, Mesh, MeshBasicMaterial } = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
          const pose = c.frame().camera.pose, floor = pose.y - pose.eyeHeight;
          const root = new Group(), geometry = new BoxGeometry(1.2, .12, 1.2), material = new MeshBasicMaterial({ color: 0x775533 });
          root.add(new Mesh(geometry, material)); root.position.set(pose.x, floor + 1.3, pose.z);
          h.__jumpBuildingScene.add(root); h.__jumpCeilings.sync("diagnostic-low-beam", root);
          h.__jumpBeam = { root, geometry, material }; h.__jumpTrace = [];
          return { floor, underside: floor + 1.24,
            actualUnderside: h.__jumpCeilings.sample(pose.x, pose.z, floor, .16, 1.7) };
        });
        assert(Math.abs(row.beam.actualUnderside - row.beam.underside) < 1e-6, "Beam fixture must enter the real structural query");
        await page.keyboard.press("Space"); await page.waitForTimeout(180);
        await page.screenshot({ path: resolve(output, `${quality}-low-beam-eye.png`) });
        await page.waitForTimeout(750);
        const beamTrace = await page.evaluate(() => {
          const h = window as any, trace = h.__jumpTrace; h.__jumpTrace = null;
          h.__jumpCeilings.remove("diagnostic-low-beam"); h.__jumpBeam.root.removeFromParent();
          h.__jumpBeam.geometry.dispose(); h.__jumpBeam.material.dispose(); delete h.__jumpBeam;
          return trace;
        });
        const beamPeak = Math.max(...beamTrace.filter((frame: any) => frame.jump).map((frame: any) => frame.feetY));
        row.beam.peak = beamPeak; row.beam.frames = beamTrace;
        assert(beamPeak + 1.0625 + .015 <= row.beam.underside + 1e-6);
        await page.keyboard.press("Space"); await page.waitForTimeout(180);
        const midair = await page.evaluate(() => (window as any).__exploration.controller.frame().appearance?.feetY);
        assert(typeof midair === "number"); row.forcedExitFeetY = midair;
      }
      await page.evaluate(() => (window as any).__exploration.controller.forceExit("session-replacement"));
      await page.waitForTimeout(150);
      const memory = await page.evaluate(() => {
        const h = window as any, renderer = h.__atmosphereLiveDebug.renderer;
        return { ...renderer.info.memory, programs: renderer.info.programs?.length,
          listeners: h.__jumpListenerCount(), temporaryChildren: h.__jumpRoot.children.length,
          appearance: h.__exploration.controller.frame().appearance, phase: h.__exploration.controller.phase() };
      });
      assert.equal(memory.appearance, null); assert.equal(memory.phase, "idle");
      assert.equal(memory.temporaryChildren, 0);
      row.cycles.push(memory); save();
    }
    const plateau = row.cycles.slice(2);
    for (const field of plateau.length ? ["geometries", "textures", "programs", "listeners"] : []) {
      const values = plateau.map((value: any) => value[field]);
      assert(Math.max(...values) - Math.min(...values) <= (field === "geometries" ? 2 : 1),
        `${quality} ${field} failed plateau: ${values}`);
    }
    row.status = plateau.length >= 10 ? "passed" : "diagnostic-only"; save(); await page.close();
  }
  assert.deepEqual(errors, []);
} finally { save(); await browser.close(); await server.close(); }
