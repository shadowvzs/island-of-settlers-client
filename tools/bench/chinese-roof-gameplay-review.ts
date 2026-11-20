import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser,startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output=resourcesPath("project-reviews","building-art-completion-2026-11-03","chinese-roof-gameplay-s");
mkdirSync(output,{recursive:true});
const sourcePath="src/renderers/three/buildings/roman-building.ts";
const sourceHash=createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
const savePath="/home/shadowvzs/Downloads/island-settlers-2026-11-03.json";
const saveText=readFileSync(savePath,"utf8"),save=JSON.parse(saveText);
const saveHash=createHash("sha256").update(saveText).digest("hex");
const {server,url}=await startDevServer(),browser=await launchBrowser();
const errors:string[]=[],loadedModules:Record<string,string>={};
let state:unknown,status="running";
try {
  const page=await browser.newPage({viewport:{width:1500,height:1100}});
  page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.addInitScript(()=>{
    localStorage.setItem("island-of-settlers.graphics.detail","high");
    localStorage.setItem("island-of-settlers.graphics.resolution","fast");
  });
  await page.route("**/src/app/island-runtime.ts*",async route=>{
    const response=await route.fetch(),source=await response.text();
    assert(source.includes("window.__islandReady = true"));
    await route.fulfill({response,body:source.replace("window.__islandReady = true",
      "window.__chineseRoofReview={world,camera,renderer};window.__islandReady = true")});
  });
  await page.route("**/src/renderers/three/buildings/roman-building.ts*",async route=>{
    const response=await route.fetch(),source=await response.text();
    assert(source.includes("roofCompactGeometry"),"Actual served dispatcher must include restored roof-only policy");
    loadedModules.renderer=createHash("sha256").update(source).digest("hex");
    await route.fulfill({response,body:source});
  });
  await page.route("**/hq-roof-save-fixture.html",route=>route.fulfill({contentType:"text/html",body:"<body></body>"}));
  await page.goto(`${url}hq-roof-save-fixture.html`);
  await page.evaluate(async save=>{
    const {openLocalSaveStore}=await import(/* @vite-ignore */String("/src/app/save-store/local-save-store.ts"));
    await(await openLocalSaveStore()).writeStartupGame(JSON.stringify(save));
  },save);
  await page.goto(`${url}admin.html?quality=high&cache=0&reveal=1&time=day`);
  await page.waitForFunction(()=>Boolean((window as any).__islandReady&&(window as any).__settlement?.playerSession),
    null,{timeout:120000});
  state=await page.evaluate(async()=>{
    const review=(window as any).__chineseRoofReview,sim=(window as any).__settlement.simulation;
    const building=sim.buildings().find((b:any)=>b.typeId===0);
    if(!building)throw new Error("Actual home HQ missing");
    const {isBuildingDetailed}=await import(/* @vite-ignore */String("/src/render-common/buildings/building-detail.ts"));
    const {panByScreen}=await import(/* @vite-ignore */String("/src/render-common/camera-controller.ts"));
    if(sim.playerNation()!=="chinese")throw new Error("Exact owner save did not restore Chinese nation");
    const restoredCamera={...review.camera};
    Object.assign(review.camera,{centerX:building.x,centerZ:building.z,zoom:3});
    const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    for(let i=0;i<4;i++)await frame();
    const centre=review.renderer.projectToViewport(building.x,building.y+1.6,building.z);
    panByScreen(review.camera,0,centre.y-innerHeight/2);
    for(let i=0;i<4;i++)await frame();
    return {nation:sim.playerNation(),type:building.typeId,uid:building.uid,restoredCamera,camera:{...review.camera},
      actualHighCameraPredicate:isBuildingDetailed(true,review.camera.zoom),stats:review.renderer.getStats()};
  });
  assert((state as any).actualHighCameraPredicate,"Actual normal-gameplay camera must select High buildings");
  assert(loadedModules.renderer,"Actual world renderer module was observed, not just a recipe declaration");
  await page.screenshot({path:resolve(output,"chinese-hq-high-actual-gameplay.png")});
  assert.deepEqual(errors,[]);status="passed";
} finally {
  await browser.close();await server.close();
  writeFileSync(resolve(output,"report.json"),JSON.stringify({status,generatedAt:new Date().toISOString(),sourceHash,savePath,saveHash,
    loadedModules,state,errors,scope:"Exact owner save loaded unchanged into isolated startup storage; source file untouched. High graphics, actual home HQ/camera predicate. Review only."},null,2));
}
console.log(`Chinese gameplay CLOSED ${status}: ${output}`);
