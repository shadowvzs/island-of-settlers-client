import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "native-i";
assert(/^[a-z0-9-]+$/.test(run));
const flowerColour = process.argv.find(argument => argument.startsWith("--colour="))?.slice(9) ?? "#ed9bb5";
const output = resolve("../resources/project-reviews/peach-shrub-2026-11-04", run);
mkdirSync(output, { recursive: true });
const plantDirectory = "src/renderers/three/plants";
const sourceFiles = readdirSync(plantDirectory).filter(file => file.startsWith("peach-") && file.endsWith(".ts"))
  .map(file => `${plantDirectory}/${file}`);
sourceFiles.push("src/render-common/plants/flowering-peach-graph.ts", "src/render-common/plants/flowering-peach-physical.ts",
  "src/render-common/plants/ornamental-tree-graph.ts",
  ...["ornamental-wood-geometry", "ornamental-shoot-geometry", "ornamental-foliage-geometry", "ornamental-leaf-textures"]
    .map(name => `${plantDirectory}/${name}.ts`), "tools/bench/peach-production-review.ts");
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file,
  createHash("sha256").update(readFileSync(file)).digest("hex")]));
const before = hashes();
writeFileSync(resolve(output, "source-before.json"), JSON.stringify(before, null, 2));
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const errors: string[] = [], reports: unknown[] = [];
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/peach-production-review.html", route => route.fulfill({ contentType: "text/html",
    body: "<body style='margin:0'><div id='title' style='position:absolute;top:16px;left:20px;font:20px sans-serif'></div></body>" }));
  await page.goto(`${url}peach-production-review.html`);
  const atlases = await page.evaluate(async ({ flowerColour }) => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const t = await imp("/node_modules/three/build/three.module.js");
    const { createFloweringPeachModel } = await imp("/src/renderers/three/plants/peach-tree-model.ts");
    const { createPeachTreeMaterials } = await imp("/src/renderers/three/plants/peach-tree-materials.ts");
    const { createFloweringPeachProductionModel } = await imp("/src/renderers/three/plants/peach-tree-production-model.ts");
    const { PEACH_IMPOSTOR } = await imp("/src/renderers/three/plants/peach-tree-impostor.ts");
    const { loadPeachProductionResources } = await imp("/src/renderers/three/plants/peach-production-resources.ts");
    const { createFloweringPeachGraph } = await imp("/src/render-common/plants/flowering-peach-graph.ts");
    const { createPeachCrownCapture } = await imp("/src/renderers/three/plants/peach-crown-capture.ts");
    const { createPeachBlossomTreeTemplates } = await imp("/src/renderers/three/plants/peach-blossom-tree-templates.ts");
    const { createPeachCrownLayout, PEACH_CROWN_ATLAS, selectPeachCrownDetails } = await imp("/src/renderers/three/plants/peach-crown-layout.ts");
    const pack = createPeachTreeMaterials();
    const captureTemplates = createPeachBlossomTreeTemplates(true, flowerColour);
    const renderer = new t.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.outputColorSpace = t.SRGBColorSpace;
    renderer.toneMapping = t.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    document.body.append(renderer.domElement);
    const scene = new t.Scene();
    scene.add(new t.HemisphereLight("#fff5e4", "#60704e", 2));
    const sun = new t.DirectionalLight("#fff2db", 2.8); sun.position.set(-4, 7, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -8; sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8; sun.shadow.camera.far = 40;
    sun.shadow.bias = -.0002; scene.add(sun);
    const camera = new t.PerspectiveCamera(30, 1.44, .01, 1000);
    const isoCamera = new t.OrthographicCamera(-14.4, 14.4, 10, -10, .01, 2000);
    const active: any[] = [];
    const clear = () => active.splice(0).forEach(model => model.dispose());
    const images: string[] = [];
    renderer.setSize(PEACH_IMPOSTOR.tile, PEACH_IMPOSTOR.tile);
    const ortho = new t.OrthographicCamera(-PEACH_IMPOSTOR.width / 2, PEACH_IMPOSTOR.width / 2,
      PEACH_IMPOSTOR.height / 2, -PEACH_IMPOSTOR.height / 2, .1, 100);
    const target = new t.Vector3(0, PEACH_IMPOSTOR.centre, 0);
    for (const variant of [0, 1, 2]) {
      const model = createFloweringPeachModel(pack.materials, true, variant, captureTemplates); scene.add(model.root);
      const canvas = document.createElement("canvas");
      canvas.width = PEACH_IMPOSTOR.columns * PEACH_IMPOSTOR.tile;
      canvas.height = PEACH_IMPOSTOR.rows * PEACH_IMPOSTOR.tile;
      const context = canvas.getContext("2d")!;
      for (let row = 0; row < PEACH_IMPOSTOR.rows; row++) for (let column = 0; column < PEACH_IMPOSTOR.columns; column++) {
        const azimuth = column * Math.PI * 2 / PEACH_IMPOSTOR.columns, elevation = PEACH_IMPOSTOR.elevations[row] * Math.PI / 180;
        ortho.position.copy(target).add(new t.Vector3(Math.sin(azimuth) * Math.cos(elevation),
          Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)).multiplyScalar(20));
        ortho.lookAt(target); renderer.render(scene, ortho);
        context.drawImage(renderer.domElement, column * PEACH_IMPOSTOR.tile, row * PEACH_IMPOSTOR.tile);
      }
      images.push(canvas.toDataURL("image/png"));
      model.dispose();
    }
    const crownImages: { high: string[]; minimal: string[] } = { high: [], minimal: [] };
    renderer.setSize(PEACH_CROWN_ATLAS.tile, PEACH_CROWN_ATLAS.tile);
    for (const detailed of [true, false]) for (const variant of [0, 1, 2]) {
      const graph = createFloweringPeachGraph(variant, true), layout = createPeachCrownLayout(graph);
      const canvas = document.createElement("canvas");
      canvas.width = PEACH_CROWN_ATLAS.columns * PEACH_CROWN_ATLAS.tile;
      canvas.height = PEACH_CROWN_ATLAS.rows * PEACH_CROWN_ATLAS.tile;
      const context = canvas.getContext("2d")!;
      for (let mass = 0; mass < layout.length; mass++) {
        const capture = createPeachCrownCapture(graph, pack.materials, detailed, mass, captureTemplates);
        scene.add(capture.root);
        const { centre, radius } = layout[mass];
        ortho.left = -radius; ortho.right = radius; ortho.top = radius; ortho.bottom = -radius;
        ortho.updateProjectionMatrix(); const at = new t.Vector3(...centre);
        for (let row = 0; row < 2; row++) for (let column = 0; column < 8; column++) {
          const azimuth = column * Math.PI / 4, elevation = PEACH_CROWN_ATLAS.elevations[row] * Math.PI / 180;
          ortho.position.copy(at).add(new t.Vector3(Math.sin(azimuth) * Math.cos(elevation),
            Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)).multiplyScalar(20));
          ortho.lookAt(at); renderer.render(scene, ortho);
          context.drawImage(renderer.domElement, column * PEACH_CROWN_ATLAS.tile, (mass * 2 + row) * PEACH_CROWN_ATLAS.tile);
        }
        capture.dispose();
      }
      crownImages[detailed ? "high" : "minimal"].push(canvas.toDataURL("image/png"));
    }
    captureTemplates.dispose(); pack.dispose();
    renderer.setSize(1440, 1000); scene.background = new t.Color("#c7cbbd");
    const ground = new t.Mesh(new t.PlaneGeometry(1000, 1000), new t.MeshStandardMaterial({ color: "#899677" }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.008; ground.receiveShadow = true; scene.add(ground);
    const templates: any[] = [];
    let resources: any, resourceQuality: boolean | undefined;
    const ensureResources = async (detailed: boolean) => {
      if (resources && resourceQuality === detailed) return;
      clear(); templates.splice(0).forEach(template => template.dispose()); resources?.dispose();
      resources = await loadPeachProductionResources({ far: images, crowns: crownImages[detailed ? "high" : "minimal"], flowerColour }, detailed); resourceQuality = detailed;
    };
    (window as any).__production = {
      draw: async (variant: number, tier: "near" | "far", detailed: boolean, azimuth = 0, mode = "cinematic", detailView = "whole") => {
        await ensureResources(detailed); clear(); renderer.shadowMap.enabled = detailed; ground.material.needsUpdate = true;
        const model = createFloweringPeachProductionModel(resources.materialsForVariant(variant),
          detailed, variant, tier, resources.templates);
        scene.add(model.root); active.push(model);
        const target = new t.Vector3(0, PEACH_IMPOSTOR.centre, 0);
        camera.position.copy(target).add(new t.Vector3(Math.sin(azimuth) * 34, 34 * Math.tan(Math.PI / 5), Math.cos(azimuth) * 34));
        camera.lookAt(target);
        const viewCamera = mode === "iso" ? isoCamera : camera;
        if (mode === "iso") {
          isoCamera.position.copy(target).add(new t.Vector3(Math.sqrt(3 / 8), .5, Math.sqrt(3 / 8)).multiplyScalar(600));
          isoCamera.lookAt(target);
        }
        let macroVisible: boolean | null = null;
        if (tier === "near" && detailView !== "whole") {
          const graph = createFloweringPeachGraph(variant, true), selection = selectPeachCrownDetails(graph, detailed);
          const distance = detailView === "flower" ? .25 : .4;
          model.root.updateMatrixWorld(true);
          const solids = model.root.children.filter((child: any) => child.name !== "peach-original-crown-masses");
          const visible = (at: any, normal: any) => {
            const ray = new t.Raycaster(at.clone().addScaledVector(normal, distance), normal.clone().negate(), 0, distance + .05);
            const hit = ray.intersectObjects(solids, false)[0];
            const name = detailView === "flower" ? "peach-real-selected-flowers" : "peach-real-selected-leaves";
            return hit?.object.name === name && hit.point.distanceTo(at) < .04;
          };
          const candidates = detailView === "flower" ? [...selection.heroFlowers].map((index: any) => {
            const flower = graph.blossoms[index], rotation = new t.Euler(flower.pitch, flower.yaw, 0, "YXZ");
            return { at: new t.Vector3(...flower.position), normal: new t.Vector3(0, 1, 0).applyEuler(rotation) };
          }) : [...selection.leaves].map((index: any) => {
            const leaf = graph.leaves[index], rotation = new t.Euler(leaf.pitch, leaf.yaw, leaf.roll, "YXZ");
            return { at: new t.Vector3(0, 0, leaf.length * .5).applyEuler(rotation).add(new t.Vector3(...leaf.position)),
              normal: new t.Vector3(0, 1, 0).applyEuler(rotation) };
          });
          candidates.sort((a: any, b: any) => b.at.y + b.at.z - a.at.y - a.at.z);
          const pose = candidates.find((candidate: any) => visible(candidate.at, candidate.normal));
          if (!pose) throw new Error(`No unobstructed genuine ${detailView} inspection target`);
          macroVisible = true; camera.position.copy(pose.at).addScaledVector(pose.normal, distance); camera.lookAt(pose.at);
        }
        renderer.render(scene, viewCamera);
        document.getElementById("title")!.textContent = `peach ${detailed ? "High" : "Minimal"} ${tier} variant ${variant} / ${detailView}`;
        return { variant, tier, detailed, mode, detailView, macroVisible, heroFlowers: model.heroFlowers, realLeaves: model.realLeaves, individualFlowers: model.individualFlowers,
          representedFlowers: model.representedFlowers, modelTriangles: model.triangles,
          submittedTriangles: renderer.info.render.triangles, calls: renderer.info.render.calls,
          memory: renderer.info.memory, camera: viewCamera.position.toArray() };
      },
      bench: async (count: number, nearCount: number) => {
        await ensureResources(false); clear(); renderer.shadowMap.enabled = false; ground.material.needsUpdate = true; templates.splice(0).forEach(template => template.dispose());
        const treeCentres: any[] = [], treeBounds: any[] = [], nearBounds: any[] = [];
        for (const variant of [0, 1, 2]) {
          const template = createFloweringPeachProductionModel(resources.materialsForVariant(variant),
            false, variant, "far", resources.templates); templates.push(template);
          const source = template.root.children[0], batch = new t.InstancedMesh(source.geometry, source.material, Math.ceil(count / 3));
          const transform = new t.Object3D(); let slot = 0;
          for (let index = variant; index < count; index += 3) {
            const row = Math.floor(index / 20), column = index % 20;
            transform.position.set((column - 9.5) * (2.8 + row * .35), 0, -18 - row * 7);
            treeCentres.push(transform.position.clone().add(new t.Vector3(0, 2.9, 0)));
            transform.rotation.y = index * 2.399963; transform.updateMatrix(); batch.setMatrixAt(slot++, transform.matrix);
            treeBounds.push(source.geometry.boundingSphere.clone().applyMatrix4(transform.matrix));
          }
          batch.count = slot; batch.computeBoundingSphere(); scene.add(batch);
          active.push({ dispose: () => { scene.remove(batch); batch.dispose(); } });
        }
        if (nearCount) {
          const near = createFloweringPeachProductionModel(resources.materialsForVariant(0), false, 0, "near", resources.templates);
          scene.add(near.root); active.push(near); near.root.updateMatrixWorld(true);
          near.root.children.forEach((child: any) => nearBounds.push(child.geometry.boundingSphere.clone().applyMatrix4(child.matrixWorld)));
        }
        camera.position.set(0, 18, 24); camera.lookAt(0, 0, 0);
        const benchmarkCamera = isoCamera;
        {
          const centreZ = -18 - (Math.ceil(count / 20) - 1) * 3.5;
          const target = new t.Vector3(0, 0, centreZ);
          isoCamera.left = -100; isoCamera.right = 100; isoCamera.top = 100 / 1.44; isoCamera.bottom = -100 / 1.44;
          isoCamera.position.copy(target).add(new t.Vector3(Math.sqrt(3 / 8), .5, Math.sqrt(3 / 8)).multiplyScalar(600));
          isoCamera.lookAt(target); isoCamera.updateProjectionMatrix();
        }
        const samples: number[] = [], intervals: number[] = [];
        let previousTick = 0;
        for (let frame = 0; frame < 50; frame++) {
          const tick = await new Promise<number>(done => requestAnimationFrame(done));
          if (frame >= 10) intervals.push(tick - previousTick);
          previousTick = tick;
          camera.position.x = Math.sin(frame * .04) * 3; camera.lookAt(0, 0, 0);
          const start = performance.now(); renderer.render(scene, benchmarkCamera);
          if (frame >= 10) samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b); intervals.sort((a, b) => a - b);
        const centresInFrame = treeCentres.filter(point => {
          const projected = point.clone().project(benchmarkCamera);
          return Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && Math.abs(projected.z) < 1;
        }).length;
        const nearCentre = new t.Vector3(0, 2.9, 0).project(benchmarkCamera);
        const nearCentresInFrame = nearCount && Math.abs(nearCentre.x) < 1 && Math.abs(nearCentre.y) < 1 && Math.abs(nearCentre.z) < 1 ? 1 : 0;
        const frustum = new t.Frustum().setFromProjectionMatrix(new t.Matrix4().multiplyMatrices(benchmarkCamera.projectionMatrix, benchmarkCamera.matrixWorldInverse));
        const inside = (sphere: any) => frustum.planes.every((plane: any) => plane.distanceToPoint(sphere.center) >= sphere.radius);
        const fullyVisibleFarBounds = treeBounds.filter(inside).length;
        const fullyVisibleNearBounds = nearCount && nearBounds.every(inside) ? 1 : 0;
        if (fullyVisibleFarBounds !== count || fullyVisibleNearBounds !== nearCount)
          throw new Error("Population witness crops a conservative submitted tree bound");
        if (centresInFrame !== count || nearCentresInFrame !== nearCount) throw new Error("Population witness does not frame every submitted tree centre");
        document.getElementById("title")!.textContent = `${count} visible instanced distant peach + ${nearCount} forced near tree`;
        return { farTrees: count, nearTrees: nearCount, centresInFrame, mode: "iso", nearSelection: nearCount ? "forced mixed-budget witness" : "normal distant field",
          fullyVisibleFarBounds, fullyVisibleNearBounds, nearCentresInFrame, totalCentresInFrame: centresInFrame + nearCentresInFrame,
          frameIntervalMedianMs: intervals[Math.floor(intervals.length / 2)],
          frameIntervalP95Ms: intervals[Math.floor(intervals.length * .95)], samples: samples.length,
          renderCpuMedianMs: samples[Math.floor(samples.length / 2)], renderCpuP95Ms: samples[Math.floor(samples.length * .95)],
          submittedTriangles: renderer.info.render.triangles, calls: renderer.info.render.calls, memory: renderer.info.memory };
      },
      dispose: () => {
        clear(); templates.forEach(template => template.dispose());
        resources?.dispose(); pack.dispose(); ground.geometry.dispose(); ground.material.dispose(); renderer.dispose();
      }
    };
    return { far: images, crowns: crownImages };
  }, { flowerColour });
  atlases.far.forEach((data, variant) => writeFileSync(resolve(output, `peach-atlas-v${variant}.png`),
    Buffer.from(data.split(",")[1]!, "base64")));
  for (const quality of ["high", "minimal"] as const) atlases.crowns[quality].forEach((data, variant) =>
    writeFileSync(resolve(output, `peach-crowns-${quality}-v${variant}.png`), Buffer.from(data.split(",")[1]!, "base64")));
  for (const detailed of [true, false]) for (const variant of [0, 1, 2]) for (const tier of ["near", "far"] as const) {
    reports.push(await page.evaluate(({ detailed, tier, variant }) =>
      (window as any).__production.draw(variant, tier, detailed), { detailed, tier, variant }));
    await page.screenshot({ path: resolve(output, `${detailed ? "high" : "minimal"}-${tier}-v${variant}.png`) });
  }
  for (const detailed of [true, false]) for (const variant of [0, 1, 2]) {
    reports.push(await page.evaluate(({ detailed, variant }) =>
      (window as any).__production.draw(variant, "far", detailed, 0, "iso"), { detailed, variant }));
    await page.screenshot({ path: resolve(output, `${detailed ? "high" : "minimal"}-far-iso-v${variant}.png`) });
  }
  for (const detailed of [true, false]) {
    reports.push(await page.evaluate(({ detailed }) =>
      (window as any).__production.draw(1, "near", detailed, Math.PI / 4), { detailed }));
    await page.screenshot({ path: resolve(output, `${detailed ? "high" : "minimal"}-near-oblique.png`) });
    for (const detailView of ["flower", "leaf"]) {
      reports.push(await page.evaluate(({ detailed, detailView }) =>
        (window as any).__production.draw(0, "near", detailed, 0, "cinematic", detailView), { detailed, detailView }));
      await page.screenshot({ path: resolve(output, `${detailed ? "high" : "minimal"}-production-${detailView}.png`) });
    }
  }
  for (const [count, near] of [[100, 0], [300, 0], [299, 1]]) {
    reports.push(await page.evaluate(({ count, near }) => (window as any).__production.bench(count, near), { count, near }));
    await page.screenshot({ path: resolve(output, `population-${count}-${near}.png`) });
  }
  await page.evaluate(() => (window as any).__production.dispose());
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status: "private production candidate", errors, reports }, null, 2));
  console.log(`Baked three full-tree and six quality-specific crown atlases (816 small original renders); captured 24 tier/macro/parallax views and 3 bounded population cases in ${output}`);
} finally {
  await browser?.close(); await server.close();
  const after = hashes();
  writeFileSync(resolve(output, "source-stability.json"), JSON.stringify({ unchanged: JSON.stringify(before) === JSON.stringify(after), before, after }, null, 2));
}
