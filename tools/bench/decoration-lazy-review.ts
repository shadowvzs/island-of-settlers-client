import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "decoration-lazy-2026-11-04");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const rows: unknown[] = [], errors: string[] = [];
try {
  for (const detailed of [true, false]) {
    const quality = detailed ? "high" : "minimal", page = await browser.newPage();
    const requests: string[] = [];
    page.on("request", request => requests.push(new URL(request.url()).pathname));
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/decoration-lazy-review.html", route => route.fulfill({
      body: "<body style='margin:0'></body>", contentType: "text/html"
    }));
    await page.goto(`${url}decoration-lazy-review.html`);
    await page.evaluate(async detailed => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createThreeRoadDecorations } = await imp("/src/renderers/three/settlement/three-road-decorations.ts");
      const renderer = new t.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      renderer.setSize(960, 720); document.body.append(renderer.domElement);
      const scene = new t.Scene(); scene.background = new t.Color("#c1c9b1");
      scene.add(new t.HemisphereLight(0xffffff, 0x647454, 2));
      const camera = new t.PerspectiveCamera(40, 960 / 720, .1, 60);
      camera.position.set(5, 4, 7); camera.lookAt(0, 1.5, 0);
      let borrowed = 0;
      const base = new Proxy({}, { get: (_target, key: string) => {
        if (!(key in base)) Object.defineProperty(base, key, { value: new t.MeshStandardMaterial({ vertexColors: true }) });
        return Object.getOwnPropertyDescriptor(base, key)!.value;
      } });
      const materialsFor = () => { borrowed++; return base; };
      const world = { cellsX: 16, cellsZ: 16, fogDisplayDisabled: true };
      let owner = createThreeRoadDecorations(world, detailed, materialsFor);
      scene.add(owner.root, owner.ghostRoot);
      const draw = () => { renderer.render(scene, camera); return { ...renderer.info.memory }; };
      const frame = (item: string, uid = 1) => ({ uid, item, position: [0, 0, 0], yaw: 0, volumes: [], supports: [] });
      const pot = "roadDecoration:indigenous-flower-pot:native";
      const api = {
        empty: () => ({ borrowed, stats: owner.statistics(), memory: draw() }),
        preview: async () => {
          const started = performance.now();
          owner.updateGhost({ item: pot, position: [0, 0, 0], yaw: 0, valid: true });
          await owner.ready(); draw();
          return { ms: performance.now() - started, borrowed, stats: owner.statistics(), children: owner.ghostRoot.children.length };
        },
        cancel: () => { owner.updateGhost(null); return { children: owner.ghostRoot.children.length, memory: draw() }; },
        place: async () => {
          const started = performance.now(); owner.update(Array.from({ length: 30 }, (_, index) => ({
            ...frame(pot, index + 1), position: [index % 6 * .4 - 1, 0, Math.floor(index / 6) * .4 - 1]
          }))); await owner.ready(); draw();
          return { ms: performance.now() - started, stats: owner.statistics(), memory: draw() };
        },
        switches: async () => {
          const ids = [pot, "roadDecoration:plant-cherry-blossom-roadside-ground-0:native"];
          const rows = [];
          for (let index = 0; index < 12; index++) {
            owner.dispose(); owner = createThreeRoadDecorations(world, detailed, materialsFor);
            scene.add(owner.root, owner.ghostRoot); owner.update([frame(ids[index % ids.length]!)]);
            await owner.ready(); owner.setHover(1); draw(); owner.setHover(null); rows.push({ ...renderer.info.memory });
          }
          return rows;
        },
        late: async () => {
          owner.dispose(); owner = createThreeRoadDecorations(world, detailed, materialsFor);
          scene.add(owner.root, owner.ghostRoot);
          owner.update([frame("roadDecoration:roman-rusticated-arch:limestone")]);
          const old = owner; old.dispose(); await old.ready(); await Promise.resolve();
          return { children: old.root.children.length, ghost: old.ghostRoot.children.length, stats: old.statistics(), memory: draw() };
        },
        dispose: () => {
          owner.dispose(); const memory = draw();
          for (const material of Object.values(base)) (material as any).dispose();
          renderer.dispose(); return memory;
        }
      };
      (window as any).__lazy = api;
    }, detailed);
    const empty = await page.evaluate(() => (window as any).__lazy.empty());
    const initialRequests = [...requests];
    assert.equal(empty.borrowed, 0); assert.equal(empty.stats.templates, 0);
    assert(!initialRequests.some(path => /road-decoration-model\.ts|road-plant-model(?:-core)?\.ts/.test(path)), initialRequests.join("\n"));
    const preview = await page.evaluate(() => (window as any).__lazy.preview());
    assert(preview.children > 0); assert.equal(preview.stats.templates, 1);
    assert(requests.some(path => path.endsWith("/road-decoration-model.ts")));
    const afterPreviewRequests = requests.length;
    const cancel = await page.evaluate(() => (window as any).__lazy.cancel()); assert.equal(cancel.children, 0);
    const placed = await page.evaluate(() => (window as any).__lazy.place());
    assert.equal(placed.stats.instances, 30); assert.equal(placed.stats.templates, 1);
    assert.equal(requests.length, afterPreviewRequests);
    await page.screenshot({ path: resolve(output, `${quality}-placed.png`) });
    const switches = await page.evaluate(() => (window as any).__lazy.switches());
    for (const parity of [0, 1]) {
      const comparable = switches.filter((_row: unknown, index: number) => index >= 4 && index % 2 === parity);
      assert(comparable.every((row: any) => row.geometries === comparable[0].geometries && row.textures === comparable[0].textures), JSON.stringify(comparable));
    }
    const late = await page.evaluate(() => (window as any).__lazy.late());
    assert.equal(late.children, 0); assert.equal(late.stats.templates, 0);
    const final = await page.evaluate(() => (window as any).__lazy.dispose()); assert.equal(final.geometries, 0);
    rows.push({ quality, empty, initialRequests, preview, cancel, placed, switches, late, final,
      modelRequests: requests.filter(path => /road-decoration-model\.ts|road-plant-model(?:-core)?\.ts/.test(path)) });
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ rows, errors }, null, 2));
  await browser.close(); await server.close();
}
console.log(JSON.stringify({ output, qualities: rows.length, errors }));
