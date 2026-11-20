import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const selection = process.env.SCULPTURE_KINDS;
const reportSuffix = selection ? `-${selection}` : "";
const tier = process.env.SCULPTURE_TIER === "ornament" ? "ornament" : "hero";
const suffix = tier === "ornament" ? "-ornament" : "";
// Review renders and generated GLBs stay in resources; the game builds sculptures procedurally,
// so these must not bloat the client asset tree or the production bundle.
const output = resolve("../resources/models/national-sculptures");
const models = output;
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const kind of (selection ?? "phoenix,qilin").split(",")) for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/sculpture-review", route => route.fulfill({ contentType: "text/html", body: "<body style='margin:0'>" }));
    await page.goto(`${url}sculpture-review`);
    const report = await page.evaluate(async ({ kind, quality, tier }) => {
      const T = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const { GLTFExporter } = await import(/* @vite-ignore */ String("/node_modules/three/examples/jsm/exporters/GLTFExporter.js"));
      const { createCulturalSculpture } = await import(/* @vite-ignore */ String("/src/renderers/three/props/cultural-sculptures.ts"));
      const asset = createCulturalSculpture(kind, quality === "high", true, tier);
      const scene = new T.Scene(); scene.background = new T.Color("#bfc5b5"); scene.add(asset.root);
      scene.add(new T.HemisphereLight("#fff1dc", "#6c7580", 2.3));
      const sun = new T.DirectionalLight("#fff1d5", 3); sun.position.set(-3, 5, 4); scene.add(sun);
      const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(innerWidth, innerHeight); document.body.append(renderer.domElement);
      const bounds = new T.Box3().setFromObject(asset.root), centre = bounds.getCenter(new T.Vector3());
      const radius = bounds.getSize(new T.Vector3()).length() / 2;
      const camera = new T.PerspectiveCamera(34, innerWidth / innerHeight, .01, 100);
      const captures: { name: string; png: string }[] = [];
      for (const [name, distance] of [["close", 1], ["gameplay", 2.5], ["back", -1], ["side", 1], ["head", 1]] as const) {
        camera.position.copy(centre).add(new T.Vector3(radius * .8, radius * .35, radius * 3.8 * distance));
        if (name === "side") camera.position.copy(centre).add(new T.Vector3(radius * 3.8, radius * .35, radius * .15));
        if (name === "head") {
          const heads: Record<string, [number, number, number]> = { qilin: [0, .99, .52], phoenix: [0, .78, .18] };
          const head = new T.Vector3(...heads[kind]!);
          camera.position.copy(head).add(new T.Vector3(.38, .12, .72)); camera.lookAt(head);
        } else camera.lookAt(centre);
        renderer.render(scene, camera);
        captures.push({ name, png: renderer.domElement.toDataURL("image/png").split(",")[1]! });
      }
      const bytes = new Uint8Array(await new GLTFExporter().parseAsync(asset.root, { binary: true, onlyVisible: true }));
      const { GLTFLoader } = await import(/* @vite-ignore */ String("/node_modules/three/examples/jsm/loaders/GLTFLoader.js"));
      const roundtrip = await new GLTFLoader().parseAsync(bytes.buffer, "");
      let reloadedTriangles = 0;
      roundtrip.scene.traverse((object: any) => {
        if (object.isMesh) reloadedTriangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
      });
      const loadedBounds = new T.Box3().setFromObject(roundtrip.scene);
      const roundtripError = Math.max(loadedBounds.min.distanceTo(bounds.min), loadedBounds.max.distanceTo(bounds.max));
      let binary = "";
      for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      let triangles = 0;
      asset.root.traverse((object: any) => { if (object.isMesh) triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3; });
      const result = { kind, quality, tier, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
        mountOrigin: asset.recipe.mountOrigin, triangles, reloadedTriangles, roundtripError, draws: renderer.info.render.calls, glb: btoa(binary), captures };
      asset.dispose(); renderer.dispose(); return result;
    }, { kind, quality, tier });
    assert.deepEqual(errors, []);
    assert.equal(report.triangles, report.reloadedTriangles);
    assert(report.roundtripError < .00001);
    const { captures, glb, ...metrics } = report;
    const path = resolve(models, `${kind}-${quality}${suffix}.glb`); writeFileSync(path, Buffer.from(glb, "base64"));
    for (const { name, png } of captures) writeFileSync(resolve(output, `${kind}-${quality}${suffix}-${name}.png`), Buffer.from(png, "base64"));
    reports.push({ ...metrics, bytes: Buffer.byteLength(glb, "base64"), errors }); await page.close();
  }
  writeFileSync(resolve(output, `export${reportSuffix}${suffix}-stats.json`), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports));
} finally { await browser.close(); await server.close(); }
