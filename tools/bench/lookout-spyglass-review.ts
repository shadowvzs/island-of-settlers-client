import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "native-a";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid review run name");
const output = resolve("../resources/project-reviews/lookout-spyglass-2026-11-03", run);
mkdirSync(output, { recursive: true });
const reports: unknown[] = [], errors: string[] = [];
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  for (const detailed of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/lookout-spyglass.html", route => route.fulfill({ body: "<body style='margin:0'></body>", contentType: "text/html" }));
    await page.goto(`${url}lookout-spyglass.html`);
    await page.evaluate(async detailed => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createNationBuildingMaterials } = await imp("/src/renderers/three/buildings/nation-building-materials.ts");
      const { createNationBuilding } = await imp("/src/renderers/three/buildings/nation-building.ts");
      const { getBuildingDefinition } = await imp("/src/render-common/buildings/building-catalog.ts");
      const { createBuildingRoadMarkers } = await imp("/src/renderers/three/buildings/building-road-marker.ts");
      const { createLookoutSpyglassMaterial } = await imp("/src/renderers/three/buildings/lookout-spyglass-material.ts");
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(900, 700); renderer.setPixelRatio(1); renderer.outputColorSpace = t.SRGBColorSpace;
      renderer.toneMapping = t.ACESFilmicToneMapping; document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#b6c0ae");
      scene.add(new t.HemisphereLight("#fff3df", "#65705a", 2.4));
      const sun = new t.DirectionalLight("#fff0d6", 2.3); sun.position.set(-3, 7, 5); scene.add(sun);
      const ground = new t.Mesh(new t.PlaneGeometry(40, 40), new t.MeshStandardMaterial({ color: "#8d9970", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.012; scene.add(ground);
      const camera = new t.PerspectiveCamera(35, 900 / 700, .01, 80), base = createRomanMaterials(detailed);
      const markers = createBuildingRoadMarkers(), marker = markers.create(); scene.add(marker);
      let model: any, pack: any, sign: any;
      const release = () => { model?.dispose(); model = null; pack?.dispose(); pack = null; };
      (window as any).review = {
        select: async (nation: string) => {
          release(); sign = null; pack = createNationBuildingMaterials(base.materials, nation, detailed);
          model = createNationBuilding(getBuildingDefinition(14), pack.materials, nation, detailed, 1);
          scene.add(model.root); model.update(0, { construction: 1, door: 0, working: false });
          markers.update(marker, { type: 14, id: "1", x: 0, y: 0, z: 0, rotation: 0, nation,
            construction: 1, working: false });
          const probe = createLookoutSpyglassMaterial(), texture = probe.map; probe.dispose();
          model.root.traverse((node: any) => { if (node.isMesh && node.material.map === texture) sign = node; });
          if (!sign) throw new Error(`Missing actual ${nation} facade spyglass`);
          const started = performance.now();
          while (!texture.image?.complete) {
            if (performance.now() - started > 10000) throw new Error("Spyglass bitmap did not load");
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          await texture.image.decode();
          return { triangles: model.triangles(false), textureWidth: texture.image.naturalWidth };
        },
        draw: (view: string) => {
          const subject = view === "post" ? marker.getObjectByName("building_signpost_icon_front") : sign;
          let bounds = new t.Box3().setFromObject(subject), centre = bounds.getCenter(new t.Vector3());
          if (view === "gameplay") {
            bounds = new t.Box3().setFromObject(model.root).union(new t.Box3().setFromObject(marker));
            centre = bounds.getCenter(new t.Vector3());
            const distance = bounds.getSize(new t.Vector3()).length() * 1.6;
            camera.position.copy(centre).add(new t.Vector3(distance * .6, distance * .45, distance));
          } else {
            const distance = bounds.getSize(new t.Vector3()).length() * 2;
            camera.position.copy(centre).add(new t.Vector3(0, .02, distance));
          }
          camera.lookAt(centre); renderer.render(scene, camera);
          return { calls: renderer.info.render.calls };
        },
        dispose: () => { release(); markers.dispose(); base.dispose(); ground.geometry.dispose(); ground.material.dispose();
          renderer.dispose(); renderer.forceContextLoss(); }
      };
    }, detailed);
    for (const nation of ["roman", "viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous"]) {
      const metrics = await page.evaluate(nation => (window as any).review.select(nation), nation);
      for (const view of ["facade", "post", "gameplay"]) {
        const stats = await page.evaluate(view => (window as any).review.draw(view), view);
        const name = `${detailed ? "high" : "minimal"}-${nation}-${view}`;
        await page.screenshot({ path: resolve(output, `${name}.png`) }); reports.push({ name, metrics, stats });
      }
    }
    await page.evaluate(() => (window as any).review.dispose()); await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ reports, errors }, null, 2));
  console.log(`Captured ${reports.length} actual lookout facade/post/gameplay images`);
} finally { await browser.close(); await server.close(); }
