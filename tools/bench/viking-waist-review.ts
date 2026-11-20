import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const base = resolve("../resources/project-reviews/commander-possession-2026-11-03");
const output = resolve(base, "viking-cloth-native-a"), stage = resolve(base, "viking-cloth-spine-approved-a");
const candidate = resolve(stage, "model.glb");
const source = resolve("../island-of-settlers-worker-generation/game_ready/mounts/riders/viking-woman-blue/model.glb");
const proof = JSON.parse(readFileSync(resolve(stage, "provenance.json"), "utf8"));
assert(proof.cpuPassed && proof.reviewOnly && !proof.publicationAllowed && proof.publicationPoseLimit === .06);
const tracked = [source, candidate, resolve(stage, "profile.json"),
  resolve("src/renderers/three/worker-combat-pose.ts"), resolve("src/renderers/three/worker-mounted-equipment.ts"),
  resolve("src/renderers/three/mounted-axe-grip.ts"), resolve("src/renderers/three/mounted-axe-contact.ts")];
const hashes = () => tracked.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
const before = hashes();
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const results: unknown[] = [];
try {
  for (const variant of ["original", "cloth-fixed"] as const) {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } }), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let overridden = 0;
    if (variant === "cloth-fixed") await page.route("**/mounts/riders/viking-woman-blue/model.glb*", async route => {
      if (route.request().resourceType() !== "fetch") { await route.continue(); return; }
      overridden++; await route.fulfill({ path: candidate, contentType: "model/gltf-binary" });
    });
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/viking-waist-review", route => route.fulfill({ contentType: "text/html", body: "<body style='margin:0'>" }));
    await page.addInitScript("window.__name = value => value;");
    await page.goto(`${url}viking-waist-review`);
    const result = await page.evaluate(async () => {
      const T = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const { createThreeMounts } = await import(/* @vite-ignore */ String("/src/renderers/three/three-mounts.ts"));
      const { createWorkerTextureLoader } = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
      const { computeEnvironment } = await import(/* @vite-ignore */ String("/src/render-common/environment.ts"));
      const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(innerWidth, innerHeight); document.body.append(renderer.domElement);
      const textures = createWorkerTextureLoader(renderer), mounts = await createThreeMounts(textures, [], true);
      mounts.scene.background = new T.Color("#b9c6ac");
      const environment = computeEnvironment({ azimuthX: -.6, azimuthZ: .8, elevation: .85 }, 12, 0);
      const camera = new T.PerspectiveCamera(30, innerWidth / innerHeight, .01, 100);
      const captures: { name: string; png: string }[] = [], rows = [];
      try {
        for (const view of ["full-left", "waist-left-engaged", "waist-right-engaged"]) {
          const engage = Number(view !== "full-left");
          const frame = { actorId: 1, attackProgress: .7, auraActive: false, clip: "idle", clipTime: .4,
            coat: "bay", commander: true, commanderLoadout: "axe", engage, faction: 0, guard: 0,
            manualGuard: false, manualControl: true, heading: 0, nation: "viking", rider: "viking-woman-blue",
            selected: false, turnRate: 0, x: 0, y: 0, z: 0 };
          await mounts.prepare([frame], environment); mounts.scene.updateMatrixWorld(true);
          const hips = new T.Vector3(); let found = false;
          const vertexCounts: number[] = [];
          mounts.scene.traverse((object: any) => {
            if (object.name === "Hips") { object.getWorldPosition(hips); found = true; }
            if (object.isSkinnedMesh) vertexCounts.push(object.geometry.getAttribute("position").count);
          });
          if (!found || !vertexCounts.includes(9089) || !vertexCounts.includes(1823))
            throw new Error("The actual original full rider body, not a differentLOD, must be present");
          camera.fov = 30;
          if (view === "full-left") { camera.position.set(2.5, 1.9, 4); camera.lookAt(0, .95, 0); }
          else {
            const side = view === "waist-left-engaged" ? 1 : -1;
            const offset = new T.Vector3(side * .7, .2, .8).applyAxisAngle(new T.Vector3(0, 1, 0), .8);
            camera.position.copy(hips).add(offset); camera.lookAt(hips.x, hips.y - .07, hips.z);
          }
          camera.updateProjectionMatrix();
          // Canonical mounted renderer's actual full model; intentionally no far-detail swap in this source comparison.
          renderer.render(mounts.scene, camera);
          captures.push({ name: view, png: renderer.domElement.toDataURL("image/png").split(",")[1]! });
          rows.push({ view, engage, hips: hips.toArray(), camera: camera.position.toArray(),
            vertexCounts, triangles: renderer.info.render.triangles });
        }
      } finally { mounts.dispose(); textures.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
      return { captures, rows };
    });
    assert.deepEqual(errors, []);
    if (variant === "cloth-fixed") assert(overridden > 0, "The actual original-source request fetched the immutable cloth-only stage");
    for (const capture of result.captures)
      writeFileSync(resolve(output, `${variant}-${capture.name}.png`), Buffer.from(capture.png, "base64"));
    results.push({ variant, overridden, errors, rows: result.rows });
    await page.close();
  }
  assert.deepEqual(hashes(), before);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status: "native-rendered-inspection-required",
    captures: 6, sourceHashes: before, results,
    scope: "Actual source-versus-cloth-only High renderer; engaged left/right waist; Minimal profile integration remains separately owned" }, null, 2));
} finally { await browser.close(); await server.close(); }
