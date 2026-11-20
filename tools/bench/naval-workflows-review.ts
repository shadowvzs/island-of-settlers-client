import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const directory = resolve("../resources/settlement-previews/naval-workflows");
mkdirSync(directory, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = { errors: [], captures: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  await page.addInitScript("window.__name = (value) => value");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${url}building-showcase.html?building=36&quality=minimal`);
  await page.waitForFunction(() => Boolean((window as any).__buildingReady));
  const phases = await page.evaluate(async () => {
    const importModule = (path: string) => import(/* @vite-ignore */ path);
    const {createSettlementSimulation} = await importModule("/src/shared/settlement/settlement-simulation.ts");
    const {createRoadNetwork} = await importModule("/src/shared/settlement/road-network.ts");
    const {getBuildingDefinition} = await importModule("/src/render-common/buildings/building-catalog.ts");
    const size=150,heights=new Float32Array((size+1)**2);
    for(let z=0;z<=size;z++) for(let x=40;x<=103;x++) heights[z*(size+1)+x]=-2;
    const world={seed:1,fog:new Uint8Array(size**2),cellsX:size,cellsZ:size,seaLevel:-1,start:{x:5.5,z:5.5},heights,
      blocking:new Uint8Array(size**2),walkCost:new Uint8Array(size**2).fill(10),
      buildClass:new Uint8Array(size**2).fill(4),props:{count:0,types:new Uint8Array(),
        x:new Float32Array(),z:new Float32Array(),scale:new Float32Array()}};
    for(let z=0;z<size;z++) for(let x=40;x<=103;x++){world.walkCost[z*size+x]=0;world.blocking[z*size+x]=1;}
    let simulation:any;
    const roads=createRoadNetwork(world,{isBlocked:(x:number,z:number)=>simulation?.isOccupied(x,z)??false});
    simulation=createSettlementSimulation({world,roads,initialStock:{planks:150,stone:100,hammer:8}});
    const place=(id:number,x:number,z:number)=>{
      const [w,d]=getBuildingDefinition(id).gridFootprint;
      const result=simulation.placeBuilding(id,Math.floor(x-w/2)+w/2,Math.floor(z-d/2)+d/2);
      if(!result.ok)throw new Error(result.reason);
      if(!simulation.connectRoads(simulation.headquarters.access,result.building.access))throw new Error("Road failed");
      return result.building;
    };
    const from=place(39,35,10),to=place(39,34,39),yard=place(36,24,25);
    simulation.setShipyardMode(yard.uid,"ships");
    const snapshots:Record<string,any>={};
    const capture=(actor?:any)=>JSON.parse(JSON.stringify({ships:simulation.shipFrames(),sites:simulation.shipSites(),
      actor, buildings:simulation.buildings(), focus:actor??simulation.shipFrames()[0]??simulation.shipSites()[0]}));
    for(let i=0;i<24000 && !simulation.ships().length;i++){
      simulation.update(.05);
      const progress=simulation.shipSites()[0]?.progress;
      const shipwright=simulation.frames().find((actor:any)=>actor.job==="Shipwright"&&actor.phase==="shipWork"&&actor.action==="work"&&actor.timer<2);
      if(shipwright&&progress>=.4&&!snapshots.hullSideWork) {
        const site=simulation.shipSites()[0],contact=site.workPier?.contact;
        if(!contact||Math.hypot(shipwright.x-contact.x,shipwright.z-contact.z)>.43)throw new Error("Shipwright too far from hull contact");
        snapshots.hullSideWork=capture(shipwright);
        if(!simulation.loadState(simulation.saveState()).ok)throw new Error("Hull-side work reload rejected");
      }
      for(const [name,threshold] of [["keel",.1],["hull",.5],["rigging",.9]] as const)
        if(progress===threshold&&!snapshots[name])snapshots[name]=capture();
    }
    if(!simulation.ships().length)throw new Error("Real ship was not built");
    simulation.setProductionPaused(yard.uid,true);
    if(from.construction!==1||to.construction!==1)throw new Error("Harbor construction incomplete");
    simulation.buildings().find((b:any)=>b.uid===from.uid).inventory.fish=40;
    if(simulation.queueSeaTransport(from.uid,to.uid,{fish:40})===null)throw new Error("Voyage queue rejected");
    for(let i=0;i<3000;i++){
      simulation.update(.05);const ship=simulation.shipFrames()[0];
      if(ship.phase==="loading"&&!snapshots.loading)snapshots.loading=capture();
      if(ship.phase==="sailing"&&ship.z>15&&ship.z<32&&!snapshots.sailing)snapshots.sailing=capture();
      if(simulation.buildings().find((b:any)=>b.uid===to.uid).inventory.fish===40)break;
    }
    if(simulation.buildings().find((b:any)=>b.uid===to.uid).inventory.fish!==40)throw new Error("Real sea transport did not unload");
    if(Object.keys(snapshots).length!==6)throw new Error("Missing lifecycle captures");
    simulation.setShipyardMode(yard.uid,"boats");
    simulation.setProductionPaused(yard.uid,false);
    let boatReload=false;
    for(let i=0;i<12000 && !(simulation.headquarters.inventory.boat??0);i++) {
      simulation.update(.05);
      const actor=simulation.frames().find((a:any)=>a.job==="Shipwright"&&a.building===yard.uid);
      if(actor?.phase==="boatWork"&&(actor.boatWork??0)>.55&&!snapshots.boatWorkshop) {
        snapshots.boatWorkshop=capture(actor);
        if(!simulation.loadState(simulation.saveState()).ok) throw new Error("Boat reload rejected");
        boatReload=true;
      }
      if(actor?.phase==="home"&&actor.ware==="boat"&&!snapshots.boatCarry) snapshots.boatCarry=capture(actor);
    }
    if(!boatReload||simulation.headquarters.inventory.boat!==1)throw new Error("Boat not built/carried to HQ");
    simulation.setProductionPaused(yard.uid,true);
    const passengers=simulation.queueSeaPassengers(from.uid,to.uid,3);
    if(passengers===null)throw new Error("Passenger voyage rejected");
    for(let i=0;i<5000;i++) {
      simulation.update(.05);
      const ship=simulation.ships()[0];
      if(ship.phase==="sailing"&&ship.passengers===3&&!snapshots.passengerVoyage) {
        snapshots.passengerVoyage=capture();
        if(!simulation.loadState(simulation.saveState()).ok)throw new Error("Passenger sailing reload rejected");
      }
      if(snapshots.passengerVoyage&&ship.passengers===0)break;
    }
    world.fog=new Uint8Array(size**2);
    simulation.buildings().find((b:any)=>b.uid===from.uid).inventory.bow=3;
    const exploreTotal=simulation.availableSettlers()+simulation.frames().filter((a:any)=>a.phase!=="retired").length;
    if(simulation.queueSeaExploration(from.uid)===null)throw new Error("Exploration rejected");
    for(let tick=0;tick<18000;tick++) {
      simulation.update(.05);const ship=simulation.ships()[0];
      if(ship.exploration&&ship.phase==="sailing"&&!snapshots.explorationVoyage){
        snapshots.explorationVoyage=capture();
        if(!simulation.loadState(simulation.saveState()).ok)throw new Error("Exploration sailing reload failed");
      }
      if(ship.exploration&&ship.phase==="unloading"&&!snapshots.explorationShore)snapshots.explorationShore=capture();
      if(snapshots.explorationVoyage&&!ship.exploration)break;
    }
    if(!snapshots.explorationShore||simulation.ships()[0].exploration||
      simulation.buildings().find((b:any)=>b.uid===from.uid).inventory.bow!==3||!world.fog.some((v:number)=>v===1)||
      exploreTotal!==simulation.availableSettlers()+simulation.frames().filter((a:any)=>a.phase!=="retired").length)
      throw new Error("Exploration discovery or crew return failed");
    simulation.buildings().find((b:any)=>b.uid===from.uid).inventory={planks:4,stone:6,hammer:1};
    const destinations=simulation.seaExpeditionDestinations(from.uid);
    if(!destinations.length)throw new Error("No new shore found");
    const total=simulation.availableSettlers()+simulation.frames().filter((a:any)=>a.phase!=="retired").length;
    if(simulation.queueSeaExpedition(from.uid,destinations[0])===null)throw new Error("Expedition rejected");
    for(let i=0;i<10000;i++) {
      simulation.update(.05);
      const outpost=simulation.buildings().find((b:any)=>b.foundedByExpedition);
      if(outpost&&outpost.construction<1&&!snapshots.expeditionBuilding) {
        const actor=simulation.frames().find((a:any)=>a.uid===outpost.worker);
        snapshots.expeditionBuilding=capture(actor);
        if(!simulation.loadState(simulation.saveState()).ok)throw new Error("Expedition construction reload rejected");
      }
      if(outpost?.construction===1){snapshots.expeditionHarbour=capture();snapshots.expeditionHarbour.focus=outpost;break;}
    }
    if(!snapshots.expeditionHarbour)throw new Error("Harbour did not finish");
    if(total!==simulation.availableSettlers()+simulation.frames().filter((a:any)=>a.phase!=="retired").length)
      throw new Error("Population changed during expedition");
    (window as any).__navalSimulation=simulation;
    (window as any).__navalCapture={snapshots,world};return Object.keys(snapshots);
  });
  for (const quality of ["high", "minimal"]) for (const phase of phases.filter(phase => !process.env.NAVAL_CAPTURE_PHASE || phase === process.env.NAVAL_CAPTURE_PHASE)) {
    const metrics = await page.evaluate(async ({phase,quality,variant}) => {
      const importModule=(path:string)=>import(/* @vite-ignore */path);
      const THREE=await importModule("/node_modules/three/build/three.module.js");
      const {createThreeSettlementShips}=await importModule("/src/renderers/three/settlement/three-ships.ts");
      const old=(window as any).__navalScene;
      old?.ships.dispose();old?.renderer.dispose();
      (window as any).__buildingPreview?.renderer.setAnimationLoop(null);
      const state=(window as any).__navalCapture.snapshots[phase];
      const scene=new THREE.Scene();scene.background=new THREE.Color(0x9ec5cb);
      const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
      renderer.setSize(1100,850);renderer.setPixelRatio(1);renderer.shadowMap.enabled=true;
      renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure=1.2;
      document.body.replaceChildren(renderer.domElement);document.body.style.margin="0";
      const camera=new THREE.PerspectiveCamera(35,1100/850,.01,100);
      const focus=state.focus;
      camera.position.set(focus.x+4.1,focus.y+3.3,focus.z+4.9);camera.lookAt(focus.x,focus.y+.6,focus.z);
      if(phase==="hullSideWork") {
        const work=state.sites[0].workPier,nx=(work.point.x-work.contact.x)/.42,nz=(work.point.z-work.contact.z)/.42;
        camera.position.set(focus.x+nx*3.8-nz*2.8,focus.y+6,focus.z+nz*3.8+nx*2.8);
        camera.lookAt(focus.x,focus.y+.6,focus.z);
      }
      scene.add(new THREE.HemisphereLight(0xeef7ff,0x65553d,2.3));
      const sun=new THREE.DirectionalLight(0xffe2ba,3);sun.position.set(focus.x-4,8,focus.z+3);sun.castShadow=true;
      scene.add(sun);
      const terrain=new THREE.PlaneGeometry(150,150,150,150);terrain.rotateX(-Math.PI/2);
      const vertices=terrain.getAttribute("position");
      for(let i=0;i<vertices.count;i++){
        const x=vertices.getX(i)+75,z=vertices.getZ(i)+75;
        vertices.setXYZ(i,x,x>=40&&x<=103?-2:0,z);
      }
      terrain.computeVertexNormals();
      const ground=new THREE.Mesh(terrain,new THREE.MeshStandardMaterial({color:0x7b8058,roughness:1}));
      ground.receiveShadow=true;scene.add(ground);
      const water=new THREE.Mesh(new THREE.PlaneGeometry(150,150),new THREE.MeshStandardMaterial({
        color:0x3b7f91,roughness:.23,metalness:.16,transparent:true,opacity:.85}));
      water.rotation.x=-Math.PI/2;water.position.set(75,-1,75);scene.add(water);
      const ships=createThreeSettlementShips(quality);await ships.ready;scene.add(ships.group);ships.update(state.ships,state.sites,3);
      const {createRomanBuilding}=await importModule("/src/renderers/three/buildings/roman-building.ts");
      const {createRomanMaterials}=await importModule("/src/renderers/three/buildings/roman-materials.ts");
      const {getBuildingDefinition}=await importModule("/src/render-common/buildings/building-catalog.ts");
      const materials=createRomanMaterials(quality==="high");
      for(const building of state.buildings.filter((b:any)=>Math.hypot(b.x-focus.x,b.z-focus.z)<12)) {
        const house=createRomanBuilding(getBuildingDefinition(building.typeId),materials.materials,quality==="high");
        house.fitToGrid();house.root.position.set(building.x,building.y,building.z);house.root.rotation.y=building.rotation*Math.PI/2;
        house.update(0,{construction:building.construction,door:building.door,working:building.working,input:building.input,output:building.output});scene.add(house.root);
      }
      let workContact:any;
      if(state.actor) {
        const {ThreeWorkerPack}=await importModule("/@fs/home/shadowvzs/personal/island of settlers/game/island-of-settlers-worker-generation/src/game-three-worker.ts");
        const {createWorkerPoser,createWorkerTextureLoader}=await importModule("/src/renderers/three/three-worker.ts");
        const {createWorkerProp}=await importModule("/src/renderers/three/three-worker-prop.ts");
        const {createSettlementRenderFrames}=await importModule("/src/app/settlement/settlement-render-frames.ts");
        const {WORKER_SCALE}=await importModule("/src/render-common/workers/worker-dimensions.ts");
        const pack=new ThreeWorkerPack(new URL("workers/tripo/",location.href).href,createWorkerTextureLoader(renderer));
        const manifest=await fetch("workers/tripo/manifest.json").then(r=>r.json());
        const entry=manifest.workers.find((e:any)=>e.nation==="roman"&&(!variant||e.variant===variant));
        const worker=await pack.load(entry.nation,entry.variant);
        worker.root.scale.setScalar(WORKER_SCALE);worker.root.position.set(state.actor.x,state.actor.y,state.actor.z);worker.root.rotation.y=state.actor.yaw;scene.add(worker.root);
        const frames=createSettlementRenderFrames([{nation:entry.nation,variant:entry.variant}]);
        frames.updateWorkers([state.actor],.05);const frame=frames.workers[state.actor.uid];
        const pose=createWorkerPoser(worker);pose(frame);const prop=createWorkerProp(pack,worker,quality==="high");
        for(let wait=0;wait<100;wait++){pose(frame);prop.update(frame);await new Promise(resolve=>setTimeout(resolve,10));}
        if(phase==="hullSideWork") {
          const site=state.sites[0],work=site.workPier,hammer=worker.root.children.find((child:any)=>child.getObjectByName("hammer"));
          if(!hammer)throw new Error("Hammer not loaded beside ship");
          let closest=Infinity,closestTime=0,closest3D=Infinity;
          const hull=ships.group.getObjectByName("ship_hull"),hullTriangles:any[]=[];
          ships.group.updateMatrixWorld(true);
          hull.traverse((mesh:any)=>{if(!mesh.isMesh)return;const vertices=mesh.geometry.getAttribute("position"),index=mesh.geometry.index;
            for(let i=0;i<(index?.count??vertices.count);i+=3)hullTriangles.push(new THREE.Triangle(...[0,1,2].map(j=>mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(vertices,index?index.getX(i+j):i+j)))));
          });
          for(let tick=0;tick<120;tick++) {
            frame.animationTime=tick/60;pose(frame);prop.update(frame);worker.root.updateMatrixWorld(true);
            const head=hammer.localToWorld(new THREE.Vector3(0,.32,0));
            const distance=Math.hypot(head.x-work.contact.x,head.z-work.contact.z);
            const surfaceDistance=Math.min(...hullTriangles.map(triangle=>head.distanceTo(triangle.closestPointToPoint(head,new THREE.Vector3()))));
            if(surfaceDistance<closest3D){closest3D=surfaceDistance;closest=distance;closestTime=frame.animationTime;}
          }
          frame.animationTime=closestTime;pose(frame);prop.update(frame);worker.root.updateMatrixWorld(true);
          workContact={workerToHull:Math.hypot(state.actor.x-work.contact.x,state.actor.z-work.contact.z),hammerToHullHorizontal:closest,hammerToHull3D:closest3D,
            variant:entry.variant,hullFlag:frame.shipHullWork,handY:worker.root.getObjectByName("RightHand")?.getWorldPosition(new THREE.Vector3()).y,socketY:worker.root.getObjectByName("hand_R")?.getWorldPosition(new THREE.Vector3()).y,
            rampGrade:Math.abs(work.shoreY-work.y)/Math.hypot(work.point.x-work.shore.x,work.point.z-work.shore.z),
            pierLength:Math.hypot(work.point.x-work.shore.x,work.point.z-work.shore.z),centreToShore:Math.hypot(site.x-work.shore.x,site.z-work.shore.z)};
          if(closest3D>.25)throw new Error("Hammer cannot reach hull side: "+JSON.stringify(workContact));
        }
      }
      let cloth:any; ships.group.traverse((object:any)=>{if(object.isMesh&&object.name==="ship_sail")cloth=object.geometry.getAttribute("position");});
      const before=cloth?.getZ(Math.floor(cloth.count/2));ships.update(state.ships,state.sites,4);
      const sailMotion=cloth ? Math.abs(cloth.getZ(Math.floor(cloth.count/2))-before) : 0;
      ships.update(state.ships,state.sites,3);renderer.render(scene,camera);
      const triangles=renderer.info.render.triangles;
      const label=document.createElement("div");label.textContent=`Original Roman merchant craft · ${quality} · ${phase}`;
      label.style.cssText="position:fixed;left:24px;top:20px;color:#f9f5e8;font:20px system-ui;background:#273b40bb;padding:12px 16px;border-radius:8px";
      document.body.append(label);
      (window as any).__navalScene={scene,renderer,ships};
      return {quality,phase,triangles,craftTriangles:triangles-3202,shipCount:state.ships.length,siteCount:state.sites.length,cargo:focus.cargoCount??0,sailMotion,workContact};
    }, { quality, phase,variant:process.env.NAVAL_WORKER_VARIANT });
    const path=resolve(directory,`naval-${quality}-${phase}${process.env.NAVAL_WORKER_VARIANT?"-"+process.env.NAVAL_WORKER_VARIANT:""}.png`);
    await page.screenshot({path});(report.captures as unknown[]).push({...metrics,path});
  }
  // Fleet and building-details views are React now (tests/settlement-ui-fleet, tests/building-details); this
  // keeps the simulation half: the shipyard mode command and its save/load.
  const ui = await page.evaluate(() => {
    const simulation=(window as any).__navalSimulation;
    const yard=simulation.buildings().find((b:any)=>b.typeId===36);
    if(!simulation.setShipyardMode(yard.uid,"ships")||simulation.shipyardMode(yard.uid)!=="ships")throw new Error("Ship mode failed");
    if(!simulation.setShipyardMode(yard.uid,"boats")||simulation.shipyardMode(yard.uid)!=="boats")throw new Error("Boat mode failed");
    if(!simulation.loadState(simulation.saveState()).ok||simulation.shipyardMode(yard.uid)!=="boats")
      throw new Error("Production icon mode reload failed");
    return {mode:simulation.shipyardMode(yard.uid)};
  });
  report.ui=ui;
  report.errors=errors;
  if(errors.length)throw new Error(errors.join("\n"));
  writeFileSync(resolve(directory,process.env.NAVAL_CAPTURE_PHASE ? `contact-review${process.env.NAVAL_WORKER_VARIANT?"-"+process.env.NAVAL_WORKER_VARIANT:""}.json` : "native-review.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); await server.close(); }
