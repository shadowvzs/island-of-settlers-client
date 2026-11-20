import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const run = process.argv[2] ?? "native-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "firebox-cavity-2026-11-04", run);
assert(!existsSync(resolve(output, "report.json")), "Preserve previous native receipts");
mkdirSync(output, { recursive: true });
const sources = [
  "src/render-common/buildings/roman-firebox-cavity.ts",
  "src/renderers/three/buildings/firebox-cavity-geometry.ts",
  "src/renderers/three/buildings/building-hidden-triangles.ts",
  "src/render-common/buildings/persian-rounded-massing.ts",
  "src/render-common/buildings/roman-resource-workshops.ts",
  "src/render-common/buildings/building-window-shadows.ts",
  "src/render-common/buildings/chinese-special-structures.ts",
  "src/render-common/buildings/nation-mill-designs.ts",
  "src/render-common/buildings/roman-third-batch.ts",
  "src/render-common/buildings/roman-craft-designs.ts",
  "src/render-common/buildings/roman-design-kit.ts",
  "src/render-common/buildings/persian-mines.ts",
  "src/render-common/buildings/persian-building-architecture.ts",
  "src/render-common/buildings/nation-kit-nubian-cupola.ts",
  "src/render-common/buildings/levels/level-chimney.ts",
  "src/render-common/buildings/levels/level-crown-nubian.ts",
  "src/render-common/buildings/nation-residence-kit.ts",
  "src/render-common/buildings/nation-japanese-headquarters.ts",
  "src/render-common/buildings/roman-harbor.ts",
  "src/render-common/buildings/roman-rural-designs.ts",
  "src/render-common/buildings/roman-logistics-mines.ts",
  "src/render-common/buildings/nation-drink-makers.ts",
  "src/render-common/buildings/maya-monument.ts",
  "src/render-common/buildings/persian-rounded-massing.ts",
  "src/render-common/buildings/nation-residences-viking-turf.ts",
  "src/render-common/buildings/roman-residences.ts",
  "src/render-common/buildings/advanced-material-designs.ts",
  "src/render-common/buildings/levels/level-crown-japanese.ts",
  "src/render-common/buildings/nation-residences-nubian.ts",
  "src/render-common/buildings/nation-woodcutter-designs.ts",
  "src/render-common/buildings/roman-furnaces.ts",
  "src/render-common/buildings/building-recipe.ts",
  "src/render-common/buildings/indigenous-well-parts.ts",
  "src/render-common/buildings/nation-well-designs.ts",
  "src/render-common/buildings/persian-well.ts",
  "src/render-common/buildings/indigenous-building-recipe.ts",
  "src/renderers/three/buildings/window-shadow-geometry.ts",
  "src/render-common/buildings/levels/level-roof-vent.ts",
  "src/render-common/buildings/levels/level-dormer.ts",
  "src/renderers/three/buildings/roman-building.ts",
  "src/renderers/three/buildings/window-shadow-material.ts",
  "tools/bench/firebox-cavity-review.ts"
];
const hashes = () => Object.fromEntries(sources.map(path => [path,
  createHash("sha256").update(readFileSync(path)).digest("hex")]));
const before = hashes(), results: unknown[] = [], errors: string[] = [], files: string[] = [];
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const watchdog = setTimeout(() => { void browser?.close().catch(() => {}); }, 180_000);
try {
  browser = await launchBrowser();
  for (const nation of ["roman", "chinese", "indigenous"]) for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript("window.__name=value=>value;");
    await page.goto(`${url}building-showcase.html?sample=1&nation=${nation}&quality=${quality}`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady));
    const cases = ({ roman: [[26, 1]], chinese: [[32, 1], [26, 1]], indigenous: [[32, 1]] } as Record<string, number[][]>)[nation]!;
    for (const [id, level] of cases) for (const close of [true]) {
      const result = await page.evaluate(async ({ close, id, level, nation, quality }) => {
        const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
        const p = (window as any).__buildingPreview;
        p.renderer.setAnimationLoop(null); p.controls.enabled = false;
        p.selectBuilding(id, level); await (window as any).__buildingResidentReady;
        const model = p.model(); model.update(0, { construction: 1, door: 0, working: false });
        model.root.updateMatrixWorld(true);
        const box = new three.Box3().setFromObject(model.root), size = box.getSize(new three.Vector3());
        const center = box.getCenter(new three.Vector3()), camera = p.camera.clone();
        camera.aspect = 1100 / 900; camera.updateProjectionMatrix();
        let distance = size.length() / 2 / Math.sin(camera.fov * Math.PI / 360) * 1.1;
        const recipes = await import(/* @vite-ignore */ String("/src/render-common/buildings/levels/leveled-building-recipe.ts"));
        const catalog = await import(/* @vite-ignore */ String("/src/render-common/buildings/building-catalog.ts"));
        const recipe = recipes.leveledBuildingRecipe(catalog.getBuildingDefinition(id), nation, quality === "high", level);
        const mouth = recipe.parts.find((part: any) => part.fireboxMouth);
        if (!mouth) throw new Error("Actual oven mouth metadata missing");
        center.set(...mouth.windowOpeningPosition); model.root.localToWorld(center); distance = 1.25;
        const origin = new three.Vector3(...mouth.windowOpeningPosition); origin.z += .08;
        const end = origin.clone(); end.z -= .08 + .2;
        model.root.localToWorld(origin); model.root.localToWorld(end);
        const ray = new three.Raycaster(origin, end.clone().sub(origin).normalize(), 0, origin.distanceTo(end));
        const occlusions = ray.intersectObject(model.root, true).filter((hit: any) => {
          if (hit.object.userData.windowShadow || !hit.object.isMesh || !hit.object.visible) return false;
          const materials = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
          return materials.some((material: any) => !material.transparent && material.opacity === 1);
        });
        if (occlusions.length) throw new Error("Opaque geometry still plugs the actual oven throat: " + occlusions[0].distance);
        camera.position.copy(center).addScaledVector(new three.Vector3(2, 1.2, 4).normalize(), distance);
        camera.lookAt(center); camera.updateMatrixWorld(true);
        p.renderer.render(p.scene, camera);
        let shadows = 0, opaqueMeshes = 0;
        model.root.traverse((object: any) => {
          if (!object.isMesh) return;
          if (!object.userData.windowShadow) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            opaqueMeshes += materials.filter((material: any) => !material.transparent && material.opacity === 1).length;
            return;
          }
          shadows++;
          if (object.material.opacity !== .5 || !object.material.transparent || object.material.color.getHex() !== 0 || object.material.depthWrite)
            throw new Error("A semantic window lost its exact shared alpha-black material");
        });
        if ([20, 31, 32].includes(id!) && shadows === 0) throw new Error("Named real opening has no semantic shadow mesh");
        if (!opaqueMeshes) throw new Error("Structural building materials lost their opacity");
        return { shadows, opaqueMeshes, realCavityRayClear: true, triangles: model.triangles(false), close, id, level };
      }, { close, id: id!, level: level!, nation, quality });
      const file = `${nation}-${quality}-${id}-l${level}-${close ? "close" : "front"}.png`;
      await page.screenshot({ path: resolve(output, file) }); files.push(file);
      results.push({ nation, quality, ...result });
      console.log(`${nation}/${quality}/${id}/L${level}/${close ? "close" : "front"}`);
    }
    await page.close();
  }
  assert.deepEqual(hashes(), before); assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ sourceHashes: before, errors, results, files }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<meta charset="utf-8"><title>Actual arched oven cavities</title>${
    files.map(file => `<figure><img style="width:700px;max-width:100%" src="${file}"><figcaption>${file}</figcaption></figure>`).join("")}`);
} catch (error) {
  writeFileSync(resolve(output, "failure.json"), JSON.stringify({ error: String(error), errors, results, files }, null, 2));
  throw error;
} finally { clearTimeout(watchdog); await browser?.close(); await server.close(); }
