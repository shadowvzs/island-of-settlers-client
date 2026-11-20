import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, Point3 } from "./building-recipe";

export type ArchitecturalBambooPart = BuildingPart;
export type BambooAdd = (part: ArchitecturalBambooPart) => void;
/** Q's last photographed roof tint becomes the wall colour under the latest owner override. */
export const BAMBOO_FORESTER_WALL_TINT=[.58,.48,.40] as const;

/** Owner-approved contrast: weathered brown roofing, while structural wall bamboo stays golden. */
export const withBambooRoofTint=(part:ArchitecturalBambooPart):ArchitecturalBambooPart=>{
  const tint=part.tint??[1,1,1];
  return {...part,tint:[tint[0]*.45,tint[1]*.43,tint[2]*.67]};
};

export const addBambooPole = (add:BambooAdd, from:Point3, to:Point3, diameter:number, phase=0) => {
  const dx=to[0]-from[0],dy=to[1]-from[1],dz=to[2]-from[2],horizontal=DMath.hypot(dx,dz);
  add({position:[(from[0]+to[0])/2,(from[1]+to[1])/2,(from[2]+to[2])/2],
    rotation:[DMath.atan2(horizontal,dy),DMath.atan2(dx,dz),0],
    shape:"architectural-bamboo",bambooSection:"round",bambooPhase:phase,
    size:[diameter,DMath.hypot(horizontal,dy),diameter],stage:2,surface:"japanese-bamboo"});
};

/** Alternating open gutters and inverted caps shed water; staggered joints overlap each course. */
export const addJapaneseBambooRoof = (emit:BambooAdd, centre:Point3, width:number, depth:number,
  rise:number,detailed:boolean) => {
  const add:BambooAdd=part=>emit(withBambooRoofTint(part));
  const pitch=DMath.atan2(rise,width/2),slope=DMath.hypot(width/2,rise);
  const gutters=detailed?11:9,courses=detailed?2:1,spacing=depth/gutters;
  for(const side of [-1,1]) {
    // Closed, shallow bamboo mat underlay prevents bright cracks between the fitted culms.
    add({position:[centre[0]+side*width/4,centre[1]+rise/2-.028,centre[2]],
      rotation:[0,0,-side*pitch],shape:"box",size:[slope,.026,depth],
      surface:"japanese-bamboo",stage:4});
    for(let row=0;row<courses;row++)for(let channel=0;channel<gutters*2-1;channel++) {
      const t=(row+.5)/courses,cap=channel%2===1;
      add({position:[centre[0]+side*width/2*t,centre[1]+rise*(1-t)+(cap?.011:0),
        centre[2]-depth/2+spacing*(.5+channel*.5)],
      rotation:[-Math.PI/2,-side*Math.PI/2,-side*pitch],
      shape:"architectural-bamboo",bambooSection:"split",bambooConcave:!cap,
      bambooPhase:(row+channel*.31)%1,size:[spacing*.98,slope/courses+.055,spacing*.42],
      surface:"japanese-bamboo",stage:4,tint:cap?[1,.97,.91]:[.93,.95,.96]});
    }
    for(const z of [-depth/2+.035,depth/2-.035])
      addBambooPole(add,[centre[0],centre[1]+rise-.035,centre[2]+z],
        [centre[0]+side*width/2,centre[1]-.035,centre[2]+z],.052);
    for(const z of [-depth*.31,depth*.31])
      addBambooPole(add,[centre[0],centre[1]+rise-.045,centre[2]+z],
        [centre[0]+side*width/2,centre[1]-.045,centre[2]+z],.042,.3);
  }
  for(const x of [-.035,.035])addBambooPole(add,
    [centre[0]+x,centre[1]+rise+.018,centre[2]-depth/2-.012],
    [centre[0]+x,centre[1]+rise+.018,centre[2]+depth/2+.012],.066);
};
