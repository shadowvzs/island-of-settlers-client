import { writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { Box3, type Object3D, type SkinnedMesh, Triangle, Vector3 } from "three";

import { getRomanPartBounds } from "../../src/render-common/buildings/building-recipe-fit";
import { getBuildingStockContact } from "../../src/render-common/buildings/building-stock-anchors";
import { getBuildingStockLayout } from "../../src/render-common/buildings/building-stock-layout";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../src/render-common/workers/worker-unit";
import { loadCatapultCpuPoser } from "./catapult-cpu-poser";
import { createHatchAuditAssets } from "./catapult-hatch-assets";
import { createSoftLoadBodyClearance } from "./soft-load-body-clearance";

const assets = await createHatchAuditAssets();
const hooks = registerHooks({ load(url,context,next) {
  if (url.endsWith("/settlement/ware-material-cache.ts")) return { format:"module",shortCircuit:true,
    source:'import {MeshStandardMaterial} from "three"; const material=new MeshStandardMaterial();' +
      'export const acquireWareMaterials=()=>({materials:new Proxy({},{get:()=>material}),release(){}});' };
  return next(url,context);
} });
const posing = await loadCatapultCpuPoser();
const { nearestSurface } = await import("../bench/tannery-transfer-fixture");
const { createWorkerProp } = await import("../../src/renderers/three/three-worker-prop");
const records: unknown[] = [];
let maximumContactGap = 0, intersectingTableVertices = 0, intersectingTableFaces = 0, cargoBodyCrossings = 0;
const layout = getBuildingStockLayout(8,{nation:"chinese"});
const table = layout.recipe.parts.find(part => !part.stock && part.surface === "wood" &&
  part.position[0] > 1 && part.size[0] === .5 && part.size[1] === .06)!;
const tableBounds = getRomanPartBounds(table);
const minimum = tableBounds.min.map(value => value * layout.scale), maximum = tableBounds.max.map(value => value * layout.scale);
const vertex = new Vector3(), triangle = new Triangle();
const tableBox = new Box3(new Vector3(...minimum as [number,number,number]).addScalar(.002),
  new Vector3(...maximum as [number,number,number]).addScalar(-.002));
try {
  const variants = process.argv.includes("--all-bodies")
    ? ["chinese-male-1","chinese-male-2","chinese-male-3","chinese-female-1","chinese-female-2","chinese-female-3"]
    : ["chinese-male-1","chinese-female-3"];
  for (const minimal of [false,true]) for (const variant of variants) {
    const worker = await assets.civilian("chinese",variant,minimal); worker.root.scale.setScalar(WORKER_SCALE);
    const cargoClearance=createSoftLoadBodyClearance(worker.root);
    const poser = posing.createWorkerPoser(worker), props = createWorkerProp(assets.pack,worker,!minimal);
    const point = (name:string) => worker.root.getObjectByName(name)!.getWorldPosition(new Vector3());
    try {
      for (const ware of ["hides","leather"]) for (const direction of ["pickup","putdown"] as const) {
        const contact = getBuildingStockContact(8,ware==="hides"?"input":"output",ware,0,
          0,0,0,0,undefined,undefined,{nation:"chinese"})!;
        const [x,y,z] = contact.approach, [tx,ty,tz] = contact.warePosition;
        const heading = Math.atan2(tx-x,tz-z);
        worker.root.position.set(x,y,z); worker.root.rotation.y = heading;
        const base:WorkerFrame = {actorId:1,nation:"chinese",variant,x,y,z,heading,visible:true,selected:false,
          action:"idle_breathe",animationTime:0,gaitPhase:0,runBlend:0,target:null,carryingWare:null,workerJob:"Tanner"};
        poser(base); worker.root.updateMatrixWorld(true);
        const idleHips=point("Hips").y, feet=[point("LeftFoot"),point("RightFoot")];
        for(let step=0;step<=20;step++) {
          const progress=step/20;
          const carryScale=ware==="hides"&&direction==="putdown"?[WORKER_SCALE,WORKER_SCALE,WORKER_SCALE]:contact.wareScale;
          const frame:WorkerFrame={...base,carriedWareScale:{x:carryScale[0]!,y:carryScale[1]!,z:carryScale[2]!},
            carryingWare:direction==="putdown"?ware:null,wareTransfer:{ware,direction,progress,presentation:contact.presentation,
              target:{x:tx,y:ty,z:tz},yaw:contact.wareYaw,scale:contact.scale,
              scale3:{x:contact.wareScale[0],y:contact.wareScale[1],z:contact.wareScale[2]}}};
          poser(frame); props.update(frame); if(step===0) await Promise.resolve();
          worker.root.updateMatrixWorld(true);
          const prop: Object3D = worker.root.getObjectByName(`ware_${ware}`)!;
          const palms=["L","R"].map(side=> {
            const palm=point(`socket_hand_${side}`);
            const fullSide=side==="L"?"Left":"Right";
            const wrist=point(`${fullSide}Hand`),shoulder=point(`${fullSide}Arm`),elbow=point(`${fullSide}ForeArm`);
            const support=prop.userData[`softLoadSupport${fullSide}`] as number[]|undefined;
            return {side,position:palm.toArray(),surfaceDistance:nearestSurface(prop,palm),support,
              wrist:wrist.toArray(),socketOffset:palm.clone().sub(wrist).toArray(),
              armLength:shoulder.distanceTo(elbow)+elbow.distanceTo(wrist),shoulder:shoulder.toArray()};
          });
          const bounds = new Box3().setFromObject(prop);
          const contactWindow = direction === "pickup" ? progress >= .3 : progress <= .7;
          if (contactWindow) maximumContactGap=Math.max(maximumContactGap,...palms.map(palm=>palm.surfaceDistance));
          let tableVertices=0, tableFaces=0;
          const tableWitnesses:unknown[]=[];
          if (ware === "leather" && contactWindow) worker.root.traverse(object => {
            const mesh=object as SkinnedMesh;
            if (!mesh.isSkinnedMesh) return;
            const positions=mesh.geometry.getAttribute("position");
            const worldVertices=new Float64Array(positions.count*3);
            for(let at=0;at<positions.count;at++) {
              vertex.fromBufferAttribute(positions,at); mesh.applyBoneTransform(at,vertex).applyMatrix4(mesh.matrixWorld);
              vertex.toArray(worldVertices,at*3);
              if (vertex.x > minimum[0]! + .002 && vertex.x < maximum[0]! - .002 &&
                vertex.y > minimum[1]! + .002 && vertex.y < maximum[1]! - .002 &&
                vertex.z > minimum[2]! + .002 && vertex.z < maximum[2]! - .002) {
                tableVertices++;
                if (tableWitnesses.length<4) {
                  const joints=mesh.geometry.getAttribute("skinIndex"),weights=mesh.geometry.getAttribute("skinWeight");
                  const influences=[0,1,2,3].map(component=>({bone:mesh.skeleton.bones[joints.getComponent(at,component)]?.name,
                    weight:weights.getComponent(at,component)}));
                  tableWitnesses.push({mesh:mesh.name,vertex:at,position:vertex.toArray(),influences});
                }
              }
            }
            const index=mesh.geometry.index,count=index?.count??positions.count;
            for(let at=0;at<count;at+=3) {
              triangle.a.fromArray(worldVertices,(index?index.getX(at):at)*3);
              triangle.b.fromArray(worldVertices,(index?index.getX(at+1):at+1)*3);
              triangle.c.fromArray(worldVertices,(index?index.getX(at+2):at+2)*3);
              if(tableBox.intersectsTriangle(triangle)) tableFaces++;
            }
          });
          const cargoBody=contactWindow&&process.argv.includes("--cargo-body")?cargoClearance(prop):undefined;
          if(cargoBody)cargoBodyCrossings+=cargoBody.bodyEdgesThroughCargo+cargoBody.cargoEdgesThroughBody;
          intersectingTableFaces+=tableFaces;
          intersectingTableVertices+=tableVertices;
          records.push({variant,minimal,ware,direction,progress,palms,tableWitnesses,cargoBody,
            tableVertices,tableFaces,hipDrop:idleHips-point("Hips").y,
            footDrift:[point("LeftFoot").distanceTo(feet[0]!),point("RightFoot").distanceTo(feet[1]!)],
            shoulder:[point("LeftArm").toArray(),point("RightArm").toArray()],
            propBounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}});
        }
      }
    } finally {props.dispose();worker.dispose();}
  }
  const output = `../resources/project-reviews/tannery-tabletop-pickup-2026-11-04/cpu-pipeline-${process.argv[2]??"a"}.json`;
  await writeFile(output,JSON.stringify({records,maximumContactGap,intersectingTableVertices,intersectingTableFaces,cargoBodyCrossings,assets:Object.fromEntries(assets.assets)},null,2));
  console.log(JSON.stringify({poses:records.length,maximumContactGap,intersectingTableVertices,intersectingTableFaces,cargoBodyCrossings,output}));
  if (maximumContactGap > .002 || intersectingTableVertices || intersectingTableFaces || cargoBodyCrossings) throw new Error("Tabletop physical-contact gate failed");
} finally { hooks.deregister(); posing.restore(); assets.restore(); }
