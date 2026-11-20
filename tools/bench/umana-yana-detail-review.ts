import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const output=resolve("../resources/project-reviews/nation-expansion-current/umana-yana/details");
mkdirSync(output,{recursive:true});
const {server,url}=await startDevServer(),browser=await launchBrowser();
const errors:string[]=[];
try {
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  page.on("pageerror",error=>errors.push(error.message));
  await page.routeWebSocket("**/*",()=>{});
  for(const quality of ["high","minimal"]) {
    await page.goto(`${url}building-showcase.html?nation=indigenous&quality=${quality}&sample=1`);
    await page.waitForFunction(()=>Boolean((window as any).__buildingReady),null,{timeout:120000});
    await page.evaluate(async()=>{
      const preview=(window as any).__buildingPreview;preview.renderer.setAnimationLoop(null);
      preview.selectBuilding(7,1);await(window as any).__buildingResidentReady;
      preview.model().update(0,{construction:1,door:1,working:false});
    });
    for(const [name,position,target] of [
      ["entrance-eye",[0,.95,5.4],[0,.95,-.35]],
      ["interior-supports",[0,.8,2.45],[0,3.2,-.35]],
      ["palm-bundle-close",[3.5,3.1,4.5],[1.3,2.6,1.65]]
    ] as const) {
      await page.evaluate(({position,target})=>{
        const {camera,controls,renderer,scene}=(window as any).__buildingPreview;
        camera.position.set(...position);controls.target.set(...target);controls.update();renderer.render(scene,camera);
      },{position,target});
      await page.screenshot({path:resolve(output,`${quality}-${name}.png`)});
    }
  }
  assert.deepEqual(errors,[]);writeFileSync(resolve(output,"review.json"),JSON.stringify({errors,qualities:["high","minimal"],views:["entrance-eye","interior-supports","palm-bundle-close"]},null,2));
} finally {await browser.close();await server.close();}
