import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "../bench/browser";

/** Original native plant/animal meshes for non-ware production inputs; static UI thumbnails only. */
const output = resolve("assets/resource-previews");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { height: 192, width: 192 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/src/building-showcase/main.ts", route => route.fulfill({ body: "", contentType: "text/javascript" }));
  await page.goto(`${url}building-showcase.html`);
  for (const kind of ["vine", "hive", "rice", "wheat", "fish", "tea", "pomegranate", "cacao", "berries"]) {
    await page.evaluate(async crop => {
      const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const { createDrinkCropMesh } = await import(/* @vite-ignore */ String("/src/render-common/props/drink-crops/drink-crop-meshes.ts"));
      const { HIVE_BENCH_TOP } = await import(/* @vite-ignore */ String("/src/render-common/props/drink-crops/beehive-mesh.ts"));
      const { createWheatMeshData } = await import(/* @vite-ignore */ String("/src/render-common/wheat-field.ts"));
      const { createFishModel, RIVER_TROUT } = await import(/* @vite-ignore */ String("/src/render-common/critters/model/fish.ts"));
      document.body.replaceChildren(); document.body.style.cssText = "margin:0;overflow:hidden;background:transparent";
      const renderer = new three.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(192, 192); renderer.setClearColor(0, 0);
      document.body.append(renderer.domElement);
      renderer.outputColorSpace = three.SRGBColorSpace;
      renderer.toneMapping = three.ACESFilmicToneMapping;
      const scene = new three.Scene(), group = new three.Group();
      const material = new three.MeshStandardMaterial({ roughness: .8, side: three.DoubleSide, vertexColors: true });
      const add = (data: any, y = 0) => {
        const geometry = new three.BufferGeometry();
        geometry.setAttribute("position", new three.Float32BufferAttribute(data.positions, 3));
        geometry.setAttribute("normal", new three.Float32BufferAttribute(data.normals, 3));
        geometry.setAttribute("color", new three.Float32BufferAttribute(data.colors, 3));
        if (data.indices) geometry.setIndex(new three.BufferAttribute(data.indices, 1));
        const mesh = new three.Mesh(geometry, material); mesh.position.y = y; group.add(mesh);
      };
      if (crop === "vine") {
        for (const key of ["vine-trellis", "vine-plant-leafy-0", "vine-bunch-full-0", "vine-bunch-full-1", "vine-bunch-full-2"])
          add(createDrinkCropMesh(key, true));
      } else if (crop === "hive") {
        add(createDrinkCropMesh("hive-stand", true)); add(createDrinkCropMesh("hive-skep", true), HIVE_BENCH_TOP);
      } else if (crop === "rice") add(createDrinkCropMesh("rice-ripe", true));
      else if (["tea", "pomegranate", "cacao", "berries"].includes(crop)) add(createDrinkCropMesh(`${crop}-ripe`, true));
      else if (crop === "fish") add(createFishModel(RIVER_TROUT).frames[2]);
      else add(createWheatMeshData(12, true));
      group.rotation.y = -.35;
      scene.add(group, new three.HemisphereLight(0xfff5df, 0x707466, 2));
      const sun = new three.DirectionalLight(0xffeed8, 3); sun.position.set(-3, 7, 5); scene.add(sun);
      const box = new three.Box3().setFromObject(group), centre = box.getCenter(new three.Vector3());
      const distance = box.getSize(new three.Vector3()).length() * 4;
      const camera = new three.OrthographicCamera(-1, 1, 1, -1, .001, 100);
      camera.position.copy(centre).add(new three.Vector3(4, 3, 5).normalize().multiplyScalar(distance));
      camera.lookAt(centre); camera.updateMatrixWorld();
      let extent = 0;
      group.updateWorldMatrix(true, true);
      // Fit the actual viewed vertices, rather than the much larger diagonal of their world bounds.
      for (const mesh of group.children as any[]) {
        const positions = mesh.geometry.getAttribute("position");
        for (let index = 0; index < positions.count; index++) {
          const point = new three.Vector3().fromBufferAttribute(positions, index)
            .applyMatrix4(mesh.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
          extent = Math.max(extent, Math.abs(point.x), Math.abs(point.y));
        }
      }
      const span = extent * 1.14;
      camera.left = -span; camera.right = span; camera.top = span; camera.bottom = -span;
      camera.updateProjectionMatrix(); renderer.render(scene, camera);
      (window as any).__disposeResourcePreview = () => {
        for (const mesh of group.children as any[]) mesh.geometry.dispose();
        material.dispose(); renderer.dispose();
      };
    }, kind);
    await page.locator("canvas").screenshot({ omitBackground: true, path: resolve(output, `${kind}.png`) });
    await page.evaluate(() => (window as any).__disposeResourcePreview());
  }
  assert.deepEqual(errors, []);
  console.log(`Exported nine native production-resource previews: ${output}`);
} finally { await browser.close(); await server.close(); }
