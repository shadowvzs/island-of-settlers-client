import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/project-reviews/chinese-palette-examples");
mkdirSync(output, { recursive: true });
const palettes = [
  { id: "emerald-burgundy", roof: "#16885f", frame: "#80282e", wall: "#eedab2" },
  { id: "gold-black", roof: "#cd9a2f", frame: "#302521", wall: "#f1e3c6" },
  { id: "blue-redwood", roof: "#285cb8", frame: "#8f3c25", wall: "#f2d7a8" },
  { id: "red-tiles-brown", roof: "#c8482f", frame: "#623333", wall: "#efd9b6" },
  { id: "tiles-navy", roof: "#202d49", frame: "#633631", wall: "#efd9b6" },
  { id: "tiles-burgundy", roof: "#773f46", frame: "#633631", wall: "#efd9b6" },
  { id: "tiles-fired-red", roof: "#a35845", frame: "#633631", wall: "#efd9b6" }
];
const { server, url } = await startDevServer(), browser = await launchBrowser();
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name = value => value;");
  await page.routeWebSocket("**/*", () => {});
  const newTiles = process.env.PALETTE_IDS?.includes("tiles-") ?? false;
  if (newTiles) {
    await page.addInitScript(`window.__paletteRoofRecipe=(recipe,id)=>{
      let parts=recipe.parts.map(part=>part.shape==='occupation-roof'&&part.roofSweep!==undefined
        ? {...part,roofTiles:'pan-cover'}:part);
      if(id===4){
        const roof=parts.find(part=>part.shape==='occupation-roof'&&part.roofSweep!==undefined);
        if(roof){parts=parts.filter(part=>!['roof','roof-slate','roof-shingles'].includes(part.surface));
          parts.push({...roof,occupationRoof:'pyramid',roofTiles:'pan-cover',
            size:[roof.size[0],roof.size[1]*1.3,roof.size[2]],
            position:[roof.position[0],roof.position[1]+roof.size[1]*.278*.3,roof.position[2]]});}
      }
      return {...recipe,parts};
    };`);
    await page.route("**/src/renderers/three/buildings/nation-building.ts*", async route => {
      const response=await route.fetch(),source=await response.text();
      const call="leveledBuildingRecipe(definition, nation, detailed, level)";
      assert(source.includes(call),"preview roof recipe instrumentation");
      await route.fulfill({response,body:source.replace(call,`window.__paletteRoofRecipe(${call},definition.id)`)});
    });
  }
  await page.goto(`${url}building-showcase.html?nation=chinese&quality=high&sample=1&building=0`);
  await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
  await page.evaluate(async () => { await (window as any).__buildingResidentReady; });
  if (newTiles) await page.evaluate(async () => {
    const T=await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
    const preview=(window as any).__buildingPreview;
    preview.renderer.setAnimationLoop(null);
    const hall=preview.model();hall.update(0,{construction:1,door:0,working:false});
    hall.dispose=()=>{};
    preview.selectBuilding(4);await(window as any).__buildingResidentReady;
    const tower=preview.model();tower.update(0,{construction:1,door:0,working:false});
    const group=new T.Group();group.add(hall.root,tower.root);preview.scene.add(group);
    hall.root.position.x=-1.45;tower.root.position.set(3.05,0,-.4);
    (window as any).__paletteModel={root:group,update:()=>{},triangles:()=>hall.triangles(false)+tower.triangles(false)};
  });
  const selected = palettes.filter(palette => !process.env.PALETTE_IDS
    || process.env.PALETTE_IDS.split(",").includes(palette.id));
  for (const palette of selected) {
    await page.evaluate(async palette => {
      const T = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
      const { paintSurfacePixels } = await import(
        /* @vite-ignore */ String("/src/renderers/three/buildings/building-surface-pixels.ts"));
      const { chineseGlazedTileDetail } = await import(
        /* @vite-ignore */ String("/src/renderers/three/buildings/chinese-roof-detail.ts"));
      const { chineseRenderDetail } = await import(
        /* @vite-ignore */ String("/src/renderers/three/buildings/cultural-timber-surface-detail.ts"));
      const preview = (window as any).__buildingPreview;
      preview.renderer.setAnimationLoop(null);
      const model = (window as any).__paletteModel ?? preview.model(); model.update(0, { construction: 1, door: 0, working: false });
      const rgb = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
      const makeMap = (material: any, hex: string, sampler: any) => {
        const pixels = paintSurfacePixels(sampler, rgb(hex), 512, true)[0];
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
        canvas.getContext("2d")!.putImageData(new ImageData(pixels, 512, 512), 0, 0);
        const map = new T.CanvasTexture(canvas);
        for (const field of ["colorSpace", "wrapS", "wrapT", "anisotropy", "minFilter", "magFilter"])
          (map as any)[field] = material.map[field];
        map.needsUpdate = true;
        return map;
      };
      model.root.traverse((object: any) => {
        if (!object.isMesh || object.userData.stock) return;
        const surface = object.userData.buildingSurface, colours = object.geometry.attributes.color;
        if (!object.userData.paletteOriginal && colours)
          object.userData.paletteOriginal = Float32Array.from(
            Array.from({ length: colours.count }, (_, vertex) =>
              [colours.getX(vertex), colours.getY(vertex), colours.getZ(vertex)]).flat());
        const original = object.userData.paletteOriginal;
        if (surface === "paint" && original) {
          const colour = new T.Color(palette.frame);
          for (let vertex = 0; vertex < colours.count; vertex++) {
            const at = vertex * 3;
            if (original[at] > .3 && original[at + 1] < .3 && original[at + 2] < .3)
              colours.setXYZ(vertex, colour.r, colour.g, colour.b);
          }
          colours.needsUpdate = true;
        }
        const roof = ["roof", "roof-slate", "roof-shingles"].includes(surface);
        if (!roof && surface !== "plaster") return;
        const material = object.material.clone();
        const tileSampler = (point: any) => {
          const detail = chineseGlazedTileDetail(point);
          if (palette.id.startsWith("tiles-")) return {
            brightness:.91+point.grain*.055+point.mineral*.035,
            colour:[1,1,1],height:.5,roughness:180+point.weather*25
          };
          if (palette.id !== "red-tiles-brown") return detail;
          const course = point.u * 12, fraction = course - Math.floor(course);
          const lap = Math.exp(-Math.min(fraction, 1 - fraction) * 95);
          return { ...detail, brightness: detail.brightness - lap * .19,
            height: detail.height - lap * .035 };
        };
        material.map = makeMap(material, roof ? palette.roof : palette.wall,
          roof ? tileSampler : chineseRenderDetail);
        if (roof && palette.id === "red-tiles-brown") material.normalScale.set(1.2, 1.2);
        if (roof && palette.id.startsWith("tiles-")) { material.normalMap=null;material.roughness=.84; }
        object.material = material;
        if (colours) {
          for (let vertex = 0; vertex < colours.count; vertex++) colours.setXYZ(vertex, 1, 1, 1);
          colours.needsUpdate = true;
        }
      });
      const bounds=new T.Box3().setFromObject(model.root);
      const centre=bounds.getCenter(new T.Vector3()).toArray();
      const radius=bounds.getSize(new T.Vector3()).length()/2,angle=.55;
      const distance = radius / Math.sin(preview.camera.fov * Math.PI / 360) * .94;
      preview.camera.position.set(centre[0] + Math.sin(angle) * distance * .82,
        centre[1] + distance * .55, centre[2] + Math.cos(angle) * distance * .82);
      preview.controls.target.set(...centre);preview.controls.update();
      preview.renderer.render(preview.scene, preview.camera);
    }, palette);
    await page.locator("canvas").first().screenshot({ path: resolve(output, `${palette.id}.png`) });
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "review.json"), JSON.stringify({ palettes: selected, building: 0,
    quality: "high", newTileGeometry:newTiles, previewOnly: true, productionPaletteChanged: false, errors }, null, 2));
} finally { await browser.close();await server.close(); }
