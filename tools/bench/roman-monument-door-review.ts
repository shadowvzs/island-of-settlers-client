import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const run = (process.argv[2] ?? "native-a").replace(/^--run=/, "");
const views = process.argv.includes("--front-only") ? ["front"] as const
  : ["whole", "front", "oblique", "backing-cutaway"] as const;
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "roman-monument-door-2026-11-04", run);
assert(!existsSync(resolve(output, "report.json")), "Preserve previous review evidence");
mkdirSync(output, { recursive: true });
const sources = ["src/renderers/three/buildings/monument-building.ts",
  "src/renderers/three/buildings/monument-owner-finish.ts",
  "src/renderers/three/buildings/window-shadow-material.ts",
  "assets/monuments/roman-high.glb", "assets/monuments/roman-minimal.glb",
  "tools/bench/roman-monument-door-review.ts"];
const hashes = () => Object.fromEntries(sources.map(path => [path,
  createHash("sha256").update(readFileSync(path)).digest("hex")]));
const before = hashes(), rows: unknown[] = [], errors: string[] = [];
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  for (const quality of ["high", "minimal"] as const) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.goto(`${url}building-showcase.html?nation=roman&quality=${quality}&building=7&level=5&sample=1`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady));
    await page.evaluate(async () => { await (window as any).__buildingResidentReady; });
    for (const view of views) {
      const measured = await page.evaluate(async view => {
        const t = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
        const preview = (window as any).__buildingPreview;
        preview.renderer.setAnimationLoop(null);
        const model = preview.model();
        model.update(0, { construction: 1, door: 0, working: false });
        model.root.updateMatrixWorld(true);
        const leaves: any[] = [], backing: any[] = [];
        model.root.traverse((object: any) => {
          if (!object.isMesh) return;
          if (/^DoorMain[LR]oak$/.test(object.name.replace(/[._]/g, ""))) leaves.push(object);
          if (object.userData.openingShadow) backing.push(object);
        });
        const bounds = new t.Box3();
        leaves.forEach(leaf => bounds.union(new t.Box3().setFromObject(leaf)));
        const center = bounds.getCenter(new t.Vector3());
        if (view !== "whole") {
          preview.scene.fog = null;
          // Inspect the real entrance from within its portico instead of centring a foreground column.
          if (view === "oblique") { preview.camera.fov = 44; preview.camera.updateProjectionMatrix(); }
          const offset = view === "oblique" ? new t.Vector3(1.1, .3, 2.1) : new t.Vector3(0, .2, 3.3);
          preview.camera.position.copy(center).add(offset);
          preview.controls.target.copy(center);
          preview.camera.lookAt(center);
          preview.controls.update();
        }
        // Deliberately labelled diagnostic: this landmark has no worker job or moving door contract.
        // Hiding its real opaque leaves exposes the existing interior-shadow plane for inspection.
        if (view === "backing-cutaway") leaves.forEach(leaf => { leaf.visible = false; });
        preview.renderer.render(preview.scene, preview.camera);
        const materials = (mesh: any): { name: string; opacity: number; transparent: boolean;
          color?: string; depthWrite: boolean; normalScale?: number[] }[] =>
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          .map((material: any) => ({ name: material.name, opacity: material.opacity,
            transparent: material.transparent, color: material.color?.getHexString(), depthWrite: material.depthWrite,
            normalScale: material.normalScale?.toArray() }));
        return { leaves: leaves.map(leaf => ({ name: leaf.name, visible: leaf.visible, materials: materials(leaf) })),
          backing: backing.map(mesh => ({ name: mesh.name, materials: materials(mesh),
            bounds: new t.Box3().setFromObject(mesh).toJSON?.() ?? { min: mesh.geometry.boundingBox?.min, max: mesh.geometry.boundingBox?.max } })),
          doorBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
          triangles: model.triangles(), calls: preview.renderer.info.render.calls,
          view, staticLandmark: true };
      }, view);
      assert.equal(measured.leaves.length, 2);
      assert.equal(measured.backing.length, 1);
      measured.leaves.forEach(leaf => leaf.materials.forEach(material => {
        // GLTFLoader retains the supplied map's inverted Y convention; reduce amplitude only.
        assert.equal(material.opacity, 1); assert.deepEqual(material.normalScale, [.2, -.2]);
      }));
      measured.backing.forEach(mesh => mesh.materials.forEach(material => {
        assert.equal(material.opacity, .5); assert.equal(material.color, "000000");
        assert.equal(material.transparent, true); assert.equal(material.depthWrite, false);
      }));
      rows.push({ quality, ...measured });
      await page.screenshot({ path: resolve(output, `${quality}-${view}.png`) });
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(hashes(), before);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ before, after: hashes(), errors, rows }, null, 2));
  const frames = ["high", "minimal"].flatMap(quality => views
    .map(view => `<figure><figcaption>${quality} / ${view}</figcaption><img src="${quality}-${view}.png"></figure>`));
  writeFileSync(resolve(output, "index.html"), `<!doctype html><meta charset="utf-8"><title>Roman monument doorway</title>
    <style>body{background:#eee;font:16px sans-serif}main{display:grid;grid-template-columns:1fr 1fr}img{width:100%}</style>
    <h1>Roman monument, level 5: actual doorway</h1><p>The landmark is static. Backing cutaways hide the real wooden
    leaves diagnostically; they do not depict a gameplay door-opening animation.</p><a href="report.json">Measurements</a>
    <main>${frames.join("")}</main>`);
} catch (error) {
  writeFileSync(resolve(output, "failure.json"), JSON.stringify({ error: String(error), errors, rows }, null, 2));
  throw error;
} finally { await browser.close(); await server.close(); }
