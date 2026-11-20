import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const run = process.argv[2] ?? "native-a";
const ionicOnly = process.argv.includes("--ionic-only");
const capitalOnly = process.argv.includes("--capital-only");
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "roman-column-decorations-2026-11-05", run);
mkdirSync(output, { recursive: true });
const sources = ["src/renderers/three/roman-column-geometry.ts", "src/renderers/three/roman-column-decoration.ts",
  "src/renderers/three/road-decoration-stone-material.ts", "src/renderers/three/road-decoration-stone-samples.ts"];
const hashes = () => Object.fromEntries(sources.map(path =>
  [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const before = hashes(), errors: string[] = [], reports: unknown[] = [], names: string[] = [];
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  await page.addInitScript("window.__name=value=>value;");
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/roman-column-review.html", route => route.fulfill({
    contentType: "text/html", body: "<body style='margin:0'></body>"
  }));
  await page.goto(`${url}roman-column-review.html`);
  for (const order of ionicOnly ? [1] : [0, 1]) for (const finish of ["limestone", "marble"])
    for (const quality of ionicOnly ? ["high", "minimal"] : ["high", "minimal", "far"]) {
    const captures = await page.evaluate(async ({ capitalOnly, finish, ionicOnly, order, quality }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const three = await imp("/@id/three");
      const { createRomanColumnDecoration } = await imp("/src/renderers/three/roman-column-decoration.ts");
      const detailed = quality === "high", renderer = new three.WebGLRenderer({
        antialias: detailed, preserveDrawingBuffer: true
      });
      renderer.setSize(1000, 850); renderer.toneMapping = three.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = detailed; renderer.shadowMap.type = three.PCFSoftShadowMap;
      const scene = new three.Scene(); scene.background = new three.Color("#c4ccb7");
      scene.add(new three.HemisphereLight("#fff5e9", "#647650", 2));
      const sun = new three.DirectionalLight("#fff2d9", 3); sun.position.set(-5, 8, 6);
      sun.castShadow = detailed; sun.shadow.mapSize.set(1024, 1024);
      Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
      sun.shadow.camera.updateProjectionMatrix(); scene.add(sun);
      const ground = new three.Mesh(new three.PlaneGeometry(40, 40),
        new three.MeshStandardMaterial({ color: "#929b77", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.008; ground.receiveShadow = detailed; scene.add(ground);
      const model = createRomanColumnDecoration(order, detailed, finish, quality === "far" ? "far" : "near");
      scene.add(model.root); scene.updateMatrixWorld(true);
      const box = new three.Box3().setFromObject(model.root), center = box.getCenter(new three.Vector3());
      const camera = new three.PerspectiveCamera(35, 1000 / 850, .02, 100);
      const captures: { name: string; png: string; modelTriangles: number; calls: number; framed: boolean }[] = [];
      let views = ["front", "rear", "capital", "gameplay"];
      if (quality === "far") views = ["gameplay"];
      if (ionicOnly) views = ["front", "capital"];
      if (capitalOnly) views = ["capital"];
      for (const name of views) {
        let target = center, direction = new three.Vector3(.6, .3, 1), distance = 7.0;
        if (name === "rear") direction = new three.Vector3(-.6, .3, -1);
        if (name === "capital") { target = new three.Vector3(0, 2.90, 0); distance = 1.45; }
        if (name === "gameplay") { distance = 15; direction = new three.Vector3(1, 1.1, 1); }
        camera.position.copy(target).add(direction.normalize().multiplyScalar(distance));
        camera.lookAt(target); renderer.render(scene, camera); renderer.getContext().finish();
        let framed = true;
        if (name !== "capital") {
          const mesh = model.root.children[0], positions = mesh.geometry.getAttribute("position");
          for (let index = 0; index < positions.count; index++) {
            const projected = new three.Vector3().fromBufferAttribute(positions, index)
              .applyMatrix4(mesh.matrixWorld).project(camera);
            if (Math.abs(projected.x) > .98 || Math.abs(projected.y) > .98) framed = false;
          }
        }
        captures.push({ name, png: renderer.domElement.toDataURL("image/png").split(",")[1],
          modelTriangles: model.triangles, calls: renderer.info.render.calls, framed });
      }
      model.dispose(); ground.geometry.dispose(); ground.material.dispose(); renderer.dispose();
      return captures;
    }, { capitalOnly, finish, ionicOnly, order, quality });
    for (const { png, ...facts } of captures) {
      assert(facts.framed, "Column must fit the full-object camera");
      const name = `${order === 0 ? "doric" : "ionic"}-${finish}-${quality}-${facts.name}`;
      names.push(name);
      writeFileSync(resolve(output, `${name}.png`), Buffer.from(png, "base64"));
      reports.push({ finish, order, quality, ...facts });
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(hashes(), before);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ hashes: before, errors, reports }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Roman columns</title>
    <style>body{background:#222;color:#ddd;font:16px system-ui}main{display:grid;grid-template-columns:1fr 1fr}
    img{width:100%}figure{margin:8px}</style><h1>Roman columns — actual native models</h1><main>${names.map(name =>
      `<figure><img loading="lazy" src="${name}.png"><figcaption>${name}</figcaption></figure>`).join("")}</main>`);
  console.log(JSON.stringify({ output, errors, frames: reports.length }));
} finally {
  try { await browser?.close(); } finally { await server.close(); }
  console.log("Roman column browser and server fully closed");
}
