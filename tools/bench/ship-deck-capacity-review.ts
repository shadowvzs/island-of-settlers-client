import assert from "node:assert/strict";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";

import {launchBrowser,startDevServer} from "./browser";
import {resourcesPath} from "./resources-path";
/**
 * Packs the measured real settlers, soldiers and crates into every deck slot of each nation's ship
 * (NATIONS, default all four; the passengers are that nation's own workers) and checks that no ship
 * geometry intersects a slot while the ship rocks and turns. DECK_REUSE=1 reuses the body measurements.
 */
const output=resourcesPath("settlement-previews","ship-deck-capacity");mkdirSync(output,{recursive:true});
const nations=(process.env.NATIONS??"roman,viking,japanese,nubian").split(",");
const {server,url}=await startDevServer();const browser=await launchBrowser();
try{for(const quality of ["high","minimal"]){
 const page=await browser.newPage({viewport:{width:1200,height:900}});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.routeWebSocket("**/*",()=>{});await page.addInitScript("window.__name=value=>value");
 await page.goto(`${url}building-showcase.html?building=0&quality=${quality}&sample=1`);await page.waitForFunction(()=>Boolean((window as any).__buildingReady));
 const cachedPath=resolve(output,`${quality}-review.json`);const cached=process.env.DECK_REUSE && existsSync(cachedPath)?JSON.parse(readFileSync(cachedPath,"utf8")):null;
 const result=await page.evaluate(async ({cached,nations,quality})=>{
 const preview=(window as any).__buildingPreview;preview.renderer.setAnimationLoop(null);preview.model().root.visible=false;
 const T=await import(/* @vite-ignore */String("/node_modules/three/build/three.module.js"));
 const W=await import(/* @vite-ignore */String("/src/renderers/three/three-worker.ts"));
 const P=await import(/* @vite-ignore */String("/src/renderers/three/three-worker-prop.ts"));
 const Pack=await import(/* @vite-ignore */String("/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-worker.ts"));
 const Armour=await import(/* @vite-ignore */String("/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-armour.ts"));
 const A=await import(/* @vite-ignore */String("/src/render-common/workers/worker-assets.ts"));
 const D=await import(/* @vite-ignore */String("/src/render-common/workers/worker-dimensions.ts"));
 const L=await import(/* @vite-ignore */String("/src/render-common/ships/ship-deck-layout.ts"));
 const S=await import(/* @vite-ignore */String("/src/renderers/three/settlement/three-ships.ts"));
 const textures=W.createWorkerTextureLoader(preview.renderer),pack=new Pack.ThreeWorkerPack(new URL(A.WORKER_ASSET_BASE+"tripo/",location.href).href,textures),armour=new Armour.ThreeArmourPack(new URL(A.WORKER_ASSET_BASE+"armour/",location.href).href,pack);
 const manifest=await fetch(A.WORKER_ASSET_BASE+"tripo/manifest.json").then(r=>r.json());
 const measure=(root:any)=>{root.updateMatrixWorld(true);const box=new T.Box3();const v=new T.Vector3();root.traverseVisible((mesh:any)=>{if(!mesh.isMesh)return;for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,v);v.applyMatrix4(mesh.matrixWorld);box.expandByPoint(v);}});return box;};
 const records:any[]=[];let maxCivil={width:0,height:0,depth:0},maxSoldier={width:0,height:0,depth:0};
 if(cached){records.push(...cached.records);maxCivil=cached.maxCivil;maxSoldier=cached.maxSoldier;}
 else for(const entry of manifest.workers)for(const rank of [null,"recruit","soldier","centurion"]){
 const worker=rank?await armour.loadSoldier(entry.nation,entry.variant,rank):await pack.load(entry.nation,entry.variant);if(rank)worker.setLod(quality==="high"?0:1);
 worker.root.scale.setScalar(D.WORKER_SCALE);preview.scene.add(worker.root);const pose=W.createWorkerPoser(worker),held=P.createWorkerProp(pack,worker,quality==="high");
 const frame:any={nation:entry.nation,variant:entry.variant,x:0,y:0,z:0,heading:0,selected:false,action:"idle_breathe",animationTime:0,gaitPhase:0,runBlend:0,target:null,workerJob:rank?"Soldier":"Settler",workerTool:rank?"sword":undefined,armourRank:rank};
 pose(frame);held.update(frame);await new Promise(r=>setTimeout(r,70));
 const box=new T.Box3();for(let phase=0;phase<8;phase++){frame.animationTime=phase/4;pose(frame);held.update(frame);box.union(measure(worker.root));}
 const size={width:2*Math.max(Math.abs(box.min.x),Math.abs(box.max.x)),height:box.max.y-box.min.y,depth:2*Math.max(Math.abs(box.min.z),Math.abs(box.max.z))};
 const envelope=rank?maxSoldier:maxCivil;for(const key of ["width","height","depth"] as const)envelope[key]=Math.max(envelope[key],size[key]);records.push({...entry,rank,size,minY:box.min.y});held.dispose();worker.root.removeFromParent();worker.dispose();
 }
 const layouts:any={civilian:L.layoutShipDeck(maxCivil,Infinity,0),soldier:L.layoutShipDeck(maxSoldier,Infinity,0),cargo:L.layoutShipDeck(maxCivil,0,Infinity),mixed:L.layoutShipDeck(maxSoldier,4,Infinity)};
 const captures:any[]=[];const checks:any[]=[];const camera=new T.PerspectiveCamera(35,innerWidth/innerHeight,.01,100);camera.position.set(12,15,12);camera.lookAt(0,2,0);
 for(const nation of nations){
 const layer=S.createThreeSettlementShips(quality);await layer.ready;const ship:any={id:1,x:0,y:0,z:0,yaw:0,phase:"idle",cargoCount:0};layer.update([ship],[],0,{playerNation:nation});preview.scene.add(layer.group);const craft=layer.group.children[0];
 const entry=manifest.workers.find((e:any)=>e.nation===nation)??manifest.workers.find((e:any)=>e.variant==="roman-man-dark");
 for(const [name,layout] of Object.entries(layouts) as any){
 const added:any[]=[];
 for(const slot of layout.slots){if(slot.kind==="crate"){
 const root=new T.Group(),mat=new T.MeshStandardMaterial({color:"#93623a",roughness:.95});
 const box=new T.Mesh(new T.BoxGeometry(.15,.1125,.15),mat);box.position.y=.05625;root.add(box);
 for(const x of [-.065,.065]){const slat=new T.Mesh(new T.BoxGeometry(.012,.11,.15),new T.MeshStandardMaterial({color:"#503725"}));slat.position.set(x,.05625,0);root.add(slat);}root.position.set(slot.x,slot.y,slot.z);craft.add(root);added.push({root,slot});
 }else{
 const rank=name==="civilian"?null:"centurion";const worker=rank?await armour.loadSoldier(entry.nation,entry.variant,rank):await pack.load(entry.nation,entry.variant);if(rank)worker.setLod(quality==="high"?0:1);worker.root.scale.setScalar(D.WORKER_SCALE/4);craft.add(worker.root);worker.root.position.set(slot.x,slot.y-(records.find((r:any)=>r.variant===entry.variant&&r.nation===entry.nation&&r.rank===rank).minY/4),slot.z);
 const pose=W.createWorkerPoser(worker),held=P.createWorkerProp(pack,worker,quality==="high"),frame:any={...entry,x:0,y:0,z:0,heading:0,selected:false,action:"idle_breathe",animationTime:.3,gaitPhase:0,runBlend:0,target:null,workerJob:rank?"Soldier":"Settler",workerTool:rank?"sword":undefined,armourRank:rank};pose(frame);held.update(frame);await new Promise(r=>setTimeout(r,70));pose(frame);held.update(frame);added.push({root:worker.root,held,worker,slot});
 }}
 for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5])for(const time of [0,1.5,3,4.5]){
 ship.yaw=yaw;layer.update([ship],[],time,{playerNation:nation});craft.updateMatrixWorld(true);
 let intersections=0;const collisions:any[]=[];const inv=craft.matrixWorld.clone().invert(),v=[new T.Vector3(),new T.Vector3(),new T.Vector3()],tri=new T.Triangle();
 for(const a of added){const actual=new T.Box3(),point=new T.Vector3();a.root.traverseVisible((mesh:any)=>{if(!mesh.isMesh)return;for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,point);point.applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);actual.expandByPoint(point);}});const b=a.slot.bounds;
 if(actual.min.x<b.minX-.002||actual.max.x>b.maxX+.002||actual.min.z<b.minZ-.002||actual.max.z>b.maxZ+.002||actual.min.y<b.minY-.002||actual.max.y>b.maxY+.002)throw new Error("Actual packed mesh escapes measured envelope: "+name+JSON.stringify({actual,b}));}
 craft.traverseVisible((mesh:any)=>{if(!mesh.isMesh||added.some(a=>{let o:any=mesh;while(o){if(o===a.root)return true;o=o.parent;}return false;}))return;
 const geom=mesh.geometry,index=geom.index,matrix=inv.clone().multiply(mesh.matrixWorld),count=index?index.count:geom.attributes.position.count;
 for(let i=0;i<count;i+=3){for(let j=0;j<3;j++)mesh.getVertexPosition(index?index.getX(i+j):i+j,v[j]).applyMatrix4(matrix);if(Math.max(...v.map((p:any)=>p.y))<=L.SHIP_DECK.floorY+.018)continue;tri.set(v[0],v[1],v[2]);for(const slot of layout.slots){const b=slot.bounds;const box=new T.Box3(new T.Vector3(b.minX+.002,b.minY+.005,b.minZ+.002),new T.Vector3(b.maxX-.002,b.maxY-.002,b.maxZ-.002));if(box.intersectsTriangle(tri)){intersections++;if(time===0&&yaw===0)collisions.push({mesh:mesh.name,slot:{kind:slot.kind,x:slot.x,z:slot.z,level:slot.level},vertices:v.map((p:any)=>p.toArray())});}}}
 });checks.push({nation,name,yaw,time,intersections,collisions});if(time===0){preview.renderer.render(preview.scene,camera);captures.push({name:`${nation}-${name}-${yaw.toFixed(2)}`,png:preview.renderer.domElement.toDataURL("image/png").split(",")[1]});}
 }
 for(const a of added){a.root.removeFromParent();a.held?.dispose();a.worker?.dispose();}
 }
 layer.dispose();}
 pack.dispose();textures.dispose();return {records,maxCivil,maxSoldier,layouts,checks,captures};
 },{quality,cached,nations});
 for(const capture of result.captures)writeFileSync(resolve(output,`${quality}-${capture.name}.png`),Buffer.from(capture.png,"base64"));
 writeFileSync(resolve(output,`${quality}-review.json`),JSON.stringify({...result,captures:result.captures.map(({png,...m}:any)=>m),errors},null,2));
 console.log(JSON.stringify({quality,maxCivil:result.maxCivil,maxSoldier:result.maxSoldier,counts:Object.fromEntries(Object.entries(result.layouts).map(([n,l]:any)=>[n,{passengers:l.passengers,crates:l.crates}])),intersections:result.checks.filter((c:any)=>c.intersections>0),errors}));assert.deepEqual(errors,[]);assert(result.records.length===96);assert(result.checks.every((c:any)=>c.intersections===0));await page.close();
}}finally{await browser.close();await server.close();}
