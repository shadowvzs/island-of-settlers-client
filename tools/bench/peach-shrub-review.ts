import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "native-a";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid candidate review run");
const output = resolve("../resources/project-reviews/peach-shrub-2026-11-04", run);
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
const compositionOnly = process.argv.includes("--composition-only");
const peachOnly = compositionOnly || process.argv.includes("--peach-only");
try {
  for (const detailed of (compositionOnly ? [true] : [true, false])) {
    const errors: string[] = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/peach-shrub-review.html", route => route.fulfill({
      body: "<body style='margin:0'><div id='title' style='position:absolute;top:20px;left:24px;font:22px sans-serif'></div></body>",
      contentType: "text/html" }));
    await page.goto(`${url}peach-shrub-review.html`);
    await page.evaluate(async ({ detailed, peachOnly }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createFloweringPeachModel } = await imp("/src/renderers/three/plants/peach-tree-model.ts");
      let createRoadsideShrubModel: any, pack: any;
      if (!peachOnly) {
        const legacy = await imp("/src/renderers/three/plants/ornamental-broadleaf-model.ts");
        createRoadsideShrubModel = legacy.createRoadsideShrubModel;
        pack = legacy.createOrnamentalBroadleafMaterials();
      }
      const { createPeachBlossomTreeTemplates } = await imp("/src/renderers/three/plants/peach-blossom-tree-templates.ts");
      const templates = createPeachBlossomTreeTemplates(detailed);
      const { createPeachTreeMaterials } = await imp("/src/renderers/three/plants/peach-tree-materials.ts");
      const peachPack = createPeachTreeMaterials();
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1440, 1000); renderer.setPixelRatio(1);
      renderer.outputColorSpace = t.SRGBColorSpace; renderer.toneMapping = t.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#c7cbbd");
      scene.add(new t.HemisphereLight("#fff5e4", "#60704e", 2));
      const sun = new t.DirectionalLight("#fff2db", 2.8); sun.position.set(-4, 7, 6); scene.add(sun);
      const ground = new t.Mesh(new t.PlaneGeometry(100, 100), new t.MeshStandardMaterial({ color: "#899677" }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.004; scene.add(ground);
      const camera = new t.PerspectiveCamera(33, 1.44, .005, 100);
      const models: any[] = [];
      (window as any).__review = {
        draw: (family: string, view: string, reviewVariant: number | null = null) => {
          models.splice(0).forEach(model => model.dispose());
          const peach = family === "peach", factory = peach ? createFloweringPeachModel : createRoadsideShrubModel;
          const spacing = peach ? 6.6 : 1.35;
          const bounds = new t.Box3();
          for (const variant of (reviewVariant === null ? [0, 1, 2] : [reviewVariant])) {
            const model = peach ? factory(peachPack.materials, detailed, variant, templates) :
              factory(pack.materials, detailed, variant);
            model.root.position.x = reviewVariant === null ? (variant - 1) * spacing : 0; scene.add(model.root); models.push(model);
            bounds.union(new t.Box3().setFromObject(model.root));
          }
          const size = bounds.getSize(new t.Vector3()), centre = bounds.getCenter(new t.Vector3());
          let distance = Math.max(size.x * 1.32, size.y * 2.8);
          if (view === "gameplay") distance *= 1.8;
          const oblique = view === "oblique";
          camera.position.set(centre.x + (oblique ? distance * .46 : distance * .08),
            centre.y + distance * .20, centre.z + distance);
          camera.lookAt(centre);
          if (view === "macro" || view === "leaf" || view === "bark") {
            const focus = models[Math.floor(models.length / 2)]!;
            for (const model of models) model.root.visible = model === focus;
            const graph = focus.graph;
            if (view === "bark") {
              const at = new t.Vector3(...graph.limbs[0].path[3]);
              camera.position.copy(at).add(new t.Vector3(.30, .18, .85)); camera.lookAt(at);
            } else if (view === "leaf") {
              const leaf = graph.leaves.reduce((best: any, detail: any) =>
                detail.position[2] > best.position[2] ? detail : best);
              const rotation = new t.Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ");
              const at = new t.Vector3(0, 0, leaf.length * .5).applyEuler(rotation)
                .add(new t.Vector3(...leaf.position));
              const normal = new t.Vector3(0, 1, 0).applyEuler(rotation);
              camera.position.copy(at).addScaledVector(normal, .34).add(new t.Vector3(.025, .025, .015));
              camera.lookAt(at);
            } else {
              const details = peach ? graph.blossoms.filter((flower: any) =>
                -Math.sin(flower.pitch) * Math.cos(flower.yaw) > .5) : graph.leaves;
              const anchor = details.reduce((best: any, detail: any) =>
                detail.position[2] > best.position[2] ? detail : best).position;
              const at = new t.Vector3(...anchor);
              camera.position.copy(at).add(new t.Vector3(.18, .26, .48)); camera.lookAt(at);
            }
          }
          renderer.render(scene, camera);
          document.getElementById("title")!.textContent = `${family} private candidate — ${detailed ? "High" : "Minimal"} / ${view}`;
          return { family, view, detailed, variant: reviewVariant, counts: models.map(model => model.counts),
            triangles: models.map(model => model.triangles), flowers: models.map(model => model.flowerLod?.() ?? { total: model.graph.blossoms.length }), calls: renderer.info.render.calls,
            renderedTriangles: renderer.info.render.triangles, memory: renderer.info.memory,
            bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
        },
        dispose: () => {
          models.splice(0).forEach(model => model.dispose()); templates.dispose(); peachPack.dispose(); pack?.dispose();
          ground.geometry.dispose(); ground.material.dispose(); renderer.dispose();
        }
      };
    }, { detailed, peachOnly });
    const frames = compositionOnly ? [0, 1, 2].flatMap(variant =>
      ["front", "bark"].map(view => ({ family: "peach", view, variant }))) :
      (peachOnly ? ["peach"] : ["peach", "shrub"]).flatMap(family =>
        ["front", "oblique", "gameplay", "macro", "leaf", ...(family === "peach" ? ["bark"] : [])]
          .map(view => ({ family, view, variant: null })));
    for (const frame of frames) {
      reports.push(await page.evaluate(({ family, variant, view }) =>
        (window as any).__review.draw(family, view, variant), frame));
      const suffix = frame.variant === null ? "" : `-v${frame.variant}`;
      await page.screenshot({ path: resolve(output,
        `${detailed ? "high" : "minimal"}-${frame.family}-${frame.view}${suffix}.png`) });
    }
    await page.evaluate(() => (window as any).__review.dispose());
    assert.deepEqual(errors, []); await page.close();
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status: "private unaccepted candidates", reports }, null, 2));
  const files = reports.map(report => {
    const { detailed, family, variant, view } = report as { detailed: boolean; family: string; view: string; variant: number | null };
    const suffix = variant === null ? "" : `-v${variant}`;
    const file = `${detailed ? "high" : "minimal"}-${family}-${view}${suffix}.png`;
    return `<figure><a href="${file}"><img loading="lazy" src="${file}"></a><figcaption>${file}</figcaption></figure>`;
  });
  writeFileSync(resolve(output, "index.html"), `<!doctype html><title>Private peach and shrub candidates</title>
    <style>body{background:#252b29;color:#eee;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(2,1fr)}
    figure{margin:8px}img{width:100%}</style><h1>Private candidates, not approved premium assets</h1><main>${files.join("")}</main>`);
  console.log(`Captured ${reports.length} candidate views in ${output}`);
} finally { await browser.close(); await server.close(); }
