import { writeFile } from "node:fs/promises";
import { MeshStandardMaterial, Quaternion, Vector3 } from "three";

import { getRomanPartBounds } from "../../src/render-common/buildings/building-recipe-fit";
import { getBuildingStockContact } from "../../src/render-common/buildings/building-stock-anchors";
import { getBuildingStockLayout } from "../../src/render-common/buildings/building-stock-layout";
import { WORKER_SCALE } from "../../src/render-common/workers/worker-dimensions";
import type { WorkerFrame } from "../../src/render-common/workers/worker-unit";
import { loadCatapultCpuPoser } from "./catapult-cpu-poser";
import { createHatchAuditAssets } from "./catapult-hatch-assets";

const assets = await createHatchAuditAssets(), posing = await loadCatapultCpuPoser();
const result: unknown[] = [];
const { createWareModel } = await import("../../src/renderers/three/settlement/ware-models");
const { createWorkerHide } = await import("../../src/renderers/three/worker-hide-transfer");
const { createSoftLoadHandContacts } = await import("../../src/renderers/three/worker-soft-load-contacts");
const { tabletopGripTargets } = await import("../../src/renderers/three/worker-tabletop-grips");
const material = new MeshStandardMaterial();
const materials = new Proxy({}, { get: () => material }) as Parameters<typeof createWareModel>[2];
try {
  const layout = getBuildingStockLayout(8, { nation: "chinese" });
  result.push({ scale: layout.scale, tableParts: layout.recipe.parts.filter(part => !part.stock &&
    part.surface === "wood" && part.position[0] > .9 && part.position[1] < .8).map(part =>
    ({ ...part, worldBounds: getRomanPartBounds(part) })) });
  for (const variant of ["chinese-male-1", "chinese-female-3"]) {
    const worker = await assets.civilian("chinese", variant, false);
    worker.root.scale.setScalar(WORKER_SCALE);
    const pose = posing.createWorkerPoser(worker);
    for (const ware of ["hides", "leather"]) {
      const contact = getBuildingStockContact(8, ware === "hides" ? "input" : "output", ware, 0,
        0, 0, 0, 0, undefined, undefined, { nation: "chinese" })!;
      const [x,y,z] = contact.approach, [tx,ty,tz] = contact.warePosition;
      const heading = Math.atan2(tx-x,tz-z);
      worker.root.position.set(x,y,z); worker.root.rotation.y = heading;
      const frame: WorkerFrame = { actorId:1,nation:"chinese",variant,x,y,z,heading,visible:true,
        selected:false,action:"idle_breathe",animationTime:0,gaitPhase:0,runBlend:0,target:null,
        carryingWare:null,workerJob:"Tanner",wareTransfer:{ware,direction:"pickup",progress:.35,
          target:{x:tx,y:ty,z:tz},presentation:contact.presentation,scale3:{x:contact.wareScale[0],y:contact.wareScale[1],z:contact.wareScale[2]}} };
      pose(frame); worker.root.updateMatrixWorld(true);
      const prop = ware === "hides" ? createWorkerHide(material, true) : createWareModel(ware, true, materials, "carry").root;
      worker.root.add(prop); prop.position.copy(worker.root.worldToLocal(new Vector3(tx,ty,tz)));
      prop.quaternion.copy(worker.root.getWorldQuaternion(new Quaternion()).invert()
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0), contact.wareYaw)));
      prop.scale.set(...contact.wareScale.map(value => value / WORKER_SCALE) as [number,number,number]);
      prop.userData.foldHide?.(0); worker.root.updateMatrixWorld(true);
      const localGrips = ware === "hides" ? prop.userData.hideGripTargets : tabletopGripTargets(prop,worker.root);
      createSoftLoadHandContacts(worker.root)(prop,frame.wareTransfer!);
      worker.root.updateMatrixWorld(true);
      const palms = ["L","R"].map((side,index) => {
        const palm = worker.root.getObjectByName(`socket_hand_${side}`)!.getWorldPosition(new Vector3());
        const target = prop.localToWorld(localGrips[index].clone());
        return { side, palm:palm.toArray(),target:target.toArray(),residual:palm.distanceTo(target) };
      });
      const point = (name:string) => worker.root.getObjectByName(name)!.getWorldPosition(new Vector3());
      const arms = ["Left","Right"].map(side => {
        const shoulder = point(`${side}Arm`), elbow = point(`${side}ForeArm`), hand = point(`${side}Hand`);
        const length = shoulder.distanceTo(elbow)+elbow.distanceTo(hand);
        const target = new Vector3(tx,ty,tz);
        return { side, shoulder:shoulder.toArray(), elbow:elbow.toArray(), hand:hand.toArray(),length,
          targetDistance: shoulder.distanceTo(target), deficit: shoulder.distanceTo(target)-length };
      });
      result.push({variant,ware,contact,hips:point("Hips").toArray(),spine:point("Spine").toArray(),arms,palms});
      prop.removeFromParent();
    }
    worker.dispose();
  }
  const output = "../resources/project-reviews/tannery-tabletop-pickup-2026-11-04/cpu-reach-c.json";
  await writeFile(output,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result.slice(1),null,2));
} finally { assets.restore(); posing.restore(); }
