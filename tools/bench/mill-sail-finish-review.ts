import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/** Isolated canonical rotor art, intentionally independent of in-flight building-stock packing. */
const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "isolated-a";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid mill review run name");
const output = resolve("../resources/project-reviews/mill-sail-finish-2026-11-03", run);
mkdirSync(output, { recursive: true });
const nations = ["roman", "viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous"];
const reports: unknown[] = [], errors: string[] = [];
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  for (const detailed of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/mill-sail-finish.html", route => route.fulfill({ body: "<body style='margin:0'></body>", contentType: "text/html" }));
    await page.goto(`${url}mill-sail-finish.html`);
    await page.evaluate(async detailed => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createNationBuildingMaterials } = await imp("/src/renderers/three/buildings/nation-building-materials.ts");
      const { createNationalMillMechanism } = await imp("/src/renderers/three/buildings/national-mill-mechanism.ts");
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1000, 760); renderer.setPixelRatio(1); renderer.outputColorSpace = t.SRGBColorSpace;
      renderer.toneMapping = t.ACESFilmicToneMapping; document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#aeb9ab");
      scene.add(new t.HemisphereLight("#fff3df", "#65705a", 2.4));
      const sun = new t.DirectionalLight("#fff3df", 2.2); sun.position.set(-3, 5, 5); scene.add(sun);
      const camera = new t.PerspectiveCamera(35, 1000 / 760, .01, 80), base = createRomanMaterials(detailed);
      let root: any, pack: any;
      const release = () => {
        if (root) {
          root.traverse((node: any) => {
            if (!node.isMesh) return;
            node.geometry.dispose();
            if (node.userData.ownedMap) node.material.map?.dispose();
            if (node.userData.ownedMaterial) node.material.dispose();
          }); root.removeFromParent(); root = null;
        }
        pack?.dispose(); pack = null;
      };
      (window as any).review = {
        select: (nation: string) => {
          release(); pack = createNationBuildingMaterials(base.materials, nation, detailed);
          root = createNationalMillMechanism(pack.materials, detailed, nation); scene.add(root);
          root.rotation.z = .18;
          let triangles = 0;
          root.traverse((node: any) => { if (node.isMesh) triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3; });
          return { triangles };
        },
        draw: (gameplay: boolean) => {
          camera.position.set(gameplay ? 2.5 : .5, gameplay ? 2.2 : .1, gameplay ? 8 : 5.8);
          camera.lookAt(0, 0, 0); renderer.render(scene, camera);
          return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
        },
        dispose: () => { release(); base.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
      };
    }, detailed);
    for (const nation of nations) {
      const metrics = await page.evaluate(nation => (window as any).review.select(nation), nation);
      for (const view of ["close", "gameplay"]) {
        const stats = await page.evaluate(gameplay => (window as any).review.draw(gameplay), view === "gameplay");
        const name = `${detailed ? "high" : "minimal"}-${nation}-${view}`;
        await page.screenshot({ path: resolve(output, `${name}.png`) }); reports.push({ name, metrics, stats });
      }
    }
    await page.evaluate(() => (window as any).review.dispose()); await page.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status: "isolated rotor only; full building art pending", reports }, null, 2));
  console.log(`Captured ${reports.length} isolated rotor images`);
} finally { await browser.close(); await server.close(); }
