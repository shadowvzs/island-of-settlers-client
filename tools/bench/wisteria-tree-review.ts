import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "native-a";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid review run");
const foliageOnly = process.argv.includes("--foliage-only");
const flowersOnly = process.argv.includes("--flowers-only");
const detailProof = foliageOnly || flowersOnly;
const output = resolve(`../resources/project-reviews/wisteria-tree-2026-11-04/${run}`);
const sources = ["src/render-common/plants/wisteria-tree-graph.ts",
  "src/renderers/three/plants/wisteria-tree-florets.ts",
  "src/renderers/three/plants/wisteria-tree-model.ts", "src/renderers/three/plants/wisteria-tree-templates.ts",
  "src/renderers/three/wisteria-botanical-templates.ts", "src/renderers/three/wisteria-botanical-materials.ts",
  "src/renderers/three/wisteria-minimal-templates.ts", "src/renderers/three/wisteria-lod-atlas.ts",
  "src/renderers/three/wisteria-population-templates.ts",
  "src/renderers/three/wisteria-botanical-atlas-geometry.ts",
  "src/renderers/three/wisteria-petiole-geometry.ts", "src/renderers/three/plants/ornamental-wood-geometry.ts",
  "assets/botanical-textures/wisteria-tree-lod-albedo.png",
  "assets/botanical-textures/wisteria-neutral-atlas-candidate.png",
  "src/renderers/three/plants/wisteria-tree-bark.ts",
  "assets/botanical-textures/wisteria-tree-lod-albedo.json", "tools/bench/wisteria-tree-review.ts"];
const hashes = () => Object.fromEntries(sources.map(path => [path,
  createHash("sha256").update(readFileSync(resolve(path))).digest("hex")]));
const before = hashes();
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [], errors: string[] = [];
try {
  for (const detailed of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/wisteria-tree-review.html", route => route.fulfill({
      body: "<body style='margin:0'></body>", contentType: "text/html"
    }));
    await page.goto(`${url}wisteria-tree-review.html`);
    await page.evaluate(async detailed => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createWisteriaTreeTemplates } = await imp("/src/renderers/three/plants/wisteria-tree-templates.ts");
      const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1100, 900); renderer.setPixelRatio(1); renderer.outputColorSpace = t.SRGBColorSpace;
      renderer.toneMapping = t.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
      renderer.shadowMap.enabled = detailed; document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#bdc7ae");
      scene.add(new t.HemisphereLight("#fff3dd", "#657c58", 2.4));
      const sun = new t.DirectionalLight("#fff0da", 2.6); sun.position.set(-4, 8, 6);
      sun.castShadow = detailed; sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = .012;
      Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 6, bottom: -5, near: .1, far: 25 });
      scene.add(sun);
      const ground = new t.Mesh(new t.PlaneGeometry(40, 40),
        new t.MeshStandardMaterial({ color: "#8f9b70", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.009; ground.receiveShadow = true; scene.add(ground);
      const owner = createWisteriaTreeTemplates(detailed);
      const camera = new t.PerspectiveCamera(35, 1100 / 900, .015, 80);
      let model: any, bounds: any;
      (window as any).wisteriaTree = {
        select: async (variant: number, tier: "near" | "far") => {
          const next = await owner.create(variant, tier); model?.dispose(); model = next;
          scene.add(model.root); bounds = new t.Box3().setFromObject(model.root);
          return { triangles: model.triangles, counts: model.counts,
            bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
        },
        draw: (view: string) => {
          const center = bounds.getCenter(new t.Vector3()), size = bounds.getSize(new t.Vector3());
          if (view === "bark") { center.set(0, 1.45, .02); camera.position.copy(center).add(new t.Vector3(.65, .1, 1.25)); }
          else if (view === "flower" || view === "leaf") {
            center.set(...model.inspection[view]); camera.position.copy(center).add(new t.Vector3(.06, .035, .40));
          } else {
            const distance = Math.max(size.x, size.y, size.z) * 2.25;
            const offset = new t.Vector3(0, .3, distance);
            if (view === "gameplay") offset.set(distance * .75, distance * .75, distance);
            camera.position.copy(center).add(offset);
          }
          camera.lookAt(center); camera.updateMatrixWorld(); renderer.render(scene, camera);
          return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
            geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
        },
        dispose: () => {
          model?.dispose(); owner.dispose(); ground.geometry.dispose(); ground.material.dispose();
          renderer.dispose(); renderer.forceContextLoss();
        }
      };
    }, detailed);
    for (const tier of (detailProof ? ["near"] : ["near", "far"]) as ("near" | "far")[])
      for (const variant of (detailProof ? [0] : [0, 1, 2])) {
      const metadata = await page.evaluate(({ tier, variant }) => (window as any).wisteriaTree.select(variant, tier),
        { tier, variant });
      assert(metadata.triangles <= (detailed ? 30000 : 6000));
      if (tier === "far") assert(metadata.triangles <= 2400);
      let views = tier === "near" ? ["front", "gameplay"] : ["gameplay"];
      if (foliageOnly) views = ["front", "leaf"];
      if (flowersOnly) views = ["front", "flower"];
      if (!detailProof && tier === "near" && variant === 0) views.push("bark", "flower", "leaf");
      for (const view of views) {
        const name = `${detailed ? "high" : "minimal"}-${variant}-${tier}-${view}`;
        const statistics = await page.evaluate(view => (window as any).wisteriaTree.draw(view), view);
        await page.screenshot({ path: resolve(output, `${name}.png`) });
        reports.push({ name, metadata, statistics });
      }
    }
    await page.evaluate(() => (window as any).wisteriaTree.dispose());
    await page.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(hashes(), before);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ hashes: before, errors, reports }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<meta charset="utf-8"><title>Standalone Wisteria tree</title>
    <style>body{background:#222;color:#eee;font:16px sans-serif}img{max-width:95vw;width:900px}figure{margin:20px}</style>
    <h1>Standalone Wisteria tree — native review, not yet released</h1>${reports.map((report: any) =>
    `<figure><figcaption>${report.name} · ${report.metadata.triangles} model triangles</figcaption>
      <img src="${report.name}.png"></figure>`).join("")}`);
  console.log(`Captured ${reports.length} Wisteria tree views at ${output}`);
} finally { await browser.close(); await server.close(); }
