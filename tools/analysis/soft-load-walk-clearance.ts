import { writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { Vector3 } from "three";

import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../src/render-common/workers/worker-unit";
import { loadCatapultCpuPoser } from "./catapult-cpu-poser";
import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { createSoftLoadBodyClearance } from "./soft-load-body-clearance";

const runId=process.argv[2];if(!runId||!/^[a-z0-9-]+$/.test(runId))throw new Error("Choose an explicit carry proof ID");
const assets=await createHatchAuditAssets();
const hooks=registerHooks({load(url,context,next){
  if(url.endsWith("/settlement/ware-material-cache.ts"))return {format:"module",shortCircuit:true,
    source:'import {MeshStandardMaterial} from "three";const material=new MeshStandardMaterial();'+
      'export const acquireWareMaterials=()=>({materials:new Proxy({},{get:()=>material}),release(){}});'};
  return next(url,context);
}});
const native=await loadCatapultCpuPoser();
const {createWorkerProp}=await import("../../src/renderers/three/three-worker-prop");
const {nearestSurface}=await import("../bench/tannery-transfer-fixture");
const originalNow=performance.now.bind(performance);let clock=0;
Object.defineProperty(performance,"now",{configurable:true,value:()=>clock});
const records:unknown[]=[];let maximumPalmGap=0,cargoBodyCrossings=0;
try {
  for(const minimal of [false,true])for(const gender of ["male","female"])for(const index of [1,2,3]) {
    const variant=`chinese-${gender}-${index}`,worker=await assets.civilian("chinese",variant,minimal);
    worker.root.scale.setScalar(WORKER_SCALE);
    const bodyClearance=createSoftLoadBodyClearance(worker.root),pose=native.createWorkerPoser(worker);
    const props=createWorkerProp(assets.pack,worker,!minimal);
    try {
      for(const ware of ["hides","leather"])for(const scale of [WORKER_SCALE,16/11]) {
        const base:WorkerFrame={actorId:1,nation:"chinese",variant,x:0,y:0,z:0,heading:0,visible:true,selected:false,
          action:"carry_back",animationTime:0,gaitPhase:0,runBlend:0,target:null,carryingWare:ware,workerJob:"Carrier",
          standingCarry:true,carriedWareScale:{x:scale,y:scale,z:scale}};
        for(let warm=0;warm<3;warm++){clock+=1000;pose(base);props.update(base);await Promise.resolve();}
        for(let step=-1;step<=20;step++) {
          const gait=Math.max(0,step)/20,frame={...base,gaitPhase:gait,standingCarry:step<0};
          clock+=50;pose(frame);props.update(frame);worker.root.updateMatrixWorld(true);
          const prop=worker.root.getObjectByName(`ware_${ware}`)!;
          const palms=["L","R"].map(side=>({side,distance:nearestSurface(prop,
            worker.root.getObjectByName(`socket_hand_${side}`)!.getWorldPosition(new Vector3()))}));
          const body=bodyClearance(prop);maximumPalmGap=Math.max(maximumPalmGap,...palms.map(palm=>palm.distance));
          cargoBodyCrossings+=body.bodyEdgesThroughCargo+body.cargoEdgesThroughBody;
          records.push({variant,minimal,ware,scale,gait,standing:step<0,palms,body});
        }
      }
    }finally{props.dispose();worker.dispose();}
  }
  const output=`../resources/project-reviews/tannery-tabletop-pickup-2026-11-04/cpu-carry-${runId}.json`;
  await writeFile(output,JSON.stringify({records,maximumPalmGap,cargoBodyCrossings,assets:Object.fromEntries(assets.assets)},null,2),{flag:"wx"});
  console.log(JSON.stringify({poses:records.length,maximumPalmGap,cargoBodyCrossings,output}));
  if(maximumPalmGap>.002||cargoBodyCrossings)throw new Error("Ordinary soft-load carry physical gate failed");
}finally{
  Object.defineProperty(performance,"now",{configurable:true,value:originalNow});
  hooks.deregister();native.restore();assets.restore();
}
