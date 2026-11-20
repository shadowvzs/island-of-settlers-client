import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const run = process.argv[2] ?? "native-a";
assert(/^[a-z0-9-]+$/.test(run));
const nations = ["persian"];
const output = resourcesPath("project-reviews", "persian-owner-yard-palette-2026-11-05", run);
mkdirSync(output, { recursive: true });
const sources = ["src/render-common/buildings/persian-mill-yard.ts",
  "src/render-common/buildings/persian-building-props.ts",
  "src/render-common/buildings/persian-ardashir-monument.ts"];
const hashes = () => Object.fromEntries(sources.map(path =>
  [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const before = hashes(), errors: string[] = [], reports: unknown[] = [];
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  await page.addInitScript("window.__name=value=>value;");
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/catapult-wall-details.html", route => route.fulfill({
    contentType: "text/html", body: "<body style='margin:0'></body>"
  }));
  await page.goto(`${url}catapult-wall-details.html`);
  for (const nation of nations) for (const detailed of [true, false]) for (const id of [7, 31])
    for (const level of [1, 5]) {
    const captures = await page.evaluate(async ({ detailed, id, level, nation }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const three = await imp("/@id/three");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createNationBuildingMaterials } = await imp("/src/renderers/three/buildings/nation-building-materials.ts");
      const { createNationBuilding } = await imp("/src/renderers/three/buildings/nation-building.ts");
      const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
      const renderer = new three.WebGLRenderer({ antialias: detailed, preserveDrawingBuffer: true });
      renderer.setSize(1000, 850); renderer.toneMapping = three.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = detailed; renderer.shadowMap.type = three.PCFSoftShadowMap;
      const scene = new three.Scene(); scene.background = new three.Color("#c4ccb7");
      scene.add(new three.HemisphereLight("#fff5e9", "#647650", 2));
      const sun = new three.DirectionalLight("#fff2d9", 3); sun.position.set(-5, 8, 6);
      sun.castShadow = detailed; sun.shadow.mapSize.set(1024, 1024);
      Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 });
      sun.shadow.camera.updateProjectionMatrix(); scene.add(sun);
      const ground = new three.Mesh(new three.PlaneGeometry(40, 40),
        new three.MeshStandardMaterial({ color: "#929b77", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.01; ground.receiveShadow = detailed; scene.add(ground);
      const base = createRomanMaterials(detailed), pack = createNationBuildingMaterials(base.materials, nation, detailed);
      const model = createNationBuilding(getBuildingDefinition(id), pack.materials, nation, detailed, level);
      model.fitToGrid(); scene.add(model.root);
      model.update(0, { construction: 1, door: 0, working: false, inputStock: { grain: 6 }, outputStock: { flour: 6 } });
      await new Promise(resolve => setTimeout(resolve, 100)); scene.updateMatrixWorld(true);
      const box = new three.Box3().setFromObject(model.root), center = box.getCenter(new three.Vector3());
      const size = box.getSize(new three.Vector3()), camera = new three.PerspectiveCamera(35, 1000 / 850, .02, 100);
      const captures: { name: string; png: string; triangles: number; modelTriangles: number; calls: number }[] = [];
      for (const [name, direction] of [["front", [.7, .4, 1]], ["rear", [-.7, .4, -1]],
        ["near", [.55, .2, 1]]] as [string, number[]][]) {
        let target = center, distance = size.length() * 1.55;
        if (name === "near") {
          target = model.root.localToWorld(new three.Vector3(0, id === 31 ? .4 : 2.3, id === 31 ? -.1 : 3.5));
          distance = id === 31 ? 3.5 : 9;
        }
        camera.position.copy(target).add(new three.Vector3(...direction).normalize().multiplyScalar(distance));
        camera.lookAt(target); renderer.render(scene, camera); renderer.getContext().finish();
        captures.push({ name, png: renderer.domElement.toDataURL("image/png").split(",")[1],
          triangles: renderer.info.render.triangles, modelTriangles: model.triangles(false), calls: renderer.info.render.calls });
      }
      model.dispose(); pack.dispose(); base.dispose();
      ground.geometry.dispose(); ground.material.dispose(); renderer.dispose();
      return captures;
    }, { detailed, id, level, nation });
    for (const { png, ...facts } of captures) {
      const quality = detailed ? "high" : "minimal";
      writeFileSync(resolve(output, `${nation}-${id}-${quality}-l${level}-${facts.name}.png`), Buffer.from(png, "base64"));
      reports.push({ id, level, nation, quality, ...facts });
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(hashes(), before);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ hashes: before, errors, reports }, null, 2));
  const figures = nations.flatMap(nation => [7, 31].flatMap(id => ["high", "minimal"].flatMap(quality =>
    [1, 5].flatMap(level => ["front", "rear", "near"].map(view => {
      const name = `${nation}-${id}-${quality}-l${level}-${view}`;
      return `<figure><img loading="lazy" src="${name}.png"><figcaption>${name}</figcaption></figure>`;
    })))));
  writeFileSync(resolve(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Persian mill yard and monument palette</title>
    <style>body{background:#222;color:#ddd;font:16px system-ui}main{display:grid;grid-template-columns:1fr 1fr}
    img{width:100%}figure{margin:8px}</style><h1>Persian mill yard and monument palette — native review</h1><main>${figures.join("")}</main>`);
  console.log(JSON.stringify({ output, errors, frames: reports.length }));
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
