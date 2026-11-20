import assert from "node:assert/strict";
import { mkdirSync,writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser,startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output=resourcesPath("project-reviews","tea-house-inputs-2026-11-04","native-a");
mkdirSync(output,{recursive:true});
const {server,url}=await startDevServer(),browser=await launchBrowser();
const errors:string[]=[],reports:unknown[]=[];
try {
  for(const detailed of [true,false]) {
    const page=await browser.newPage({viewport:{width:1100,height:900}});
    page.on("pageerror",error=>errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.route("**/tea-input-review.html",route=>route.fulfill({contentType:"text/html",body:"<body style='margin:0'></body>"}));
    await page.goto(`${url}tea-input-review.html`);
    await page.evaluate(async detailed=>{
      const imp=(path:string)=>import(/* @vite-ignore */path);
      const t=await imp("/node_modules/three/build/three.module.js");
      const {createRomanMaterials}=await imp("/src/renderers/three/buildings/roman-materials.ts");
      const {createNationBuildingMaterials}=await imp("/src/renderers/three/buildings/nation-building-materials.ts");
      const {createNationBuilding}=await imp("/src/renderers/three/buildings/nation-building.ts");
      const {getBuildingDefinition}=await imp("/src/render-common/buildings/building-catalog.ts");
      const {getBuildingStockContact}=await imp("/src/render-common/buildings/building-stock-anchors.ts");
      const {createBuildingRoadMarkers}=await imp("/src/renderers/three/buildings/building-road-marker.ts");
      const renderer=new t.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
      renderer.setSize(1100,900);renderer.outputColorSpace=t.SRGBColorSpace;
      renderer.toneMapping=t.ACESFilmicToneMapping;document.body.append(renderer.domElement);
      const scene=new t.Scene();scene.background=new t.Color("#b9c0ac");
      scene.add(new t.HemisphereLight("#fff4df","#63705d",2.1));
      const sun=new t.DirectionalLight("#fff1db",2.4);sun.position.set(-4,8,6);scene.add(sun);
      const base=createRomanMaterials(detailed),pack=createNationBuildingMaterials(base.materials,"chinese",detailed);
      const model=createNationBuilding(getBuildingDefinition(6),pack.materials,"chinese",detailed,1);
      model.fitToGrid();scene.add(model.root);
      const markers=createBuildingRoadMarkers(),marker=markers.create();scene.add(marker);
      markers.update(marker,{id:"tea",type:6,nation:"chinese",rotation:0,x:0,y:0,z:0,construction:1,working:false});
      const sign=marker.getObjectByName("building_signpost_icon_front");
      const started=performance.now();
      while(!sign.material.map?.image?.complete) {
        if(performance.now()-started>10000)throw new Error("Actual tea post bitmap did not load");
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      if(!sign.material.map.image.src.includes("teaLeaves"))throw new Error("Tea road sign still uses wrong artwork");
      const camera=new t.PerspectiveCamera(35,1100/900,.01,80);
      (window as any).teaReview={
        set:(water:number,teaLeaves:number)=>{
          const input={water,teaLeaves};
          model.update(0,{construction:1,door:0,working:false,inputStock:input,outputStock:{}});
          model.root.updateMatrixWorld(true);
          const boxes:any[]=[],units:any[]=[];
          for(const ware of ["water","teaLeaves"])for(let slot=0;slot<input[ware as keyof typeof input];slot++) {
            const object=model.root.getObjectByName(`stock_input_${slot}_${ware}`);
            if(!object?.visible)throw new Error(`Missing ${ware}${slot}`);
            const box=new t.Box3().setFromObject(object);boxes.push(box);
            const contact=getBuildingStockContact(6,"input",ware,slot,0,0,0,0,input,{}, {nation:"chinese",level:1});
            if(!contact||contact.slot!==slot)throw new Error(`Clamped incoming contact ${ware}${slot}`);
            units.push({ware,slot,min:box.min.toArray(),max:box.max.toArray(),contact});
          }
          for(let a=0;a<boxes.length;a++)for(let b=a+1;b<boxes.length;b++)
            if(boxes[a].intersectsBox(boxes[b]))throw new Error("Actual input models intersect");
          return {input,units,signSource:sign.material.map.image.src};
        },
        draw:(view:string)=>{
          let bounds=new t.Box3().setFromObject(model.root);
          if(view==="post")bounds=new t.Box3().setFromObject(marker);
          if(view==="tea"||view==="water") {
            bounds.makeEmpty();for(let i=0;i<2;i++)bounds.union(new t.Box3().setFromObject(
              model.root.getObjectByName(`stock_input_${i}_${view==="tea"?"teaLeaves":"water"}`)));
          }
          const centre=bounds.getCenter(new t.Vector3()),size=bounds.getSize(new t.Vector3());
          const distance=Math.max(.8,size.length()*1.55);
          const side=view==="water"?-1:1;
          camera.position.copy(centre).add(new t.Vector3(side*distance*.75,distance*.48,distance));
          camera.lookAt(centre);renderer.render(scene,camera);
        },
        dispose:()=>{model.dispose();markers.dispose();pack.dispose();base.dispose();renderer.dispose();renderer.forceContextLoss();}
      };
    },detailed);
    for(const [water,teaLeaves] of [[1,1],[2,1],[2,2]]) {
      const state=await page.evaluate(([water,teaLeaves])=>(window as any).teaReview.set(water,teaLeaves),[water,teaLeaves]);
      await page.evaluate(()=>(window as any).teaReview.draw("overview"));
      await page.screenshot({path:resolve(output,`${detailed?"high":"minimal"}-arrival-${water}-${teaLeaves}.png`)});
      reports.push({detailed,...state});
    }
    for(const view of ["tea","water","post"]) {
      await page.evaluate(view=>(window as any).teaReview.draw(view),view);
      await page.screenshot({path:resolve(output,`${detailed?"high":"minimal"}-${view}.png`)});
    }
    await page.evaluate(()=>(window as any).teaReview.dispose());await page.close();
  }
  assert.deepEqual(errors,[]);
  writeFileSync(resolve(output,"report.json"),JSON.stringify({reports,errors,
    scope:"Actual canonical High/Minimal stock models, real roadpost bitmap and input-arrival/contact transitions; not a full island delivery simulation."},null,2));
} finally {await browser.close();await server.close();}
console.log(`Tea input review CLOSED: ${output}`);
