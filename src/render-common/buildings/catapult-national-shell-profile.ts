import type { WorkerNation } from "../workers/worker-nation";
import { CATAPULT_SHAFT_HEIGHT } from "./catapult-dimensions";
import { CATAPULT_HATCH_WELL } from "./catapult-hatch";

export type CatapultShellNation=Exclude<WorkerNation,"maya">;
const H=CATAPULT_SHAFT_HEIGHT;

/** Radius to a rectangular face; the protected old staircase occupies the entire ±.52 square. */
const square=(angle:number,half:number)=>half/Math.max(Math.abs(Math.sin(angle)),Math.abs(Math.cos(angle)));
const chamfered=(angle:number,half:number,cut:number)=>Math.min(square(angle,half),
  (half*2-cut)/(Math.abs(Math.sin(angle))+Math.abs(Math.cos(angle))));

/** These are architectural profiles, not a change to the shared stair, hatch or throwing rig. */
export const catapultShellOuterRadius=(nation:CatapultShellNation,angle:number,y:number)=>{
  const fraction=Math.max(0,Math.min(1,y/H));
  let radius:number;
  switch(nation) {
    case "persian": radius=.82;break;
    case "viking": radius=.81;break;
    case "chinese": radius=chamfered(angle,.735,.22);break;
    case "nubian": radius=chamfered(angle,.80-fraction*.075,.13);break;
    case "indigenous": {
      const uneven=.008*Math.sin(angle*7+.8)+.006*Math.sin(angle*11-.3);
      radius=chamfered(angle,.765,.15)+uneven;break;
    }
    case "japanese": radius=square(angle,.70-fraction*.018);break;
    case "roman": radius=chamfered(angle,.745,.08);break;
  }
  // The old NW hatch throat extends beyond a circular shaft's diagonal. An upper stair/hatch
  // buttress retains its full protected pocket instead of forcing the worker through new stone.
  if(Math.sin(angle)<0&&Math.cos(angle)<0&&y>H-.90) {
    const blend=Math.max(0,Math.min(1,(y-(H-.90))/.20));
    radius=Math.max(radius,radius*(1-blend)+square(angle,.70)*blend);
  }
  return radius;
};

export const catapultShellInnerRadius=(nation:CatapultShellNation,angle:number,y:number)=>{
  // Retain the original square stair room inside the rounded outer shell. A concentric circular
  // interior would reduce all masonry to an implausibly thin sleeve just to protect four corners.
  let radius=square(angle,.535);
  if(y>=H-.70&&Math.sin(angle)<0&&Math.cos(angle)<0) {
    const well=CATAPULT_HATCH_WELL;
    const x=Math.abs(well.center[0])+well.lower/2+.015;
    const z=Math.abs(well.center[2])+well.lower/2+.015;
    // Preserve the old lid recess/landing rectangle, including its outer diagonal corner.
    radius=Math.max(radius,Math.min(x/Math.abs(Math.sin(angle)),z/Math.abs(Math.cos(angle))));
  }
  return radius;
};

/** Actual clear apertures; the two old window/garrison locations keep their shared height. */
export const catapultShellVoid=(angle:number,y:number)=>{
  const x=Math.sin(angle),z=Math.cos(angle);
  if(z>.8&&Math.abs(x)<.345&&y<.86)return "door";
  if(Math.abs(x)>.92&&z<.095&&z>-.30&&y>1.785&&y<2.105)return "window";
  return undefined;
};
