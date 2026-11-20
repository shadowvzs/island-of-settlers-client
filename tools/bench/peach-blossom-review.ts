import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "native-a";
assert(/^[a-z0-9-]+$/.test(run));
const allowedViews = ["front", "oblique", "back", "paired", "palettes", "canopy", "far"];
const selectedViews = process.argv.find(argument => argument.startsWith("--views="))?.slice(8);
const views = selectedViews ? selectedViews.split(",") : allowedViews;
assert(views.length > 0 && views.every(view => allowedViews.includes(view)) && new Set(views).size === views.length);
const output = resolve("../resources/project-reviews/peach-blossom-2026-11-04", run);
mkdirSync(output, { recursive: true });
const sourceHashes = () => Object.fromEntries(["geometry", "materials", "model"].map(part => {
  const file = `src/renderers/three/plants/peach-blossom-${part}.ts`;
  return [file, createHash("sha256").update(readFileSync(resolve(file))).digest("hex")];
}));
const before = sourceHashes();
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [], errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/peach-blossom-review.html", route => route.fulfill({ contentType: "text/html",
    body: "<body style='margin:0'><div id='title' style='position:absolute;top:20px;left:20px;font:20px sans-serif'></div></body>" }));
  await page.goto(`${url}peach-blossom-review.html`);
  await page.evaluate(async () => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const t = await imp("/node_modules/three/build/three.module.js");
    const { createPeachBlossomFarGeometries, createPeachBlossomGeometries } =
      await imp("/src/renderers/three/plants/peach-blossom-geometry.ts");
    const { createPeachBlossomMaterials, createPeachPetalTextures } =
      await imp("/src/renderers/three/plants/peach-blossom-materials.ts");
    const { createPeachBlossomModel } = await imp("/src/renderers/three/plants/peach-blossom-model.ts");
    const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1100, 900); renderer.setPixelRatio(1); renderer.outputColorSpace = t.SRGBColorSpace;
    renderer.toneMapping = t.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
    document.body.append(renderer.domElement);
    const scene = new t.Scene(); scene.background = new t.Color("#c6cec3");
    scene.add(new t.HemisphereLight("#fff4e7", "#65705b", 2.1));
    const sun = new t.DirectionalLight("#fff3df", 2.8); sun.position.set(-2, 5, 3); scene.add(sun);
    const camera = new t.PerspectiveCamera(33, 1100 / 900, .001, 100);
    const texturePack = createPeachPetalTextures();
    const palettes = ["#f3a5c1", "#f7c5d6", "#fff4f5"].map(colour =>
      createPeachBlossomMaterials(colour, texturePack));
    const active: any[] = [];
    let source: any, twig: any;
    const clear = () => {
      active.splice(0).forEach(model => model.dispose());
      if (source) Object.values(source).forEach((geometry: any) => geometry.dispose());
      source = undefined;
      if (twig) { scene.remove(twig); twig.geometry.dispose(); twig.material.dispose(); twig = undefined; }
    };
    (window as any).__flower = {
      draw: (detailed: boolean, view: string) => {
        clear();
        const canopy = view === "canopy";
        const canonical = { position: [0, 0, 0], yaw: 0, pitch: 0, radius: 1, seed: 5 };
        source = view === "far" ? createPeachBlossomFarGeometries(canonical) :
          createPeachBlossomGeometries(canonical, detailed, canopy);
        const paired = view === "paired" || view === "palettes";
        let count = 1;
        if (paired) count = 2;
        if (view === "palettes") count = 3;
        for (let index = 0; index < count; index++) {
          const x = paired ? (index - (count - 1) / 2) * .125 : 0;
          const flower = { position: [x, 0, 0], yaw: index * .7, pitch: paired ? (index - .5) * .3 : 0,
            radius: paired ? .055 : .065, seed: 5 };
          const model = createPeachBlossomModel(flower, detailed,
            palettes[view === "palettes" ? index : 0].materials, source);
          scene.add(model.root); active.push(model);
        }
        if (paired) {
          twig = new t.Mesh(new t.CylinderGeometry(.004, .005, .38, detailed ? 8 : 5),
            new t.MeshStandardMaterial({ color: "#5f4634", roughness: .95 }));
          twig.rotation.z = Math.PI / 2; twig.position.y = -.003; scene.add(twig);
        }
        const distance = paired ? .56 : .29;
        camera.position.set(.025, distance, .025);
        if (view === "oblique" || canopy || view === "far") camera.position.set(.17, .17, .14);
        if (view === "back") camera.position.set(.04, -.26, .06);
        camera.lookAt(0, .013, 0); renderer.render(scene, camera);
        document.getElementById("title")!.textContent = `Separate peach flower — ${detailed ? "High" : "Minimal"} / ${view}`;
        return { detailed, view, models: active.length, modelTriangles: active[0].triangles,
          calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
          memory: { ...renderer.info.memory }, sharedGeometry: paired,
          opaquePetals: palettes[0].materials.petals.alphaTest === 0 && !palettes[0].materials.petals.transparent };
      },
      dispose: () => {
        clear(); palettes.forEach(pack => pack.dispose()); texturePack.dispose(); renderer.dispose();
      }
    };
  });
  for (const detailed of [true, false]) for (const view of views) {
    reports.push(await page.evaluate(({ detailed, view }) => (window as any).__flower.draw(detailed, view), { detailed, view }));
    await page.screenshot({ path: resolve(output, `${detailed ? "high" : "minimal"}-${view}.png`) });
  }
  await page.evaluate(() => (window as any).__flower.dispose());
  assert.deepEqual(errors, []); await page.close();
  const after = sourceHashes(); assert.deepEqual(after, before, "Flower sources changed during capture");
  writeFileSync(resolve(output, "report.json"), JSON.stringify({
    status: "private candidate, visual inspection required", sourceHashes: after, reports, errors
  }, null, 2));
  const figures = reports.map(row => {
    const { detailed, view } = row as { detailed: boolean; view: string };
    const file = `${detailed ? "high" : "minimal"}-${view}.png`;
    return `<figure><a href="${file}"><img src="${file}"></a><figcaption>${file}</figcaption></figure>`;
  });
  writeFileSync(resolve(output, "index.html"), `<!doctype html><title>Separate peach blossoms</title>
    <style>body{font:16px sans-serif;background:#252b29;color:#eee}main{display:grid;grid-template-columns:1fr 1fr}
    figure{margin:8px}img{width:100%}</style><h1>Separate true-3D peach flower candidates</h1><main>${figures.join("")}</main>`);
  console.log(`Captured ${reports.length} peach flower views in ${output}`);
} finally { await browser.close(); await server.close(); }
