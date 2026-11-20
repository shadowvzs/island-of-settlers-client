import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { BAMBOO_CONTENT_IDS } from "../../src/render-common/plants/bamboo-grove-species";
import { launchBrowser, startDevServer } from "./browser";

/**
 * Close model review of the bamboo groves through the actual decoration layer (both detail levels):
 * a full view, the culm base (nodes, sheaths, shoots, mound) and the crown (branch whorls, sprays).
 * Bench lights, not the island shading path; the in-game check is bamboo-game-review.ts.
 *
 * Usage (from island-of-settlers-client): npx tsx tools/bench/bamboo-grove-review.ts --out <dir>
 */
const outAt = process.argv.indexOf("--out");
assert(outAt >= 0, "--out <directory> is required (captures are never committed)");
const output = resolve(process.argv[outAt + 1]!);
mkdirSync(output, { recursive: true });
const ids = [...BAMBOO_CONTENT_IDS, "japanese-bamboo-stand"];
/** Framing: look-at height, camera distance and elevation (fractions of the grove height). */
const views = { full: [.48, 1.7, .2], base: [.06, .32, .25], crown: [.62, .42, .05] } as const;

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const errors: string[] = [];
try {
  for (const detailed of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error" && /shader|WebGL|THREE/i.test(message.text())) errors.push(message.text());
    });
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/bamboo-review.html", route => route.fulfill({ body: "<body style='margin:0'></body>",
      contentType: "text/html" }));
    await page.goto(`${url}bamboo-review.html`);
    await page.evaluate(async high => {
      const imp = (path: string) => import(/* @vite-ignore */ path);
      const t = await imp("/node_modules/three/build/three.module.js");
      const { createRomanMaterials } = await imp("/src/renderers/three/buildings/roman-materials.ts");
      const { createThreeRoadDecorations } = await imp("/src/renderers/three/settlement/three-road-decorations.ts");
      const renderer = new t.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(1); renderer.setSize(1000, 1000); renderer.setClearColor("#9fc3dc");
      renderer.outputColorSpace = t.SRGBColorSpace; renderer.toneMapping = t.ACESFilmicToneMapping;
      document.body.append(renderer.domElement);
      const scene = new t.Scene(), camera = new t.PerspectiveCamera(40, 1, .02, 80);
      scene.add(new t.HemisphereLight("#fff7e8", "#697478", 2.2));
      const sun = new t.DirectionalLight("#ffffff", 2.8); sun.position.set(-3, 6, 5); scene.add(sun);
      const ground = new t.Mesh(new t.CircleGeometry(6, 48), new t.MeshStandardMaterial({ color: "#7d9a52" }));
      ground.rotation.x = -Math.PI / 2; scene.add(ground);
      const base = createRomanMaterials(high);
      const owner = createThreeRoadDecorations({ cellsX: 16, cellsZ: 16, fogDisplayDisabled: true, fogRevision: 0 },
        high, () => base.materials);
      scene.add(owner.root);
      (window as any).review = async (item: string, [lookAt, reach, rise]: readonly [number, number, number],
        yaw: number) => {
        owner.update([{ item: `roadDecoration:${item}:native`, uid: 1, position: [0, 0, 0], yaw: 0, volumes: [],
          supports: [] }]);
        await owner.ready();
        const bounds = new t.Box3().setFromObject(owner.root), height = bounds.max.y;
        const target = new t.Vector3(0, height * lookAt, 0), distance = height * reach;
        camera.position.set(Math.sin(yaw) * distance, target.y + height * rise, Math.cos(yaw) * distance);
        camera.lookAt(target); renderer.render(scene, camera);
        return { height, triangles: renderer.info.render.triangles };
      };
    }, detailed);
    for (const id of ids) for (const [name, view] of Object.entries(views)) for (const yaw of [.5, 2.6]) {
      const data = await page.evaluate(([item, framing, angle]) => (window as any).review(item, framing, angle),
        [id, view, yaw] as const);
      await page.screenshot({ path: resolve(output, `${detailed ? "high" : "minimal"}-${id}-${name}-${yaw}.png`) });
      console.log(detailed ? "high" : "minimal", id, name, yaw, JSON.stringify(data));
    }
    await page.close();
  }
} finally {
  await browser.close(); await server.close();
}
assert.deepEqual(errors, []);
console.log(`Bamboo grove review: ${output}`);
