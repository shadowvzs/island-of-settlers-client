import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { gallerySourceGuard } from "./building-gallery-source";
import { resourcesPath } from "./resources-path";

/** Four native frames: actual Chinese brewery water quantities one/two, High/Minimal. */
const output = resourcesPath("project-reviews", "brewery-water-inputs-2026-11-04", "native-a");
mkdirSync(output, { recursive: true });
const guard = gallerySourceGuard(), errors: string[] = [], reports: unknown[] = [];
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
let status = "running";
try {
  browser = await launchBrowser();
  for (const detailed of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    page.on("request", request => guard.request(request.url()));
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/brewery-water-review.html", route => route.fulfill({ contentType: "text/html",
      body: "<body style='margin:0'></body>" }));
    await page.goto(`${url}brewery-water-review.html`);
    await page.evaluate(async detailed => {
      const imp = (path: string) => import(/* @vite-ignore */path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createNationBuildingMaterials } = await imp("/src/renderers/three/buildings/nation-building-materials.ts");
      const { createNationBuilding } = await imp("/src/renderers/three/buildings/nation-building.ts");
      const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
      const { getBuildingStockContact } = await imp("/src/render-common/buildings/building-stock-anchors.ts");
      const { isBuildingCourtyardPointConnected } = await imp("/src/render-common/buildings/building-courtyard.ts");
      const { nationTriangleBudget } = await imp("/src/render-common/buildings/building-triangle-budgets.ts");
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1100, 850); renderer.outputColorSpace = t.SRGBColorSpace;
      renderer.toneMapping = t.ACESFilmicToneMapping; document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#b9c0ac");
      scene.add(new t.HemisphereLight("#fff4df", "#63705d", 2.1));
      const sun = new t.DirectionalLight("#fff1db", 2.4); sun.position.set(4, 8, 6); scene.add(sun);
      const base = createRomanMaterials(detailed), pack = createNationBuildingMaterials(base.materials, "chinese", detailed);
      const model = createNationBuilding(getBuildingDefinition(23), pack.materials, "chinese", detailed, 1);
      model.fitToGrid(); scene.add(model.root);
      const ground = new t.Mesh(new t.PlaneGeometry(12, 12), new t.MeshStandardMaterial({ color: "#71805a" }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.008; scene.add(ground);
      const camera = new t.PerspectiveCamera(35, 1100 / 850, .01, 80);
      (window as any).breweryReview = {
        set: (count: number) => {
          const input = { water: count, grain: 1 }, output = { beer: 6 };
          model.update(0, { construction: 1, door: 0, working: false, inputStock: input, outputStock: output });
          model.root.updateMatrixWorld(true);
          const objects = [0, 1].map(slot => model.root.getObjectByName(`stock_input_${slot}_water`));
          if (objects.filter(object => object?.visible).length !== count) throw new Error("Wrong visible water count");
          const grain = new t.Box3().setFromObject(model.root.getObjectByName("stock_input_0_grain"));
          const boxes: any[] = [], units = [];
          for (let slot = 0; slot < count; slot++) {
            const object = objects[slot], box = new t.Box3().setFromObject(object); boxes.push(box);
            if (box.intersectsBox(grain)) throw new Error("Water intersects grain input");
            const contact = getBuildingStockContact(23, "input", "water", slot, 0, 0, 0, 0, input, output,
              { nation: "chinese", level: 1 });
            if (!contact || contact.slot !== slot) throw new Error("Clamped incoming water contact");
            if (!isBuildingCourtyardPointConnected(23, 0, 0, 0,
              { x: contact.approach[0], z: contact.approach[2] }, output, input, { nation: "chinese", level: 1 }))
              throw new Error("Disconnected actual delivery approach");
            units.push({ slot, min: box.min.toArray(), max: box.max.toArray(), contact });
          }
          if (count === 2 && boxes[0].intersectsBox(boxes[1])) throw new Error("Actual handled buckets overlap");
          if (count === 1) {
            const next = getBuildingStockContact(23, "input", "water", 1, 0, 0, 0, 0, input, output,
              { nation: "chinese", level: 1 });
            if (next?.slot !== 1) throw new Error("Second delivery clamps onto first place");
          }
          const triangles = model.triangles(false), budget = nationTriangleBudget("chinese", 23)[detailed ? 0 : 1];
          if (triangles > budget) throw new Error(`Triangle budget exceeded: ${triangles}/${budget}`);
          return { count, units, triangles, budget };
        },
        draw: () => {
          const bounds = new t.Box3();
          for (const name of ["stock_input_0_water", "stock_input_1_water", "stock_input_0_grain"])
            bounds.union(new t.Box3().setFromObject(model.root.getObjectByName(name)));
          const centre = bounds.getCenter(new t.Vector3()), size = bounds.getSize(new t.Vector3());
          const distance = Math.max(1.15, size.length() * 2);
          camera.position.copy(centre).add(new t.Vector3(distance * 1.2, distance * .62, distance * .65));
          camera.lookAt(centre); renderer.render(scene, camera); renderer.getContext().finish();
        },
        dispose: () => { model.dispose(); pack.dispose(); base.dispose(); ground.geometry.dispose();
          ground.material.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
      };
    }, detailed);
    for (const count of [0, 1, 2, 1, 0]) {
      const state = await page.evaluate(count => (window as any).breweryReview.set(count), count);
      if (reports.filter((row: any) => row.detailed === detailed && row.count === count).length === 0 && count > 0) {
        await page.evaluate(() => (window as any).breweryReview.draw());
        await page.screenshot({ path: resolve(output, `${detailed ? "high" : "minimal"}-water-${count}.png`) });
      }
      reports.push({ detailed, ...state });
    }
    await page.evaluate(() => (window as any).breweryReview.dispose());
    await page.close();
  }
  assert.deepEqual(errors, []);
  status = "passed";
} finally {
  await browser?.close();
  await server.close();
  const source = guard.finish();
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, reports, errors, source,
    scope: "Actual original Chinese High/Minimal brewery and handled national stock meshes; input visibility and canonical delivery-contact transitions, no full-island transport actors." }, null, 2));
  assert(source.stable, source.errors.join("\n"));
}
console.log("Brewery water native proof FULLCLOSED: four frames, ten visibility/contact states.");
