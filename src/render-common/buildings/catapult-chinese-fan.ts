import type { BuildingPart, Point3 } from "./building-recipe";
import { runBetween } from "./nation-kit-parts";

type Add=(part:Omit<BuildingPart,"stage">)=>unknown;
/** A genuinely folded painted wall fan on its timber pivot, with two restrained flank fret panels. */
export const addChineseCatapultFan=(add:Add,centre:Point3,_detailed:boolean)=>{
  add({position:[centre[0],centre[1]-.145,centre[2]+.011],size:[.045,.045,.045],
    surface:"wood",shape:"cylinder",rotation:[Math.PI/2,0,0],radialSegments:8});
  add({position:[centre[0],centre[1],centre[2]+.030],size:[.60,.35,.06],
    surface:"paint",shape:"chinese-wall-fan"});
  // Two paired geometric scrolls sit in the free panels below the side windows.
  for(const side of [-1,1]){
    const x=side*.747,z=-.08,y=1.43,rotation:Point3=[0,side*Math.PI/2,0];
    add({position:[x,y,z],rotation,size:[.37,.145,.018],surface:"wood",shape:"box"});
    const path=[[-.15,-.045],[.15,-.045],[.15,.045],[-.10,.045],[-.10,0],[.065,0]];
    for(let i=0;i<path.length-1;i++){
      const a=path[i]!,b=path[i+1]!;
      runBetween(add,[x+side*.013,y+a[1]!,z-side*a[0]!],
        [x+side*.013,y+b[1]!,z-side*b[0]!],[.012,.012],{surface:"paint",tint:[.71,.57,.31]});
    }
  }
};
