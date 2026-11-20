import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { auditCommanderBow } from "./commander-archery-audit";
import { auditCommanderMelee } from "./commander-melee-audit";
import { installCommanderOwnedLifecycle } from "./commander-owned-lifecycle";
import { resourcesPath } from "./resources-path";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "first";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid review run");
const lifecycleAudit = process.argv.includes("--lifecycle-audit");
const walkAway = lifecycleAudit || process.argv.includes("--walk-away");
const cameraAudit = process.argv.includes("--camera-audit");
const guardAudit = process.argv.includes("--guard-audit");
const guardMatrixAudit = process.argv.includes("--guard-matrix-audit");
const archeryAudit = process.argv.includes("--archery-audit");
const meleeAudit = process.argv.includes("--melee-audit");
const stagedHands = process.argv.includes("--staged-hands");
const runtimeSurface = process.argv.includes("--surface-runtime");
const nation = process.argv.find(argument => argument.startsWith("--nation="))?.slice(9) ?? "roman";
assert(["roman", "japanese", "viking", "nubian", "chinese", "maya", "persian", "indigenous"].includes(nation));
if (guardMatrixAudit) assert.equal(nation, "viking", "Actual axe matrix audit belongs to the Viking guard");
if (stagedHands) assert.equal(nation, "nubian", "Only the explicitly staged Nubian derivative is overridden");
if (runtimeSurface) {
  assert(["nubian", "viking"].includes(nation));
  assert(!stagedHands, "Production surface proof never intercepts staged bodies");
}
const stagedHandPath = resourcesPath("project-reviews", "commander-possession-2026-11-03",
  "minimal-rider-hands-a", "nubian-rider-minimal.glb");
const qualityOnly = process.argv.find(argument => argument.startsWith("--quality="))?.slice(10);
const output = resourcesPath("project-reviews", "commander-possession-2026-11-03", run);
mkdirSync(output, { recursive: true });
const rigCameraSourceHashes = () => Object.fromEntries([
  "src/app/commander-control/integration.ts",
  "src/render-common/exploration/exploration-frame.ts",
  "src/renderers/three/exploration/three-camera.ts",
  "src/renderers/three/worker-military-placement.ts",
  "src/renderers/three/worker-melee-weapon.ts"
].map(path => [path, createHash("sha256").update(readFileSync(resolve(path))).digest("hex")]));
const cameraSourcesBefore = rigCameraSourceHashes();
const lifecycleSources = () => Object.fromEntries([
  ...globSync("src/**/*.ts"), ...globSync(resolve(process.env.WORKER_REPO ?? "../island-of-settlers-worker-generation", "src/**/*.ts")),
  "tools/bench/commander-owned-lifecycle.ts", "tools/bench/commander-possession-review.ts"
].sort().map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const lifecycleSourcesBefore = lifecycleAudit ? lifecycleSources() : undefined;
const { server, url } = await startDevServer(), browser = await launchBrowser();
const errors: string[] = [], reports: unknown[] = [];
let status = "failed";
try {
  for (const quality of ["high", "minimal"] as const) {
    if (qualityOnly && qualityOnly !== quality) continue;
    if (lifecycleAudit) console.log(`[commander-owned] ${quality}: setup`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(quality => {
      localStorage.setItem("island-of-settlers.graphics.detail", quality);
      localStorage.setItem("island-of-settlers.graphics.resolution", "fast");
    }, quality);
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    if (lifecycleAudit) await installCommanderOwnedLifecycle(context, page);
    const guardModuleLoads: Promise<{ path: string; sha256: string; hasReverseEdge: boolean }>[] = [];
    if (guardMatrixAudit) page.on("response", response => {
      const path = ["worker-military-placement.ts", "worker-melee-weapon.ts"].find(path =>
        response.url().includes(`/src/renderers/three/${path}`));
      if (!path) return;
      guardModuleLoads.push(response.text().then(source => {
        writeFileSync(resolve(output, `${quality}-requested-${path}.js`), source);
        return { path, sha256: createHash("sha256").update(source).digest("hex"),
          hasReverseEdge: source.includes("reverseEdge") };
      }));
    });
    if (guardMatrixAudit) await page.route("**/src/renderers/three/three-worker.ts*", async route => {
      const response = await route.fetch(), original = await response.text();
      assert(original.includes("const scene = new Scene();"), "Actual worker scene marker exists");
      assert(original.includes("prop.update(frame);"), "Actual worker prop-update marker exists");
      const exposed = original.replace("const scene = new Scene();",
        "const scene = new Scene(); window.__commanderWorkerScene = scene;");
      await route.fulfill({ response, body: exposed.replace("prop.update(frame);",
        "prop.update(frame); worker.root.userData.__commanderRenderedFrame = " +
        "{...frame, combat: frame.combat && {...frame.combat}};") });
    });
    const runtimeBodyLoads: Promise<{ url: string; bytes: number; sha256: string }>[] = [];
    if (runtimeSurface) page.on("response", response => {
      if (response.request().resourceType() !== "fetch" || !response.url().includes(`/${nation}-commander-surface.glb`)) return;
      runtimeBodyLoads.push(response.body().then(bytes => ({ url: response.url(), bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex") })));
    });
    let stagedRequests = 0;
    if (stagedHands && quality === "minimal") await page.route("**/assets/mounts/nubian-rider-minimal.glb*", async route => {
      if (route.request().resourceType() !== "fetch") { await route.continue(); return; }
      stagedRequests++; await route.fulfill({ contentType: "model/gltf-binary", path: stagedHandPath });
    });
    await page.goto(`${url}admin.html?seed=123&size=96&forest=0&cache=0&time=day`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__commanderControl),
      null, { timeout: 180000 });
    if (lifecycleAudit) console.log(`[commander-owned] ${quality}: island ready; recruiting actual commander`);
    if (nation !== "roman") {
      await page.getByRole("button", { name: "Development tools", exact: true }).click();
      const panel = page.locator(".development-menu:not([hidden])");
      await panel.getByRole("tab", { name: "Appearance", exact: true }).click();
      await panel.locator(`[data-nation="${nation}"]`).click();
      await page.waitForFunction(nation => (window as any).__settlement?.simulation.playerNation() === nation,
        nation, { timeout: 120000 });
      await page.keyboard.press("Escape"); await panel.waitFor({ state: "hidden" });
    }
    const recruited = await page.evaluate(async requireOddVariation => {
      const { playerSession: player, simulation: sim } = (window as any).__settlement;
      const { LEVEL_THRESHOLDS } = await import(/* @vite-ignore */ String("/@id/@shared/catalog/balance"));
      player.progress().experience = LEVEL_THRESHOLDS[22];
      const built = sim.debugRaiseBuilding(62); if (!built.ok) throw new Error(built.reason);
      const { commanderRecruitCost } = await import(/* @vite-ignore */ String("/src/shared/settlement/settlement-commander.ts"));
      sim.receiveHomeGoods(commanderRecruitCost(sim.playerNation()));
      const parityReserve = requireOddVariation && sim.saveState().nextActor % 2 === 0
        ? sim.grantDebugTroop({ rank: 0, type: "archer" }) : undefined;
      const result = sim.recruitCommander(built.building.uid); if (!result.ok) throw new Error(result.reason);
      const commander = sim.commanderSnapshot(), soldier = sim.militarySoldiers().find((row: any) => row.commanderId === commander.id);
      return { commander: commander.id, actor: soldier.actor, horse: soldier.combat.mount, parityReserve };
    }, guardMatrixAudit && nation === "viking");
    if (guardMatrixAudit && nation === "viking") assert.equal(recruited.actor % 2, 1,
      "A legitimate stored debug reserve gives the actual Commander an odd attack variation");
    await page.getByRole("button", { name: "Control commander", exact: true }).click();
    await page.waitForTimeout(1500);
    const entryState = await page.evaluate(() => {
      const sim = (window as any).__settlement.simulation, control = (window as any).__commanderControl;
      const soldier = sim.militarySoldiers().find((row: any) => row.commanderId);
      const actor = sim.frames().find((row: any) => row.uid === soldier?.actor);
      return { debug: control.debug(), owns: control.owns(), active: control.controller.active(), preparing: control.controller.preparing(),
        notice: control.controller.notice(), location: sim.commanderSnapshot()?.location,
        actor: actor && { phase: actor.phase, x: actor.x, y: actor.y, z: actor.z, path: actor.path,
          pathIndex: actor.pathIndex, visible: actor.visible, mounted: actor.mounted },
        problem: sim.commanderControlProblem(soldier?.actor), combat: soldier?.combat,
        ui: document.querySelector(".commander-control-host")?.textContent };
    });
    writeFileSync(resolve(output, `${quality}-entry-state.json`), JSON.stringify(entryState, null, 2));
    console.log(JSON.stringify({ quality, entryState }));
    await page.screenshot({ path: resolve(output, `${quality}-entry-diagnostic.png`) });
    await page.waitForFunction(() => (window as any).__commanderControl.controller.active() ||
      document.querySelector(".commander-control-entry [role=status]"), null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => (window as any).__commanderControl.controller.active()), true,
      await page.locator(".commander-control-host").innerText());
    const read = () => page.evaluate(() => {
      const { simulation: sim } = (window as any).__settlement;
      const snapshot = sim.commanderControlSnapshot(), saved = sim.saveState();
      return { snapshot, actorCount: saved.actors.filter((row: any) => row.uid === snapshot?.actor).length,
        horse: saved.military.soldiers.find((row: any) => row.actor === snapshot?.actor)?.combat.mount };
    });
    const before = await read();
    assert.equal(before.snapshot.commanderId, recruited.commander); assert.equal(before.actorCount, 1);
    assert.equal(before.horse, recruited.horse);
    await page.locator(".commander-control-status [role=progressbar]").waitFor();
    const hints = page.locator(".exploration-ui__keys--commander");
    await hints.waitFor();
    const hintBounds = await hints.boundingBox();
    assert(hintBounds && hintBounds.x > 720 && hintBounds.y > 450 &&
      hintBounds.width < 380 && hintBounds.height < 240, "Commander hints stay compact in the bottom-right");
    await page.keyboard.press("KeyK"); await hints.waitFor({ state: "detached" });
    await page.screenshot({ path: resolve(output, `${quality}-hints-hidden.png`) });
    await page.keyboard.press("KeyK"); await hints.waitFor();
    const guardSamples: unknown[] = [];
    const checkGuard = async (mode: string) => {
      await page.keyboard.down("KeyQ");
      await page.waitForFunction(() => {
        const guard = (window as any).__settlement.simulation.commanderControlSnapshot()?.guard;
        return guard > 0 && guard <= .4;
      });
      const raised = await read();
      assert(raised.snapshot.guard > 0, "Real Q input starts authoritative guard");
      const presentation = await page.evaluate(() => {
        const settlement = (window as any).__settlement, actor = settlement.simulation.commanderControlSnapshot()?.actor;
        const frame = settlement.workerFrames.find((row: any) => row.actorId === actor);
        return frame?.combat && { ...frame.combat, appearanceVariant: frame.variant };
      });
      const rigCamera = await page.evaluate(() => {
        const settlement = (window as any).__settlement;
        const camera = (window as any).__commanderControl.frame()?.camera?.pose;
        if (!camera) return undefined;
        const horizontal = Math.cos(camera.pitch);
        const projected = settlement.project(camera.x + Math.sin(camera.yaw) * horizontal,
          camera.y + Math.sin(camera.pitch), camera.z + Math.cos(camera.yaw) * horizontal);
        return { camera, projected, viewport: { width: window.innerWidth, height: window.innerHeight } };
      });
      assert(rigCamera && Number.isFinite(rigCamera.camera.eyeBaseY), "Existing rig supplies its actual support height");
      assert(Math.abs(rigCamera.projected.x - rigCamera.viewport.width / 2) < 4 &&
        Math.abs(rigCamera.projected.y - rigCamera.viewport.height / 2) < 4,
      "Actual rendered eye remains on the existing rig's anatomical view line");
      const screenshotStarted = performance.now();
      await page.screenshot({ path: resolve(output, `${quality}-${mode}-manual-guard.png`) });
      const screenshotMilliseconds = performance.now() - screenshotStarted;
      const captured = await read();
      const matrices = guardMatrixAudit && mode === "on-foot" ? await page.evaluate(() => {
        const host = window as any, settlement = host.__settlement;
        const actor = settlement.simulation.commanderControlSnapshot();
        const scene = host.__commanderWorkerScene;
        if (!scene || !actor) throw new Error("Actual worker scene unavailable");
        const candidates: any[] = [];
        scene.traverse((node: any) => {
          if (node.name !== "military_axe") return;
          for (let parent = node; parent; parent = parent.parent) if (!parent.visible) return;
          const point = node.getWorldPosition(node.position.clone());
          candidates.push({ node, renderedFrame: node.parent?.userData.__commanderRenderedFrame,
            distance: Math.hypot(point.x - actor.x, point.z - actor.z) });
        });
        const selected = candidates.filter(candidate => candidate.renderedFrame?.actorId === actor.actor)
          .sort((a, b) => a.distance - b.distance)[0];
        const prop = selected?.node;
        if (!prop) throw new Error("Actual actor-bound visible Commander axe unavailable: " + JSON.stringify(
          candidates.map(candidate => ({ distance: candidate.distance, renderedFrame: candidate.renderedFrame }))));
        const body = prop.parent, points: unknown[] = [], projected: any[] = [];
        prop.updateWorldMatrix(true, true);
        prop.traverse((mesh: any) => {
          if (!mesh.isMesh || !mesh.visible) return;
          const position = mesh.geometry.getAttribute("position"), surface = mesh.geometry.getAttribute("equipmentSurface");
          const point = mesh.position.clone();
          for (let index = 0; index < position.count; index++) {
            if (!surface || surface.getX(index) < .3) continue;
            point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
            const screen = settlement.project(point.x, point.y, point.z);
            points.push({ index, local: [position.getX(index), position.getY(index), position.getZ(index)],
              world: point.toArray(), screen });
            projected.push(screen);
          }
        });
        const bones = ["Head", "Hips", "socket_axe_L", "socket_axe_R", "LeftHand", "RightHand"].map(name => {
          const node = body.getObjectByName(name);
          return { name, matrix: node?.matrixWorld.toArray() };
        });
        const frame = settlement.workerFrames.find((frame: any) => frame.actorId === actor.actor);
        const camera = host.__commanderControl.frame().camera.pose;
        const centre = points.reduce((sum: number[], point: any) =>
          sum.map((value, axis) => value + point.world[axis] / points.length), [0, 0, 0]);
        const normal = [prop.matrixWorld.elements[8], prop.matrixWorld.elements[9], prop.matrixWorld.elements[10]];
        const toCamera = [camera.x - centre[0]!, camera.y - centre[1]!, camera.z - centre[2]!];
        const headFacing = Math.abs(normal.reduce((sum, value, axis) => sum + value * toCamera[axis]!, 0)) /
          (Math.hypot(...normal) * Math.hypot(...toCamera));
        return { actor, frame, renderedFrame: body.userData.__commanderRenderedFrame,
          candidateActors: candidates.map(candidate => ({ actorId: candidate.renderedFrame?.actorId,
            distance: candidate.distance })),
          rootMatrix: body.matrixWorld.toArray(), propMatrix: prop.matrixWorld.toArray(),
          bladeNormal: normal, headFacing,
          cuttingEdge: [prop.matrixWorld.elements[0], prop.matrixWorld.elements[1], prop.matrixWorld.elements[2]],
          propLocal: { position: prop.position.toArray(), rotation: prop.quaternion.toArray() }, bones, points,
          bounds: { minX: Math.min(...projected.map(point => point.x)), maxX: Math.max(...projected.map(point => point.x)),
            minY: Math.min(...projected.map(point => point.y)), maxY: Math.max(...projected.map(point => point.y)) } };
      }) : undefined;
      writeFileSync(resolve(output, `${quality}-${mode}-guard-diagnostic.json`), JSON.stringify({
        captured, guardModuleLoads: await Promise.all(guardModuleLoads), matrices, presentation,
        raised, rigCamera, screenshotMilliseconds
      }, null, 2));
      if (mode === "on-foot") assert.equal(presentation?.defending, true,
        "Actual foot frame receives the authoritative guard");
      if (matrices) {
        assert.equal(matrices.renderedFrame.actorId, matrices.actor.actor,
          "The inspected prop belongs to the actual controlled actor");
        assert.equal(matrices.frame.combat.variant % 2, 1,
          "The actual guard exercises the formerly edge-on sweeping attack variation");
        assert(Math.abs(matrices.bladeNormal[1]) < Math.hypot(...matrices.bladeNormal) * .1,
          "The actual guard holds the blade plane upright regardless of the attack variation");
        assert(matrices.cuttingEdge[1] > Math.hypot(...matrices.cuttingEdge) * .9,
          "The actual defensive beard lies above the unchanged shaft and palms");
        assert(matrices.bounds.minX >= 0 && matrices.bounds.maxX <= rigCamera.viewport.width &&
          matrices.bounds.minY >= 0 && matrices.bounds.maxY <= rigCamera.viewport.height,
        "Every actual metal head vertex lies inside the rendered viewport");
      }
      await page.waitForFunction(() => (window as any).__settlement.simulation.commanderControlSnapshot()?.guard === 0);
      const held = await read();
      assert.equal(held.snapshot.guard, 0, "Holding Q cannot sustain guard");
      assert(held.snapshot.guardRecovery > 0, "Guard still has a recovery interval");
      await page.keyboard.up("KeyQ");
      guardSamples.push({ mode, raised, held, presentation, rigCamera, matrices, captured, screenshotMilliseconds });
      await page.waitForFunction(() => (window as any).__settlement.simulation.commanderControlSnapshot()?.guardRecovery === 0);
    };
    await page.screenshot({ path: resolve(output, `${quality}-mounted.png`) });
    const archerySamples = [];
    if (archeryAudit) archerySamples.push(await auditCommanderBow(page, output, quality, "mounted"));
    if (guardAudit) await checkGuard("mounted");
    await page.keyboard.down("ArrowUp"); await page.waitForTimeout(850); await page.keyboard.up("ArrowUp");
    const moved = await read();
    assert(Math.hypot(moved.snapshot.x - before.snapshot.x, moved.snapshot.z - before.snapshot.z) > .2);
    assert.equal(moved.snapshot.hp, before.snapshot.hp);
    await page.keyboard.press("KeyX", { delay: 120 });
    await page.waitForFunction(() => (window as any).__settlement.simulation.commanderControlSnapshot()?.mounted === false);
    await page.waitForTimeout(450);
    if (archeryAudit) {
      await page.keyboard.down("ArrowDown"); await page.waitForTimeout(850); await page.keyboard.up("ArrowDown");
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path: resolve(output, `${quality}-dismounted.png`) });
    if (archeryAudit) archerySamples.push(await auditCommanderBow(page, output, quality, "on-foot"));
    if (guardAudit) await checkGuard("on-foot");
    const cameraSamples: unknown[] = [];
    if (cameraAudit) {
      const cameraSample = (view: string) => page.evaluate(view => ({ view,
        camera: (window as any).__commanderControl.frame()?.camera?.pose,
        presentation: (window as any).__commanderControl.debug(),
        actor: (window as any).__settlement.simulation.commanderControlSnapshot()
      }), view);
      cameraSamples.push(await cameraSample("on-foot-straight"));
      if (walkAway) {
        await page.keyboard.down("ArrowDown"); await page.waitForTimeout(850); await page.keyboard.up("ArrowDown");
        await page.waitForTimeout(250);
        const away = await cameraSample("on-foot-walked-away"); cameraSamples.push(away);
        await page.screenshot({ path: resolve(output, `${quality}-on-foot-walked-away.png`) });
        writeFileSync(resolve(output, `${quality}-camera-samples.json`), JSON.stringify(cameraSamples, null, 2));
        assert(Math.abs(Math.atan2(Math.sin(away.camera.yaw - away.actor.yaw),
          Math.cos(away.camera.yaw - away.actor.yaw))) < .15,
        "Walking backward must preserve the actual commander's view direction");
      }
      await page.keyboard.down("ArrowRight"); await page.waitForTimeout(350); await page.keyboard.up("ArrowRight");
      await page.waitForTimeout(150);
      await page.screenshot({ path: resolve(output, `${quality}-on-foot-turned.png`) });
      cameraSamples.push(await cameraSample("on-foot-turned"));
      // Real drag/pointer-lock input; no direct commander state/camera mutation.
      const lookBounds = await page.locator(".exploration-ui__look").boundingBox();
      assert(lookBounds, "The actual commander look surface must be visible");
      const lookX = lookBounds.x + lookBounds.width * .5, lookY = lookBounds.y + lookBounds.height * .25;
      await page.mouse.move(lookX, lookY); await page.mouse.down();
      await page.waitForTimeout(150);
      await page.mouse.move(lookX, lookY + 175, { steps: 12 }); await page.mouse.up();
      await page.waitForTimeout(250);
      cameraSamples.push(await cameraSample("on-foot-downward"));
      await page.screenshot({ path: resolve(output, `${quality}-on-foot-downward.png`) });
      await page.evaluate(() => { document.exitPointerLock?.(); });
      writeFileSync(resolve(output, `${quality}-camera-samples.json`), JSON.stringify(cameraSamples, null, 2));
    }
    await page.keyboard.press("KeyT", { delay: 100 });
    assert.deepEqual((await read()).snapshot.follow, { shield: false, heavy: false, archer: false });
    await page.keyboard.press("KeyG", { delay: 100 });
    assert.deepEqual((await read()).snapshot.follow, { shield: true, heavy: true, archer: true });
    await page.keyboard.press("KeyH", { delay: 120 });
    try {
      await page.waitForFunction(() => (window as any).__settlement.simulation.commanderControlSnapshot()?.mounted === true,
        null, { timeout: 20000 });
    } catch (error) {
      const failed = await page.evaluate(() => ({ state: (window as any).__settlement.simulation.saveState(),
        debug: (window as any).__commanderControl.debug(),
        snapshot: (window as any).__settlement.simulation.commanderControlSnapshot() }));
      writeFileSync(resolve(output, `${quality}-remount-failure.json`), JSON.stringify(failed, null, 2));
      throw error;
    }
    const remounted = await read(); assert.equal(remounted.horse, recruited.horse);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !(window as any).__commanderControl.owns());
    assert.equal(await page.evaluate(() => (window as any).__settlement.simulation.commanderControlSnapshot()), null);
    await page.screenshot({ path: resolve(output, `${quality}-returned-rts.png`) });
    const lifecycleSamples = [];
    if (lifecycleAudit) console.log(`[commander-owned] ${quality}: recruited and physical ownership checks complete; starting 2 warmup + 10 retained cycles`);
    if (lifecycleAudit) for (let cycle = 0; cycle < 12; cycle++) {
      await page.getByRole("button", { name: "Control commander", exact: true }).click();
      await page.waitForFunction(() => (window as any).__commanderControl.controller.active());
      await page.waitForTimeout(350);
      await page.waitForFunction(() => !(window as any).__commanderOwned.snapshot().pendingLoads);
      const active = await page.evaluate(() => (window as any).__commanderControl.debug());
      const activeOwned = await page.evaluate(() => (window as any).__commanderOwned.snapshot());
      assert(active.viewLeaseHeld && active.resources, "Active commander owns one renderer-view lease");
      if (cycle === 1) await page.evaluate(() => { window.dispatchEvent(new Event("blur")); });
      else await page.keyboard.press("Escape");
      await page.waitForFunction(() => !(window as any).__commanderControl.owns());
      await page.waitForTimeout(450);
      const idle = await page.evaluate(() => (window as any).__commanderControl.debug());
      const idleOwned = await page.evaluate(() => (window as any).__commanderOwned.snapshot());
      assert(!idle.viewLeaseHeld && !idle.preparingResources, "Every exit releases its view lease");
      assert.equal(await page.evaluate(() => (window as any).__settlement.simulation.commanderControlSnapshot()), null);
      const identity = await page.evaluate(() => {
        const sim = (window as any).__settlement.simulation, soldier = sim.militarySoldiers().find((row: any) => row.commanderId);
        return { actor: soldier.actor, horse: soldier.combat.mount, hp: soldier.combat.hp,
          actorCount: sim.frames().filter((row: any) => row.uid === soldier.actor).length };
      });
      assert.equal(identity.actor, recruited.actor); assert.equal(identity.horse, recruited.horse);
      assert.equal(identity.actorCount, 1); assert.equal(identity.hp, before.snapshot.hp);
      assert.equal(idleOwned.pendingPreparation, 0);
      assert.equal(idleOwned.pendingLoads, 0);
      assert(idleOwned.caches.length > 0, "Real ownership cache observers were installed");
      for (const cache of idleOwned.caches) assert.equal(cache.value.pending, 0, `${cache.name} settled at idle`);
      lifecycleSamples.push({ cycle, warmup: cycle < 2,
        exit: cycle === 1 ? "dispatched window blur" : "Escape", active, idle, activeOwned, idleOwned, identity });
      if ([1, 6, 11].includes(cycle)) console.log(`[commander-owned] ${quality}: cycle ${cycle + 1}/12 complete`);
    }
    for (const sample of lifecycleSamples.slice(3)) {
      assert.deepEqual(sample.active.resources, lifecycleSamples[2]!.active.resources,
        "Warm commander active resources plateau across repeated ownership cycles");
      assert.deepEqual(sample.idle.resources, lifecycleSamples[2]!.idle.resources,
        "Every idle return releases the same owned view resources");
      assert.deepEqual(sample.activeOwned, lifecycleSamples[2]!.activeOwned, "Warm active private ownership plateaus");
      assert.deepEqual(sample.idleOwned, lifecycleSamples[2]!.idleOwned, "Warm idle private ownership and listeners plateau");
    }
    let latePreparation;
    if (lifecycleAudit) {
      console.log(`[commander-owned] ${quality}: deferred preparation cancellation`);
      await page.evaluate(() => { (window as any).__commanderOwned.holdPreparation = true; });
      await page.getByRole("button", { name: "Control commander", exact: true }).click();
      await page.waitForFunction(() => (window as any).__commanderOwned.preparationHeld);
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => (window as any).__commanderControl.owns()), false);
      await page.evaluate(() => (window as any).__commanderOwned.releasePreparation());
      await page.waitForFunction(() => !(window as any).__commanderOwned.snapshot().pendingPreparation);
      await page.waitForTimeout(450);
      latePreparation = await page.evaluate(() => ({ owned: (window as any).__commanderOwned.snapshot(),
        control: (window as any).__commanderControl.debug() }));
      assert(!latePreparation.control.viewLeaseHeld && !latePreparation.control.preparingResources);
      assert.deepEqual(latePreparation.owned, lifecycleSamples[2]!.idleOwned, "Late cancelled view releases its actual resources");
    }
    const meleeSamples = [];
    if (meleeAudit) meleeSamples.push(await auditCommanderMelee(page, output, quality));
    if (stagedHands && quality === "minimal") assert(stagedRequests > 0, "Actual staged model was fetched");
    const stagedRider = stagedRequests ? { requests: stagedRequests, path: stagedHandPath,
      hash: createHash("sha256").update(readFileSync(stagedHandPath)).digest("hex") } : undefined;
    const runtimeBodies = await Promise.all(runtimeBodyLoads);
    if (runtimeSurface) {
      assert(runtimeBodies.length > 0, "Production Commander surface was actually requested without interception");
      const expected = createHash("sha256").update(readFileSync(resolve(`assets/mounts/${nation}-commander-surface.glb`))).digest("hex");
      assert(runtimeBodies.every(body => body.sha256 === expected), "Live loaded bytes equal the accepted Commander surface");
    }
    let finalTeardown;
    if (lifecycleAudit) {
      console.log(`[commander-owned] ${quality}: actual island runtime teardown`);
      await page.evaluate(async () => { await (window as any).__commanderOwned.disposeRuntime(); });
      await page.waitForTimeout(450);
      finalTeardown = await page.evaluate(() => (window as any).__commanderOwned.snapshot());
      assert.equal(finalTeardown.pendingPreparation, 0);
      assert.equal(finalTeardown.pendingLoads, 0);
      assert.equal(finalTeardown.orphanedUndisposed, 0, "GC cannot hide missing disposal events");
      assert.deepEqual(finalTeardown.live, {}, "All observed private materials, textures and render targets were disposed");
      for (const cache of finalTeardown.caches)
        for (const [name, count] of Object.entries(cache.value)) assert.equal(count, 0, `${cache.name}.${name} released`);
      assert(finalTeardown.listeners <= lifecycleSamples[2]!.idleOwned.listeners, "Island teardown does not add global listeners");
      console.log(`[commander-owned] ${quality}: owned-resource teardown passed`);
    }
    reports.push({ quality, nation, recruited, before, moved, remounted, sameBodyAndHorse: true, stagedRider,
      runtimeBodies, guardProfileSha256: guardAudit && nation === "viking" ? createHash("sha256")
        .update(readFileSync(resolve("src/render-common/workers/viking-foot-axe-grips.json"))).digest("hex") : undefined,
      realLodgeExit: true, keyboardMovement: true, followHold: true, returnedRts: true,
      compactHints: hintBounds, hideShowHints: true, cameraSamples, lifecycleSamples, latePreparation, finalTeardown,
      ownershipScope: lifecycleAudit ? "Actual shading/refraction/shadow/sky/moon, worker source+instance material/texture ownership; canonical body/pack stats. Global listener counts observe add/remove calls; once/AbortSignal automatic retirement is not instrumented. Image bytes estimate decoded RGBA/data+mips; GC never substitutes for an observed dispose event. No universal heap claim." : undefined,
      guardSamples, archerySamples, meleeSamples });
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(rigCameraSourceHashes(), cameraSourcesBefore, "Anatomical camera sources stay frozen during native proof");
  if (lifecycleAudit) assert.deepEqual(lifecycleSources(), lifecycleSourcesBefore,
    "Client and worker TypeScript plus ownership probe stay frozen during native proof");
  status = "passed";
} finally {
  await browser.close(); await server.close();
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, reports, errors, cameraSourcesBefore,
    lifecycleSourcesBefore,
    scope: "Real guest commander recruitment, physical deployment, FPS input/HUD, same-horse dismount/call and RTS return; visual acceptance separate." }, null, 2));
}
