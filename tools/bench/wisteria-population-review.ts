import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "minimal-population";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid Wisteria population run");
const output = resolve("../resources/project-reviews/road-decoration-prototypes-2026-11-03", run);
mkdirSync(output, { recursive: true });
const errors: string[] = [];
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/wisteria-population.html", route => route.fulfill({ body: "<body style='margin:0'></body>", contentType: "text/html" }));
  await page.goto(`${url}wisteria-population.html`);
  const report = await page.evaluate(async () => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const t = await imp("/node_modules/three/build/three.module.js");
    const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
    const { createWisteriaHero } = await imp("/src/renderers/three/wisteria-hero.ts");
    const { createWisteriaMinimalTemplates } = await imp("/src/renderers/three/wisteria-minimal-templates.ts");
    const { createWisteriaPopulationTemplates } = await imp("/src/renderers/three/wisteria-population-templates.ts");
    const metadata = await (await fetch("/assets/botanical-textures/wisteria-owned-lod-atlas-candidate.json")).json();
    if (metadata.coverage.fixedFront >= metadata.coverage.racemeFront * .5)
      throw new Error("Rejected Wisteria atlas: fixed-colour tile contains neutral flowers");
    const atlas = await new t.TextureLoader().loadAsync("/assets/botanical-textures/wisteria-owned-lod-atlas-candidate.png");
    const botanical = createWisteriaMinimalTemplates(atlas, metadata), base = createRomanMaterials(false);
    const model = createWisteriaHero(base.materials, botanical, { minimal: true, flowerPalette: [1, 1, 1] });
    const buildAt = performance.now();
    const owner = createWisteriaPopulationTemplates({ root: model.root, dispose: () => {
      model.dispose(); botanical.dispose();
    } }, (mesh: any) => mesh.name === "wisteria_minimal_neutral_racemes");
    const templateBuildMs = performance.now() - buildAt;
    const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 900); renderer.outputColorSpace = t.SRGBColorSpace;
    renderer.toneMapping = t.ACESFilmicToneMapping;
    document.body.append(renderer.domElement);
    const scene = new t.Scene(); scene.background = new t.Color("#bcc3b2");
    scene.add(new t.HemisphereLight("#fff8eb", "#777e60", 2.1));
    const sun = new t.DirectionalLight("#fff3dd", 2.7); sun.position.set(-3, 6, 5); scene.add(sun);
    const camera = new t.PerspectiveCamera(35, 1200 / 900, .01, 200);
    const gl = renderer.getContext(), timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const cases = [], palettes = [[.75, .62, .92], [1, 1, 1], [.85, .55, .69]] as const;
    let picture = "";
    try {
      for (const count of [1, 32, 128]) {
        const batch = owner.create(count), commitAt = performance.now();
        for (let index = 0; index < count; index++) {
          const matrix = new t.Matrix4().makeTranslation((index % 16) * 3.3, 0, Math.floor(index / 16) * 3.3);
          batch.set(index, matrix, palettes[index % palettes.length]);
        }
        batch.commit(); const commitMs = performance.now() - commitAt;
        scene.add(batch.root);
        const bounds = new t.Box3().setFromObject(batch.root), center = bounds.getCenter(new t.Vector3());
        const span = Math.max(7, bounds.getSize(new t.Vector3()).length());
        camera.position.copy(center).add(new t.Vector3(span * .65, span * .55, span * .85)); camera.lookAt(center);
        renderer.render(scene, camera);
        const frames = [], queries = [];
        for (let frame = 0; frame < 45; frame++) {
          const query = timer ? gl.createQuery() : null;
          if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
          const before = performance.now(); renderer.render(scene, camera);
          if (query) { gl.endQuery(timer.TIME_ELAPSED_EXT); queries.push(query); }
          await new Promise(requestAnimationFrame); frames.push(performance.now() - before);
        }
        frames.sort((left, right) => left - right);
        const gpu: number[] = [];
        for (let wait = 0; wait < 4 && queries.some(query => !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)); wait++)
          await new Promise(requestAnimationFrame);
        const gpuDisjoint = !!timer && gl.getParameter(timer.GPU_DISJOINT_EXT);
        for (const query of queries) {
          if (!gpuDisjoint && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
            gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(query);
        }
        gpu.sort((left, right) => left - right);
        cases.push({ count, commitMs, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls,
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
          medianFrameMs: frames[Math.floor(frames.length / 2)], p95FrameMs: frames[Math.floor(frames.length * .95)],
          gpuSamples: gpu.length, gpuDisjoint,
          gpuMedianMs: gpu[Math.floor(gpu.length / 2)] ?? null, gpuP95Ms: gpu[Math.floor(gpu.length * .95)] ?? null });
        if (count === 128) picture = renderer.domElement.toDataURL("image/png").split(",")[1]!;
        batch.dispose();
      }
      return { templateBuildMs, templateTriangles: owner.triangles, surfaces: owner.surfaces, cases, picture,
        scope: "One frozen static Minimal template; all placements deliberately rendered, no shadow pass. Three flower palettes share buffers/atlas. Warm frame timings are this browser/machine only; optional hardware GPU queries are null if unavailable/disjoint. This is not a complete game/mobile benchmark." };
    } finally { owner.dispose(); base.dispose(); renderer.dispose(); renderer.forceContextLoss(); }
  });
  const { picture, ...metrics } = report;
  writeFileSync(resolve(output, "128-placements.png"), Buffer.from(picture, "base64"));
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ ...metrics, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert(report.templateTriangles <= 2300);
  assert(report.cases.every((entry: any) => entry.calls === report.surfaces));
  assert(report.cases.every((entry: any) => entry.geometries === report.cases[0]!.geometries));
  console.log(JSON.stringify(metrics));
  await page.close();
} finally { await browser.close(); await server.close(); }
