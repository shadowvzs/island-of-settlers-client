import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { WISTERIA_TRIANGLE_BUDGET } from "../../src/render-common/road-decoration-wisteria";
import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "unregistered-additions-a";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid review run name");
const output = resolve("../resources/project-reviews/road-decoration-prototypes-2026-11-03", run);
const requested = process.argv.find(argument => argument.startsWith("--ids="))?.slice(6).split(",");
const cases = [
  { id: "japanese-wooden-lantern", kind: "wood", nation: "japanese" },
  { id: "chinese-wooden-lantern", kind: "wood", nation: "chinese" },
  ...["limestone", "granite", "marble"].map(finish => ({ id: `rubble-mortar-${finish}`, kind: "rubble", finish })),
  ...["curved", "lattice", "pergola"].map(frame => ({ id: `wisteria-${frame}-purple`, kind: "wisteria", frame, palette: "purple" })),
  ...["lilac", "white", "pink", "blue"].map(palette => ({ id: `wisteria-curved-${palette}`, kind: "wisteria", frame: "curved", palette }))
].filter(choice => !requested || requested.includes(choice.id));
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const detailed of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } }), errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/road-decoration-additions.html", route => route.fulfill({ body: "<body style='margin:0'></body>", contentType: "text/html" }));
    await page.goto(`${url}road-decoration-additions.html`);
    await page.evaluate(async detailed => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createNationBuildingMaterials } = await imp("/src/renderers/three/buildings/nation-building-materials.ts");
      const { createRoadDecorationModel } = await imp("/src/renderers/three/road-decoration-model.ts");
      const { createWoodenRoadLanternModel } = await imp("/src/renderers/three/road-decoration-wood-lantern.ts");
      const { createRubbleRoadArchRecipe } = await imp("/src/render-common/road-decoration-rubble.ts");
      const { createWisteriaRoadTemplates } = await imp("/src/renderers/three/road-decoration-wisteria-templates.ts");
      const { createThreeRoads } = await imp("/src/renderers/three/settlement/three-roads.ts");
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1000, 760); renderer.setPixelRatio(1); renderer.outputColorSpace = t.SRGBColorSpace;
      renderer.toneMapping = t.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = detailed; document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#c1c9b1");
      scene.add(new t.HemisphereLight("#fff2d8", "#6b785c", 2.2));
      const sun = new t.DirectionalLight("#fff0d6", 2.6); sun.position.set(-3, 7, 5); sun.castShadow = detailed;
      sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 5, bottom: -4, near: .1, far: 20 });
      sun.shadow.normalBias = .012; scene.add(sun);
      const ground = new t.Mesh(new t.PlaneGeometry(40, 40), new t.MeshStandardMaterial({ color: "#8d9970", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.012; ground.receiveShadow = true; scene.add(ground);
      const world = { cellsX: 16, cellsZ: 16, heights: new Float32Array(17 ** 2), blocking: new Uint8Array(16 ** 2), buildRevision: 0, terrainRevision: 0 };
      const roads = createThreeRoads(world, detailed ? "high" : "minimal");
      roads.update([{ start: { x: 8, z: 0 }, end: { x: 8, z: 16 }, tier: "stone" }]); roads.root.position.set(-8, 0, -8); scene.add(roads.root);
      const base = createRomanMaterials(detailed), packs = new Map<string, any>();
      const wisteria = createWisteriaRoadTemplates(base.materials, detailed);
      const camera = new t.PerspectiveCamera(35, 1000 / 760, .03, 60);
      let model: any = null, bounds: any;
      (window as any).additions = {
        select: (choice: any) => {
          model?.dispose();
          if (choice.kind === "wisteria") model = wisteria.instantiate(choice.frame, choice.palette);
          else if (choice.kind === "rubble") model = createRoadDecorationModel(createRubbleRoadArchRecipe(detailed, choice.finish), base.materials, detailed);
          else {
            if (!packs.has(choice.nation)) packs.set(choice.nation, createNationBuildingMaterials(base.materials, choice.nation, detailed));
            model = createWoodenRoadLanternModel(choice.nation, detailed, packs.get(choice.nation).materials);
            model.root.position.x = 1;
          }
          scene.add(model.root); bounds = new t.Box3().setFromObject(model.root);
          return { triangles: model.triangles, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, shared: wisteria.statistics() };
        },
        draw: (view: string) => {
          const center = bounds.getCenter(new t.Vector3()), size = bounds.getSize(new t.Vector3()), distance = Math.max(size.y, size.x) * 2.3;
          camera.position.copy(center).add(new t.Vector3(view === "oblique" ? distance * .64 : 0,
            view === "oblique" ? distance * .35 : 0, distance)); camera.lookAt(center); renderer.render(scene, camera);
          return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
        },
        dispose: () => { model?.dispose(); wisteria.dispose(); roads.dispose(); for (const pack of packs.values()) pack.dispose(); base.dispose();
          ground.geometry.dispose(); ground.material.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
      };
    }, detailed);
    const budgets: Record<string, number> = detailed ? { wood: 3500, rubble: 7000, wisteria: WISTERIA_TRIANGLE_BUDGET.high }
      : { wood: 1000, rubble: 1800, wisteria: WISTERIA_TRIANGLE_BUDGET.minimal };
    for (const choice of cases) {
      const metadata = await page.evaluate(choice => (window as any).additions.select(choice), choice);
      assert(metadata.triangles <= budgets[choice.kind]!, `${choice.id} budget`);
      for (const view of ["front", "oblique"]) {
        const stats = await page.evaluate(view => (window as any).additions.draw(view), view);
        const name = `${detailed ? "high" : "minimal"}-${choice.id}-${view}`;
        await page.screenshot({ path: resolve(output, `${name}.png`) }); reports.push({ name, ...metadata, stats });
      }
    }
    await page.evaluate(() => (window as any).additions.dispose()); assert.deepEqual(errors, []); await page.close();
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status: "unregistered visual candidates; acceptance pending", reports }, null, 2));
  console.log(`Captured ${reports.length} unregistered road-decoration views in ${output}`);
} finally { await browser.close(); await server.close(); }
