import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

// Actual mounted renderer; staged fetch override is restricted to this review page.
const vikingGrip = process.argv.includes("--viking-grip");
const surfaceD = process.argv.includes("--surface-d");
let run = "a";
if (vikingGrip) run = "b";
if (surfaceD) run = "d";
const output = resolve(`../resources/project-reviews/commander-possession-2026-11-03/loadout-surface-${run}`);
const candidate = resolve("../resources/project-reviews/commander-possession-2026-11-03/minimal-rider-hands-a/nubian-rider-minimal.glb");
const sourcePaths = [resolve("assets/mounts/nubian-rider-minimal.glb"),
  resolve("../island-of-settlers-worker-generation/game_ready/mounts/riders/nubian-man-kilt/model.glb")];
if (!surfaceD) sourcePaths.push(candidate);
if (surfaceD) sourcePaths.push(
  resolve("../resources/project-reviews/commander-possession-2026-11-03/rider-surface-d/nubian-rider-minimal.glb"),
  resolve("../resources/project-reviews/commander-possession-2026-11-03/rider-surface-d/viking-rider-minimal.glb"),
  resolve("assets/mounts/viking-rider-minimal.glb"),
  resolve("../island-of-settlers-worker-generation/game_ready/mounts/riders/viking-woman-blue/model.glb"),
  resolve("src/renderers/three/mounted-axe-grip.ts"), resolve("src/renderers/three/mounted-axe-surface.ts"),
  resolve("src/renderers/three/mounted-axe-contact.ts"), resolve("src/renderers/three/worker-combat-pose.ts"),
  resolve("src/renderers/three/worker-mounted-equipment.ts"), resolve("src/render-common/workers/viking-axe.ts"));
const sourceHashes = () => sourcePaths.map(path => ({ path,
  sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
const before = sourceHashes();
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
let captureCount = 0;
try {
  let variants = ["nubian-baseline", "nubian-staged", "viking-high", "viking-minimal"];
  if (vikingGrip) variants = ["viking-high", "viking-minimal"];
  if (surfaceD) variants = ["nubian-high", "nubian-minimal", "viking-high", "viking-minimal"];
  for (const variant of variants) {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } }), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let candidateRequests = 0;
    if (surfaceD) await page.route("**/assets/mounts/*-rider-minimal.glb*", async route => {
      if (route.request().resourceType() !== "fetch") { await route.continue(); return; }
      const nation = variant.startsWith("nubian") ? "nubian" : "viking";
      if (!route.request().url().includes(`/${nation}-rider-minimal.glb`)) { await route.continue(); return; }
      candidateRequests++; await route.fulfill({ contentType: "model/gltf-binary",
        path: resolve(`../resources/project-reviews/commander-possession-2026-11-03/rider-surface-d/${nation}-rider-minimal.glb`) });
    });
    if (variant === "nubian-staged") await page.route("**/assets/mounts/nubian-rider-minimal.glb*", async route => {
      if (route.request().resourceType() !== "fetch") { await route.continue(); return; }
      candidateRequests++; await route.fulfill({ path: candidate, contentType: "model/gltf-binary" });
    });
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/loadout-surface", route => route.fulfill({ contentType: "text/html", body: "<body style='margin:0'>" }));
    await page.addInitScript("window.__name = value => value;");
    await page.goto(`${url}loadout-surface`);
    const result = await page.evaluate(async ({ surfaceD, variant, vikingGrip }) => {
      const T = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const { createThreeMounts } = await import(/* @vite-ignore */ String("/src/renderers/three/three-mounts.ts"));
      const { createWorkerTextureLoader } = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
      const { computeEnvironment } = await import(/* @vite-ignore */ String("/src/render-common/environment.ts"));
      const { NATION_RIDERS } = await import(/* @vite-ignore */ String("/src/render-common/mounts/nation-riders.ts"));
      const nation = variant.startsWith("nubian") ? "nubian" : "viking";
      const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(innerWidth, innerHeight); document.body.append(renderer.domElement);
      const textures = createWorkerTextureLoader(renderer), mounts = await createThreeMounts(textures, [], variant.endsWith("-high"));
      mounts.scene.background = new T.Color("#b9c6ac");
      const environment = computeEnvironment({ azimuthX: -.6, azimuthZ: .8, elevation: .85 }, 12, 0);
      const camera = new T.PerspectiveCamera(30, innerWidth / innerHeight, .01, 100);
      const captures: { name: string; png: string }[] = [], frames = [];
      let modes = nation === "nubian" ? ["idle", "draw", "guard"] : ["guard", "strike"];
      if (surfaceD && nation === "nubian") modes = ["draw"];
      for (const mode of modes) {
        let attackProgress: number | null = null;
        if (mode === "draw") attackProgress = .55;
        if (mode === "strike") attackProgress = .7;
        const frame = { actorId: 1, attackProgress,
          auraActive: false, clip: "idle", clipTime: .4, coat: "bay", commander: true,
          commanderLoadout: nation === "nubian" ? "bow" : "axe", faction: 0, guard: mode === "guard" ? 1 : 0,
          manualGuard: mode === "guard", manualBowPitch: nation === "nubian" ? 0 : undefined,
          manualControl: vikingGrip || surfaceD,
          heading: 0, nation, rider: NATION_RIDERS[nation], selected: false, turnRate: 0, x: 0, y: 0, z: 0 };
        await mounts.prepare([frame], environment);
        mounts.scene.updateMatrixWorld(true);
        const hand = new T.Vector3();
        let found = false;
        mounts.scene.traverse((object: any) => { if (object.name === "LeftHand") { object.getWorldPosition(hand); found = true; } });
        if (!found) throw new Error("Actual original rider hand not found");
        let views = ["hand"];
        if (mode === "idle") views = ["full"];
        if (nation === "nubian" && mode === "draw") views = ["full", "hand"];
        if (vikingGrip || surfaceD) views = mode === "guard" ? ["hand", "fps"] : ["full"];
        if (surfaceD && nation === "nubian") views = ["full", "hand", "fps"];
        for (const view of views) {
          camera.fov = 30;
          if (view === "full") { camera.position.set(2.5, 1.9, 4); camera.lookAt(0, .95, 0); }
          else { camera.position.copy(hand).add(new T.Vector3(.35, .15, .7)); camera.lookAt(hand); }
          if (view === "fps") {
            const eye = mounts.eyeOffset(1);
            if (!eye) throw new Error("Actual rig eye unavailable");
            const forward = nation === "nubian" ? .08 : .1;
            camera.fov = 65; camera.position.set(eye.x, eye.y, eye.z + forward);
            camera.lookAt(eye.x, eye.y, eye.z + 1 + forward);
          }
          camera.updateProjectionMatrix();
          renderer.render(mounts.scene, camera);
          captures.push({ name: `${variant}-${mode}-${view}`, png: renderer.domElement.toDataURL("image/png").split(",")[1]! });
        }
        const weapon = mounts.scene.getObjectByName(nation === "nubian" ? "military_bow" : "military_axe");
        const weaponBounds = weapon ? new T.Box3().setFromObject(weapon) : undefined;
        frames.push({ mode, hand: hand.toArray(), eye: mounts.eyeOffset(1),
          weaponBounds: weaponBounds ? { min: weaponBounds.min.toArray(), max: weaponBounds.max.toArray() } : null,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures });
      }
      mounts.dispose(); textures.dispose(); renderer.dispose(); renderer.forceContextLoss();
      return { captures, frames };
    }, { variant, vikingGrip, surfaceD });
    assert.deepEqual(errors, []);
    if (variant === "nubian-staged") assert(candidateRequests > 0, "Actual staged hand derivative fetched");
    if (surfaceD) assert(candidateRequests > 0, "Actual sound-surface staged rider fetched");
    for (const { name, png } of result.captures) writeFileSync(resolve(output, `${name}.png`), Buffer.from(png, "base64"));
    captureCount += result.captures.length;
    reports.push({ variant, candidateRequests, frames: result.frames, errors });
    await page.close();
  }
  assert.equal(captureCount, vikingGrip ? 6 : 12, "Exact bounded actual-renderer comparison set");
  assert.deepEqual(sourceHashes(), before, "Staged, original and runtime source bytes remain unchanged");
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status: "rendered-visual-review-required",
    captureCount, sourceHashes: before, runtimeAssetsChanged: false, reports }, null, 2));
} finally { await browser.close(); await server.close(); }
