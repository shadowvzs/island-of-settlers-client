import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { type GalleryCard, writeGalleryIndex } from "./building-gallery-index";
import { type GalleryCase, galleryCaseKey } from "./building-gallery-plan";
import { renderGalleryCase, renderGallerySheet } from "./building-gallery-render";
import { gallerySourceGuard } from "./building-gallery-source";
import { resourcesPath } from "./resources-path";

const run = process.argv[2] ?? "native-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resourcesPath("project-reviews", "building-textile-cleanup-2026-11-04", run);
assert(!existsSync(output), "Preserve prior review attempts");
mkdirSync(output, { recursive: true });
const guard = gallerySourceGuard(), errors: string[] = [], rows: unknown[] = [], cards: GalleryCard[] = [];
const { server, url } = await startDevServer();
let browser: Browser | undefined;
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 768, height: 640 } });
  page.on("request", request => guard.request(request.url()));
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name=value=>value;");
  for (const nation of ["maya", "indigenous"] as const) for (const quality of ["high", "minimal"] as const) {
    await page.goto(`${url}building-showcase.html?sample=1&nation=${nation}&quality=${quality}`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady));
    for (const id of nation === "maya" ? [0, 20, 22, 33, 35, 61] : [35, 40]) {
      const entry: GalleryCase = { nation, quality, id, level: 5, name: `Type ${id}` };
      const result = await page.evaluate(renderGalleryCase, { entry, views: ["front", "rear"] as const });
      assert(result.residentTriangles > 0);
      for (const image of result.images) {
        const file = `${galleryCaseKey(entry)}-${image.view}.jpg`;
        writeFileSync(resolve(output, file), Buffer.from(image.encoded, "base64"));
        cards.push({ ...entry, file, view: image.view, triangles: result.triangles, withinBudget: result.withinBudget });
      }
      const { images: _images, ...measurements } = result;
      rows.push({ ...entry, ...measurements });
      if (nation === "maya" && id === 0) {
        const macro = await page.evaluate(async () => {
          const t = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
          const p = (window as any).__buildingPreview;
          const meshes: any[] = [];
          p.model().root.traverse((object: any) => {
            if (object.isMesh && object.material?.name === "maya_headquarters_quetzal") meshes.push(object);
          });
          if (meshes.length !== 1) throw new Error("Expected exactly one original headquarters textile");
          const mesh = meshes[0]!, box = new t.Box3().setFromObject(mesh), center = box.getCenter(new t.Vector3());
          const camera = p.camera.clone();
          const height = box.getSize(new t.Vector3()).y;
          camera.position.copy(center).add(new t.Vector3(height * 2, height * .1, height * .15));
          camera.lookAt(center);camera.updateMatrixWorld(true);
          p.renderer.render(p.scene,camera);
          return { encoded:p.renderer.domElement.toDataURL("image/jpeg",.94).split(",")[1],
            map:mesh.material.map.image.width,normal:Boolean(mesh.material.normalMap),opacity:mesh.material.opacity };
        });
        assert.equal(macro.map,quality === "high" ? 512 : 256);
        assert.equal(macro.normal,quality === "high");assert.equal(macro.opacity,1);
        const file = `${quality}-headquarters-textile-macro.jpg`;
        writeFileSync(resolve(output,file),Buffer.from(macro.encoded,"base64"));
        rows.push({ quality, macro: true, map:macro.map, normal:macro.normal,opacity:macro.opacity,file });
      }
    }
  }
  const sheets: string[] = [];
  for (let first = 0; first < cards.length; first += 12) {
    const group = cards.slice(first,first+12);
    const tiles = group.map(card => ({ encoded:readFileSync(resolve(output,card.file)).toString("base64"),
      label:`${card.nation} ${card.id} ${card.quality} ${card.view}` }));
    const file=`sheet-${first/12+1}.jpg`;
    writeFileSync(resolve(output,file),Buffer.from(await page.evaluate(renderGallerySheet,tiles),"base64"));sheets.push(file);
  }
  const source = guard.finish();
  writeFileSync(resolve(output,"source-manifest.json"),JSON.stringify(source,null,2));
  writeFileSync(resolve(output,"report.json"),JSON.stringify({rows,errors,sourceStable:source.stable,frames:cards.length+2},null,2));
  writeGalleryIndex(output,cards,{capturedVariants:16,complete:true,frames:32,mode:"full",native:true,
    omitted:0,passed:source.stable&&!errors.length,sheets,variants:16});
  const indexPath=resolve(output,"index.html");
  writeFileSync(indexPath,readFileSync(indexPath,"utf8").replace("<nav>",
    `<p>Actual headquarters textile macros: <a href="high-headquarters-textile-macro.jpg">High</a> /
    <a href="minimal-headquarters-textile-macro.jpg">Minimal</a>.</p><nav>`));
  assert.deepEqual(errors,[]);assert(source.stable,source.errors.join("\n"));
} finally { await browser?.close();await server.close(); }
console.log("Textile cleanup native FULL CLOSED");
