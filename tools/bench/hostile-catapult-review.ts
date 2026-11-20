import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const run = process.argv[2] ?? "native-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "hostile-catapult-2026-11-04", run);
mkdirSync(output, { recursive: true });
const dependencies = [
  "src/render-common/buildings/hostile-catapult-recipe.ts",
  "src/render-common/buildings/hostile-catapult-details.ts",
  "src/render-common/buildings/hostile-pirate-catapult-shaft.ts",
  "src/render-common/buildings/catapult-tower-recipe.ts",
  "src/renderers/three/buildings/neutral-building.ts",
  "src/renderers/three/buildings/hostile-catapult-materials.ts",
  "tools/bench/hostile-catapult-review.ts"
];
const fingerprints = () => Object.fromEntries(dependencies.map(path =>
  [path, createHash("sha256").update(readFileSync(resolve(path))).digest("hex")]));
const sourceHashes = fingerprints();
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const errors: string[] = [], reports: unknown[] = [];
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/hostile-catapult-review.html", route => route.fulfill({
    contentType: "text/html", body: "<body style='margin:0'></body>"
  }));
  await page.goto(`${url}hostile-catapult-review.html`);
  for (const detailed of [true, false]) for (const variant of ["bandit", "pirate"] as const) {
    const captures = await page.evaluate(async ({ detailed, variant }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const three = await imp("/@id/three");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createNeutralBuilding } = await imp("/src/renderers/three/buildings/neutral-building.ts");
      const { createThemedNeutralBuildingMaterials } =
        await imp("/src/renderers/three/buildings/themed-neutral-building-materials.ts");
      const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
      const renderer = new three.WebGLRenderer({ antialias: detailed, preserveDrawingBuffer: true });
      renderer.setSize(1000, 850); renderer.toneMapping = three.ACESFilmicToneMapping;
      const scene = new three.Scene(); scene.background = new three.Color("#c4ccb7");
      scene.add(new three.HemisphereLight("#fff5e9", "#647650", 2.0));
      const sun = new three.DirectionalLight("#fff2d9", 3); sun.position.set(-5, 8, 6); scene.add(sun);
      const ground = new three.Mesh(new three.PlaneGeometry(30, 30),
        new three.MeshStandardMaterial({ color: "#929b77", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.01; scene.add(ground);
      const base = createRomanMaterials(detailed);
      const style = { theme: variant === "pirate" ? "tropical" : "forest", variant };
      const materials = createThemedNeutralBuildingMaterials(base.materials, style);
      const model = createNeutralBuilding(getBuildingDefinition(16), materials.materials, detailed, style);
      model.fitToGrid(); scene.add(model.root);
      model.update(0, { construction: 1, door: 0, working: false, inputStock: { stone: 2 } });
      await new Promise(resolve => setTimeout(resolve, 150));
      const box = new three.Box3().setFromObject(model.root);
      const center = box.getCenter(new three.Vector3()), size = box.getSize(new three.Vector3());
      const camera = new three.PerspectiveCamera(35, 1000 / 850, .05, 80);
      const captures: { name: string; png: string; triangles: number; calls: number; bounds: number[] }[] = [];
      for (const [name, offset] of [
        ["front", [0, .25, 1]], ["oblique", [.8, .45, 1]],
        ["rear", [-.8, .45, -1]], ["gameplay", [.8, 1.5, 1.4]]
      ] as [string, number[]][]) {
        const distance = size.length() * 1.5;
        camera.position.copy(center).add(new three.Vector3(...offset).multiplyScalar(distance));
        camera.lookAt(center); scene.updateMatrixWorld(true); renderer.render(scene, camera);
        renderer.getContext().finish();
        captures.push({ name, png: renderer.domElement.toDataURL("image/png").split(",")[1],
          triangles: renderer.info.render.triangles, calls: renderer.info.render.calls, bounds: size.toArray() });
      }
      model.dispose(); materials.dispose(); base.dispose();
      ground.geometry.dispose(); ground.material.dispose(); renderer.dispose();
      return captures;
    }, { detailed, variant });
    for (const { png, ...facts } of captures) {
      const quality = detailed ? "high" : "minimal";
      writeFileSync(resolve(output, `${variant}-${quality}-${facts.name}.png`), Buffer.from(png, "base64"));
      reports.push({ variant, quality, ...facts });
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(fingerprints(), sourceHashes, "Reviewed source must stay frozen during capture");
  writeFileSync(resolve(output, "source-hashes.json"), JSON.stringify(sourceHashes, null, 2));
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ errors, reports }, null, 2));
  const figures: string[] = [];
  for (const variant of ["bandit", "pirate"]) for (const quality of ["high", "minimal"])
    for (const view of ["front", "oblique", "rear", "gameplay"]) {
      const name = `${variant}-${quality}-${view}`;
      figures.push(`<figure><img src="${name}.png" loading="lazy"><figcaption>${name}</figcaption></figure>`);
    }
  writeFileSync(resolve(output, "index.html"), `<!doctype html><meta charset="utf-8">
    <title>Hostile Catapult final source review</title><style>body{background:#222;color:#ddd;font:16px system-ui}
    main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}figure{margin:8px}img{width:100%}</style>
    <h1>Hostile Catapult final source review — art acceptance pending</h1><main>${figures.join("")}</main>`);
  console.log(JSON.stringify({ output, errors, reports }, null, 2));
} finally {
  try { await browser?.close(); } finally { await server.close(); }
}
