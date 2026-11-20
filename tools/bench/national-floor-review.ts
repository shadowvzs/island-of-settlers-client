import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const run = process.argv[2] ?? "native-a";
const onlyNation = process.argv[3];
assert(onlyNation === undefined || ["persian", "indigenous", "repair"].includes(onlyNation));
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "national-floor-coverage-2026-11-04", run);
assert(!existsSync(resolve(output, "report.json")), "Preserve previous native receipts");
mkdirSync(output, { recursive: true });
const sources = ["src/render-common/buildings/japanese-interior-floors.ts",
  "src/render-common/buildings/nation-building-recipe.ts", "src/render-common/buildings/building-recipe.ts",
  "src/renderers/three/buildings/interior-floor-faces.ts", "src/renderers/three/buildings/roman-building.ts",
  "src/renderers/three/buildings/cultural-timber-surface-detail.ts", "tools/bench/national-floor-review.ts", "src/render-common/buildings/national-interior-floors.ts",
  "src/render-common/buildings/building-interior-floors.ts", "src/render-common/buildings/persian-room-dimensions.ts"];
if (onlyNation === "indigenous") sources.push("src/render-common/buildings/indigenous-floor-hides.ts",
  "src/render-common/props/indigenous-floor-hide-profile.ts",
  "src/renderers/three/buildings/indigenous-floor-hide-geometry.ts",
  "src/renderers/three/buildings/indigenous-floor-hide-material.ts");
const hashes = () => Object.fromEntries(sources.map(path => [path,
  createHash("sha256").update(readFileSync(path)).digest("hex")]));
const before = hashes(), rows: unknown[] = [], errors: string[] = [];
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  let nations = ["chinese", "persian", "maya", "nubian", "viking"];
  if (onlyNation === "indigenous") nations = ["indigenous"];
  if (onlyNation === "repair") nations = ["chinese", "persian"];
  for (const nation of nations.filter(nation => !onlyNation || onlyNation === "repair" || nation === onlyNation))
    for (const detailed of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/japanese-floor-review.html", route => route.fulfill({
      body: "<body style='margin:0'></body>", contentType: "text/html"
    }));
    await page.goto(`${url}japanese-floor-review.html`);
    await page.evaluate(async ({ detailed, nation }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
      const { leveledBuildingRecipe } = await imp("/src/render-common/buildings/levels/leveled-building-recipe.ts");
      const { getRomanPartBounds } = await imp("/src/render-common/buildings/building-recipe-fit.ts");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createNationBuildingMaterials } = await imp("/src/renderers/three/buildings/nation-building-materials.ts");
      const { createRomanBuilding, createRomanPartGeometry } = await imp("/src/renderers/three/buildings/roman-building.ts");
      const { getBuildingInteriorFloorSites } = await imp("/src/render-common/buildings/building-interior-floors.ts");
      const base = createRomanMaterials(detailed);
      const pack = createNationBuildingMaterials(base.materials, nation, detailed);
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
        draw: (id: number, cutaway: boolean, macro = false) => {
          model?.root.removeFromParent();
          model?.dispose();
          const definition = getBuildingDefinition(id), recipe = leveledBuildingRecipe(definition, nation, detailed, 1);
          const authoredFloors = nation === "indigenous"
            ? recipe.parts.filter((part: any) => part.shape === "indigenous-floor-hide")
            : getBuildingInteriorFloorSites(recipe, id).map((site: any) => site.part);
          for (const floor of authoredFloors) {
            const geometry = createRomanPartGeometry(floor, detailed);
            const count = geometry.index?.count ?? geometry.getAttribute("position").count; geometry.dispose();
            if (!count) throw new Error("An actual authored floor lost all of its render triangles");
          }
          const floorCeiling = Math.max(...authoredFloors.map((part: any) => part.position[1] + part.size[1] / 2)) + .08;
          const selected = cutaway ? { ...recipe, hideDoor: true, hideFlag: true,
            parts: recipe.parts.filter((part: any) => !part.stock && getRomanPartBounds(part).max[1] <= floorCeiling) } : recipe;
          model = createRomanBuilding(definition, pack.materials, detailed, selected, nation);
          model.root.userData.reviewFloorModel = true;
          model.update(0, { construction: 1, door: 1, working: false }); scene.add(model.root);
          if (scene.children.filter((object: any) => object.userData.reviewFloorModel).length !== 1)
            throw new Error("Floor review retained an obsolete model owner");
          if (cutaway) for (const child of model.root.children)
            if (!child.name.startsWith("construction_")) child.visible = false;
          const box = new t.Box3().setFromObject(model.root), size = box.getSize(new t.Vector3());
          const center = box.getCenter(new t.Vector3()), reach = Math.max(size.x, size.y, size.z);
          if (cutaway) {
            const floors = authoredFloors;
            const floorBox = new t.Box3();
            for (const part of floors) {
              const bounds = getRomanPartBounds(part);
              floorBox.expandByPoint(new t.Vector3(...bounds.min)); floorBox.expandByPoint(new t.Vector3(...bounds.max));
            }
            floorBox.getCenter(center);
            const span = Math.max(floorBox.getSize(new t.Vector3()).x, floorBox.getSize(new t.Vector3()).z);
            if (macro) camera.position.copy(center).add(new t.Vector3(span * .22, span * .48, span * .68));
            else camera.position.copy(center).add(new t.Vector3(span * .44, span * 1.45, span * 1.1));
          } else camera.position.copy(center).add(new t.Vector3(reach * .60, reach * .34, reach * 1.8));
          camera.lookAt(center); renderer.render(scene, camera);
          return { triangles: model.triangles(false), calls: renderer.info.render.calls,
            memory: { ...renderer.info.memory },
            floors: authoredFloors
              .map((part: any) => ({ shape: part.shape, position: part.position, size: part.size,
                surface: part.surface, worldUv: part.worldUv,
                interiorFloorFaces: part.interiorFloorFaces })) };
        },
        exportHide: async () => {
          const { GLTFExporter } = await imp("/node_modules/three/examples/jsm/exporters/GLTFExporter.js");
          const { GLTFLoader } = await imp("/node_modules/three/examples/jsm/loaders/GLTFLoader.js");
          let mesh: any;
          model.root.traverse((object: any) => {
            if (object.isMesh && object.userData.ownedMaterial && object.userData.buildingSurface === "hide") mesh = object;
          });
          if (!mesh) throw new Error("Actual model has no owned floor-hide batch");
          const bytes = await new GLTFExporter().parseAsync(mesh, { binary: true });
          const loaded = await new GLTFLoader().parseAsync(bytes, "");
          let meshes = 0, textureSize = 0, normal = false;
          loaded.scene.traverse((object: any) => {
            if (!object.isMesh) return;
            meshes++; textureSize = object.material.map?.image?.width ?? 0;
            normal = Boolean(object.material.normalMap);
            object.geometry.dispose(); object.material.map?.dispose(); object.material.normalMap?.dispose();
            object.material.dispose();
          });
          if (meshes !== 1 || textureSize !== (detailed ? 512 : 256) || normal !== detailed)
            throw new Error("Floor hide GLB roundtrip lost its real contour or fur maps");
          return { bytes: bytes.byteLength, meshes, textureSize, normal };
        },
        dispose: () => {
          model?.root.removeFromParent(); model?.dispose(); pack.dispose(); base.dispose();
          ground.geometry.dispose(); ground.material.dispose();
          renderer.dispose(); renderer.forceContextLoss();
        }
      };
    }, { detailed, nation });
    const reviewIds: Record<string, number[]> = { chinese: [4], persian: [0, 20], maya: [0], nubian: [62],
      viking: [62], indigenous: [0, 7, 20, 33] };
    if (onlyNation === "repair") reviewIds.chinese = [16];
    const views = nation === "indigenous" ? ["front", "cutaway", "fur"] : ["front", "cutaway"];
    for (const id of reviewIds[nation]!) for (const view of views) {
      const cutaway = view !== "front", macro = view === "fur";
      const stats = await page.evaluate(({ cutaway, id, macro }) => (window as any).floorReview.draw(id, cutaway, macro),
        { id, cutaway, macro });
      assert(stats.floors.length > 0 && stats.floors.every((part: any) => nation === "indigenous"
        ? part.shape === "indigenous-floor-hide" : part.worldUv === 1));
      const name = `${nation}-${detailed ? "high" : "minimal"}-${id}-${view}`;
      await page.screenshot({ path: resolve(output, `${name}.png`) }); rows.push({ name, nation, id, detailed, cutaway, ...stats });
    }
    if (nation === "indigenous") {
      const cycles = await page.evaluate(() => Array.from({ length: 8 }, () =>
        (window as any).floorReview.draw(20, true).memory));
      for (const cycle of cycles.slice(3)) assert.deepEqual(cycle, cycles[2], "Repeated floor owners must plateau");
      const exported = await page.evaluate(() => (window as any).floorReview.exportHide());
      rows.push({ lifecycle: cycles, exported, nation, detailed });
    }
    await page.evaluate(() => (window as any).floorReview.dispose());
    await page.close();
  }
  assert.deepEqual(errors, []);
  const after = hashes(); assert.deepEqual(after, before, "Source changes invalidate a mixed-state native receipt");
  const screenshots = rows.filter((row: any) => typeof row.name === "string");
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ rows, errors, sourceHashes: before,
    screenshots: screenshots.length,
    scope: "Canonical actual models and separately labelled roof/upper-wall-hidden diagnostic geometry; no runtime cutaway feature.",
    visualInspectionRequired: true }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<meta charset="utf-8"><title>National interior floors</title>
    <style>body{background:#242922;color:white;font:16px sans-serif}img{max-width:96vw;width:1000px}</style>
    <h1>National floors — actual models and explicit diagnostic cutaways</h1>${screenshots.map((row: any) =>
    `<figure><figcaption>${row.name}</figcaption><img src="${row.name}.png"></figure>`).join("")}`);
  console.log(`National floors CLOSED: ${screenshots.length} frames, ${rows.length - screenshots.length} lifecycle records, ${output}`);
} finally { await browser.close(); await server.close(); }
