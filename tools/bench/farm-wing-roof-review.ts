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

const run=process.argv[2]??"native-a";
const targeted=process.argv.includes("--targeted"),levels=targeted?[1,5] as const:[1,2,3,4,5] as const;
const views=targeted?["rear"] as const:["front","rear"] as const;
assert(/^[a-z0-9-]+$/.test(run));
const output=resourcesPath("project-reviews","farm-wing-roof-2026-11-04",run);
assert(!existsSync(output),"Preserve every review attempt");mkdirSync(output,{recursive:true});
const guard=gallerySourceGuard(),errors:string[]=[],rows:unknown[]=[],cards:GalleryCard[]=[];
const {server,url}=await startDevServer();let browser:Browser|undefined;
try {
  browser=await launchBrowser();
  const page=await browser.newPage({viewport:{width:768,height:640}});
  page.on("request",request=>guard.request(request.url()));page.on("pageerror",error=>errors.push(error.message));
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
  await page.routeWebSocket("**/*",()=>{});await page.addInitScript("window.__name=value=>value;");
  for(const quality of ["high","minimal"] as const) {
    await page.goto(`${url}building-showcase.html?sample=1&nation=chinese&quality=${quality}`);
    await page.waitForFunction(()=>Boolean((window as any).__buildingReady));
    for(const level of levels) {
      const entry:GalleryCase={nation:"chinese",quality,id:37,level,name:"Farm"};
      const result=await page.evaluate(renderGalleryCase,{entry,views});
      assert(result.withinBudget,`Farm ${quality}/${level} strict budget`);
      for(const image of result.images) {
        const file=`${galleryCaseKey(entry)}-${image.view}.jpg`;
        writeFileSync(resolve(output,file),Buffer.from(image.encoded,"base64"));
        cards.push({...entry,file,view:image.view,triangles:result.triangles,withinBudget:result.withinBudget});
      }
      const {images:_images,...measurements}=result;rows.push({...entry,...measurements});
      if(level===1||level===5) {
        const encoded=await page.evaluate(async()=>{
          const t=await import(/* @vite-ignore */String("/node_modules/three/build/three.module.js"));
          const p=(window as any).__buildingPreview,root=p.model().root;
          const center=root.localToWorld(new t.Vector3(.72,1.09,-.80));
          const scale=root.getWorldScale(new t.Vector3()).x,camera=p.camera.clone();
          camera.position.copy(center).add(new t.Vector3(1.3,.65,-1.9).multiplyScalar(scale));
          camera.lookAt(center);camera.updateMatrixWorld(true);p.renderer.render(p.scene,camera);
          return p.renderer.domElement.toDataURL("image/jpeg",.94).split(",")[1];
        });
        const file=`${quality}-l${level}-rear-wing-close.jpg`;
        writeFileSync(resolve(output,file),Buffer.from(encoded,"base64"));rows.push({quality,level,macro:file});
      }
    }
  }
  const sheets:string[]=[];
  for(let first=0;first<cards.length;first+=12) {
    const tiles=cards.slice(first,first+12).map(card=>({encoded:readFileSync(resolve(output,card.file)).toString("base64"),
      label:`Farm37 ${card.quality} L${card.level} ${card.view}`}));
    const file=`sheet-${first/12+1}.jpg`;
    writeFileSync(resolve(output,file),Buffer.from(await page.evaluate(renderGallerySheet,tiles),"base64"));sheets.push(file);
  }
  const source=guard.finish();
  writeFileSync(resolve(output,"source-manifest.json"),JSON.stringify(source,null,2));
  writeFileSync(resolve(output,"report.json"),JSON.stringify({rows,errors,frames:targeted?8:24,targeted,sourceStable:source.stable},null,2));
  writeGalleryIndex(output,cards,{capturedVariants:targeted?4:10,complete:true,frames:cards.length,mode:"full",native:true,omitted:0,
    passed:source.stable&&!errors.length,sheets,variants:targeted?4:10});
  const index=resolve(output,"index.html");
  writeFileSync(index,readFileSync(index,"utf8").replace("<nav>",`<p>Actual rear-wing close views:
    <a href="high-l1-rear-wing-close.jpg">High L1</a> / <a href="high-l5-rear-wing-close.jpg">High L5</a> /
    <a href="minimal-l1-rear-wing-close.jpg">Minimal L1</a> / <a href="minimal-l5-rear-wing-close.jpg">Minimal L5</a>.</p><nav>`));
  assert.deepEqual(errors,[]);assert(source.stable,source.errors.join("\n"));
} finally {await browser?.close();await server.close();}
console.log(`Farm wing${targeted?8:24} FULL CLOSED`);
