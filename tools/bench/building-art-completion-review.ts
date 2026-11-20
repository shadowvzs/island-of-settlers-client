import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const runId = process.argv[2] ?? "hq-cloud-masks-a";
assert(/^[a-z0-9-]+$/.test(runId));
const views = (process.env.VIEWS ?? "gameplay,front,close,rear").split(",");
assert(views.length > 0 && views.every(view => ["gameplay", "front", "close", "rear", "yard", "side", "table", "paint", "window"].includes(view)));
const allRoster = process.argv[3] === "all";
const nations = ["roman", "japanese", "chinese", "persian", "maya", "nubian", "indigenous", "viking"];
const requestedCases = allRoster ? nations.flatMap(nation => BUILDING_CATALOG.map(({ id }) => ({ id, nation }))) :
  (process.argv[3] ?? "chinese:0,maya:0").split(",").map(entry => {
  const [nation, rawId] = entry.split(":"), id = Number(rawId);
  assert(/^[a-z]+$/.test(nation!) && Number.isInteger(id) && id >= 0);
  return { id, nation };
});
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
assert(qualities.length > 0 && qualities.every(quality => ["high", "minimal"].includes(quality)));
const pendingTypes = new Set([0, 7, 8, 16, 17, 20, 31, 32, 33, 41, 42, 43, 44, 45, 46,
  47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 61]);
const levels = (process.env.LEVELS ?? "1").split(",").map(Number);
assert(levels.every(level => Number.isInteger(level) && level >= 1 && level <= 5));
const readyOnly = process.env.READY_ONLY === "1";
const cases = readyOnly ? requestedCases.filter(entry => !pendingTypes.has(entry.id)) : requestedCases;
const excluded = readyOnly ? requestedCases.filter(entry => pendingTypes.has(entry.id)) : [];
const width = Number(process.env.WIDTH ?? 1100), height = Number(process.env.HEIGHT ?? 950);
assert(Number.isInteger(width) && width >= 400 && width <= 1600);
assert(Number.isInteger(height) && height >= 400 && height <= 1600);
const sourcePaths = ["src/render-common/buildings/building-window-shadows.ts",
  "src/render-common/buildings/building-window-finish.ts", "src/render-common/buildings/persian-window-openings.ts",
  "src/render-common/buildings/levels/leveled-building-recipe.ts", "src/render-common/buildings/levels/level-dressing.ts",
  "src/render-common/buildings/nation-building-recipe.ts", "src/render-common/buildings/chinese-roof-bedding.ts",
  "src/render-common/buildings/indigenous-building-motifs.ts", "src/render-common/buildings/indigenous-building-paint.ts",
  "src/render-common/buildings/indigenous-fisher-paint-cloth.ts",
  "src/renderers/three/buildings/indigenous-pigment-overlay.ts", "src/renderers/three/buildings/indigenous-cave-art-scenes.ts",
  "src/render-common/buildings/indigenous-building-recipe.ts", "src/render-common/buildings/indigenous-prop-clearance.ts",
  "src/render-common/buildings/indigenous-shipyard-walls.ts",
  "src/render-common/buildings/indigenous-tannery-bench.ts",
  "src/render-common/buildings/catapult-maya-window-wall.ts", "src/renderers/three/buildings/indigenous-rubble-detail.ts",
  "src/render-common/buildings/catapult-platform.ts", "src/render-common/props/maya-civic-mask.ts",
  "src/render-common/props/maya-relief-carving.ts",
  "src/render-common/buildings/catapult-tower-recipe.ts", "src/render-common/buildings/catapult-shell-architecture.ts",
  "src/render-common/buildings/catapult-window-profiles.ts",
  "src/render-common/buildings/catapult-chinese-round-window.ts",
  "src/renderers/three/buildings/catapult-window-geometry.ts",
  "src/renderers/three/buildings/catapult-round-window-aperture.ts",
  "src/render-common/buildings/catapult-national-shell-profile.ts", "src/render-common/buildings/catapult-maya-entry-hood.ts",
  "src/render-common/buildings/catapult-national-wall-finish.ts", "src/render-common/buildings/catapult-indigenous-rubble.ts",
  "src/renderers/three/buildings/indigenous-rubble-cells.ts",
  "src/renderers/three/buildings/indigenous-rubble-stones.ts",
  "src/renderers/three/buildings/indigenous-rubble-layout.ts",
  "src/renderers/three/buildings/indigenous-rubble-material.ts",
  "src/renderers/three/buildings/indigenous-rubble-normals.ts",
  "src/renderers/three/buildings/indigenous-rubble-masonry.ts",
  "src/render-common/buildings/catapult-persian-rosette.ts", "src/renderers/three/buildings/catapult-ornament-curve.ts",
  "src/renderers/three/buildings/catapult-rubble-opening-clip.ts",
  "src/renderers/three/buildings/catapult-national-shell-geometry.ts", "src/renderers/three/buildings/structural-rock-geometry.ts",
  "src/renderers/three/buildings/building-surface-paint.ts",
  "src/renderers/three/buildings/chinese-red-brick-detail.ts",
  "src/renderers/three/buildings/japanese-catapult-stone-detail.ts",
  "src/renderers/three/buildings/chinese-wall-fan.ts",
  "src/render-common/buildings/catapult-chinese-fan.ts",
  "src/render-common/buildings/chinese-cloud-pattern.ts",
  "src/renderers/three/buildings/catapult-national-shell-geometry.ts", "src/renderers/three/buildings/lean-thatch-roof.ts",
  "src/render-common/buildings/catapult-national-facades.ts", "src/render-common/buildings/catapult-masonry.ts",
  "src/render-common/buildings/maya-masonry-layout.ts", "src/renderers/three/buildings/chinese-pan-cover-roof.ts",
  "src/renderers/three/buildings/maya-masonry-uv.ts", "src/renderers/three/buildings/maya-stone-detail.ts",
  "src/renderers/three/buildings/window-shadow-material.ts", "src/renderers/three/buildings/window-shadow-geometry.ts",
  "src/renderers/three/buildings/roman-building.ts",
  "src/render-common/buildings/roof-review-prototype.ts", "src/render-common/buildings/occupation-roof-redesign.ts",
  "src/render-common/buildings/advanced-material-buildings.ts", "src/render-common/props/nursery-sapling.ts",
  "src/render-common/buildings/maya-building-walls.ts", "src/render-common/buildings/nation-kit-towers.ts",
  "src/render-common/buildings/roman-craft-designs.ts", "src/render-common/buildings/nation-commander-lodge-designs.ts",
  "src/render-common/buildings/nation-tavern-designs.ts", "src/renderers/three/buildings/roman-industry-mechanisms.ts",
  "src/renderers/three/buildings/monument-building.ts", "src/renderers/three/buildings/monument-owner-finish.ts",
  "src/render-common/buildings/persian-ardashir-monument.ts",
  "src/render-common/buildings/japanese-bamboo-doorway.ts", "src/render-common/buildings/yagura-wall-openings.ts",
  "src/render-common/buildings/military-yagura-tower.ts", "src/renderers/three/buildings/yagura-wall-geometry.ts",
  "src/render-common/buildings/japanese-bamboo-forester.ts", "src/render-common/buildings/japanese-bamboo-roof.ts",
  "src/renderers/three/buildings/architectural-bamboo-geometry.ts", "src/renderers/three/buildings/japanese-bamboo-detail.ts",
  "src/renderers/three/buildings/japanese-white-stone-detail.ts", "src/renderers/three/buildings/building-surface-paint.ts",
  "src/render-common/buildings/japanese-bamboo-forester-levels.ts", "src/render-common/buildings/japanese-tower-hip.ts",
  "src/renderers/three/buildings/building-image-sign-material.ts", "assets/editor-icons/tree-oak@2x.webp",
  "assets/monuments/roman-high.glb", "assets/monuments/roman-minimal.glb",
  "assets/monuments/viking-high.glb", "assets/monuments/viking-minimal.glb",
  "tools/bench/building-art-completion-review.ts"];
const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const output = resourcesPath("project-reviews", "building-art-completion-2026-11-03", runId);
const startedAt = new Date().toISOString();
assert(!existsSync(resolve(output, "report.json")), "Preserve native evidence; select a new run id.");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [], errors: string[] = [], failures: unknown[] = [];
let screenshots = 0, selectedPack = "";
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name=value=>value;");
  for (const quality of qualities) for (const entry of cases.flatMap(entry => levels.map(level => ({ ...entry, level })))) {
    try {
    const { id, level, nation } = entry;
    const levelSuffix = process.env.LEVELS ? `-level${level}` : "";
    const pack = `${nation}:${quality}`;
    if (pack !== selectedPack) {
      if (selectedPack) console.log(`Completed ${selectedPack}; ${screenshots} review images captured.`);
      await page.goto(`${url}building-showcase.html?nation=${nation}&quality=${quality}&sample=1&building=${id}`);
      await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
      selectedPack = pack;
    }
    const result = await page.evaluate(async ({ id, level, nation, verifyPigment }) => {
      const p = (window as any).__buildingPreview; p.renderer.setAnimationLoop(null); await p.selectBuilding(id, level);
      await ((window as any).__buildingResidentReady ?? Promise.resolve());
      const model = p.model(); model.update(0, { construction: 1, door: 0, working: false });
      const deadline=Date.now()+10000;
      for(;;) {
        let waiting=false;
        model.root.traverse((object:any)=>{
          if(!object.isMesh||!object.userData.ownedMaterial)return;
          for(const material of Array.isArray(object.material)?object.material:[object.material])
            if(material.map&&!material.map.image?.width)waiting=true;
        });
        if(!waiting)break;
        if(Date.now()>deadline)throw new Error(`Owned sign bitmap not resident: ${nation}/${id}`);
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      model.root.rotation.y = 0; model.root.updateMatrixWorld(true); p.renderer.render(p.scene, p.camera);
      let residentMeshes = 0, residentTriangles = 0;
      model.root.traverse((object: any) => {
        if (!object.isMesh) return;
        for (let ancestor = object; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return;
        const available = object.geometry.index?.count ?? object.geometry.getAttribute("position")?.count ?? 0;
        const count = Math.max(0, Math.min(available - object.geometry.drawRange.start, object.geometry.drawRange.count));
        if (count > 0) { residentMeshes++; residentTriangles += count / 3; }
      });
      if (!residentMeshes || !residentTriangles) throw new Error(`Empty resident model: ${nation}/${id}`);
      if (id === 7 && nation === "viking") model.root.traverse((object: any) => {
        if (["Courtyardpaving", "Courtyardstone", "Foundationstone"].includes(object.name.replace(/[._]/g, "")))
          throw new Error(`Viking unwanted white slab remains: ${object.name}`);
      });
      if (id === 7 && nation === "roman") {
        let shadows = 0;
        model.root.traverse((object: any) => { if (object.userData.openingShadow) shadows++; });
        if (shadows !== 1) throw new Error(`Roman entry shadow plane missing/duplicated: ${shadows}`);
      }
      let pigmentExport:unknown;
      if(verifyPigment) {
        const {GLTFExporter}=await import(/* @vite-ignore */String("/node_modules/three/examples/jsm/exporters/GLTFExporter.js"));
        const {GLTFLoader}=await import(/* @vite-ignore */String("/node_modules/three/examples/jsm/loaders/GLTFLoader.js"));
        let paint:any;model.root.traverse((object:any)=>{if(object.userData.visualPigment)paint=object;});
        if(!paint)throw new Error("Pigment export proof requires the actual painted textile mesh");
        const bytes=await new GLTFExporter().parseAsync(paint,{binary:true});
        const loaded=await new GLTFLoader().parseAsync(bytes,"");let meshes=0,alphaGap=false,brownInk=false;
        loaded.scene.traverse((object:any)=>{
          if(!object.isMesh)return;meshes++;
          const material=object.material,map=material.map;
          if(!object.userData.visualPigment||!material.transparent||!map?.image?.width)
            throw new Error("Pigment GLB lost its transparent atlas or semantic identity");
          const canvas=document.createElement("canvas");canvas.width=map.image.width;canvas.height=map.image.height;
          const context=canvas.getContext("2d")!;context.drawImage(map.image,0,0);
          const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
          for(let at=0;at<pixels.length;at+=4) {
            if(pixels[at+3]===0)alphaGap=true;
            if(pixels[at+3]!>32&&pixels[at]!>pixels[at+1]!&&pixels[at+1]!>pixels[at+2]!)brownInk=true;
          }
          object.geometry.dispose();map.dispose();material.dispose();
        });
        if(meshes!==1||!alphaGap||!brownInk)throw new Error("Pigment GLB mask lost colour/transparent gaps");
        pigmentExport={bytes:bytes.byteLength,meshes,alphaGap,brownInk};
      }
      const { nationTriangleBudget } = await import(
        /* @vite-ignore */ String("/src/render-common/buildings/building-triangle-budgets.ts"));
      return { triangles: model.triangles(false), budgets: nationTriangleBudget(nation, id), residentMeshes, residentTriangles,pigmentExport };
    }, {...entry,verifyPigment:process.env.PIGMENT_EXPORT_PROOF==="1"});
    const withinBudget = result.triangles <= result.budgets[quality === "high" ? 0 : 1];
    if (!allRoster) assert(withinBudget,
      `${nation}/${id}/${quality}: ${result.triangles} triangles exceed ${result.budgets[quality === "high" ? 0 : 1]}`);
    if (views.includes("gameplay")) {
      await page.screenshot({ path: resolve(output, `${nation}-${id}-${quality}${levelSuffix}-gameplay.png`) });
      screenshots++;
    }
    for (const view of views.filter(view => view !== "gameplay")) {
      await page.evaluate(async view => {
        const p = (window as any).__buildingPreview;
        const three = await import(/* @vite-ignore */ String("/node_modules/three/build/three.module.js"));
        const box = new three.Box3().setFromObject(p.model().root), size = box.getSize(new three.Vector3());
        const centre = box.getCenter(new three.Vector3()), reach = Math.max(size.x, size.y, size.z);
        if(view==="window") {
          const model=p.model(),parts=model.recipe?.parts??[];
          const pane=parts.find((part:any)=>part.windowShadow&&part.catapultWindowStyle==="chinese-round")??
            parts.find((part:any)=>part.windowShadow&&part.catapultWindowStyle&&part.position[0]>0);
          if(!pane)throw new Error("Focused window view requires an actual fitted national window");
          const target=model.root.localToWorld(new three.Vector3(...pane.position));
          const yaw=pane.rotation?.[1]??0;
          const normal=new three.Vector3(Math.sin(yaw),0,Math.cos(yaw)).transformDirection(model.root.matrixWorld);
          p.camera.position.copy(target).addScaledVector(normal,reach);
          p.camera.lookAt(target);
          if(p.camera.isOrthographicCamera){p.camera.zoom=4;p.camera.updateProjectionMatrix();}
          p.camera.updateMatrixWorld(true);p.renderer.render(p.scene,p.camera);return;
        }
        if(view==="paint") {
          let painting:any;
          p.model().root.traverse((object:any)=>{if(object.userData.visualPigment)painting=object;});
          if(!painting)throw new Error("Focused paint view requires actual pigment geometry");
          const target=new three.Box3().setFromObject(painting).getCenter(new three.Vector3());
          const normals=painting.geometry.getAttribute("normal"),normal=new three.Vector3();
          for(let vertex=0;vertex<normals.count;vertex++)normal.add(new three.Vector3().fromBufferAttribute(normals,vertex));
          normal.normalize().transformDirection(painting.matrixWorld);
          p.camera.position.copy(target).addScaledVector(normal,reach*1.2);
          p.camera.lookAt(target);
          if(p.camera.isOrthographicCamera){p.camera.zoom*=1.6;p.camera.updateProjectionMatrix();}
          p.camera.updateMatrixWorld(true);p.renderer.render(p.scene,p.camera);return;
        }
        if(view==="table") {
          const model=p.model(),top=model.recipe?.parts.find((part:any)=>!part.stock&&
            part.workyardAssembly==="tannery-table"&&part.size[0]>.3&&part.size[2]>.3);
          if(!top)throw new Error("Focused table view requires the actual tagged receiving bench");
          const target=model.root.localToWorld(new three.Vector3(...top.position));
          target.y+=.05*model.root.scale.y;
          p.camera.position.copy(target).add(new three.Vector3(reach*.7,reach*.45,reach*.85));
          p.camera.lookAt(target);
          if(p.camera.isOrthographicCamera){p.camera.zoom*=2;p.camera.updateProjectionMatrix();}
          p.camera.updateMatrixWorld(true);p.renderer.render(p.scene,p.camera);return;
        }
        if(view==="side") {
          const model=p.model(),pane=model.recipe?.parts.find((part:any)=>part.windowShadow&&part.position[0]>0);
          if(!pane)throw new Error("Focused side view requires a real right-side window");
          const target=model.root.localToWorld(new three.Vector3(...pane.position));
          target.y+=.07*model.root.scale.y;
          p.camera.position.copy(target).add(new three.Vector3(reach,reach*.05,reach*.20));
          p.camera.lookAt(target);
          if(p.camera.isOrthographicCamera){p.camera.zoom*=2;p.camera.updateProjectionMatrix();}
          p.camera.updateMatrixWorld(true);p.renderer.render(p.scene,p.camera);return;
        }
        let y = box.min.y + size.y * .58;
        if (view === "yard") {
          y = box.min.y + size.y * .25;
          p.camera.position.set(centre.x + reach * .54, y + size.y * .12, box.max.z + reach * .72);
        }
        else if (view === "front") p.camera.position.set(centre.x + reach * .03, y, box.max.z + reach * 1.45);
        else if (view === "close")
          p.camera.position.set(centre.x + reach * .42, y + size.y * .12, box.max.z + reach * .62);
        else {
          y = box.min.y + size.y * .40;
          p.camera.position.set(centre.x - reach * .90, box.min.y + size.y * .85, box.min.z - reach * 1.05);
        }
        p.camera.lookAt(centre.x, y, centre.z); p.camera.updateMatrixWorld(true);
        if (view === "rear" || view === "yard") {
          let extent = 0;
          for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z]) {
              const projected = new three.Vector3(x,y,z).project(p.camera);
              extent = Math.max(extent,Math.abs(projected.x),Math.abs(projected.y));
            }
          if (p.camera.isOrthographicCamera && extent > .90) {
            p.camera.zoom *= .90 / extent; p.camera.updateProjectionMatrix();
          }
        }
        p.renderer.render(p.scene, p.camera);
      }, view);
      await page.screenshot({ path: resolve(output, `${nation}-${id}-${quality}${levelSuffix}-${view}.png`) });
      screenshots++;
    }
    reports.push({ ...entry, name: BUILDING_CATALOG.find(definition => definition.id === id)?.name,
      quality, ...result, withinBudget });
    } catch (error) {
      if (!allRoster) throw error;
      failures.push({ ...entry, quality, error: String(error) }); selectedPack = "";
    }
  }
  if (!allRoster) assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ reports, views, errors, failures, screenshots,
    readyOnly, excluded, qualities, levels, startedAt, generatedAt: new Date().toISOString(), sourceHashes, allRoster, viewport: { width, height },
    passed: errors.length === 0 && failures.length === 0,
    visualAcceptance: "REVIEW ONLY. Actual image inspection required; no accepted-library publication." }, null, 2));
} finally { await browser.close(); await server.close(); }
console.log(`Building art CLOSED: ${screenshots} images, ${output}`);
