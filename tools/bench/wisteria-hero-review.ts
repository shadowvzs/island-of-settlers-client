import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "reference-hero-a";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid hero review run name");
const requestedViews = process.argv.find(argument => argument.startsWith("--views="))?.slice(8).split(",") ??
  ["front", "oblique", "canopy", "raceme", "leaf", "trunk", "gameplay"];
if (!requestedViews.length || new Set(requestedViews).size !== requestedViews.length ||
  requestedViews.some(view => !["front", "oblique", "canopy", "raceme", "leaf", "trunk", "gameplay"].includes(view)))
  throw new Error("Invalid Wisteria review views");
const frame = process.argv.find(argument => argument.startsWith("--frame="))?.slice(8) ?? "curved";
if (!["curved", "lattice", "pergola"].includes(frame)) throw new Error("Invalid Wisteria frame");
const allFrames = process.argv.includes("--all-frames");
const frames = allFrames ? ["curved", "lattice", "pergola"] : [frame];
const minimal = process.argv.includes("--minimal"), lean = process.argv.includes("--lean");
const output = resolve("../resources/project-reviews/road-decoration-prototypes-2026-11-03", run);
mkdirSync(output, { recursive: true });
const errors: string[] = [];
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  for (const frame of frames) {
  const caseOutput = allFrames ? resolve(output, frame) : output;
  mkdirSync(caseOutput, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/wisteria-hero.html", route => route.fulfill({ body: "<body style='margin:0'></body>", contentType: "text/html" }));
  await page.goto(`${url}wisteria-hero.html`);
  const measured = await page.evaluate(async ({ frame, lean, minimal }: { frame: "curved" | "lattice" | "pergola"; minimal: boolean; lean: boolean }) => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const t = await imp("/node_modules/three/build/three.module.js");
    const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
    const { createWisteriaHero } = await imp("/src/renderers/three/wisteria-hero.ts");
    const renderer = new t.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 1000); renderer.setPixelRatio(1); renderer.outputColorSpace = t.SRGBColorSpace;
    renderer.toneMapping = t.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
    document.body.append(renderer.domElement);
    const scene = new t.Scene(); scene.background = new t.Color("#bcc3b2");
    scene.add(new t.HemisphereLight("#fff8eb", "#777e60", 2.1));
    const sun = new t.DirectionalLight("#fff3dd", 2.7); sun.position.set(-3, 6, 5); scene.add(sun);
    const { createWisteriaBotanicalTemplates } = await imp("/src/renderers/three/wisteria-botanical-templates.ts");
    let templates;
    if (minimal) {
      const { createWisteriaMinimalTemplates } = await imp("/src/renderers/three/wisteria-minimal-templates.ts");
      const atlas = await new t.TextureLoader().loadAsync("/assets/botanical-textures/wisteria-owned-lod-atlas-candidate.png");
      const metadata = await (await fetch("/assets/botanical-textures/wisteria-owned-lod-atlas-candidate.json")).json();
      if (metadata.coverage.fixedFront >= metadata.coverage.racemeFront * .5)
        throw new Error("Rejected Wisteria atlas: fixed-colour tiles contain neutral flowers");
      templates = createWisteriaMinimalTemplates(atlas, metadata);
    } else templates = createWisteriaBotanicalTemplates({ neutralAtlas: true, lean });
    const base = createRomanMaterials(!minimal), model = createWisteriaHero(base.materials, templates, { minimal, lean, frame });
    const textureDeadline = performance.now() + 15000;
    while (!templates.materials.atlasReady()) {
      if (templates.materials.atlasFailed() || performance.now() > textureDeadline)
        throw new Error("Wisteria neutral atlas failed to load");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    scene.add(model.root);
    const ground = new t.Mesh(new t.PlaneGeometry(30, 30), new t.MeshStandardMaterial({ color: "#899569", roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.005; scene.add(ground);
    const camera = new t.PerspectiveCamera(35, 1.2, .005, 60);
    const bounds = new t.Box3().setFromObject(model.root);
    (window as any).hero = {
      draw: (view: string) => {
        const raceme = model.inspection.raceme, leaf = model.inspection.leaf;
        const poses: Record<string, number[]> = {
          front: [0, 1.9, 6.9, 0, 1.7, 0], oblique: [3.8, 2.9, 5.8, 0, 1.8, 0],
          canopy: [1.5, 4.1, 2.7, 0, 3.04, 0],
          raceme: [raceme[0] + .08, raceme[1] + .015, raceme[2] + .40, ...raceme],
          leaf: [leaf[0] + .10, leaf[1] + .23, leaf[2] + .40, ...leaf], trunk: [1.42, .92, .83, 1, .85, 0],
          gameplay: [5.6, 5.7, 7.4, 0, 1.6, 0]
        };
        const pose = poses[view];
        if (!pose) throw new Error(`Unknown hero view ${view}`);
        camera.position.set(...pose.slice(0, 3)); camera.lookAt(...pose.slice(3));
        renderer.render(scene, camera);
        return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
      },
      dispose: () => { model.dispose(); templates.dispose(); base.dispose(); ground.geometry.dispose(); ground.material.dispose();
        renderer.dispose(); renderer.forceContextLoss(); }
    };
    return { bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, counts: model.counts, topology: model.topology };
  }, { frame: frame as "curved" | "lattice" | "pergola", lean, minimal });
  const views = [];
  for (const view of requestedViews) {
    const metrics = await page.evaluate(view => (window as any).hero.draw(view), view);
    await page.screenshot({ path: resolve(caseOutput, `${minimal ? "minimal" : "high"}-purple-${view}.png`) }); views.push({ view, ...metrics });
  }
  await page.evaluate(() => (window as any).hero.dispose()); await page.close();
  assert.deepEqual(errors, []);
  writeFileSync(resolve(caseOutput, "report.json"), JSON.stringify({ status: "UNACCEPTED private Wisteria LOD candidate; no production budget approval", quality: minimal ? "minimal" : "high", frame, lean, measured, views, errors }, null, 2));
  console.log(`Captured ${views.length} ${minimal ? "Minimal" : "High"} ${frame} diagnostic views`);
  }
} finally { await browser.close(); await server.close(); }
