import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const run = process.argv[2] ?? "native-a";
const harbourOnly = process.argv[3] === "harbour-only";
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "roman-roof-corrections-2026-11-04", run);
assert(!existsSync(resolve(output, "report.json")), "Preserve previous native receipts");
mkdirSync(output, { recursive: true });
const sources = ["src/render-common/buildings/roman-occupation-roofs.ts",
  "src/render-common/buildings/levels/level-roof-vent.ts", "src/render-common/buildings/levels/level-dormer.ts",
  "src/render-common/buildings/levels/level-crown-roman.ts", "src/render-common/buildings/levels/level-crown-viking.ts",
  "src/render-common/buildings/roof-review-prototype.ts", "src/renderers/three/buildings/roman-harbor-beacon.ts",
  "src/render-common/buildings/building-window-shadows.ts", "src/renderers/three/buildings/window-shadow-geometry.ts",
  "src/renderers/three/buildings/roman-building.ts",
  "src/renderers/three/buildings/window-shadow-material.ts", "tools/bench/roman-roof-corrections-review.ts"];
const hashes = () => Object.fromEntries(sources.map(path => [path,
  createHash("sha256").update(readFileSync(path)).digest("hex")]));
const before = hashes(), results: unknown[] = [], errors: string[] = [], files: string[] = [];
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const watchdog = setTimeout(() => { void browser?.close().catch(() => {}); }, 120_000);
try {
  browser = await launchBrowser();
  for (const nation of harbourOnly ? ["roman"] : ["roman", "viking"]) for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript("window.__name=value=>value;");
    await page.goto(`${url}building-showcase.html?sample=1&nation=${nation}&quality=${quality}`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady));
    let cases = nation === "roman" ? [[17, 1], [17, 5], [1, 5], [37, 5], [40, 5], [39, 5]] : [[1, 5], [17, 5]];
    if (harbourOnly) cases = [[39, 5]];
    for (const [id, level] of cases) for (const close of [false, true]) {
      const result = await page.evaluate(async ({ close, id, level }) => {
        const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
        const p = (window as any).__buildingPreview;
        p.renderer.setAnimationLoop(null); p.controls.enabled = false;
        p.selectBuilding(id, level); await (window as any).__buildingResidentReady;
        const model = p.model(); model.update(0, { construction: 1, door: 0, working: false });
        model.root.updateMatrixWorld(true);
        const box = new three.Box3().setFromObject(model.root), size = box.getSize(new three.Vector3());
        const center = box.getCenter(new three.Vector3()), camera = p.camera.clone();
        camera.aspect = 1100 / 900; camera.updateProjectionMatrix();
        let distance = size.length() / 2 / Math.sin(camera.fov * Math.PI / 360) * 1.1;
        if (close) {
          center.y = box.min.y + size.y * .79;
          distance = Math.max(size.x, size.z) * 1.65;
          if (id === 39) {
            const beacon = model.root.getObjectByName("harbor_shore_beacon");
            if (!beacon) throw new Error("Actual harbour beacon missing");
            new three.Box3().setFromObject(beacon).getCenter(center); distance = .9;
          }
        }
        camera.position.copy(center).addScaledVector(new three.Vector3(4.5, 3.2, 5.5).normalize(), distance);
        camera.lookAt(center); camera.updateMatrixWorld(true);
        p.renderer.render(p.scene, camera);
        let shadows = 0;
        model.root.traverse((object: any) => {
          if (!object.isMesh || !object.userData.windowShadow) return;
          shadows++;
          if (object.material.opacity !== .5 || object.material.color.getHex() !== 0 || object.material.depthWrite)
            throw new Error("A semantic window lost its exact shared alpha-black material");
        });
        let brazierMaterial;
        if (id === 39) {
          const base = model.root.getObjectByName("harbor_beacon_brazier");
          if (base.material.vertexColors && !base.geometry.hasAttribute("color"))
            throw new Error("Brazier requires nonexistent vertex colors and will render black");
          brazierMaterial = { color: base.material.color.getHex(), vertexColors: base.material.vertexColors,
            opacity: base.material.opacity, metalness: base.material.metalness };
        }
        return { shadows, triangles: model.triangles(false), close, id, level, brazierMaterial };
      }, { close, id: id!, level: level! });
      const file = `${nation}-${quality}-${id}-l${level}-${close ? "close" : "front"}.png`;
      await page.screenshot({ path: resolve(output, file) }); files.push(file);
      results.push({ nation, quality, ...result });
      console.log(`${nation}/${quality}/${id}/L${level}/${close ? "close" : "front"}`);
    }
    await page.close();
  }
  assert.deepEqual(hashes(), before); assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ sourceHashes: before, errors, results, files }, null, 2));
  writeFileSync(resolve(output, "index.html"), `<meta charset="utf-8"><title>Roman roof corrections</title>${
    files.map(file => `<figure><img style="width:700px;max-width:100%" src="${file}"><figcaption>${file}</figcaption></figure>`).join("")}`);
} catch (error) {
  writeFileSync(resolve(output, "failure.json"), JSON.stringify({ error: String(error), errors, results, files }, null, 2));
  throw error;
} finally { clearTimeout(watchdog); await browser?.close(); await server.close(); }
