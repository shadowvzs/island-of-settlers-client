import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const run = process.argv[2] ?? "native-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "japanese-interior-floors-2026-11-04", run);
assert(!existsSync(resolve(output, "report.json")), "Preserve previous native receipts");
mkdirSync(output, { recursive: true });
const sources = ["src/render-common/buildings/japanese-interior-floors.ts",
  "src/render-common/buildings/nation-building-recipe.ts", "src/render-common/buildings/building-recipe.ts",
  "src/renderers/three/buildings/interior-floor-faces.ts", "src/renderers/three/buildings/roman-building.ts",
  "src/renderers/three/buildings/cultural-timber-surface-detail.ts", "tools/bench/japanese-floor-review.ts"];
const hashes = () => Object.fromEntries(sources.map(path => [path,
  createHash("sha256").update(readFileSync(path)).digest("hex")]));
const before = hashes(), rows: unknown[] = [], errors: string[] = [];
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  for (const detailed of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/japanese-floor-review.html", route => route.fulfill({
      body: "<body style='margin:0'></body>", contentType: "text/html"
    }));
    await page.goto(`${url}japanese-floor-review.html`);
    await page.evaluate(async detailed => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
      const { leveledBuildingRecipe } = await imp("/src/render-common/buildings/levels/leveled-building-recipe.ts");
      const { getRomanPartBounds } = await imp("/src/render-common/buildings/building-recipe-fit.ts");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createNationBuildingMaterials } = await imp("/src/renderers/three/buildings/nation-building-materials.ts");
      const { createRomanBuilding } = await imp("/src/renderers/three/buildings/roman-building.ts");
      const { isJapaneseInteriorFloor } = await imp("/src/render-common/buildings/japanese-interior-floors.ts");
      const base = createRomanMaterials(detailed);
      const pack = createNationBuildingMaterials(base.materials, "japanese", detailed);
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1100, 850); renderer.setPixelRatio(1); renderer.outputColorSpace = t.SRGBColorSpace;
      renderer.toneMapping = t.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
      document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#c6cbb9");
      scene.add(new t.HemisphereLight("#fff4df", "#7b8069", 2.5));
      const sun = new t.DirectionalLight("#fff3df", 3); sun.position.set(-3, 7, 5); scene.add(sun);
      const ground = new t.Mesh(new t.PlaneGeometry(40, 40), new t.MeshStandardMaterial({ color: "#a0a982" }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.02; scene.add(ground);
      const camera = new t.PerspectiveCamera(34, 1100 / 850, .01, 80);
      let model: any;
      (window as any).floorReview = {
        draw: (id: number, cutaway: boolean) => {
          model?.root.removeFromParent();
          model?.dispose();
          const definition = getBuildingDefinition(id), recipe = leveledBuildingRecipe(definition, "japanese", detailed, 1);
          const selected = cutaway ? { ...recipe, hideDoor: true, hideFlag: true,
            parts: recipe.parts.filter((part: any) => !part.stock && getRomanPartBounds(part).max[1] <= .32) } : recipe;
          model = createRomanBuilding(definition, pack.materials, detailed, selected, "japanese");
          model.root.userData.reviewFloorModel = true;
          model.update(0, { construction: 1, door: 1, working: false }); scene.add(model.root);
          if (scene.children.filter((object: any) => object.userData.reviewFloorModel).length !== 1)
            throw new Error("Floor review retained an obsolete model owner");
          if (cutaway) for (const child of model.root.children)
            if (!child.name.startsWith("construction_")) child.visible = false;
          const box = new t.Box3().setFromObject(model.root), size = box.getSize(new t.Vector3());
          const center = box.getCenter(new t.Vector3()), reach = Math.max(size.x, size.y, size.z);
          if (cutaway) {
            const floors = recipe.parts.filter((part: any) => isJapaneseInteriorFloor(part) || part.interiorFloorFaces === "top");
            const floorBox = new t.Box3();
            for (const part of floors) {
              const bounds = getRomanPartBounds(part);
              floorBox.expandByPoint(new t.Vector3(...bounds.min)); floorBox.expandByPoint(new t.Vector3(...bounds.max));
            }
            floorBox.getCenter(center);
            const span = Math.max(floorBox.getSize(new t.Vector3()).x, floorBox.getSize(new t.Vector3()).z);
            camera.position.copy(center).add(new t.Vector3(span * .44, span * 1.45, span * 1.1));
          } else camera.position.copy(center).add(new t.Vector3(reach * .60, reach * .34, reach * 1.8));
          camera.lookAt(center); renderer.render(scene, camera);
          return { triangles: model.triangles(false), calls: renderer.info.render.calls,
            floors: recipe.parts.filter((part: any) => isJapaneseInteriorFloor(part) || part.interiorFloorFaces === "top")
              .map((part: any) => ({ position: part.position, size: part.size, surface: part.surface, worldUv: part.worldUv,
                interiorFloorFaces: part.interiorFloorFaces })) };
        },
        dispose: () => {
          model?.root.removeFromParent(); model?.dispose(); pack.dispose(); base.dispose();
          ground.geometry.dispose(); ground.material.dispose();
          renderer.dispose(); renderer.forceContextLoss();
        }
      };
    }, detailed);
    for (const id of [0, 20, 62, 4, 9, 16]) for (const cutaway of [false, true]) {
      const stats = await page.evaluate(({ cutaway, id }) => (window as any).floorReview.draw(id, cutaway), { id, cutaway });
      assert(stats.floors.length > 0 && stats.floors.every((part: any) => part.surface === "planks" && part.worldUv === 1));
      const name = `${detailed ? "high" : "minimal"}-${id}-${cutaway ? "cutaway" : "front"}`;
      await page.screenshot({ path: resolve(output, `${name}.png`) }); rows.push({ name, id, detailed, cutaway, ...stats });
    }
    await page.evaluate(() => (window as any).floorReview.dispose());
    await page.close();
  }
  assert.deepEqual(errors, []);
  const after = hashes(); assert.deepEqual(after, before, "Source changes invalidate a mixed-state native receipt");
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ rows, errors, sourceHashes: before,
    scope: "Canonical actual models and separately labelled roof/upper-wall-hidden diagnostic geometry; no runtime cutaway feature.",
    visualInspectionRequired: true }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<meta charset="utf-8"><title>Japanese interior floors</title>
    <style>body{background:#242922;color:white;font:16px sans-serif}img{max-width:96vw;width:1000px}</style>
    <h1>Japanese floors — actual models and explicit diagnostic cutaways</h1>${rows.map((row: any) =>
    `<figure><figcaption>${row.name}</figcaption><img src="${row.name}.png"></figure>`).join("")}`);
  console.log(`Japanese floors CLOSED: ${rows.length} frames, ${output}`);
} finally { await browser.close(); await server.close(); }
