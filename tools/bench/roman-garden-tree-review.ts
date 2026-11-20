import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv[2] ?? "native-a";
const materialsOnly = process.argv.includes("--materials");
const willowOnly = process.argv.includes("--willow");
const speciesList = willowOnly ? ["willow-tree"] : ["willow-tree", "cypress-tree"];
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid garden tree review name");
const output = resolve("../resources/project-reviews/roman-garden-trees-2026-11-05", run);
mkdirSync(output, { recursive: true });
const files = ["src/render-common/plants/roman-garden-tree-graph.ts",
  "src/renderers/three/plants/roman-garden-tree-materials.ts",
  "src/renderers/three/plants/roman-garden-tree-model.ts",
  "src/renderers/three/plants/cypress-foliage-core.ts",
  "src/render-common/plants/willow-tree-graph.ts",
  "src/renderers/three/plants/willow-tree-geometry.ts",
  "src/renderers/three/plants/ornamental-wood-geometry.ts", "tools/bench/roman-garden-tree-review.ts"];
const sourceHash = () => {
  const hash = createHash("sha256");
  for (const file of files) { hash.update(file); hash.update(readFileSync(file)); }
  return hash.digest("hex");
};
const initialHash = sourceHash();
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: any[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.setDefaultTimeout(40000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/garden-tree-review.html", route => route.fulfill({
    body: "<body style='margin:0'><div id='title' style='position:absolute;top:15px;left:15px;font:20px sans-serif'></div></body>",
    contentType: "text/html" }));
  await page.goto(`${url}garden-tree-review.html`);
  await page.evaluate(async () => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const t = await imp("/node_modules/three/build/three.module.js");
    const garden = await imp("/src/renderers/three/plants/roman-garden-tree-model.ts");
    const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 1000); renderer.setPixelRatio(1);
    renderer.outputColorSpace = t.SRGBColorSpace; renderer.toneMapping = t.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05; document.body.append(renderer.domElement);
    const scene = new t.Scene(); scene.background = new t.Color("#c3cbd0");
    scene.add(new t.HemisphereLight("#fff5df", "#4b6252", 2));
    const sun = new t.DirectionalLight("#fff2d5", 2.8); sun.position.set(-5, 9, 7); scene.add(sun);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 8, bottom: -8, near: .1, far: 40 });
    sun.shadow.bias = -.0003; sun.shadow.normalBias = .01;
    const ground = new t.Mesh(new t.PlaneGeometry(100, 100),
      new t.MeshStandardMaterial({ color: "#83936d" }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.005; ground.receiveShadow = true; scene.add(ground);
    const camera = new t.PerspectiveCamera(33, 1.2, .005, 300);
    let model: any, pack: any;
    const visibleJunction = () => {
      const candidates = model.renderedLeaves.filter((leaf: any) => leaf.petiole &&
        model.graph.limbs[leaf.petiole.limb].role === "twig")
        .sort((first: any, last: any) => last.petiole.node[2] - first.petiole.node[2]);
      const ray = new t.Raycaster();
      for (const leaf of candidates.slice(0, 120)) {
        const at = new t.Vector3(...leaf.petiole.node).lerp(new t.Vector3(...leaf.position), .5);
        const outward = new t.Vector3(at.x, .10, at.z).normalize();
        for (const turn of [-.35, 0, .35]) {
          const direction = outward.clone().applyAxisAngle(new t.Vector3(0, 1, 0), turn);
          const origin = at.clone().addScaledVector(direction, .25);
          ray.set(origin, at.clone().sub(origin).normalize());
          const hit = ray.intersectObject(model.root, true)[0];
          if (!hit || hit.point.distanceTo(at) > .014) continue;
          return { at, origin, seed: leaf.seed };
        }
      }
      throw new Error("No actual unobscured willow leaf-petiole junction found");
    };
    (window as any).__gardenTreeReview = {
      draw: (options: any) => {
        model?.dispose(); pack?.dispose();
        const { detailed, species, tier, variant, view } = options;
        pack = garden.createRomanGardenTreeMaterials(species);
        model = garden.createRomanGardenTreeModel(pack, species, detailed, variant, tier);
        scene.add(model.root); renderer.shadowMap.enabled = detailed;
        const bounds = new t.Box3().setFromObject(model.root);
        const centre = bounds.getCenter(new t.Vector3());
        camera.position.set(6.2, 5.4, 9.6); camera.lookAt(centre);
        if (view === "rear") { camera.position.set(-6.2, 5.0, -9.6); camera.lookAt(centre); }
        if (view === "gameplay") { camera.position.set(11, 14, 18); camera.lookAt(centre); }
        if (view === "branch") { camera.position.set(1.7, 2.4, 3.1); camera.lookAt(0, 2.45, 0); }
        if (view === "bark") {
          camera.position.set(.72, 1.15, 1.3); camera.lookAt(0, .95, 0);
          if (species === "cypress-tree") { camera.position.set(.30, .21, .56); camera.lookAt(0, .12, 0); }
        }
        if (view === "leaf" || view === "junction") {
          const leaf = model.renderedLeaves.reduce((best: any, value: any) =>
            value.position[2] > best.position[2] ? value : best);
          const rotation = new t.Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ");
          const at = new t.Vector3(0, 0, leaf.length * .5).applyEuler(rotation)
            .add(new t.Vector3(...leaf.position));
          const normal = new t.Vector3(0, 1, 0).applyEuler(rotation);
          if (normal.x * at.x + normal.z * at.z < 0) normal.negate();
          if (view === "junction") at.copy(new t.Vector3(...leaf.petiole.node))
            .lerp(new t.Vector3(...leaf.position), .5);
          camera.position.copy(at).addScaledVector(normal, .60).add(new t.Vector3(.025, .025, .025));
          if (view === "junction")
            camera.position.copy(at).addScaledVector(normal, .22).add(new t.Vector3(.015, .015, .015));
          camera.lookAt(at);
        }
        let junctionLeafSeed: number | undefined;
        if (view === "junction") {
          const junction = visibleJunction();
          camera.position.copy(junction.origin); camera.lookAt(junction.at);
          junctionLeafSeed = junction.seed;
        }
        renderer.render(scene, camera);
        document.getElementById("title")!.textContent =
          `${species} ${variant} / ${detailed ? "High" : "Minimal"} / ${tier} / ${view}`;
        return { ...options, junctionLeafSeed, triangles: model.triangles, calls: renderer.info.render.calls,
          leaves: model.graph.leaves.length, limbs: model.graph.limbs.length,
          bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
      },
      dispose: () => {
        model?.dispose(); pack?.dispose(); ground.geometry.dispose(); ground.material.dispose();
        sun.shadow.dispose(); renderer.dispose();
      }
    };
  });
  const variants = materialsOnly ? [0] : [0, 1, 2];
  const wholeViews = materialsOnly ? ["front"] : ["front", "rear", "gameplay"];
  for (const species of speciesList) for (const detailed of [true, false])
    for (const variant of variants) for (const view of wholeViews) {
      const options = { detailed, species, tier: "near", variant, view };
      const report = await page.evaluate(options => (window as any).__gardenTreeReview.draw(options), options);
      report.file = `${species}-${detailed ? "high" : "minimal"}-${variant}-${view}.png`;
      reports.push(report); await page.screenshot({ path: resolve(output, report.file) });
    }
  const macroViews = willowOnly ? ["bark", "leaf", "branch", "junction"] : ["bark", "leaf", "far"];
  for (const species of speciesList) for (const detailed of [true, false])
    for (const view of macroViews) {
      const options = { detailed, species, tier: view === "far" ? "far" : "near", variant: 0, view };
      const report = await page.evaluate(options => (window as any).__gardenTreeReview.draw(options), options);
      report.file = `${species}-${detailed ? "high" : "minimal"}-${view}.png`;
      reports.push(report); await page.screenshot({ path: resolve(output, report.file) });
    }
  await page.evaluate(() => (window as any).__gardenTreeReview.dispose());
  assert.deepEqual(errors, []); assert.equal(sourceHash(), initialHash);
  const sourceHashes = Object.fromEntries(files.map(file =>
    [file, createHash("sha256").update(readFileSync(file)).digest("hex")]));
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ files, materialsOnly, sourceHashes, sourceHash: initialHash,
    status: "native captured; visual acceptance pending", errors, reports }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<!doctype html><title>Roman garden trees</title>
    <style>body{background:#282d2a;color:#eee;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(3,1fr)}
    figure{margin:6px}img{width:100%}</style><main>${reports.map(row =>
      `<figure><a href='${row.file}'><img loading='lazy' src='${row.file}'></a><figcaption>${row.file}</figcaption></figure>`
    ).join("")}</main>`);
  console.log(`Captured ${reports.length} native garden tree frames in ${output}`);
} finally { await browser.close(); await server.close(); }
