import {BoxGeometry,DoubleSide,Group,Mesh,MeshStandardMaterial,PlaneGeometry} from "three";

import type {BuildingPart} from "../../../render-common/buildings/building-recipe";
import { PIG_FEEDING_SURFACE_HEIGHT } from "../../../render-common/buildings/pig-feeding-layout";
import { PIG_VISUAL_SCALE } from "../../../render-common/wares/ware-dimensions";
import {createImportedPig,PIG_HEAD_PIVOT,PIG_MUZZLE} from "./imported-pig";

/** Ground covered by one walk cycle, in pig-model units (a short trotting step). */
const PIG_STRIDE = .36;
/** Leg order front-left, front-right, back-left, back-right. */
const DIAGONAL_PHASE = [0, Math.PI, Math.PI, 0];
const PIG_TURN_RATE = 2.5;

/** One resident breeding sow, and one active paid-cycle piglet; produced pig wares remain finite stock. */
export const createRomanPigResidents=(marker:BuildingPart|undefined,detailed:boolean)=>{
  if(!marker)return undefined;
  const root=new Group();root.name="pig_farm_residents";
  const animals=[0,1].map(index=>{
    const animal=createImportedPig(detailed);
    animal.pig.name=index?"breeding_piglet":"breeding_sow";
    animal.pig.position.set(index ? 1 : .65, marker.position[1] - .13, -.3);
    root.add(animal.pig);return animal;
  });
  const stream=new Mesh(detailed?new BoxGeometry(.012,.3,.012):new PlaneGeometry(.012,.3),new MeshStandardMaterial({side:DoubleSide,color:0x79b9d1,transparent:true,opacity:.65,roughness:.2}));
  stream.name="pig_farm_pour_stream";stream.userData.ownedMaterial=true;stream.visible=false;root.add(stream);
  const offset=marker.position[1]-.13;
  let previousTime: number | undefined;
  /** Walk cycle per pig, advanced by the distance it covers (feet never skate). */
  const gait = animals.map(() => 0);
  const update=(time:number,finished:boolean,phase:string|null|undefined,workTime:number|undefined)=>{
    const dt = previousTime === undefined ? 0 : Math.max(0, Math.min(.25, time - previousTime));
    previousTime = time;
    root.visible=finished && phase!==null; // Omitted in standalone previews: display authored breeding residents.
    const breeding=phase==="breeding",progress=breeding?Math.max(0,Math.min(1,(workTime??0)/24)):0;
    const approaching=phase==="grain"||phase==="water"||breeding;
    let amount=0;
    if(breeding)amount=1;
    else if(approaching)amount=Math.max(0,Math.min(1,(workTime??0)*2));
    animals.forEach((animal,index)=>{
      const scale=PIG_VISUAL_SCALE*(index?.5+.5*progress:1);
      animal.pig.visible=index?breeding:true;animal.pig.scale.setScalar(scale);
      const targetY=PIG_FEEDING_SURFACE_HEIGHT/scale,dy=targetY-PIG_HEAD_PIVOT[1];
      const angle=Math.atan2(PIG_MUZZLE[1],PIG_MUZZLE[2])-Math.asin(Math.max(-.95,Math.min(.95,dy/Math.hypot(PIG_MUZZLE[1],PIG_MUZZLE[2]))));
      const cycle = ((time + index * 7) % 24 + 24) % 24;
      const wandering = cycle < 16;
      const heading = Math.min(1, cycle / 16) * Math.PI * 2;
      const idleX = .84 + Math.cos(heading) * .12;
      const idleZ = -.4 + Math.sin(heading) * .06;
      animal.head.rotation.x=approaching ? angle*amount : .08 + Math.sin(time * 1.1) * .035;
      const muzzleZ=PIG_HEAD_PIVOT[2]+PIG_MUZZLE[1]*Math.sin(animal.head.rotation.x)+PIG_MUZZLE[2]*Math.cos(animal.head.rotation.x);
      const targetZ=.68-muzzleZ*scale;
      const previousX = animal.pig.position.x, previousZ = animal.pig.position.z;
      if (approaching) {
        animal.pig.position.set(index ? 1 : .65, offset, -.3 + (targetZ + .3) * amount);
        // Turn towards the trough rather than snapping round.
        const turn = Math.atan2(Math.sin(-animal.pig.rotation.y), Math.cos(-animal.pig.rotation.y));
        animal.pig.rotation.y += Math.max(-dt * PIG_TURN_RATE, Math.min(dt * PIG_TURN_RATE, turn));
      } else {
        const dx = idleX - previousX, dz = idleZ - previousZ;
        const distance = Math.hypot(dx, dz), step = wandering ? Math.min(distance, dt * .075) : 0;
        if (distance > .001 && step > 0) {
          animal.pig.position.x += dx / distance * step;
          animal.pig.position.z += dz / distance * step;
          const turn = Math.atan2(dx, dz) - animal.pig.rotation.y;
          animal.pig.rotation.y += Math.max(-dt * PIG_TURN_RATE, Math.min(dt * PIG_TURN_RATE,
            Math.atan2(Math.sin(turn), Math.cos(turn))));
        }
        animal.pig.position.y = offset;
      }
      const moved = Math.hypot(animal.pig.position.x - previousX, animal.pig.position.z - previousZ);
      gait[index] = (gait[index]! + moved / (PIG_STRIDE * scale)) % 1;
      const moving = moved > .00001;
      // Diagonal pairs swing together: front-left with back-right, front-right with back-left.
      animal.feet.forEach((foot, leg) => foot.rotation.x = moving
        ? Math.sin(gait[index]! * Math.PI * 2 + DIAGONAL_PHASE[leg]!) * .23 : 0);
      animal.tail.rotation.z=Math.sin(time*2+index)*.14;
    });
    stream.visible=phase==="water"&&(workTime??0)>.22&&(workTime??0)<.83;
    // Keep the upper pour point fixed while extending the lower end to the lowered water.
    const pourHeight = .41 - PIG_FEEDING_SURFACE_HEIGHT;
    stream.scale.y = pourHeight / .3;
    stream.position.set(1, offset + PIG_FEEDING_SURFACE_HEIGHT + pourHeight / 2, .68);
  };
  const dispose=()=>{animals.forEach(animal=>animal.dispose());stream.geometry.dispose();(stream.material as MeshStandardMaterial).dispose();};
  update(0,true,undefined,0);
  return{root,update,dispose,animals};
};
