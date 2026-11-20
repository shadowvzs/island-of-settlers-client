import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const stage = resolve(process.argv[2] ?? "../resources/project-reviews/commander-possession-2026-11-03/viking-cloth-hard-integer-c");
const output = resolve(stage, "native-a");
const source = resolve("../island-of-settlers-worker-generation/game_ready/mounts/riders/viking-woman-blue/model.glb");
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const proof = read(resolve(stage, "provenance.json"));
const high = read(resolve(stage, "actual-loaded-60-pose-validation.json"));
const minimal = read(resolve(stage, "minimal-waist-proof.json"));
const minimalCpu = read(resolve(stage, "minimal-waist-actual-loaded-60-pose-validation.json"));
for (const control of [high, minimalCpu]) {
  assert.equal(control.samples, 60); assert.equal(control.newCameraExposures, 0); assert.equal(control.newNormalExposures, 0);
  assert.equal(control.targetFailures.length, 0); assert.equal(control.hemFailures.length, 0);
  assert.equal(control.originalTargetBodyFirstCount, 8); assert.equal(control.bodyDifference, 0); assert.equal(control.outsideClothDifference, 0);
  assert(control.maximumMotion <= .065 && control.maximumRestoredMotion <= .06);
}
assert(proof.cpuPassed && proof.reviewOnly && !proof.publicationAllowed);
assert(minimal.sourceAppliedBeforeLod && !minimal.old11PointProfileUsed && minimal.allLiteralClothTopologyRetained
  && minimal.matchingOriginalMinimalAnatomyExact && minimal.originalWaistBodyVerticesLocked);
assert.equal(hash(source), proof.sourceSha256);
const candidate = resolve(stage, "model.glb"); assert.equal(hash(candidate), proof.candidateSha256);
for (const file of minimal.outputs) assert.equal(hash(file.file), file.sha256);
const tracked = [source, candidate, ...minimal.outputs.map((entry: { file: string }) => entry.file),
  resolve(stage, "profile.json"), resolve(stage, "minimal-waist-proof.json"),
  resolve("src/renderers/three/three-mounts.ts"), resolve("src/renderers/three/worker-combat-pose.ts"),
  resolve("src/renderers/three/worker-mounted-equipment.ts"), resolve("src/renderers/three/mounted-axe-grip.ts")];
const fingerprints = () => tracked.map(file => ({ file, sha256: hash(file) }));
const before = fingerprints(); mkdirSync(output);
const { server, url } = await startDevServer(), browser = await launchBrowser();
const results = [];
try {
  for (const quality of ["high", "minimal"]) for (const variant of ["original", "candidate"]) {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    const errors: string[] = [], overrides: { kind: string; url: string; sha256: string }[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const minimalFile = minimal.outputs.find((entry: { variant: string }) => entry.variant === variant)!;
    await page.route("**/*viking-commander-surface.glb*", async route => {
      if (route.request().resourceType() !== "fetch") { await route.continue(); return; }
      overrides.push({ kind: "actual-minimal-source-before-lod", url: route.request().url(), sha256: minimalFile.sha256 });
      await route.fulfill({ path: minimalFile.file, contentType: "model/gltf-binary" });
    });
    if (variant === "candidate") await page.route("**/mounts/riders/viking-woman-blue/model.glb*", async route => {
      if (route.request().resourceType() !== "fetch") { await route.continue(); return; }
      overrides.push({ kind: "actual-original-high-source", url: route.request().url(), sha256: proof.candidateSha256 });
      await route.fulfill({ path: candidate, contentType: "model/gltf-binary" });
    });
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/viking-integer-review", route => route.fulfill({ contentType: "text/html", body: "<body style='margin:0'>" }));
    await page.addInitScript("window.__name=value=>value;"); await page.goto(`${url}viking-integer-review`);
    const captured = await page.evaluate(async ({ quality, samples }) => {
      const T = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const { createThreeMounts } = await import(/* @vite-ignore */ String("/src/renderers/three/three-mounts.ts"));
      const { createWorkerTextureLoader } = await import(/* @vite-ignore */ String("/src/renderers/three/three-worker.ts"));
      const { computeEnvironment } = await import(/* @vite-ignore */ String("/src/render-common/environment.ts"));
      const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setSize(900, 800);
      document.body.append(renderer.domElement);
      const textures = createWorkerTextureLoader(renderer), mounts = await createThreeMounts(textures, [], quality === "high");
      mounts.scene.background = new T.Color("#b9c6ac");
      const environment = computeEnvironment({ azimuthX: -.6, azimuthZ: .8, elevation: .85 }, 12, 0);
      const camera = new T.PerspectiveCamera(30, 900 / 800, .01, 100), images = [], rows = [];
      const visible = (object: any) => { for (let own = object; own; own = own.parent) if (!own.visible) return false; return true; };
      try {
        for (const view of ["wholebody", "waist-left", "waist-right"]) {
          const sheet = document.createElement("canvas"); sheet.width = 288 * 6; sheet.height = 280 * 10;
          const context = sheet.getContext("2d")!; context.fillStyle = "#b9c6ac"; context.fillRect(0, 0, sheet.width, sheet.height);
          for (const [index, sample] of samples.entries()) {
            const frame = { actorId: 1, ...sample, attackProgress: sample.attack, auraActive: false,
              clipTime: sample.time, coat: "bay", commander: true, commanderLoadout: "axe", faction: 0,
              guard: Number(sample.guard), manualGuard: sample.guard, heading: 0, nation: "viking", rider: "viking-woman-blue",
              selected: false, turnRate: 0, x: 0, y: 0, z: 0 };
            await mounts.prepare([frame], environment); mounts.scene.updateMatrixWorld(true);
            const hips = new T.Vector3(); let found = false;
            mounts.scene.traverse((object: any) => { if (object.name === "Hips") { object.getWorldPosition(hips); found = true; } });
            if (!found) throw new Error("Actual mounted original rig missing");
            if (view === "wholebody") { camera.position.set(2.5, 1.9, 4); camera.lookAt(0, .95, 0); }
            else {
              const side = view === "waist-left" ? 1 : -1;
              camera.position.copy(hips).add(new T.Vector3(side * .7, .2, .8).applyAxisAngle(new T.Vector3(0, 1, 0), .8 * sample.engage));
              camera.lookAt(hips.x, hips.y - .07, hips.z);
            }
            camera.updateMatrixWorld(true); mounts.render(renderer, camera);
            const bodies: { name: string; vertices: number; triangles: number }[] = [];
            mounts.scene.traverse((object: any) => {
              if (object.isSkinnedMesh && visible(object) && !object.name.startsWith("armour_"))
                bodies.push({ name: object.name, vertices: object.geometry.getAttribute("position").count,
                  triangles: object.geometry.index.count / 3 });
            });
            if (!bodies.some(body => body.vertices === 1823 && body.triangles === 1715)) throw new Error("Literal original cloth topology was replaced");
            if (quality === "high" && !bodies.some(body => body.vertices === 9089)) throw new Error("High silently selected a different body LOD");
            if (quality === "minimal" && bodies.some(body => body.vertices === 9089)) throw new Error("Minimal silently substituted the High body");
            const x = index % 6 * 288, y = Math.floor(index / 6) * 280;
            context.drawImage(renderer.domElement, x, y + 24, 288, 256); context.fillStyle = "#132015"; context.font = "11px sans-serif";
            context.fillText(`${index} ${sample.clip} t${sample.time} a${sample.attack ?? "-"} e${sample.engage} m${Number(sample.manualControl)} g${Number(sample.guard)}`, x + 3, y + 16);
            rows.push({ view, index, sample, hips: hips.toArray(), camera: camera.position.toArray(), bodies,
              calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
            if (sample.attack === .7 && sample.engage === 1 && sample.manualControl && view !== "wholebody")
              images.push({ name: `${view}-strike`, png: renderer.domElement.toDataURL("image/png").split(",")[1]! });
          }
          images.push({ name: `${view}-60`, png: sheet.toDataURL("image/png").split(",")[1]! });
        }
        const sample = samples.find((sample: any) => sample.attack === .7 && sample.engage === 1 && sample.manualControl)!;
        await mounts.prepare([{ actorId: 1, ...sample, attackProgress: sample.attack, auraActive: false, clipTime: sample.time,
          coat: "bay", commander: true, commanderLoadout: "axe", faction: 0, guard: 0, manualGuard: false, heading: 0,
          nation: "viking", rider: "viking-woman-blue", selected: false, turnRate: 0, x: 0, y: 0, z: 0 }], environment);
        const hips = new T.Vector3(); mounts.scene.traverse((object: any) => { if (object.name === "Hips") object.getWorldPosition(hips); });
        camera.position.copy(hips).add(new T.Vector3(0, .16, -.9).applyAxisAngle(new T.Vector3(0, 1, 0), .8));
        camera.lookAt(hips.x, hips.y - .07, hips.z); camera.updateMatrixWorld(true); mounts.render(renderer, camera);
        images.push({ name: "waist-back-seam-strike", png: renderer.domElement.toDataURL("image/png").split(",")[1]! });
      } finally { mounts.dispose(); textures.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
      return { images, rows };
    }, { quality, samples: high.guards.map(({ attack, clip, engage, guard, manualControl, time }: any) =>
      ({ clip, time, attack, guard, engage, manualControl })) });
    assert.deepEqual(errors, []); assert(overrides.some(override => override.kind === "actual-minimal-source-before-lod"));
    if (quality === "high" && variant === "candidate") assert(overrides.some(override => override.kind === "actual-original-high-source"));
    for (const image of captured.images) writeFileSync(resolve(output, `${quality}-${variant}-${image.name}.png`), Buffer.from(image.png, "base64"));
    results.push({ quality, variant, errors, overrides, rows: captured.rows });
    await page.close(); console.log(JSON.stringify({ quality, variant, sheets: 3, rawSeams: 3, poseCells: captured.rows.length }));
  }
  assert.deepEqual(fingerprints(), before);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ nativeAccepted: false, productionPublished: false,
    actualRuntimeMountedRenderer: true, matchingOriginalMinimalControl: true, capturedSheets: 12, rawSeamViews: 12,
    poseCells: 720, sourceHashes: before, results }, null, 2));
} finally { await browser.close(); await server.close(); }
