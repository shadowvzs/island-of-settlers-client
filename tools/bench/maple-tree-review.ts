import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "native-a";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid maple review run");
const tier = process.argv.find(argument => argument.startsWith("--tier="))?.slice(7) ?? "near";
if (tier !== "near" && tier !== "far") throw new Error("Invalid maple review tier");
const output = resolve("../resources/project-reviews/maple-trees-2026-11-04", run);
mkdirSync(output, { recursive: true });
const sourceFiles = ["src/render-common/plants/maple-tree-graph.ts",
  ...["maple-tree-model", "maple-bark-material", "maple-leaf-geometry", "maple-production-leaf-geometry",
    "maple-production-wood", "maple-connected-wood", "maple-display-limb",
    "maple-leaf-material", "maple-leaf-textures",
    "ornamental-shoot-geometry", "ornamental-wood-geometry", "maple-tree-far-model", "maple-far-alpha"]
    .map(name => `src/renderers/three/plants/${name}.ts`), "tools/bench/maple-tree-review.ts"];
const sourceHash = () => {
  const hash = createHash("sha256");
  for (const file of sourceFiles) { hash.update(file); hash.update(readFileSync(resolve(file))); }
  return hash.digest("hex");
};
const initialSourceHash = sourceHash();
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
const requestedViews = process.argv.find(argument => argument.startsWith("--views="))?.slice(8).split(",");
const allowedViews = ["front", "oblique", "gameplay", "trunk", "twig", "leaf", "palettes", "junction", "roots"];
const allPalettes = process.argv.includes("--all-palettes");
const allSubjects = process.argv.includes("--all-subjects");
const views = requestedViews ?? allowedViews;
if (!views.length || views.some(view => !allowedViews.includes(view))) throw new Error("Invalid maple review views");
try {
  for (const detailed of [true, false]) {
    const errors: string[] = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/maple-tree-review.html", route => route.fulfill({
      body: "<body style='margin:0'><div id='title' style='position:absolute;top:18px;left:22px;font:22px sans-serif'></div></body>",
      contentType: "text/html" }));
    await page.goto(`${url}maple-tree-review.html`);
    await page.evaluate(async ({ detailed, tier }) => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createMapleTreeMaterials, createMapleTreeTemplate } =
        await imp("/src/renderers/three/plants/maple-tree-model.ts");
      const pack = createMapleTreeMaterials(detailed);
      const templates = [0, 1, 2].map(variant => createMapleTreeTemplate(pack, detailed, variant, tier));
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1440, 1000); renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = detailed; renderer.shadowMap.type = t.PCFSoftShadowMap;
      renderer.outputColorSpace = t.SRGBColorSpace; renderer.toneMapping = t.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05; document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#c3cbd0");
      scene.add(new t.HemisphereLight("#fff5df", "#4b6252", 2.0));
      const sun = new t.DirectionalLight("#fff2d5", 2.8); sun.position.set(-5, 9, 7); scene.add(sun);
      sun.castShadow = detailed; sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: .1, far: 60 });
      sun.shadow.bias = -.0003; sun.shadow.normalBias = .01;
      const ground = new t.Mesh(new t.PlaneGeometry(150, 150), new t.MeshStandardMaterial({ color: "#83936d" }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.005; ground.receiveShadow = detailed; scene.add(ground);
      const camera = new t.PerspectiveCamera(33, 1.44, .005, 300);
      const models: any[] = [];
      (window as any).__mapleReview = {
        draw: (view: string, paletteOffset = 0, subject = 1) => {
          models.splice(0).forEach(model => model.dispose());
          const paletteOnly = view === "palettes";
          const palettes = ["yellow", "orange", "red"];
          const bounds = new t.Box3();
          for (let variant = 0; variant < 3; variant++) {
            const model = templates[paletteOnly ? 0 : variant].create(palettes[(variant + paletteOffset) % palettes.length]);
            model.root.position.x = (variant - 1) * 7.5;
            scene.add(model.root); models.push(model); bounds.union(new t.Box3().setFromObject(model.root));
          }
          const size = bounds.getSize(new t.Vector3()), centre = bounds.getCenter(new t.Vector3());
          let distance = Math.max(size.x * 1.35, size.y * 2.8);
          if (view === "gameplay") distance *= 1.60;
          camera.position.set(centre.x + (view === "oblique" ? distance * .40 : distance * .06),
            centre.y + distance * .20, centre.z + distance);
          camera.lookAt(centre);
          if (["trunk", "twig", "leaf", "junction", "roots"].includes(view)) {
            models.forEach((model, index) => { model.root.visible = index === subject; });
            models[subject].root.position.x = 0;
            if (view === "roots") {
              camera.position.set(1.4, 1.25, 2.4); camera.lookAt(0, .20, 0);
            } else if (view === "trunk") {
              camera.position.set(1.7, 1.45, 3.1); camera.lookAt(.12, 1.15, 0);
            } else {
              const graph = templates[subject].graph;
              const leaf = graph.leaves.reduce((best: any, detail: any) =>
                detail.position[2] > best.position[2] ? detail : best);
              const rotation = new t.Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ");
              const at = new t.Vector3(0, 0, leaf.length * .5).applyEuler(rotation)
                .add(new t.Vector3(...leaf.position));
              const normal = new t.Vector3(0, 1, 0).applyEuler(rotation);
              if (view === "junction") {
                const root = new t.Vector3(...leaf.position);
                const side = new t.Vector3(1, 0, 0).applyEuler(rotation);
                if (normal.z < 0) normal.negate();
                camera.position.copy(root).addScaledVector(normal, .23).addScaledVector(side, .24)
                  .add(new t.Vector3(0, .025, .23));
                at.copy(root).add(new t.Vector3(0, 0, leaf.length * .12).applyEuler(rotation));
              } else if (view === "leaf")
                camera.position.copy(at).addScaledVector(normal, .55).add(new t.Vector3(.025, .035, .05));
              else camera.position.copy(at).add(new t.Vector3(.35, .45, 1.6));
              camera.lookAt(at);
            }
          }
          renderer.render(scene, camera);
          document.getElementById("title")!.textContent =
            `Ornamental maple — ${detailed ? "High" : "Minimal"} / ${tier} / ${view} / palette${paletteOffset}`;
          return { detailed, paletteOffset, subject, tier, view, triangles: templates.map((template: any) => template.triangles),
            counts: templates.map((template: any) => template.counts), leaves: templates.map((template: any) => template.graph.leaves.length),
            calls: renderer.info.render.calls, renderedTriangles: renderer.info.render.triangles,
            memory: renderer.info.memory, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
        },
        dispose: () => {
          models.splice(0).forEach(model => model.dispose());
          templates.forEach((template: any) => template.dispose()); pack.dispose();
          ground.geometry.dispose(); ground.material.dispose(); sun.shadow.dispose(); renderer.dispose();
        }
      };
    }, { detailed, tier });
    const paletteOffsets = allPalettes ? [0, 1, 2] : [0];
    for (const view of views) for (const paletteOffset of paletteOffsets) {
      const macro = ["trunk", "twig", "leaf", "junction", "roots"].includes(view);
      const subjects = allSubjects && macro ? [0, 1, 2] : [1];
      for (const subject of subjects) {
        reports.push(await page.evaluate(({ paletteOffset, subject, view }) =>
          (window as any).__mapleReview.draw(view, paletteOffset, subject), { paletteOffset, subject, view }));
        const paletteSuffix = allPalettes ? `-p${paletteOffset}` : "";
        const subjectSuffix = allSubjects ? `-s${subject}` : "";
        await page.screenshot({ path: resolve(output,
          `${detailed ? "high" : "minimal"}-${view}${paletteSuffix}${subjectSuffix}.png`) });
      }
    }
    await page.evaluate(() => (window as any).__mapleReview.dispose());
    assert.deepEqual(errors, []); await page.close();
  }
  assert.equal(sourceHash(), initialSourceHash, "Candidate source changed during capture");
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status: "private unaccepted decorative candidates",
    sourceFiles, sourceHash: initialSourceHash, reports }, null, 2));
  const figures = reports.map(report => {
    const { detailed, paletteOffset, subject, view } = report as {
      detailed: boolean; paletteOffset: number; subject: number; view: string };
    const paletteSuffix = allPalettes ? `-p${paletteOffset}` : "";
    const subjectSuffix = allSubjects ? `-s${subject}` : "";
    const file = `${detailed ? "high" : "minimal"}-${view}${paletteSuffix}${subjectSuffix}.png`;
    return `<figure><a href="${file}"><img loading="lazy" src="${file}"></a><figcaption>${file}</figcaption></figure>`;
  });
  writeFileSync(resolve(output, "index.html"), `<!doctype html><title>Ornamental maple candidates</title>
    <style>body{background:#252b29;color:#eee;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(2,1fr)}
    figure{margin:8px}img{width:100%}</style><h1>Private ornamental maple candidates</h1><main>${figures.join("")}</main>`);
  console.log(`Captured ${reports.length} maple views in ${output}`);
} finally { await browser.close(); await server.close(); }
