import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync,mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser,startDevServer } from "./browser";
import { readCatapultContacts } from "./catapult-contact-metrics";
import { resourcesPath } from "./resources-path";

const run=process.argv[2]??"roof-two-a";
assert(/^[a-z0-9-]+$/.test(run));
const output=resourcesPath("project-reviews","catapult-roof-two-2026-11-04",run);
assert(!existsSync(resolve(output,"report.json")),"Preserve previous native evidence");mkdirSync(output,{recursive:true});
const paths=["src/render-common/buildings/catapult-tower-recipe.ts","src/render-common/buildings/catapult-shell-architecture.ts",
  "src/render-common/buildings/catapult-national-shell-profile.ts","src/render-common/buildings/catapult-platform.ts",
  "src/shared/settlement/military-catapult-ammo.ts","src/shared/settlement/military-catapult-resupply.ts",
  "src/shared/settlement/military-catapult-resupply-actors.ts","src/renderers/three/worker-catapult-hands.ts",
  "src/renderers/three/worker-stone-lean.ts","src/renderers/three/catapult-pickup-crouch.ts",
  "src/renderers/three/worker-stone-carry.ts","src/shared/settlement/catapult-cycle.ts",
  "src/render-common/buildings/catapult-dimensions.ts"];
const sourceHashes=Object.fromEntries(paths.map(path=>[path,createHash("sha256").update(readFileSync(path)).digest("hex")]));
const {server,url}=await startDevServer(),browser=await launchBrowser();
const reports:unknown[]=[],errors:string[]=[],servedSourceHashes:Record<string,string>={};
try {
  for(const quality of (process.env.QUALITIES??"high,minimal").split(",")) {
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    page.on("pageerror",error=>errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");await page.routeWebSocket("**/*",()=>{});
    for(const [path,before,after]of[
      ["app/island-runtime.ts","window.__islandReady = true","(window.__catapultCamera=camera,window.__islandReady=true)"],
      ["renderers/three/three-worker.ts","const scene = new Scene();","const scene=new Scene();window.__catapultWorkerScene=scene;"]
    ])await page.route(`**/src/${path}*`,async route=>{
      const response=await route.fetch(),source=await response.text();
      assert(source.includes(before!),`Missing native hook ${path}`);
      servedSourceHashes[`${quality}/${path}`]=createHash("sha256").update(source).digest("hex");
      await route.fulfill({response,body:source.replace(before!,after!)});
    });
    await page.goto(`${url}admin.html?quality=${quality}&seed=123&size=96&forest=0&cache=0&time=day`);
    await page.waitForFunction(()=>Boolean((window as any).__islandReady&&(window as any).__settlement),null,{timeout:180000});
    await page.locator("#loading-screen").waitFor({state:"detached"});
    const fixture=await page.evaluate(async()=>{
      const host=window as any,sim=host.__settlement.simulation;
      const {CATAPULT_SUPPLY_SECONDS,catapultLocalStone}=await import(/* @vite-ignore */String("/src/shared/settlement/military-catapult-resupply.ts"));
      const {catapultPhaseDuration}=await import(/* @vite-ignore */String("/src/shared/settlement/catapult-cycle.ts"));
      const {CATAPULT_DECK_HEIGHT}=await import(/* @vite-ignore */String("/src/render-common/buildings/catapult-dimensions.ts"));
      const result=sim.debugRaiseBuilding(16);if(!result.ok)throw new Error(result.reason);
      const uid=result.building.uid,raw=sim.update.bind(sim),initial=result.building;
      // Only this fresh debug fixture starts downstairs, so actual hauling is observable.
      // Relocate any prefilled owned units; never invent stock or synthesize a carrier.
      const transferredDown=initial.input.stone??0;
      if(initial.catapultCycle||initial.catapultSupply?.porter)throw new Error("Fresh fixture already has a crew cycle");
      initial.input.stone=0;(initial.catapultSupply??={ground:0}).ground+=transferredDown;
      sim.receiveTroops([{type:"heavy",rank:0,hp:150},{type:"shield",rank:0,hp:125}]);
      sim.setMilitaryComposition(uid,{heavy:1,shield:1,archer:0});
      const review:any={elapsed:0,launches:[],seen:new Set(),targets:[],porterPhases:[],placements:[],maxRoof:0,maxLocal:0};
      Object.defineProperty(review,"tower",{get:()=>sim.buildings().find((site:any)=>site.uid===uid)});
      review.step=(dt:number)=>{
        for(const target of review.targets)sim.commandMilitaryOpponent([target.uid],target.point,1,"move");
        const before=review.tower.input.stone??0;
        raw(dt);review.elapsed+=dt;
        const site=review.tower,roof=site.input.stone??0,local=catapultLocalStone(site);
        if(roof>2||local>6)throw new Error(`Capacity exceeded: roof${roof}, site${local}`);
        review.maxRoof=Math.max(review.maxRoof,roof);review.maxLocal=Math.max(review.maxLocal,local);
        for(const shot of sim.militaryArrows())if(shot.boulder&&!review.seen.has(shot.id)) {
          review.seen.add(shot.id);review.launches.push(review.elapsed);
        }
        if(roof>before) {
          if(roof-before!==1)throw new Error(`Non-single porter delivery: ${before}→${roof}`);
          review.placements.push({time:review.elapsed,roof,launches:review.launches.length});
        }
        const phase=site.catapultSupply?.porter?.phase;
        if(phase&&!review.porterPhases.includes(phase))review.porterPhases.push(phase);
      };
      review.until=(kind:string,phase:string,share=.85)=>{
        for(let tick=0;tick<16000;tick++) {
          review.step(.025);
          const site=review.tower,porter=site.catapultSupply?.porter,cycle=site.catapultCycle;
          if(kind==="porter"&&porter?.phase===phase&&porter.elapsed>=CATAPULT_SUPPLY_SECONDS[phase]*share)
            return {porter:structuredClone(porter),roof:site.input.stone,local:catapultLocalStone(site)};
          if(kind==="cycle"&&cycle?.phase===phase&&cycle.elapsed>=catapultPhaseDuration(cycle)*share)
            return {cycle:structuredClone(cycle),roof:site.input.stone,local:catapultLocalStone(site)};
          if(kind==="filled"&&(site.input.stone??0)===2&&!porter)return {roof:site.input.stone,local:catapultLocalStone(site)};
          if(kind==="postshot"&&review.placements.some((event:any)=>event.launches>0)&&
            (site.input.stone??0)===2&&!porter)return {roof:site.input.stone,local:catapultLocalStone(site)};
        }
        throw new Error(`Native condition absent ${kind}/${phase}: ${JSON.stringify({roof:review.tower.input,
          supply:review.tower.catapultSupply,cycle:review.tower.catapultCycle,launches:review.launches})}`);
      };
      review.camera=(roof:boolean)=>{
        const tower=review.tower,deck=CATAPULT_DECK_HEIGHT*(16/11),height=tower.y+(roof?deck+.4:deck*.5);
        const offset=height/Math.tan(Math.PI/6)/Math.SQRT2;
        Object.assign(host.__catapultCamera,{yaw:roof?-Math.PI/2:Math.PI/2,tilt:0,zoom:roof?3.3:2,
          centerX:tower.x+(roof?offset:-offset),centerZ:tower.z+(roof?-offset:offset)});
      };
      host.__catapultReview=review;sim.update=()=>{};sim.tickFraction=()=>1;review.camera(false);
      return {uid,x:review.tower.x,z:review.tower.z,transferredDown,initialLocal:catapultLocalStone(initial)};
    });
    const stages:unknown[]=[];
    for(const phase of ["pickup","stairs-up","place","stairs-down"]) {
      const state=await page.evaluate(phase=>{const r=(window as any).__catapultReview;r.camera(phase!=="pickup");
        return r.until("porter",phase,.85);},phase);
      await page.waitForTimeout(350);
      await page.screenshot({path:resolve(output,`${quality}-porter-${phase}.png`)});stages.push({phase,state});
    }
    const filled=await page.evaluate(()=>{const r=(window as any).__catapultReview;return r.until("filled","");});
    await page.evaluate(()=>{
      const host=window as any,sim=host.__settlement.simulation,r=host.__catapultReview;r.camera(true);
      for(const [dx,dz]of[[6,0],[0,6],[-6,0],[0,-6]]) {
        const point={x:r.tower.x+dx!,z:r.tower.z+dz!},uid=sim.spawnMilitaryOpponent(point,"archer");
        if(uid!==null)r.targets.push({uid,point});
      }
      if(!r.targets.length)throw new Error("No real hostile target spawned");
    });
    const phases:unknown[]=[];
    for(const phase of ["pick","load","traverse","fire","return"]) {
      // Real .05s simulation ticks expose pick elapsed1.05..1.35;1.40 is already the next phase.
      let shares=[.85];
      if(phase==="pick")shares=[.73,.77,.81,.85,.89,.91,.93];
      // Fire lasts .2s: observe the real .1s tick, before .2 transitions to return.
      if(phase==="fire")shares=[.5];
      for(const share of shares) {
      const state=await page.evaluate(({phase,share})=>(window as any).__catapultReview.until("cycle",phase,share),{phase,share});
      await page.waitForTimeout(350);
      const contacts=await page.evaluate(readCatapultContacts);
      phases.push({phase,share,state,contacts});
      writeFileSync(resolve(output,`${quality}-phase-progress.json`),JSON.stringify({fixture,stages,filled,phases},null,2));
      const suffix=phase==="pick"?`-${Math.round(share*100)}`:"";
      await page.screenshot({path:resolve(output,`${quality}-${phase}${suffix}.png`)});
      assert(!("error"in contacts),JSON.stringify(contacts));
      if(phase==="pick"||phase==="load")assert(contacts.carryErrors.every((value:number|null|undefined)=>value!=null&&value<.005),JSON.stringify(contacts));
      if(phase==="traverse"||phase==="fire")assert(contacts.crankErrors?.every((value:number|null|undefined)=>value!=null&&value<.005),JSON.stringify(contacts));
      assert(Math.min(contacts.soles.left,contacts.soles.right)>=-.01,JSON.stringify(contacts));
      }
    }
    const final=await page.evaluate(()=>{
      const host=window as any,sim=host.__settlement.simulation,r=host.__catapultReview;
      for(const target of r.targets)sim.commandMilitaryOpponent([target.uid],{x:r.tower.x+25,z:r.tower.z+25},1,"move");
      r.targets=[];const filled=r.until("postshot","");
      const saved=sim.saveState(),restore=sim.loadState(structuredClone(saved));
      return {filled,restore,maxRoof:r.maxRoof,maxLocal:r.maxLocal,launches:r.launches,
        placements:r.placements,porterPhases:r.porterPhases};
    });
    assert.equal(final.restore.ok,true);assert.equal(final.maxRoof,2);assert(final.maxLocal<=6);
    assert(final.launches.length>0);assert(final.placements.some((event:any)=>event.launches>0));
    await page.waitForTimeout(250);await page.screenshot({path:resolve(output,`${quality}-refilled-after-shot.png`)});
    reports.push({quality,fixture,stages,filled,phases,final});await page.close();
  }
  assert.deepEqual(errors,[]);
  const finalSourceHashes=Object.fromEntries(paths.map(path=>[path,createHash("sha256").update(readFileSync(path)).digest("hex")]));
  assert.deepEqual(finalSourceHashes,sourceHashes,"Runtime source changed during native witness");
  writeFileSync(resolve(output,"report.json"),JSON.stringify({sourceHashes,servedSourceHashes,reports,errors,
    scope:"Real simulation stepped deterministically in actual game; native phase screenshots, not real-time video."},null,2));
}catch(error) {
  writeFileSync(resolve(output,"failure.json"),JSON.stringify({sourceHashes,reports,errors,error:String(error)},null,2));
  throw error;
}finally {await browser.close();await server.close();console.log(`Catapult roof2 native CLOSED ${output}`);}
