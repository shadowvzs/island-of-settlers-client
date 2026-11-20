import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const run = process.argv[2] ?? "native-a";
assert(/^[a-z0-9-]+$/.test(run));
assert(!process.argv[3] || ["roman-only", "viking-only"].includes(process.argv[3]));
assert(!process.argv[4] || process.argv[4] === "front-detail");
const frontDetail = process.argv[4] === "front-detail";
const nations = ["roman", "viking"].filter(nation =>
  !process.argv[3] || process.argv[3] === `${nation}-only`);
const output = resourcesPath("project-reviews", "catapult-wall-details-2026-11-04", run);
mkdirSync(output, { recursive: true });
const sources = ["src/render-common/buildings/catapult-wall-details.ts",
  "src/render-common/buildings/catapult-tower-recipe.ts", "src/renderers/three/buildings/roman-building.ts",
  "src/renderers/three/buildings/catapult-ivy-geometry.ts", "src/renderers/three/buildings/catapult-ivy-material.ts",
  "src/renderers/three/viking-round-shield.ts", "src/render-common/buildings/catapult-viking-entry-axes.ts",
  "src/render-common/buildings/catapult-shell-architecture.ts",
  "src/renderers/three/buildings/catapult-viking-axe-metal.ts"];
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
  for (const nation of nations) for (const detailed of [true, false]) {
    const captures = await page.evaluate(async ({ detailed, frontDetail, nation }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const three = await imp("/@id/three");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createNationBuildingMaterials } = await imp("/src/renderers/three/buildings/nation-building-materials.ts");
      const { createNationBuilding } = await imp("/src/renderers/three/buildings/nation-building.ts");
      const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
      const { catapultIvyGrowth } = await imp("/src/render-common/buildings/catapult-wall-details.ts");
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
      const model = createNationBuilding(getBuildingDefinition(16), pack.materials, nation, detailed, 5);
      model.fitToGrid(); scene.add(model.root);
      model.update(0, { construction: 1, door: 0, working: false, inputStock: { stone: 2 } });
      await new Promise(resolve => setTimeout(resolve, 100)); scene.updateMatrixWorld(true);
      const box = new three.Box3().setFromObject(model.root), center = box.getCenter(new three.Vector3());
      const size = box.getSize(new three.Vector3()), camera = new three.PerspectiveCamera(35, 1000 / 850, .02, 100);
      const captures: { name: string; png: string; triangles: number; modelTriangles: number; calls: number }[] = [];
      for (const [name, direction] of [["front", [.6, .35, 1]], ["side", [1, .25, -.2]],
        ["rear", [-.7, .35, -1]], ["detail", [1, .1, .4]]] as [string, number[]][]) {
        if (frontDetail && name !== "front" && name !== "detail") continue;
        let target = center, distance = size.length() * 1.72;
        if (name === "detail") {
          const local = nation === "roman" ? catapultIvyGrowth(detailed).leaves[16].center : [0, 1.56, .88];
          target = model.root.localToWorld(new three.Vector3(...local));
          distance = nation === "roman" ? .95 : 1.0;
        }
        const viewDirection = name === "detail" && nation === "viking" ? [.3, .1, 1] : direction;
        camera.position.copy(target).add(new three.Vector3(...viewDirection).normalize().multiplyScalar(distance));
        camera.lookAt(target); renderer.render(scene, camera); renderer.getContext().finish();
        captures.push({ name, png: renderer.domElement.toDataURL("image/png").split(",")[1],
          triangles: renderer.info.render.triangles, modelTriangles: model.triangles(false), calls: renderer.info.render.calls });
      }
      model.dispose(); pack.dispose(); base.dispose();
      ground.geometry.dispose(); ground.material.dispose(); renderer.dispose();
      return captures;
    }, { nation, detailed, frontDetail });
    for (const { png, ...facts } of captures) {
      const quality = detailed ? "high" : "minimal";
      writeFileSync(resolve(output, `${nation}-${quality}-${facts.name}.png`), Buffer.from(png, "base64"));
      reports.push({ nation, quality, ...facts });
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(hashes(), before);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ hashes: before, errors, reports }, null, 2));
  const figures = nations.flatMap(nation => ["high", "minimal"].flatMap(quality =>
    (frontDetail ? ["front", "detail"] : ["front", "side", "rear", "detail"]).map(view => {
      const name = `${nation}-${quality}-${view}`;
      return `<figure><img loading="lazy" src="${name}.png"><figcaption>${name}</figcaption></figure>`;
    })));
  writeFileSync(resolve(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Catapult wall details</title>
    <style>body{background:#222;color:#ddd;font:16px system-ui}main{display:grid;grid-template-columns:1fr 1fr}
    img{width:100%}figure{margin:8px}</style><h1>Catapult wall details — native review</h1><main>${figures.join("")}</main>`);
  console.log(JSON.stringify({ output, errors, frames: reports.length }));
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
